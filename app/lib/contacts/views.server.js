/**
 * Saved views and column configuration for the Contacts table.
 *
 * A view bundles the filters and the visible columns under a name, so
 * "Unsubscribed this month" or "VIP buyers" is one click rather than four
 * dropdowns rebuilt from memory each visit.
 *
 * Column keys are either a built-in id or a custom property namespaced with
 * "prop:" — see PROP_PREFIX in properties.server.js. Keeping both in one flat,
 * ordered array is what lets a merchant interleave them freely.
 */
import prisma from "../../db.server.js";
import { PROP_PREFIX } from "./properties.server.js";

/**
 * Built-in columns. `locked` ones cannot be hidden — a contacts table with no
 * contact identity in it is not a table anyone can use.
 */
export const BUILTIN_COLUMNS = [
  { key: "contact",   label: "Contact",     group: "Identity", locked: true },
  { key: "phone",     label: "Phone",       group: "Identity" },
  { key: "source",    label: "Source",      group: "Identity" },
  { key: "status",    label: "Status",      group: "Status" },
  { key: "lifecycle", label: "Lifecycle",   group: "Status" },
  { key: "tags",      label: "Tags",        group: "Status" },
  { key: "orders",    label: "Orders",      group: "Purchase" },
  { key: "spent",     label: "Total spent", group: "Purchase" },
  { key: "lastOrder", label: "Last order",  group: "Purchase" },
  { key: "carts",     label: "Carts",       group: "Activity" },
  { key: "emails",    label: "Emails sent", group: "Activity" },
  { key: "opens",     label: "Open rate",   group: "Activity" },
  { key: "lastSeen",  label: "Last seen",   group: "Activity" },
  { key: "firstSeen", label: "First seen",  group: "Activity" },
];

/** Order the groups appear in the picker. */
export const COLUMN_GROUPS = ["Identity", "Status", "Purchase", "Activity"];

/** What the table shows before anyone configures anything. */
export const DEFAULT_COLUMNS = ["contact", "status", "lifecycle", "tags", "carts", "lastSeen"];

const BUILTIN_KEYS = new Set(BUILTIN_COLUMNS.map((c) => c.key));

/**
 * Drop unknown keys, guarantee the locked ones, and cap the width.
 *
 * Runs on read as well as write: a column list can go stale when a custom
 * property is deleted, and rendering a column with no definition would throw.
 *
 * @param {string[]} columns
 * @param {Array} propertyDefs
 */
export function sanitizeColumns(columns, propertyDefs = []) {
  // Decide "nothing specified" from the INPUT, before locked columns are added
  // below — otherwise an empty list resolves to just the locked column and the
  // merchant gets a one-column table instead of the sensible default set.
  if (!Array.isArray(columns) || columns.length === 0) return [...DEFAULT_COLUMNS];

  const propKeys = new Set(propertyDefs.map((d) => `${PROP_PREFIX}${d.key}`));
  const seen = new Set();
  const out = [];

  for (const key of Array.isArray(columns) ? columns : []) {
    if (seen.has(key)) continue;
    if (!BUILTIN_KEYS.has(key) && !propKeys.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  // Locked columns are prepended if the stored list somehow lost them.
  for (const c of BUILTIN_COLUMNS) {
    if (c.locked && !seen.has(c.key)) out.unshift(c.key);
  }

  return out.length ? out.slice(0, 12) : [...DEFAULT_COLUMNS];
}

export async function listViews(shop) {
  return prisma.contactView.findMany({
    where: { shop },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

export async function createView(shop, { name, filters, columns }) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return { ok: false, error: "Give the view a name." };

  const count = await prisma.contactView.count({ where: { shop } });
  if (count >= 30) {
    return { ok: false, error: "You've reached the limit of 30 saved views." };
  }

  const view = await prisma.contactView.create({
    data: {
      shop,
      name: trimmed,
      filters: filters || {},
      columns: Array.isArray(columns) ? columns : [],
      position: count,
    },
  });
  return { ok: true, view };
}

export async function updateView(shop, id, { name, filters, columns }) {
  const data = {};
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return { ok: false, error: "Give the view a name." };
    data.name = trimmed;
  }
  if (filters !== undefined) data.filters = filters || {};
  if (columns !== undefined) data.columns = Array.isArray(columns) ? columns : [];
  await prisma.contactView.updateMany({ where: { id, shop }, data });
  return { ok: true };
}

export async function deleteView(shop, id) {
  await prisma.contactView.deleteMany({ where: { id, shop } });
  return { ok: true };
}

/**
 * Per-shop default column layout, stored as a nameless "default" view so the
 * merchant's column choices persist across sessions and devices without
 * needing a named view.
 */
export async function getDefaultColumns(shop) {
  const row = await prisma.contactView.findFirst({
    where: { shop, isDefault: true },
    select: { columns: true },
  });
  return Array.isArray(row?.columns) && row.columns.length ? row.columns : [...DEFAULT_COLUMNS];
}

export async function setDefaultColumns(shop, columns) {
  const existing = await prisma.contactView.findFirst({
    where: { shop, isDefault: true },
    select: { id: true },
  });
  if (existing) {
    await prisma.contactView.update({ where: { id: existing.id }, data: { columns } });
  } else {
    await prisma.contactView.create({
      data: { shop, name: "__default__", isDefault: true, columns, position: -1 },
    });
  }
  return { ok: true };
}
