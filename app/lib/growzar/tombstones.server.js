/**
 * Tombstones for Growzar's feeds (API-CONTRACT §6.2): ids of rows that were
 * hard-deleted, so a consumer sees a deletion instead of a silent absence.
 *
 * Only GDPR erasure hard-deletes feed rows in this app — a merchant's delete is
 * a soft delete (Contact.deletedAt) and a flow is archived, not removed — so
 * customers/redact is the only writer. Feed names and row ids match what the
 * feeds return as `id`, so a consumer can drop exactly the row it holds.
 */
import prisma from "../../db.server.js";

export const TOMBSTONE_FEEDS = ["contacts", "enrollments", "messages", "checkouts", "journeys"];

/**
 * Record every feed row customers/redact is about to delete for one shopper.
 *
 * @param {string} shop
 * @param {string} email normalized
 * @param {string|null} contactId
 */
export async function recordCustomerTombstones(shop, email, contactId) {
  const byEmail = { equals: email, mode: "insensitive" };
  const enrollments = await prisma.journeyEnrollment.findMany({
    where: { shop, contactEmail: byEmail },
    select: {
      id: true,
      jobs: { select: { id: true } },
      whatsappJobs: { select: { id: true } },
      pushJobs: { select: { id: true } },
    },
  });
  const carts = await prisma.abandonedCart.findMany({
    where: { shop, customerEmail: byEmail },
    select: { checkoutToken: true },
  });

  const rows = [];
  if (contactId) rows.push({ shop, feed: "contacts", rowId: contactId });
  for (const e of enrollments) {
    rows.push({ shop, feed: "enrollments", rowId: e.id });
    for (const j of e.jobs) rows.push({ shop, feed: "messages", rowId: `email:${j.id}` });
    for (const j of e.whatsappJobs) rows.push({ shop, feed: "messages", rowId: `whatsapp:${j.id}` });
    for (const j of e.pushJobs) rows.push({ shop, feed: "messages", rowId: `push:${j.id}` });
  }
  for (const c of carts) rows.push({ shop, feed: "checkouts", rowId: c.checkoutToken });
  if (!rows.length) return 0;

  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.growzarTombstone.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
  }
  return rows.length;
}

/**
 * Tombstones for one feed since a moment, capped. `truncated` is true when
 * there are more than `cap`, so a capped list never looks like a complete one.
 *
 * @param {string} shop
 * @param {string} feed
 * @param {Date|null} since inclusive; null means all
 * @param {number} [cap]
 * @returns {Promise<{ ids: string[], truncated: boolean }>}
 */
export async function tombstonesSince(shop, feed, since, cap = 1000) {
  const rows = await prisma.growzarTombstone.findMany({
    where: { shop, feed, ...(since ? { deletedAt: { gte: since } } : {}) },
    orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
    take: cap + 1,
    select: { rowId: true },
  });
  return { ids: rows.slice(0, cap).map((r) => r.rowId), truncated: rows.length > cap };
}
