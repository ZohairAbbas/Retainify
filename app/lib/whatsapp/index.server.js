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
import { sendWhatsappMessage as sendViaMeta } from "./cloud-api.server.js";

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
 * @param {{ shop: string, settings?: object, account?: object }} ctx
 * @returns {Promise<import('./adapter.server.js').SendWhatsappResult>}
 */
export async function sendWhatsapp(message, { shop, settings, account } = {}) {
  const resolvedAccount = account || (await resolveAccount(shop));
  if (!resolvedAccount) {
    return { ok: false, error: "no connected WhatsApp account for shop" };
  }

  let accessToken;
  try {
    accessToken = decryptSecret(resolvedAccount.accessTokenEnc);
  } catch (err) {
    return { ok: false, error: `token decrypt failed: ${err.message}` };
  }

  const provider = resolveProvider(settings || { whatsappProvider: "meta" });
  const send = provider === "meta" ? sendViaMeta : sendViaMeta;

  return send({
    phoneNumberId: resolvedAccount.phoneNumberId,
    accessToken,
    to: message.to,
    templateName: message.templateName,
    language: message.language,
    components: message.components,
  });
}
