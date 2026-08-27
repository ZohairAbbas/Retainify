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
// Last-resort SES sender if SES_FROM_EMAIL is unset. Must be on our SES-verified
// domain (mail.financifyapp.com) — SES rejects any unverified from-identity, so
// we must NOT fall back to the Resend address here.
const DEFAULT_SES_FROM_EMAIL = "hello@mail.financifyapp.com";

// Deliberately the same shape the providers accept for `reply_to`. Anything
// this rejects, they reject too.
const REPLY_TO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validate a merchant-supplied Reply-To before it can reach the database.
 *
 * This is not cosmetic. A malformed `reply_to` does not degrade the send — the
 * provider 422s the ENTIRE request, so `from` and `to` being perfectly valid
 * changes nothing and every email for that shop stops. Worse, the message is
 * never accepted, so it leaves no trace in the provider dashboard either.
 * A bare mailbox ("hello" instead of "hello@shop.com") is the realistic way in.
 *
 * Empty is valid and means "no explicit Reply-To" — resolveFrom() then falls
 * back to senderEmail.
 *
 * We reject rather than repair: auto-appending a domain guesses at an intent
 * the merchant may not share, and hides that they typed something wrong.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateReplyTo(raw) {
  const value = String(raw || "").trim();
  if (!value) return { ok: true, value: "" };
  if (REPLY_TO_RE.test(value)) return { ok: true, value };
  return {
    ok: false,
    error: value.includes("@")
      ? "Reply-to must be a valid email address, like support@yourstore.com."
      : `"${value}" is not a complete email address — include the domain, like ${value}@yourstore.com.`,
  };
}

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
  const merchantReplyTo =
    settings?.replyTo || settings?.senderEmail || process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL;

  // Mode B (default) — the merchant's sending domain is NOT verified, so we send
  // from OUR shared verified address and put the merchant in Reply-To. This holds
  // for BOTH providers: SES and Resend each reject an unverified from-domain, so
  // the gate is `domainVerified`, not the provider.
  if (!settings?.domainVerified) {
    const sharedFrom =
      provider === "ses"
        ? process.env.SES_FROM_EMAIL || DEFAULT_SES_FROM_EMAIL
        : process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL;
    return {
      from: `${senderName} <${sharedFrom}>`,
      replyTo: merchantReplyTo,
    };
  }

  // Mode A — merchant's own domain is verified; send as their chosen mailbox.
  // senderEmail is `[mailbox]@verifiedDomain`, validated at save time.
  const merchantEmail =
    settings?.senderEmail || process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL;
  return {
    from: `${senderName} <${merchantEmail}>`,
    replyTo: merchantReplyTo,
  };
}

/**
 * The workspace's public website — the {store_url} merge tag, and the fallback
 * href for any email button left without a URL.
 *
 * Order matters: an explicit setting always wins, because a Shopify merchant
 * with a custom domain wants their real storefront in the email, not the
 * .myshopify.com address. Falling back to the shop key only works when that key
 * IS a domain, which is true for a Shopify install and false for a direct
 * workspace — where returning "" is correct, since a wrong host is worse than
 * an absent one (the renderer degrades an empty store_url to "#").
 *
 * @param {{ shop?: string, settings?: object }} args
 * @returns {string} absolute URL, or "" when the workspace has no website
 */
export function resolveStoreUrl({ shop, settings }) {
  const explicit = String(settings?.websiteUrl || "").trim();
  if (explicit) return normalizeUrl(explicit);
  if (isShopifyShop(shop)) return `https://${shop}`;
  return "";
}

/**
 * The cart URL for {cart_url} when no real recovery link is available.
 * Only a storefront has a cart, so this is empty for a direct workspace.
 */
export function resolveCartUrl({ shop, settings }) {
  const base = resolveStoreUrl({ shop, settings });
  if (!base || !isShopifyShop(shop)) return "";
  return `${base.replace(/\/+$/, "")}/cart`;
}

/** A Shopify tenant key is the shop's own domain; a direct one is a slug. */
export function isShopifyShop(shop) {
  return /\.myshopify\.com$/i.test(String(shop || ""));
}

/** Accept "acme.com" as well as "https://acme.com" — merchants type both. */
function normalizeUrl(raw) {
  const v = String(raw).trim().replace(/\/+$/, "");
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
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
