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

const VALID_CATEGORIES = new Set(["MARKETING", "UTILITY", "AUTHENTICATION"]);
// Meta template names: lowercase letters, digits, underscores only.
const NAME_RE = /^[a-z0-9_]+$/;

/** Count the highest positional variable {{n}} used in a body string. */
function countBodyVars(text) {
  const nums = [...String(text || "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

async function resolveToken(shop) {
  const account = await prisma.whatsappAccount.findUnique({ where: { shop } });
  if (!account || account.status !== "connected" || !account.wabaId) {
    return { error: "no connected WhatsApp account for shop" };
  }
  try {
    return { account, accessToken: decryptSecret(account.accessTokenEnc) };
  } catch (err) {
    return { error: `token decrypt failed: ${err.message}` };
  }
}

/**
 * Create a WhatsApp message template on the shop's WABA and mirror it locally
 * as PENDING. Meta reviews every template before it can be sent.
 *
 * @param {string} shop
 * @param {object} input
 * @param {string} input.name
 * @param {string} input.language
 * @param {string} input.category
 * @param {string} input.bodyText
 * @param {string[]} [input.samples] - one example per {{n}} in bodyText (required by Meta).
 * @param {{ format: "TEXT"|"IMAGE", text?: string, sampleUrl?: string }} [input.header]
 * @param {Array<{ type: "URL"|"QUICK_REPLY", text: string, url?: string }>} [input.buttons]
 * @returns {Promise<{ ok: boolean, error?: string, status?: string }>}
 */
export async function createTemplate(shop, input) {
  // Normalize to Meta's allowed charset: lowercase, and any run of invalid
  // chars (spaces, punctuation) collapses to a single underscore.
  const name = String(input.name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const language = String(input.language || "").trim();
  const category = String(input.category || "").trim().toUpperCase();
  const bodyText = String(input.bodyText || "").trim();
  const samples = Array.isArray(input.samples) ? input.samples : [];

  if (!NAME_RE.test(name)) {
    return { ok: false, error: "Name must use only lowercase letters, numbers, and underscores." };
  }
  if (!language) return { ok: false, error: "Language is required (e.g. en_US)." };
  if (!VALID_CATEGORIES.has(category)) return { ok: false, error: "Invalid category." };
  if (!bodyText) return { ok: false, error: "Body text is required." };

  const varCount = countBodyVars(bodyText);
  if (varCount > 0) {
    const filled = samples.slice(0, varCount).filter((s) => String(s || "").trim());
    if (filled.length < varCount) {
      return { ok: false, error: `Provide a sample value for each of the ${varCount} variable(s).` };
    }
  }

  const { account, accessToken, error } = await resolveToken(shop);
  if (error) return { ok: false, error };

  const components = [];

  // Optional header (TEXT or IMAGE). Image headers need an example media URL.
  const header = input.header;
  if (header && header.format === "TEXT" && String(header.text || "").trim()) {
    components.push({ type: "HEADER", format: "TEXT", text: String(header.text).trim() });
  } else if (header && header.format === "IMAGE" && String(header.sampleUrl || "").trim()) {
    components.push({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: [String(header.sampleUrl).trim()] },
    });
  }

  const bodyComponent = { type: "BODY", text: bodyText };
  if (varCount > 0) {
    // Meta requires example.body_text: an array containing one row of samples.
    bodyComponent.example = { body_text: [samples.slice(0, varCount).map((s) => String(s))] };
  }
  components.push(bodyComponent);

  // Optional buttons: URL (with a link) or QUICK_REPLY (no link).
  const buttons = Array.isArray(input.buttons) ? input.buttons : [];
  const builtButtons = buttons
    .filter((b) => b && String(b.text || "").trim())
    .map((b) => {
      if (b.type === "URL" && String(b.url || "").trim()) {
        return { type: "URL", text: String(b.text).trim(), url: String(b.url).trim() };
      }
      return { type: "QUICK_REPLY", text: String(b.text).trim() };
    });
  if (builtButtons.length) {
    components.push({ type: "BUTTONS", buttons: builtButtons });
  }

  const payload = { name, language, category, components };

  let json;
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${account.wabaId}/message_templates`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.error?.error_user_msg || json?.error?.message || `HTTP ${res.status}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const status = json?.status || "PENDING";
  await prisma.whatsappTemplate.upsert({
    where: { shop_name_language: { shop, name, language } },
    create: {
      shop,
      name,
      language,
      category: json?.category || category,
      metaTemplateId: json?.id || "",
      status,
      bodyText,
      components,
      lastSyncedAt: new Date(),
    },
    update: {
      category: json?.category || category,
      metaTemplateId: json?.id || "",
      status,
      bodyText,
      components,
      lastSyncedAt: new Date(),
    },
  });

  return { ok: true, status };
}

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
