/**
 * Per-contact cart aggregates.
 *
 * The same move as lib/contacts/engagement.server.js and the purchase columns in
 * lib/orders: a segment rule compares a field across the whole audience, so a
 * field that can only be produced by aggregating a child table per contact
 * forces the evaluator to load contacts into memory one page at a time. As
 * columns on Contact these compare in SQL, and with them the evaluator's last
 * in-memory path — and its 5,000-contact ceiling — goes away.
 *
 * ── lastCartValue means the latest cart, not the largest ────────────────────
 * It was computed as MAX(totalPrice) while being labelled "Last cart value", so
 * a shopper whose biggest cart was not their most recent one had a figure
 * attached to them that they never abandoned. 128 contacts were in that state.
 * It is the value of the most recent cart here, which is what sits beside
 * lastCartAt and what the label has always promised.
 *
 * ── Recompute, never increment ──────────────────────────────────────────────
 * As everywhere else in this family: checkout webhooks retry, and a cart can be
 * updated in place, so an incremented counter drifts. A full recompute is one
 * grouped query and cannot.
 *
 * ── There is no hasActiveCart here ──────────────────────────────────────────
 * "Has an active cart" means abandoned within the last 24 hours. That answer
 * changes with the clock, not with a write, so a stored column would be stale
 * for most of every day and correct only just after a rollup. The evaluator
 * derives it from lastCartAt at query time instead.
 */
import { Prisma } from "@prisma/client";
import prisma from "../../db.server.js";
import { normalizeEmail } from "./contacts.server.js";

/** The zeroed row for a contact who has abandoned nothing. */
function emptyCartRollup() {
  return { cartAbandonCount: 0, lastCartAt: null, lastCartValue: 0 };
}

/**
 * Recompute the cart columns for several contacts at once.
 *
 * @param {string} shop
 * @param {string[]} emails
 * @returns {Promise<number>} how many contacts were written
 */
export async function recalcManyContactCartStats(shop, emails) {
  const list = [...new Set((emails || []).map(normalizeEmail).filter(Boolean))];
  if (!shop || list.length === 0) return 0;

  // DISTINCT ON picks the latest cart per contact; the window function counts
  // them without a second pass. AbandonedCart.customerEmail comes straight off
  // checkout payloads and is not normalized on write, so it is lowercased here
  // to match Contact.email.
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON (lower(btrim(a."customerEmail")))
           lower(btrim(a."customerEmail")) AS email,
           a."abandonedAt"                 AS last_at,
           a."totalPrice"                  AS last_value,
           COUNT(*) OVER (PARTITION BY lower(btrim(a."customerEmail"))) AS carts
      FROM "AbandonedCart" a
     WHERE a."shop" = ${shop}
       AND lower(btrim(a."customerEmail")) IN (${Prisma.join(list)})
     ORDER BY lower(btrim(a."customerEmail")), a."abandonedAt" DESC`;

  const byEmail = new Map(rows.map((r) => [r.email, r]));

  for (const email of list) {
    const row = byEmail.get(email);
    await prisma.contact.updateMany({
      where: { shop, email },
      // An address whose carts have all been deleted resets to zero rather than
      // keeping a stale figure — the same reasoning as the refund reset in
      // recalcManyContactOrderStats.
      data: row
        ? {
            cartAbandonCount: Number(row.carts) || 0,
            lastCartAt: row.last_at || null,
            lastCartValue: Number(row.last_value) || 0,
          }
        : emptyCartRollup(),
    });
  }
  return list.length;
}

/**
 * Recompute one contact's cart columns. Called from the checkout webhook.
 *
 * @param {string} shop
 * @param {string} rawEmail
 */
export async function recalcContactCartStats(shop, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!shop || !email) return null;
  await recalcManyContactCartStats(shop, [email]);
  return email;
}
