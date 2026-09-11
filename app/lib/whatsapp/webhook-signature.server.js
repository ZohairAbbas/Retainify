/**
 * Verifying Meta's X-Hub-Signature-256 on WhatsApp webhooks.
 *
 * Meta signs each delivery with the app secret of the app it is delivering FOR
 * — not of whoever owns the callback URL. So the secret that verifies an event
 * depends on which app's subscription produced it, and more than one app can
 * route events to this endpoint:
 *
 *   - Retainify's own app, for merchants connected through Embedded Signup.
 *     Its app-wide callback points elsewhere, so its events only reach us via a
 *     per-account callback override (see subscribeAppToWaba).
 *   - A sibling app (Convaify) whose app-wide callback is set to this URL. Its
 *     deliveries are signed with its own secret, and until this module every
 *     one of them was rejected with a 401 — delivered, read, replies and STOP
 *     opt-outs alike, 44 of 44, and never once logged as anything but noise.
 *
 * Accepting a second app's secret does not widen who can reach the handlers:
 * every accepted event is still HMAC-authenticated as coming from Meta, and one
 * for an account Retainify does not hold matches no shop and is ignored.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Every app secret whose signature this endpoint accepts: Retainify's own
 * first, then any listed in WHATSAPP_WEBHOOK_EXTRA_SECRETS (comma-separated).
 * Read per call rather than at import, so a changed .env takes effect on the
 * next reload without depending on module evaluation order.
 *
 * @returns {string[]}
 */
export function webhookSecrets(env = process.env) {
  const extra = String(env.WHATSAPP_WEBHOOK_EXTRA_SECRETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [String(env.META_APP_SECRET || "").trim(), ...extra].filter(Boolean);
}

/**
 * Does `header` ("sha256=<hex>") sign `raw` under any of `secrets`?
 *
 * Every secret is checked, and each comparison is constant-time, so the
 * response time does not reveal which secret — if any — came close.
 *
 * @param {string} raw - the exact request body Meta sent
 * @param {string} header - the X-Hub-Signature-256 value
 * @param {string[]} secrets
 * @returns {boolean}
 */
export function verifyWebhookSignature(raw, header, secrets) {
  const value = String(header || "");
  if (!value.startsWith("sha256=")) return false;
  const provided = Buffer.from(value.slice("sha256=".length), "hex");
  if (provided.length !== 32) return false;

  let matched = false;
  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(raw, "utf8").digest();
    if (timingSafeEqual(provided, expected)) matched = true;
  }
  return matched;
}
