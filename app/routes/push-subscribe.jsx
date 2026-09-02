import prisma from "../db.server.js";
import { upsertContact, normalizeEmail } from "../lib/contacts/contacts.server.js";
import { recalcContactPushEnabled } from "../lib/contacts/engagement.server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
  }

  const { shop, endpoint, p256dh, auth, anonId } = body;
  if (!shop || !endpoint || !p256dh || !auth) {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
  }

  // Stored lowercased. Every consumer joins this column to Contact.email, which
  // is always normalized on write, so a subscription saved with the case the
  // browser happened to send matched nothing — neither the push worker looking
  // for a recipient's endpoints nor the pushEnabled rollup below.
  const contactEmail = normalizeEmail(body.contactEmail) || null;

  await prisma.pushSubscription.upsert({
    where: { shop_endpoint: { shop, endpoint } },
    create: {
      shop,
      endpoint,
      p256dh,
      auth,
      anonId: anonId ?? null,
      contactEmail,
    },
    update: {
      isActive: true,
      p256dh,
      auth,
      ...(anonId ? { anonId } : {}),
      ...(contactEmail ? { contactEmail } : {}),
    },
  });

  if (contactEmail) {
    // Sequenced, not parallel: pushEnabled is a column on Contact, so the row
    // has to exist before it can be set. Still off the response path — the
    // browser doesn't wait on either.
    upsertContact({ shop, email: contactEmail, source: "push_only" })
      .then(() => recalcContactPushEnabled(shop, contactEmail))
      .catch((err) => console.error("[push-subscribe] contact rollup failed:", err.message));
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return new Response(null, { status: 405 });
};
