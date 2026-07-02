/**
 * Email provider seam.
 *
 * Single entry point for sending email. Resolves which provider a shop uses
 * (ShopSettings.emailProvider, default "resend") and dispatches to the matching
 * adapter. Resend behavior is unchanged; SES is opt-in per shop.
 *
 * Also owns from/replyTo resolution so the SES "send-on-behalf-of-merchant"
 * (Mode B) logic lives in one place instead of being duplicated across callers.
 */
import prisma from "../../db.server.js";
import { sendEmail as sendViaResend } from "./resend.server.js";
import { sendEmail as sendViaSes } from "./ses.server.js";

const DEFAULT_FROM_EMAIL = "noreply@retainify.app";

/**
 * Resolve a shop's email provider. Defaults to "resend" for any
 * unset/empty/unknown value so nothing changes until a shop is explicitly
 * flipped to "ses".
 * @param {{ emailProvider?: string } | null | undefined} settings
 * @returns {"resend" | "ses"}
 */
export function resolveProvider(settings) {
  return settings?.emailProvider === "ses" ? "ses" : "resend";
}

/**
 * Build the `from` and `replyTo` addresses for a send, accounting for the
 * provider and (for SES) whether the merchant's own domain is verified.
 *
 * - Resend: send as the merchant's configured sender address (existing behavior).
 * - SES + merchant domain verified (Mode A): same — send as merchant address.
 * - SES + domain NOT verified (Mode B, default): send from our verified SES
 *   domain (SES_FROM_EMAIL) and put the merchant address in Reply-To. SES
 *   rejects unverified from-identities, so this keeps sends deliverable with
 *   zero merchant DNS setup.
 *
 * @param {object} args
 * @param {object|null} args.settings - ShopSettings row
 * @param {"resend"|"ses"} args.provider
 * @returns {{ from: string, replyTo: string }}
 */
export function resolveFrom({ settings, provider }) {
  const senderName = settings?.senderName || "Your Store";
  const merchantEmail =
    settings?.senderEmail || process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL;
  const merchantReplyTo = settings?.replyTo || merchantEmail;

  if (provider === "ses" && !settings?.domainVerified) {
    // Mode B — send from our verified SES domain, reply goes to the merchant.
    const sesFrom =
      process.env.SES_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL;
    return {
      from: `${senderName} <${sesFrom}>`,
      replyTo: merchantEmail,
    };
  }

  // Resend, or SES with a verified merchant domain (Mode A).
  return {
    from: `${senderName} <${merchantEmail}>`,
    replyTo: merchantReplyTo,
  };
}

/**
 * Send an email through the shop's configured provider.
 *
 * @param {import('./adapter.server.js').SendEmailOptions} options
 * @param {{ shop?: string, settings?: object }} ctx - `shop` selects the
 *   provider (looked up if `settings` not supplied). `settings` may be passed
 *   to avoid a redundant ShopSettings query.
 * @returns {Promise<import('./adapter.server.js').SendEmailResult>}
 */
export async function sendEmail(options, { shop, settings } = {}) {
  let resolvedSettings = settings;
  if (!resolvedSettings && shop) {
    resolvedSettings = await prisma.shopSettings.findUnique({ where: { shop } });
  }

  const provider = resolveProvider(resolvedSettings);
  const send = provider === "ses" ? sendViaSes : sendViaResend;
  return send(options);
}
