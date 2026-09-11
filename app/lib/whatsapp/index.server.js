/**
 * WhatsApp provider seam — single entry point for sending WhatsApp messages.
 *
 * Mirrors the email seam (app/lib/email/index.server.js): resolves the shop's
 * connected WABA, decrypts its token, and dispatches to the provider adapter.
 * Only the Meta Cloud API is wired today; the resolveProvider indirection keeps
 * the door open for BSPs without touching the worker.
 */
import prisma from "../../db.server.js";
import { decryptSecret } from "../crypto/secrets.server.js";
import {
  sendWhatsappMessage as sendViaMeta,
  sendSessionText,
  registerPhoneNumber,
  getRegistrationStatus,
} from "./cloud-api.server.js";

/**
 * @param {{ whatsappProvider?: string } | null | undefined} settings
 * @returns {"meta"}
 */
export function resolveProvider(settings) {
  // Only "meta" exists today; anything else falls back to it.
  return settings?.whatsappProvider === "meta" ? "meta" : "meta";
}

/**
 * Load a shop's connected WABA. Returns null if not connected.
 * @param {string} shop
 * @returns {Promise<import('@prisma/client').WhatsappAccount | null>}
 */
export async function resolveAccount(shop) {
  if (!shop) return null;
  const account = await prisma.whatsappAccount.findUnique({ where: { shop } });
  if (!account || account.status !== "connected") return null;
  return account;
}

/**
 * Send a WhatsApp template message through the shop's connected provider.
 *
 * @param {{ to: string, templateName: string, language?: string, components?: Array<object> }} message
 * @param {{ shop: string, account?: object }} ctx - `settings` is accepted for
 *   call-site compatibility but unused (single provider today).
 * @returns {Promise<import('./adapter.server.js').SendWhatsappResult>}
 */
export async function sendWhatsapp(message, { shop, account } = {}) {
  const creds = await resolveCreds(shop, account);
  if (creds.error) return { ok: false, error: creds.error };

  const result = await sendViaMeta({
    phoneNumberId: creds.phoneNumberId,
    accessToken: creds.accessToken,
    to: message.to,
    templateName: message.templateName,
    language: message.language,
    components: message.components,
  });
  await recordSendOutcome(shop, result);
  return result;
}

/**
 * Resolve a shop's connected WABA credentials (phoneNumberId + decrypted token).
 * @returns {Promise<{ phoneNumberId?: string, accessToken?: string, error?: string }>}
 */
async function resolveCreds(shop, account) {
  const resolvedAccount = account || (await resolveAccount(shop));
  if (!resolvedAccount) return { error: "no connected WhatsApp account for shop" };
  try {
    return {
      phoneNumberId: resolvedAccount.phoneNumberId,
      accessToken: decryptSecret(resolvedAccount.accessTokenEnc),
    };
  } catch (err) {
    return { error: `token decrypt failed: ${err.message}` };
  }
}

/**
 * Send a free-form text message (24h session window only). For testing.
 * @param {{ to: string, text: string }} message
 * @param {{ shop: string, account?: object }} ctx
 * @returns {Promise<import('./adapter.server.js').SendWhatsappResult>}
 */
export async function sendWhatsappText(message, { shop, account } = {}) {
  const creds = await resolveCreds(shop, account);
  if (creds.error) return { ok: false, error: creds.error };

  const result = await sendSessionText({
    phoneNumberId: creds.phoneNumberId,
    accessToken: creds.accessToken,
    to: message.to,
    text: message.text,
  });
  await recordSendOutcome(shop, result);
  return result;
}

/**
 * Prefix marking a lastError written because Meta refused to send for the
 * whole account. lastError also carries connect-time notes (a failed webhook
 * subscription, a failed token exchange), and those have their own panels and
 * must survive a successful send — so only a message carrying this prefix is
 * shown as "sending blocked" and only such a message is cleared by a success.
 */
export const SEND_BLOCKED_PREFIX = "Sending blocked: ";

/**
 * Keep the account's "sending blocked" note in step with reality.
 *
 * Recorded here, in the seam, rather than by each caller, because every send
 * path meets the same wall: the worker, the settings-page test and the
 * campaign test. Previously only the worker wrote it, so a merchant pressing
 * "Send test" learned about the block in a toast that vanished and the page
 * went on showing a healthy channel.
 *
 * A success clears it, which is the point of the campaign page telling a
 * merchant to send a test once they have fixed things at Meta: that test is
 * what lifts the block from the screen.
 */
async function recordSendOutcome(shop, result) {
  if (!shop) return;
  if (result?.accountError) {
    await prisma.whatsappAccount
      .updateMany({
        where: { shop },
        data: { lastError: `${SEND_BLOCKED_PREFIX}${String(result.error || "").slice(0, 450)}` },
      })
      .catch(() => {});
  } else if (result?.ok) {
    await prisma.whatsappAccount
      .updateMany({
        where: { shop, lastError: { startsWith: SEND_BLOCKED_PREFIX } },
        data: { lastError: "" },
      })
      .catch(() => {});
  }
}

/** The account's current send block in plain words, or "". */
export function sendBlockedReason(account) {
  const note = String(account?.lastError || "");
  return note.startsWith(SEND_BLOCKED_PREFIX) ? note.slice(SEND_BLOCKED_PREFIX.length) : "";
}

/**
 * Register the shop's connected phone number for the Cloud API. Stamps
 * WhatsappAccount.registeredAt on success. Required before any send works.
 * @param {string} shop
 * @param {string} pin - 6-digit two-step verification PIN.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function registerWhatsappNumber(shop, pin) {
  const account = await resolveAccount(shop);
  if (!account) return { ok: false, error: "no connected WhatsApp account for shop" };

  let accessToken;
  try {
    accessToken = decryptSecret(account.accessTokenEnc);
  } catch (err) {
    return { ok: false, error: `token decrypt failed: ${err.message}` };
  }

  // Ask Meta before asking the merchant. A number that is already CONNECTED
  // needs no registration, and trying anyway fails on a two-step PIN that was
  // set at first registration — which for a test number, or one registered in
  // WhatsApp Manager, nobody here ever chose. That presented as "Incorrect PIN"
  // for a PIN that does not exist, with no way forward.
  const already = await checkAndStampRegistration(shop, account.phoneNumberId, accessToken);
  if (already.registered) return { ok: true, alreadyRegistered: true };

  const result = await registerPhoneNumber({
    phoneNumberId: account.phoneNumberId,
    accessToken,
    pin,
  });

  if (result.ok) {
    await prisma.whatsappAccount
      .update({ where: { shop }, data: { registeredAt: new Date(), lastError: "" } })
      .catch(() => {});
  }
  return result;
}

/**
 * Reconcile our `registeredAt` with the number's real state at Meta.
 *
 * registeredAt is our bookkeeping, not Meta's — nothing in the send path reads
 * it, only the admin UI does — so it can be false while the number is perfectly
 * able to send, which locks the merchant out of their own working channel. This
 * settles it from the authority rather than from our record.
 *
 * Never clears the stamp: Meta briefly reports a number as PENDING or
 * MIGRATING, and dropping the flag on a transient status would put the merchant
 * back in front of a PIN prompt for a number they already registered.
 *
 * @returns {Promise<{ registered: boolean, status?: string, error?: string }>}
 */
export async function checkAndStampRegistration(shop, phoneNumberId, accessToken) {
  const res = await getRegistrationStatus({ phoneNumberId, accessToken });
  if (!res.ok) return { registered: false, error: res.error };
  if (!res.registered) return { registered: false, status: res.status };

  await prisma.whatsappAccount
    .updateMany({
      where: { shop, registeredAt: null },
      data: { registeredAt: new Date(), lastError: "" },
    })
    .catch(() => {});
  return { registered: true, status: res.status };
}

/**
 * Resolve a shop's registration state, stamping it if Meta says it is done.
 * Used by the WhatsApp page's loader so a pre-registered number is never shown
 * a PIN prompt in the first place.
 *
 * @returns {Promise<{ registered: boolean, status?: string, error?: string }>}
 */
export async function syncRegistrationState(shop) {
  const account = await resolveAccount(shop);
  if (!account?.phoneNumberId) return { registered: false };
  if (account.registeredAt) return { registered: true };
  try {
    return await checkAndStampRegistration(
      shop,
      account.phoneNumberId,
      decryptSecret(account.accessTokenEnc),
    );
  } catch {
    return { registered: false };
  }
}
