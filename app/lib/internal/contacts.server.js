/**
 * Turning "a Growzar app user" into a Contact the flow engine can message.
 *
 * The engine identifies an enrollment by contactEmail throughout — the queue,
 * the workers, the exit evaluator and the suppression tables all key on it — so
 * an internal user has to exist as an ordinary Contact under the internal tenant
 * before anything can be sent to them.
 *
 * ── On the phone number ────────────────────────────────────────────────────
 * Email is the channel now; WhatsApp is next. A number supplied today is
 * recorded as a confirmed opt-in immediately, which is precisely what the
 * WhatsApp worker resolves on (a confirmed WhatsappSubscription for this
 * shop+contactEmail). That makes the second channel a matter of adding a
 * WhatsApp step to a flow, with no backfill and no second round of asking every
 * app team for numbers they already had.
 *
 * An earlier design keyed identity on the phone and synthesised
 * "{phone}@growzar.internal" addresses to satisfy the email-shaped enrollment
 * API. That is deliberately not what this does: those addresses are
 * undeliverable, the email worker checks suppression rather than consent before
 * sending, and a flow with an email step would have hard-bounced every message
 * against our own sending domain.
 */
import prisma from "../../db.server.js";
import { upsertContact, toE164 } from "../contacts/contacts.server.js";
import { recordOptIn } from "../whatsapp/optin.server.js";
import { INTERNAL_SHOP } from "./tenant.js";

/**
 * Has this number ever opted out of the internal tenant's WhatsApp?
 *
 * recordOptIn treats every call as a fresh opt-in: it re-subscribes the row and
 * deletes the suppression. That is right when a person opts in themselves — an
 * explicit re-opt-in wins — and wrong here, where the "opt-in" is a server
 * repeating a number it already sent. Apps send events for the same person
 * again and again (every "inactive"), so without this a user who replied STOP
 * would be quietly re-subscribed by the next event about them.
 *
 * So the API may create a subscription or refresh one that is still active, but
 * never revive one that was stopped. A suppression row, or a subscription in any
 * state other than "subscribed", means the person said no, and the API leaves it
 * exactly as it is.
 */
async function phoneHasOptedOut(rawPhone) {
  const check = toE164(rawPhone);
  // An unusable number is recordOptIn's to reject, with its own log line.
  if (!check.ok) return false;
  const [sub, suppressed] = await Promise.all([
    prisma.whatsappSubscription.findUnique({
      where: { shop_phoneNumber: { shop: INTERNAL_SHOP, phoneNumber: check.phone } },
      select: { status: true },
    }),
    prisma.whatsappSuppression.findUnique({
      where: { shop_phoneNumber: { shop: INTERNAL_SHOP, phoneNumber: check.phone } },
      select: { id: true },
    }),
  ]);
  return Boolean(suppressed) || (Boolean(sub) && sub.status !== "subscribed");
}

/** Same grammar the rest of the app validates addresses with. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validate a caller-supplied address. Rejects rather than repairs — a caller
 * that sent us a broken address needs to hear so, not have us guess.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, email: string } | { ok: false, error: string }}
 */
export function validateInternalEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) return { ok: false, error: "email is required." };
  if (email.length > 254) return { ok: false, error: "email is too long." };
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: `"${email}" is not a valid email address.` };
  }
  if (email.endsWith(".internal") || email.endsWith(".local")) {
    // Guards the exact mistake the old placeholder design would have made.
    return { ok: false, error: "email must be a real, deliverable address." };
  }
  return { ok: true, email };
}

/**
 * Create or refresh the Contact for a Growzar app user.
 *
 * @param {object} input
 * @param {string} input.email   validated address — the identity everything keys on
 * @param {string} [input.name]
 * @param {string} [input.phone] E.164; recorded as a confirmed WhatsApp opt-in
 * @param {string} [input.app]   which Growzar app sent them, for the audit trail
 * @returns {Promise<{ contact: object|null, created: boolean, whatsappOptIn: boolean }>}
 */
export async function upsertInternalContact({ email, name, phone, app }) {
  const { contact, created } = await upsertContact({
    shop: INTERNAL_SHOP,
    email,
    name: name || "",
    source: "internal_api",
    // These people installed one of our apps and gave us this address to run
    // their account on, which is the consent basis the whole feature rests on.
    // Recorded explicitly so the unsubscribe path has something to revoke —
    // an opt-out then flips this to "unsubscribed" like any other contact.
    subscriptionStatus: "subscribed",
    marketingConsentAt: new Date(),
    // revive: a user who uninstalled and came back should start receiving
    // lifecycle mail again, rather than staying soft-deleted forever.
    revive: true,
  });

  let whatsappOptIn = false;
  if (phone && contact && !(await phoneHasOptedOut(phone))) {
    // recordOptIn does the whole job — normalises to E.164, upserts the
    // subscription and writes the phone back onto the contact. The guard above
    // is what keeps its suppression-clearing from ever undoing a STOP.
    //
    // recordOptIn returns null on a number Meta could never deliver to, which
    // must not fail the email enrollment that is actually being asked for here.
    const sub = await recordOptIn({
      shop: INTERNAL_SHOP,
      phoneNumber: phone,
      contactEmail: email,
      optInMethod: "api",
      confirmed: true,
    }).catch((err) => {
      console.error(`[internal-api] opt-in failed for ${email}:`, err.message);
      return null;
    });
    whatsappOptIn = !!sub;
    if (!whatsappOptIn) {
      console.warn(
        `[internal-api] ${app || "unknown app"} sent an unusable phone for ${email} — ` +
          `contact stored, WhatsApp opt-in skipped`,
      );
    }
  }

  return { contact, created, whatsappOptIn };
}
