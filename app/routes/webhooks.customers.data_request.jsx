/**
 * Shopify GDPR — customers/data_request.
 *
 * Shopify's contract is that the APP delivers the shopper's data to the STORE
 * OWNER, who then passes it to the shopper. Acknowledging with a bare 200 (the
 * previous behaviour) satisfies the retry logic but not the obligation, and it
 * is checked during app review.
 *
 * We respond 200 immediately and do the work afterwards: Shopify expects an
 * acknowledgement within seconds, while collecting the data and sending the
 * export email takes longer than that budget allows.
 */
import { authenticate, unauthenticated } from "../shopify.server.js";
import prisma from "../db.server.js";
import { collectCustomerData } from "../lib/privacy/gdpr.server.js";
import { sendEmail, resolveFrom, resolveProvider } from "../lib/email/index.server.js";

const SHOP_OWNER_QUERY = `#graphql
  query shopContact {
    shop {
      name
      email
      contactEmail
    }
  }
`;

export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  const customerEmail = payload?.customer?.email || "";
  const requestId = payload?.data_request?.id || "unknown";

  // Fire-and-forget so the 200 lands inside Shopify's acknowledgement window.
  deliverExport({ shop, customerEmail, requestId }).catch((err) =>
    console.error(`[gdpr] data_request ${requestId} for ${shop} failed:`, err.message),
  );

  return new Response(null, { status: 200 });
};

async function deliverExport({ shop, customerEmail, requestId }) {
  if (!customerEmail) {
    // Shopify can send a request for a customer with no email on file. There is
    // nothing for us to look up — we key everything on email.
    console.warn(`[gdpr] data_request ${requestId} for ${shop} had no customer email — nothing to export`);
    return;
  }

  const data = await collectCustomerData(shop, customerEmail);
  const owner = await resolveOwnerEmail(shop);

  if (!owner) {
    // Log the export so it is recoverable manually rather than lost outright.
    console.error(
      `[gdpr] data_request ${requestId} for ${shop}: could not resolve a store-owner address. ` +
        `Export withheld — deliver manually for ${customerEmail}.`,
    );
    return;
  }

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const provider = resolveProvider(settings);
  const { from } = resolveFrom({ settings, provider });

  const json = JSON.stringify(data, null, 2);
  const result = await sendEmail(
    {
      to: owner,
      from,
      replyTo: "",
      subject: `Customer data request — ${customerEmail}`,
      html: exportHtml({ customerEmail, requestId, json }),
      text: `Customer data request for ${customerEmail} (request ${requestId}).\n\nThe data Retainify holds for this shopper is below.\n\n${json}`,
      // Transactional compliance mail: no List-Unsubscribe, and it must not be
      // suppressible. Deliberately not routed through the marketing headers.
    },
    { shop, settings },
  );

  if (!result.ok) {
    console.error(`[gdpr] data_request ${requestId} export email to ${owner} failed:`, result.error);
    return;
  }
  console.log(`[gdpr] data_request ${requestId} export for ${shop} delivered to store owner`);
}

/**
 * The store owner's address. Prefer Shopify's own record; fall back to the
 * session that installed the app, which is all we have if the Admin API call
 * fails (e.g. the token was revoked between the request and this handler).
 */
async function resolveOwnerEmail(shop) {
  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(SHOP_OWNER_QUERY);
    const body = await response.json();
    const s = body?.data?.shop;
    const email = s?.email || s?.contactEmail;
    if (email) return email;
  } catch (err) {
    console.warn(`[gdpr] could not read shop contact for ${shop}: ${err.message}`);
  }

  const session = await prisma.session
    .findFirst({
      where: { shop, email: { not: null } },
      orderBy: { accountOwner: "desc" },
      select: { email: true },
    })
    .catch(() => null);

  return session?.email || null;
}

function exportHtml({ customerEmail, requestId, json }) {
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#1a1a1a;padding:24px;">
  <h2 style="margin:0 0 8px;font-size:19px;">Customer data request</h2>
  <p style="margin:0 0 4px;">A shopper has asked for the personal data stored about them.</p>
  <p style="margin:0 0 4px;"><strong>Customer:</strong> ${customerEmail}</p>
  <p style="margin:0 0 16px;"><strong>Shopify request ID:</strong> ${requestId}</p>
  <p style="margin:0 0 16px;">Below is everything Retainify holds for this shopper. Forward it to them to complete the request.</p>
  <pre style="background:#f5f5f3;border:1px solid #e2e2de;border-radius:6px;padding:16px;font-size:12px;white-space:pre-wrap;word-break:break-word;">${escaped}</pre>
</body></html>`;
}
