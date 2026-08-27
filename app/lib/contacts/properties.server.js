/**
 * Merchant-defined contact properties.
 *
 * Replaces the "Custom properties — Soon" locked card on the contact profile.
 *
 * ── Why a JSON bag rather than columns ──────────────────────────────────────
 * Merchants need to add a property ("VIP tier", "Preferred store", "Referral
 * source") without a deploy. One JSONB column on Contact plus a definitions
 * table gives that: the definitions supply the key, label and type, and the bag
 * holds the values. Postgres indexes JSONB with GIN, so filtering stays fast.
 *
 * ── Why values are coerced on write ─────────────────────────────────────────
 * A "number" property whose values arrive as the strings "10" and "9" from a
 * CSV would sort and compare as text — "10" < "9". Coercing at the boundary
 * means every read, filter and segment rule can trust the declared type.
 */
import prisma from "../../db.server.js";

export const PROPERTY_TYPES = [
  { id: "text", label: "Text" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "boolean", label: "Yes / no" },
  { id: "select", label: "Choice list" },
];

const VALID_TYPES = new Set(PROPERTY_TYPES.map((t) => t.id));

/** Column keys for custom properties are namespaced to avoid colliding with built-ins. */
export const PROP_PREFIX = "prop:";

/**
 * Machine name for a property, derived once from its label.
 *
 * Kept stable forever: the key is what appears in Contact.customProps, in CSV
 * mappings and in segment rules, so regenerating it on a label edit would
 * orphan every stored value.
 */
export function toPropertyKey(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export async function listProperties(shop) {
  return prisma.contactPropertyDef.findMany({
    where: { shop },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Create a property. Returns { ok, error?, property? }.
 */
export async function createProperty(shop, { label, type = "text", options = [] }) {
  const trimmed = String(label || "").trim();
  if (!trimmed) return { ok: false, error: "Give the property a name." };
  if (!VALID_TYPES.has(type)) return { ok: false, error: "Unknown property type." };

  const key = toPropertyKey(trimmed);
  if (!key) return { ok: false, error: "That name needs at least one letter or number." };

  const clash = await prisma.contactPropertyDef.findUnique({
    where: { shop_key: { shop, key } },
  });
  if (clash) return { ok: false, error: `"${clash.label}" already uses that name.` };

  const count = await prisma.contactPropertyDef.count({ where: { shop } });
  const property = await prisma.contactPropertyDef.create({
    data: {
      shop,
      key,
      label: trimmed,
      type,
      options: type === "select" ? cleanOptions(options) : undefined,
      position: count,
    },
  });
  return { ok: true, property };
}

/** Rename or re-option a property. `key` and `type` are immutable. */
export async function updateProperty(shop, id, { label, options }) {
  const data = {};
  if (label !== undefined) {
    const trimmed = String(label).trim();
    if (!trimmed) return { ok: false, error: "Give the property a name." };
    data.label = trimmed;
  }
  if (options !== undefined) data.options = cleanOptions(options);
  await prisma.contactPropertyDef.updateMany({ where: { id, shop }, data });
  return { ok: true };
}

/**
 * Delete a property definition.
 *
 * Stored values are deliberately LEFT in place on the contacts. Deleting a
 * definition hides the column; it does not destroy per-contact data that the
 * merchant may not have meant to lose, and re-creating a property with the same
 * name brings the values straight back.
 */
export async function deleteProperty(shop, id) {
  await prisma.contactPropertyDef.deleteMany({ where: { id, shop } });
  return { ok: true };
}

function cleanOptions(options) {
  if (!Array.isArray(options)) return [];
  return [...new Set(options.map((o) => String(o).trim()).filter(Boolean))].slice(0, 100);
}

/**
 * Coerce a raw value to the property's declared type.
 *
 * Returns `null` for anything unparseable, which reads as "not set" everywhere
 * rather than storing a string where a number is expected.
 */
export function coercePropertyValue(type, raw) {
  if (raw === null || raw === undefined || raw === "") return null;

  switch (type) {
    case "number": {
      // Tolerate thousands separators and currency symbols from spreadsheets.
      const stripped = String(raw).replace(/[^0-9.-]/g, "");
      // Guard the empty case explicitly: Number("") is 0, and 0 is finite, so
      // without this a text column mapped onto a number property would import
      // as zeros everywhere instead of blanks.
      if (!/\d/.test(stripped)) return null;
      const n = Number(stripped);
      return Number.isFinite(n) ? n : null;
    }
    case "boolean": {
      const s = String(raw).trim().toLowerCase();
      if (["true", "yes", "y", "1"].includes(s)) return true;
      if (["false", "no", "n", "0"].includes(s)) return false;
      return null;
    }
    case "date": {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    case "select":
    case "text":
    default:
      return String(raw).trim().slice(0, 500) || null;
  }
}

/**
 * Coerce a whole {key: value} object against the shop's definitions, dropping
 * keys that aren't defined so an import can't inject arbitrary JSON.
 *
 * @param {Array} defs   result of listProperties()
 * @param {object} input raw values keyed by property key
 */
export function coerceProperties(defs, input) {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out = {};
  for (const [key, raw] of Object.entries(input || {})) {
    const def = byKey.get(key);
    if (!def) continue;
    const value = coercePropertyValue(def.type, raw);
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * Merge new property values onto a contact without clobbering keys the caller
 * didn't mention — a CSV that only carries "vip_tier" must not erase every
 * other property on those contacts.
 */
export async function setContactProperties(shop, contactId, values) {
  const defs = await listProperties(shop);
  const clean = coerceProperties(defs, values);

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, shop },
    select: { customProps: true },
  });
  if (!contact) return { ok: false, error: "Contact not found." };

  const merged = { ...(contact.customProps || {}), ...clean };
  // An explicit empty string means "clear this one".
  for (const [key, raw] of Object.entries(values || {})) {
    if (raw === "" || raw === null) delete merged[key];
  }

  await prisma.contact.update({ where: { id: contactId }, data: { customProps: merged } });
  return { ok: true, customProps: merged };
}

/** Human-readable rendering for a stored value. */
export function formatPropertyValue(def, value) {
  if (value === null || value === undefined || value === "") return "";
  switch (def?.type) {
    case "boolean":
      return value ? "Yes" : "No";
    case "date": {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
    }
    case "number":
      return Number(value).toLocaleString();
    default:
      return String(value);
  }
}
