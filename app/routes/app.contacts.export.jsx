/**
 * Contacts CSV export.
 *
 * Replaces the two disabled "Export CSV · Soon" buttons (page menu and bulk
 * bar). Beyond being an expected feature, this is the merchant's own audience
 * data — being unable to get it out is a lock-in problem as much as a missing
 * one, and it is what a GDPR request to the merchant ultimately depends on.
 *
 * Honours the same filters as the list view, so "export what I'm looking at"
 * does what it says. Streamed in keyset-paged batches rather than assembled in
 * memory — a full-list export is exactly where that matters.
 */
import { requireAccount } from "../lib/auth/require.server.js";
import prisma from "../db.server.js";
import { buildContactWhere } from "../lib/contacts/contacts.server.js";
import { listProperties, formatPropertyValue } from "../lib/contacts/properties.server.js";
import { csvDate, csvStreamResponse, sanitizeFilename } from "../lib/export/csv.server.js";

const BATCH = 500;

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "all";
  const source = url.searchParams.get("source") || "all";
  const tagId = url.searchParams.get("tag") || "all";
  const search = url.searchParams.get("q") || "";

  const where = buildContactWhere({ shop, status, source, tagId, search });

  // Merchant-defined properties become their own columns, so an export carries
  // everything the contacts table can show rather than just the built-ins.
  const properties = await listProperties(shop);

  async function* batches() {
    let cursor = null;
    for (;;) {
      const rows = await prisma.contact.findMany({
        where,
        include: { tags: { include: { tag: { select: { name: true } } } } },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        // Keyset pagination on a stable unique column. Ordering by a
        // non-unique field would skip or repeat rows across pages.
        orderBy: { id: "asc" },
      });
      if (!rows.length) return;
      yield rows;
      if (rows.length < BATCH) return;
      cursor = rows[rows.length - 1].id;
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);

  return csvStreamResponse({
    filename: sanitizeFilename(`contacts-${stamp}.csv`),
    headers: [
      "Email",
      "Name",
      "Phone",
      "Subscription status",
      "Marketing consent at",
      "WhatsApp status",
      "Source",
      "Tags",
      "Orders",
      "Total spent",
      "Average order value",
      "First order",
      "Last order",
      "First seen",
      "Last seen",
      "Shopify customer ID",
      ...properties.map((d) => d.label),
    ],
    batches: batches(),
    toRow: (c) => [
      c.email,
      c.name,
      c.phone || "",
      c.subscriptionStatus,
      csvDate(c.marketingConsentAt),
      c.whatsappStatus,
      c.source,
      c.tags.map((ct) => ct.tag?.name).filter(Boolean).join("; "),
      c.orderCount,
      c.totalSpent,
      c.orderCount ? (c.totalSpent / c.orderCount).toFixed(2) : "",
      csvDate(c.firstOrderAt),
      csvDate(c.lastOrderAt),
      csvDate(c.firstSeenAt),
      csvDate(c.lastSeenAt),
      c.shopifyCustomerId || "",
      ...properties.map((d) => formatPropertyValue(d, c.customProps?.[d.key])),
    ],
  });
};
