/**
 * Email link helpers — unsubscribe URLs and their signing.
 *
 * Open/click tracking is handled by the provider (Resend/SES) and ingested by
 * webhooks.resend.jsx / webhooks.ses.jsx, which write JourneyJob.openedAt and
 * clickedAt. There is no first-party link wrapper.
 *
 * ── Unsubscribe threat model ────────────────────────────────────────────────
 * The unsubscribe URL ships inside marketing email, so it is handled by parties
 * that are not the recipient: corporate link scanners, spam filters and inbox
 * prefetchers all issue GETs against every URL in a message. Any design where a
 * GET mutates state will silently unsubscribe real subscribers.
 *
 * So the contract is:
 *   GET  → never mutates. Renders a confirmation page.
 *   POST → mutates, and only with a valid signature.
 *
 * Two signatures exist because they answer different questions:
 *
 *   `t`  (unsubscribeToken)  — durable, embedded in the email itself. Proves the
 *        request carries a link we generated for this shop+email. Never expires,
 *        because an unsubscribe link must work for the life of the message.
 *        This is what RFC 8058 one-click POSTs (Gmail/Yahoo) present.
 *
 *   `ct` (confirmFormToken)  — short-lived, minted by the GET page. Proves a
 *        human loaded the confirmation page and clicked the button. This is what
 *        keeps links from BEFORE token signing existed working: they have no `t`,
 *        so the only way through is the page, which a prefetcher never clicks.
 */
import { createHmac } from "crypto";
import { normalizeEmail } from "../contacts/contacts.server.js";

const CONFIRM_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function appUrl() {
  // eslint-disable-next-line no-undef
  const url = process.env.SHOPIFY_APP_URL;
  if (!url) {
    // Loud rather than silent: a wrong base URL ships dead unsubscribe links to
    // every recipient, and the old "https://example.com" default made that
    // failure invisible until someone tried to unsubscribe.
    console.error(
      "[links] SHOPIFY_APP_URL is not set — unsubscribe links will be relative and unusable",
    );
    return "";
  }
  return url.replace(/\/+$/, "");
}

function secret() {
  // eslint-disable-next-line no-undef
  return process.env.SHOPIFY_API_SECRET || "";
}

function sign(payload) {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** Constant-time hex compare. Both sides are hex of a fixed length. */
function safeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/**
 * Durable unsubscribe signature for a shop+email pair.
 *
 * Deterministic and non-expiring by design — the same address always yields the
 * same token, so an unsubscribe link stays valid for the life of the email that
 * carries it. The email is normalized first so a link generated for
 * "Bob@Shop.com" still verifies when the POST arrives lowercased.
 */
export function unsubscribeToken(shop, email) {
  return sign(`${shop}:unsub:${normalizeEmail(email)}`);
}

export function verifyUnsubscribeToken(shop, email, token) {
  if (!token || token.length !== 64) return false;
  return safeEqual(unsubscribeToken(shop, email), token);
}

/**
 * Short-lived signature minted by the confirmation page and submitted with its
 * form. `issuedAt` is carried in the clear alongside it so the verifier can
 * recompute the same payload and enforce the window.
 */
export function confirmFormToken(shop, email, issuedAt) {
  return sign(`${shop}:unsubconfirm:${normalizeEmail(email)}:${issuedAt}`);
}

export function verifyConfirmFormToken(shop, email, issuedAt, token) {
  const ts = Number(issuedAt);
  if (!Number.isFinite(ts)) return false;
  // Reject future timestamps (clock skew tolerance of 5 minutes) and stale ones.
  const age = Date.now() - ts;
  if (age < -5 * 60 * 1000 || age > CONFIRM_TOKEN_TTL_MS) return false;
  if (!token || token.length !== 64) return false;
  return safeEqual(confirmFormToken(shop, email, ts), token);
}

/**
 * Build the signed one-click unsubscribe URL embedded in outgoing email.
 *
 * This same URL is used for the visible "Unsubscribe" link (where it is fetched
 * with GET and renders a confirmation page) and for the List-Unsubscribe header
 * (where mailbox providers POST to it directly per RFC 8058).
 */
export function buildUnsubscribeUrl({ shop, email }) {
  const normalized = normalizeEmail(email);
  const params = new URLSearchParams({
    shop,
    email: normalized,
    t: unsubscribeToken(shop, normalized),
  });
  return `${appUrl()}/track/unsubscribe?${params.toString()}`;
}

/**
 * RFC 2369 + RFC 8058 headers for a marketing send.
 *
 * Gmail and Yahoo's bulk-sender requirements make one-click unsubscribe
 * mandatory; without these the mailbox provider has no machine-readable way to
 * unsubscribe and throttles or spam-folders the sender. `List-Unsubscribe-Post`
 * is what tells them the URL accepts a POST and no confirmation step is needed.
 *
 * @param {{ unsubscribeUrl?: string }} args
 * @returns {Record<string,string>} empty when there is no URL to advertise
 */
export function listUnsubscribeHeaders({ unsubscribeUrl }) {
  if (!unsubscribeUrl) return {};
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
