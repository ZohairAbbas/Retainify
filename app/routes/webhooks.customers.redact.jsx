/**
 * Shopify GDPR — customers/redact.
 *
 * Erases every record we hold for one shopper. The table list and the
 * case-insensitive matching both live in lib/privacy/gdpr.server.js; see the
 * notes there on why exact email matching silently under-deletes.
 */
import { authenticate } from "../shopify.server.js";
import { redactCustomer } from "../lib/privacy/gdpr.server.js";

export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  const customerEmail = payload?.customer?.email;
  if (!customerEmail) {
    // Everything we store is keyed on email; without one there is nothing to
    // erase. Acknowledge so Shopify stops retrying.
    console.warn(`[gdpr] customers/redact for ${shop} had no customer email — nothing to erase`);
    return new Response(null, { status: 200 });
  }

  try {
    const { deleted } = await redactCustomer(shop, customerEmail);
    const summary = Object.entries(deleted)
      .filter(([, n]) => n !== 0)
      .map(([table, n]) => `${table}=${n}`)
      .join(" ");
    // Log the tables touched, never the address — this log line would otherwise
    // reintroduce the PII we were asked to erase.
    console.log(`[gdpr] customers/redact complete for ${shop} — ${summary || "no rows held"}`);
  } catch (err) {
    console.error(`[gdpr] customers/redact failed for ${shop}:`, err.message);
    // 500 so Shopify retries — a failed erasure must not look like a success.
    return new Response("redaction failed", { status: 500 });
  }

  return new Response(null, { status: 200 });
};
