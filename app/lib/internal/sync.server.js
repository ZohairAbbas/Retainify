/**
 * Bulk contact sync for the internal tenant — POST /internal/contacts.
 *
 * Events answer "what just happened"; this answers "what is true now". A
 * caller (in practice Merchant360) pushes each merchant's current facts — plan,
 * usage, which apps they run — as custom properties and tags, so segments,
 * flow entry filters and broadcasts in the internal workspace can target them.
 *
 * ── Properties ─────────────────────────────────────────────────────────────
 * Values land in Contact.customProps, coerced to their definition's type, the
 * same way a CSV import or the contact page writes them. The caller may
 * declare definitions in the request; a declared property that does not exist
 * is created, and one that exists with a DIFFERENT type is refused, because
 * every value already stored under it would then compare wrongly. A value for
 * a property nobody declared is an error for that contact, not a silent drop.
 * `null` clears a value.
 *
 * ── Tags are owned by whoever applied them ─────────────────────────────────
 * `tags` is the complete set THIS caller wants on the contact. Tags the caller
 * applied before and no longer lists are removed; tags a person or a flow
 * applied are never touched, even when the names match. Ownership is recorded
 * in ContactTag.appliedByStepKey as "api:<caller>" — the column that already
 * tells a flow's tags from a person's — so "remove what the sync applied"
 * cannot strip a tag someone put there by hand. Omitting `tags` leaves the
 * contact's tags alone entirely.
 *
 * ── Contacts ───────────────────────────────────────────────────────────────
 * Created through upsertInternalContact, so consent and WhatsApp opt-in follow
 * exactly the rules the event API does, including never reviving a STOP. One
 * difference: a sync never revives a deleted contact. An event means the
 * person just did something; a sync repeats the same facts every run, and
 * would otherwise undo an admin's delete within the hour.
 */
import prisma from "../../db.server.js";
import {
  PROPERTY_TYPES,
  coercePropertyValue,
  listProperties,
} from "../contacts/properties.server.js";
import { upsertInternalContact, validateInternalEmail } from "./contacts.server.js";
import { INTERNAL_SHOP } from "./tenant.js";

export const MAX_CONTACTS_PER_CALL = 200;
const MAX_PROPERTY_DEFS = 100;
const MAX_PROPS_PER_CONTACT = 60;
const MAX_TAGS_PER_CONTACT = 100;
const MAX_TAG_LENGTH = 60;
const PROP_KEY_RE = /^[a-z0-9_]{1,40}$/;
const VALID_TYPES = new Set(PROPERTY_TYPES.map((t) => t.id));

/** The appliedByStepKey marking a tag as owned by an API caller. */
export function tagOwnerKey(caller) {
  return `api:${caller}`;
}

/**
 * Validate the request's shape. Per-contact problems are reported per contact
 * later; only a request that cannot be processed at all is refused here.
 *
 * @returns {{ ok: true, defs: Array, contacts: Array } | { ok: false, error: string }}
 */
export function readSyncRequest(body) {
  const defs = body.properties ?? [];
  if (!Array.isArray(defs)) return { ok: false, error: "properties must be an array of definitions." };
  if (defs.length > MAX_PROPERTY_DEFS) {
    return { ok: false, error: `At most ${MAX_PROPERTY_DEFS} property definitions per call.` };
  }
  const cleanDefs = [];
  for (const d of defs) {
    if (!d || typeof d !== "object") return { ok: false, error: "Each property definition must be an object." };
    if (!PROP_KEY_RE.test(String(d.key ?? ""))) {
      return { ok: false, error: `Property key "${d.key}" must be 1-40 lowercase letters, numbers or underscores.` };
    }
    const type = d.type ?? "text";
    if (!VALID_TYPES.has(type)) {
      return { ok: false, error: `Property "${d.key}" has unknown type "${type}".` };
    }
    const options = Array.isArray(d.options)
      ? [...new Set(d.options.map((o) => String(o).trim()).filter(Boolean))].slice(0, 100)
      : [];
    cleanDefs.push({
      key: d.key,
      label: typeof d.label === "string" && d.label.trim() ? d.label.trim().slice(0, 80) : d.key,
      type,
      options,
    });
  }

  const contacts = body.contacts;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return { ok: false, error: "contacts must be a non-empty array." };
  }
  if (contacts.length > MAX_CONTACTS_PER_CALL) {
    return { ok: false, error: `At most ${MAX_CONTACTS_PER_CALL} contacts per call.` };
  }
  return { ok: true, defs: cleanDefs, contacts };
}

/**
 * Create declared properties that do not exist yet; refuse a type change.
 * Select options are merged, so a new plan name becomes pickable in the
 * segment builder the first time a merchant is on it.
 *
 * @returns {Promise<{ ok: true, defs: Array } | { ok: false, error: string }>}
 */
export async function ensurePropertyDefs(declared) {
  const existing = await listProperties(INTERNAL_SHOP);
  const byKey = new Map(existing.map((d) => [d.key, d]));
  let position = existing.reduce((m, d) => Math.max(m, d.position), 0);

  for (const d of declared) {
    const current = byKey.get(d.key);
    if (current) {
      if (current.type !== d.type) {
        return {
          ok: false,
          error: `Property "${d.key}" already exists as ${current.type}; it cannot be redeclared as ${d.type}.`,
        };
      }
      if (d.type === "select" && d.options.length) {
        const have = Array.isArray(current.options) ? current.options.map(String) : [];
        const merged = [...new Set([...have, ...d.options])].slice(0, 100);
        if (merged.length !== have.length) {
          const updated = await prisma.contactPropertyDef.update({
            where: { id: current.id },
            data: { options: merged },
          });
          byKey.set(d.key, updated);
        }
      }
      continue;
    }
    position += 1;
    try {
      const created = await prisma.contactPropertyDef.create({
        data: {
          shop: INTERNAL_SHOP,
          key: d.key,
          label: d.label,
          type: d.type,
          options: d.type === "select" ? d.options : undefined,
          position,
        },
      });
      byKey.set(d.key, created);
    } catch (err) {
      // Another sync created it between our read and this write.
      if (err?.code !== "P2002") throw err;
      const raced = await prisma.contactPropertyDef.findUnique({
        where: { shop_key: { shop: INTERNAL_SHOP, key: d.key } },
      });
      if (raced) byKey.set(d.key, raced);
    }
  }
  return { ok: true, defs: [...byKey.values()] };
}

/**
 * Validate one contact's properties against the definitions.
 *
 * @returns {{ ok: true, set: Record<string, unknown>, clear: string[] } | { ok: false, error: string }}
 */
function readContactProps(raw, defsByKey) {
  if (raw === undefined || raw === null) return { ok: true, set: {}, clear: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "properties must be an object." };
  const entries = Object.entries(raw);
  if (entries.length > MAX_PROPS_PER_CONTACT) {
    return { ok: false, error: `At most ${MAX_PROPS_PER_CONTACT} properties per contact.` };
  }
  const set = {};
  const clear = [];
  for (const [key, value] of entries) {
    const def = defsByKey.get(key);
    if (!def) return { ok: false, error: `Unknown property "${key}" — declare it in properties first.` };
    if (value === null || value === "") {
      clear.push(key);
      continue;
    }
    const coerced = coercePropertyValue(def.type, value);
    if (coerced === null) {
      return { ok: false, error: `"${value}" is not a valid ${def.type} for property "${key}".` };
    }
    set[key] = coerced;
  }
  return { ok: true, set, clear };
}

function readTags(raw) {
  if (raw === undefined) return { ok: true, tags: null };
  if (!Array.isArray(raw)) return { ok: false, error: "tags must be an array of names." };
  if (raw.length > MAX_TAGS_PER_CONTACT) {
    return { ok: false, error: `At most ${MAX_TAGS_PER_CONTACT} tags per contact.` };
  }
  const byKey = new Map();
  for (const t of raw) {
    const name = String(t ?? "").trim();
    if (!name) continue;
    if (name.length > MAX_TAG_LENGTH) return { ok: false, error: `Tag "${name}" is longer than ${MAX_TAG_LENGTH} characters.` };
    byKey.set(name.toLowerCase(), name);
  }
  return { ok: true, tags: byKey };
}

/** Tag ids for these names, creating the missing ones. */
async function tagIdsFor(nameByKey) {
  if (nameByKey.size === 0) return new Map();
  const keys = [...nameByKey.keys()];
  await prisma.tag.createMany({
    data: keys.map((k) => ({ shop: INTERNAL_SHOP, name: nameByKey.get(k), nameKey: k })),
    skipDuplicates: true,
  });
  const rows = await prisma.tag.findMany({
    where: { shop: INTERNAL_SHOP, nameKey: { in: keys } },
    select: { id: true, nameKey: true },
  });
  return new Map(rows.map((r) => [r.nameKey, r.id]));
}

/**
 * Make the caller-owned tags on this contact exactly `wantedIds`.
 * Returns how many were added and removed.
 */
async function reconcileOwnedTags(contactId, ownerKey, wantedIds) {
  const current = await prisma.contactTag.findMany({
    where: { contactId },
    select: { tagId: true, appliedByStepKey: true },
  });
  const onContact = new Map(current.map((c) => [c.tagId, c.appliedByStepKey]));

  const toRemove = current
    .filter((c) => c.appliedByStepKey === ownerKey && !wantedIds.has(c.tagId))
    .map((c) => c.tagId);
  // A tag already on the contact from any source is left as it is: re-owning a
  // hand-applied tag would let the next sync remove it.
  const toAdd = [...wantedIds].filter((id) => !onContact.has(id));

  if (toRemove.length) {
    await prisma.contactTag.deleteMany({
      where: { contactId, tagId: { in: toRemove }, appliedByStepKey: ownerKey },
    });
  }
  if (toAdd.length) {
    await prisma.contactTag.createMany({
      data: toAdd.map((tagId) => ({ contactId, tagId, appliedByStepKey: ownerKey })),
      skipDuplicates: true,
    });
  }
  return { added: toAdd.length, removed: toRemove.length };
}

/**
 * Sync a batch. Never throws for one bad contact — each gets its own result —
 * so a single malformed address cannot hold back the other 199.
 *
 * @param {{ caller: string, app?: string|null, defs: Array, contacts: Array }} input
 * @returns {Promise<{ ok: true, results: Array } | { ok: false, error: string }>}
 */
export async function syncInternalContacts({ caller, app = null, defs, contacts }) {
  const ensured = await ensurePropertyDefs(defs);
  if (!ensured.ok) return ensured;
  const defsByKey = new Map(ensured.defs.map((d) => [d.key, d]));
  const ownerKey = tagOwnerKey(caller);

  const results = [];
  for (const raw of contacts) {
    const email = validateInternalEmail(raw?.email);
    if (!email.ok) {
      results.push({ email: String(raw?.email ?? ""), status: "error", error: email.error });
      continue;
    }
    const props = readContactProps(raw.properties, defsByKey);
    if (!props.ok) {
      results.push({ email: email.email, status: "error", error: props.error });
      continue;
    }
    const tags = readTags(raw.tags);
    if (!tags.ok) {
      results.push({ email: email.email, status: "error", error: tags.error });
      continue;
    }

    try {
      const existing = await prisma.contact.findUnique({
        where: { shop_email: { shop: INTERNAL_SHOP, email: email.email } },
        select: { id: true, deletedAt: true },
      });
      if (existing?.deletedAt) {
        results.push({ email: email.email, status: "skipped", reason: "contact was deleted in Retainify" });
        continue;
      }

      const { contact, created, whatsappOptIn } = await upsertInternalContact({
        email: email.email,
        name: typeof raw.name === "string" ? raw.name : "",
        phone: typeof raw.phone === "string" ? raw.phone : "",
        app: app || caller,
        revive: false,
        touch: false,
      });
      if (!contact) throw new Error("Could not store the contact.");

      if (Object.keys(props.set).length || props.clear.length) {
        const merged = { ...(contact.customProps || {}), ...props.set };
        for (const key of props.clear) delete merged[key];
        await prisma.contact.update({ where: { id: contact.id }, data: { customProps: merged } });
      }

      let tagChanges = null;
      if (tags.tags) {
        const idsByKey = await tagIdsFor(tags.tags);
        tagChanges = await reconcileOwnedTags(contact.id, ownerKey, new Set(idsByKey.values()));
      }

      results.push({
        email: email.email,
        status: created ? "created" : "updated",
        whatsappOptIn,
        ...(tagChanges ? { tagsAdded: tagChanges.added, tagsRemoved: tagChanges.removed } : {}),
      });
    } catch (err) {
      console.error(`[internal-api] contact sync failed for ${email.email}:`, err);
      results.push({ email: email.email, status: "error", error: "Could not be stored. Retry later." });
    }
  }
  return { ok: true, results };
}
