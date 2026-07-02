/**
 * Sync Meta-approved message templates (HSM) from a shop's WABA into the
 * WhatsappTemplate table. Marketing sends reference these by name+language.
 *
 * Called on demand (and later by the admin page / a periodic refresh). Meta
 * owns approval state, so we mirror it rather than authoring templates here.
 */
import prisma from "../../db.server.js";
import { decryptSecret } from "../crypto/secrets.server.js";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

/**
 * @param {string} shop
 * @returns {Promise<{ ok: boolean, synced?: number, error?: string }>}
 */
export async function syncTemplates(shop) {
  const account = await prisma.whatsappAccount.findUnique({ where: { shop } });
  if (!account || account.status !== "connected" || !account.wabaId) {
    return { ok: false, error: "no connected WhatsApp account for shop" };
  }

  let accessToken;
  try {
    accessToken = decryptSecret(account.accessTokenEnc);
  } catch (err) {
    return { ok: false, error: `token decrypt failed: ${err.message}` };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${account.wabaId}/message_templates?limit=200`;
  let json;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.error?.message || `HTTP ${res.status}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const templates = Array.isArray(json?.data) ? json.data : [];
  const now = new Date();
  let synced = 0;

  for (const t of templates) {
    const name = t.name;
    const language = t.language;
    if (!name || !language) continue;

    const bodyText =
      (t.components || []).find((c) => c.type === "BODY")?.text || "";

    await prisma.whatsappTemplate.upsert({
      where: { shop_name_language: { shop, name, language } },
      create: {
        shop,
        name,
        language,
        category: t.category || "MARKETING",
        metaTemplateId: t.id || "",
        status: t.status || "PENDING",
        bodyText,
        components: t.components ?? undefined,
        lastSyncedAt: now,
      },
      update: {
        category: t.category || "MARKETING",
        metaTemplateId: t.id || "",
        status: t.status || "PENDING",
        bodyText,
        components: t.components ?? undefined,
        lastSyncedAt: now,
      },
    });
    synced += 1;
  }

  return { ok: true, synced };
}
