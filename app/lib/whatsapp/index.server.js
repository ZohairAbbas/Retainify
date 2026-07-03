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
import { sendWhatsappMessage as sendViaMeta, sendSessionText } from "./cloud-api.server.js";

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

  return sendViaMeta({
    phoneNumberId: creds.phoneNumberId,
    accessToken: creds.accessToken,
    to: message.to,
    templateName: message.templateName,
    language: message.language,
    components: message.components,
  });
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

  return sendSessionText({
    phoneNumberId: creds.phoneNumberId,
    accessToken: creds.accessToken,
    to: message.to,
    text: message.text,
  });
}
