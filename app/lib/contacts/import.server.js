/**
 * Bulk contact import.
 *
 * Replaces a loop of per-row upsertContact() calls, which issued two queries per
 * contact and ran unbounded inside a single request — a 20k-row file simply
 * timed out partway through, leaving a partial import with no record of where
 * it stopped.
 *
 * Here a batch costs a fixed handful of queries regardless of size:
 *   1 read  — which of these emails already exist
 *   1 write — createMany for the new ones
 *   n       — updates, but only for rows that actually change
 *   2       — tag resolution and membership, both createMany
 *
 * ── Consent ─────────────────────────────────────────────────────────────────
 * The old import stamped `subscriptionStatus: "subscribed"` and
 * `marketingConsentAt: now` on every row unconditionally. That fabricates a
 * consent record that never happened, for a list we cannot verify — the fastest
 * possible way to burn a shared sending domain's reputation, and the first thing
 * a GDPR complaint would point at.
 *
 * Now the merchant must explicitly attest that these people opted in. Without
 * that attestation the contacts still import — they are simply not marketable
 * ("never_opted_in"), so they can be browsed and segmented but never emailed.
 */
import prisma from "../../db.server.js";
import { normalizeEmail, normalizePhone } from "./contacts.server.js";
import { coerceProperties, listProperties } from "./properties.server.js";

export const MAX_ROWS_PER_BATCH = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * @typedef {Object} ImportRow
 * @property {string} email
 * @property {string} [name]
 * @property {string} [phone]
 * @property {string[]} [tags]
 * @property {Record<string,*>} [props] merchant-defined property values, keyed
 *   by ContactPropertyDef.key. Coerced to the declared type on write.
 */

/**
 * Import one batch of rows.
 *
 * @param {string} shop
 * @param {ImportRow[]} rows
 * @param {{ consent: boolean }} options
 *   consent — the merchant has attested these contacts opted in to marketing.
 * @returns {Promise<{imported:number, updated:number, skippedInvalid:number, skippedDuplicate:number}>}
 */
export async function importContactRows(shop, rows, { consent = false } = {}) {
  const result = { imported: 0, updated: 0, skippedInvalid: 0, skippedDuplicate: 0 };
  if (!shop || !Array.isArray(rows) || rows.length === 0) return result;
  if (rows.length > MAX_ROWS_PER_BATCH) {
    rows = rows.slice(0, MAX_ROWS_PER_BATCH);
  }

  // ── Normalize + dedupe within the batch ─────────────────────────────────
  // A file listing the same address twice must not count as two imports, and
  // must not race itself through createMany.
  const byEmail = new Map();
  for (const raw of rows) {
    const email = normalizeEmail(raw?.email);
    if (!email || !EMAIL_RE.test(email)) {
      result.skippedInvalid++;
      continue;
    }
    const existing = byEmail.get(email);
    const tags = Array.isArray(raw.tags) ? raw.tags.filter(Boolean).map(String) : [];
    if (existing) {
      // Later rows fill gaps rather than clobbering — first occurrence wins on
      // conflict, which matches how a human reads a spreadsheet top-down.
      existing.name ||= String(raw.name || "").trim();
      existing.phone ||= normalizePhone(raw.phone);
      existing.tags = [...new Set([...existing.tags, ...tags])];
      existing.props = { ...(raw.props || {}), ...existing.props };
      result.skippedDuplicate++;
      continue;
    }
    byEmail.set(email, {
      email,
      name: String(raw.name || "").trim(),
      phone: normalizePhone(raw.phone),
      tags,
      props: raw.props && typeof raw.props === "object" ? raw.props : {},
    });
  }

  const emails = [...byEmail.keys()];
  if (emails.length === 0) return result;

  const now = new Date();
  const status = consent ? "subscribed" : "never_opted_in";

  // Property values are coerced against the shop's definitions, which also
  // drops any key that isn't a defined property — a CSV cannot inject arbitrary
  // JSON into the contact record.
  const propertyDefs = await listProperties(shop);
  const hasProps = propertyDefs.length > 0;
  for (const row of byEmail.values()) {
    row.props = hasProps ? coerceProperties(propertyDefs, row.props) : {};
  }

  // ── Which already exist ─────────────────────────────────────────────────
  const existing = await prisma.contact.findMany({
    where: { shop, email: { in: emails } },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      subscriptionStatus: true,
      marketingConsentAt: true,
      customProps: true,
      deletedAt: true,
    },
  });
  const existingByEmail = new Map(existing.map((c) => [c.email, c]));

  // ── Insert the new ones ─────────────────────────────────────────────────
  const fresh = emails.filter((e) => !existingByEmail.has(e)).map((e) => byEmail.get(e));
  if (fresh.length) {
    await prisma.contact.createMany({
      data: fresh.map((r) => ({
        shop,
        email: r.email,
        name: r.name,
        phone: r.phone || null,
        source: "csv_import",
        firstSeenAt: now,
        lastSeenAt: now,
        subscriptionStatus: status,
        marketingConsentAt: consent ? now : null,
        customProps: Object.keys(r.props).length ? r.props : undefined,
      })),
      // Guards against a concurrent import of the same file.
      skipDuplicates: true,
    });
    result.imported += fresh.length;
  }

  // ── Update the ones we already had ──────────────────────────────────────
  for (const email of emails) {
    const prior = existingByEmail.get(email);
    if (!prior) continue;
    const row = byEmail.get(email);

    const data = { lastSeenAt: now };
    // Merge rather than replace: a CSV carrying only "vip_tier" must not erase
    // every other property already on these contacts.
    if (Object.keys(row.props).length) {
      data.customProps = { ...(prior.customProps || {}), ...row.props };
    }
    // Only fill gaps. An import must never overwrite a name or phone the
    // merchant curated in the app.
    if (row.name && !prior.name) data.name = row.name;
    if (row.phone && !prior.phone) data.phone = row.phone;
    // A previously deleted contact reappearing in an import is a deliberate
    // re-add, so revive it and treat it as a fresh acquisition.
    if (prior.deletedAt) {
      data.deletedAt = null;
      data.firstSeenAt = now;
    }
    // Consent can be granted but never revoked by an import, and an existing
    // suppression (unsubscribed / bounced / complained) always wins.
    const suppressed = ["unsubscribed", "bounced", "complained"].includes(
      prior.subscriptionStatus,
    );
    if (consent && !suppressed) {
      data.subscriptionStatus = "subscribed";
      if (!prior.marketingConsentAt) data.marketingConsentAt = now;
    }

    await prisma.contact.update({ where: { id: prior.id }, data });
    result.updated++;
  }

  // ── Tags ────────────────────────────────────────────────────────────────
  await applyTagsBulk(shop, byEmail);

  return result;
}

/**
 * Resolve every tag name in the batch to a Tag row, then attach memberships —
 * two queries total rather than one per contact-tag pair.
 */
async function applyTagsBulk(shop, byEmail) {
  const names = new Set();
  for (const row of byEmail.values()) {
    for (const t of row.tags) {
      const trimmed = String(t).trim();
      if (trimmed) names.add(trimmed);
    }
  }
  if (names.size === 0) return;

  const wanted = [...names].map((name) => ({ name, nameKey: name.toLowerCase() }));

  await prisma.tag.createMany({
    data: wanted.map((t) => ({ shop, name: t.name, nameKey: t.nameKey })),
    skipDuplicates: true,
  });

  const tags = await prisma.tag.findMany({
    where: { shop, nameKey: { in: wanted.map((t) => t.nameKey) } },
    select: { id: true, nameKey: true },
  });
  const tagIdByKey = new Map(tags.map((t) => [t.nameKey, t.id]));

  const contacts = await prisma.contact.findMany({
    where: { shop, email: { in: [...byEmail.keys()] } },
    select: { id: true, email: true },
  });

  const links = [];
  for (const c of contacts) {
    const row = byEmail.get(c.email);
    if (!row) continue;
    for (const t of row.tags) {
      const tagId = tagIdByKey.get(String(t).trim().toLowerCase());
      if (tagId) links.push({ contactId: c.id, tagId });
    }
  }
  if (links.length) {
    await prisma.contactTag.createMany({ data: links, skipDuplicates: true });
  }
}
