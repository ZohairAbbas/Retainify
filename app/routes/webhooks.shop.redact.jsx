/**
 * Shopify GDPR — shop/redact, delivered 48h after uninstall.
 *
 * Erases every record we hold for the shop. The table list lives in
 * lib/privacy/gdpr.server.js so it stays reviewable in one place; the previous
 * inline version covered 8 tables and left 11 behind, including WhatsappAccount
 * and its encrypted Meta access token.
 */
import { authenticate } from "../shopify.server.js";
import { redactShop } from "../lib/privacy/gdpr.server.js";

export const action = async ({ request }) => {
  const { shop } = await authenticate.webhook(request);

  const deleted = await redactShop(shop);

  const failures = Object.entries(deleted).filter(([, n]) => n === -1);
  const summary = Object.entries(deleted)
    .filter(([, n]) => n > 0)
    .map(([table, n]) => `${table}=${n}`)
    .join(" ");

  if (failures.length) {
    console.error(
      `[gdpr] shop/redact for ${shop} partially failed — ${failures.map(([t]) => t).join(", ")}`,
    );
    // Retry: a partial erasure is not a completed one.
    return new Response("partial redaction", { status: 500 });
  }

  console.log(`[gdpr] shop/redact complete for ${shop} — ${summary || "no rows held"}`);
  return new Response(null, { status: 200 });
};
