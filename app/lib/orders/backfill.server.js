/**
 * Historical order backfill.
 *
 * Live ingestion via the orders webhook only sees orders placed from now on.
 * Without a backfill every existing shop would start with zero purchase history
 * — so "total spent" and "order count" would read 0 for their best customers,
 * which is worse than the fields being disabled.
 *
 * Runs page-by-page against the Admin API, resumable via a stored cursor so a
 * shop with years of orders can be processed across several passes rather than
 * one request that times out.
 *
 * That was true of the cursor and false of everything around it until
 * 2026-09-16. A run that hit its page ceiling left the status as "running", and
 * the guard declines to start while a run is "running" — so the cursor was
 * written every time and read never, and any shop past ~2,000 orders stopped
 * there for good. The states now distinguish "in flight" from "ended with work
 * left" ("partial"), and "running" is believed only while its heartbeat is
 * fresh, so a process killed mid-run cannot lock a shop out permanently either.
 */
import prisma from "../../db.server.js";
import { unauthenticated } from "../../shopify.server.js";
import { recalcManyContactOrderStats } from "./orders.server.js";
import { normalizeEmail } from "../contacts/contacts.server.js";

const PAGE_SIZE = 100;
/** Pages per invocation. Bounded so one call can't run for minutes. */
const MAX_PAGES_PER_RUN = 20;

const ORDERS_QUERY = `#graphql
  query backfillOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: PROCESSED_AT, reverse: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        email
        processedAt
        cancelledAt
        displayFinancialStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        customer { id firstName lastName phone }
      }
    }
  }
`;

/** GraphQL gids look like gid://shopify/Order/12345 — the webhook sends 12345. */
function numericId(gid) {
  const s = String(gid || "");
  const i = s.lastIndexOf("/");
  return i === -1 ? s : s.slice(i + 1);
}

/**
 * Backfill a shop's orders.
 *
 * @param {string} shop
 * @param {{ maxPages?: number }} [opts]
 * @returns {Promise<{imported:number, pages:number, done:boolean, error?:string}>}
 */
export async function backfillOrders(shop, { maxPages = MAX_PAGES_PER_RUN } = {}) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) return { imported: 0, pages: 0, done: true, error: "shop not set up" };

  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch (err) {
    // No session — the shop has uninstalled. Nothing to backfill.
    return { imported: 0, pages: 0, done: true, error: err.message };
  }

  let cursor = settings.ordersBackfillCursor || null;
  let imported = 0;
  let pages = 0;
  let hasNext = true;

  // Claim the run before the first API call. Two dashboard loaders landing
  // together would otherwise both walk the same pages — harmless to the data,
  // since every write is an upsert, but it doubles the API spend against a
  // rate limit the backfill already lives close to.
  await markState(shop, { cursor, status: "running", error: "" });

  const touchedEmails = new Set();

  while (hasNext && pages < maxPages) {
    let body;
    try {
      const resp = await admin.graphql(ORDERS_QUERY, {
        variables: { first: PAGE_SIZE, after: cursor },
      });
      body = await resp.json();
    } catch (err) {
      await markState(shop, { cursor, status: "failed", error: err.message });
      return { imported, pages, done: false, error: err.message };
    }

    const conn = body?.data?.orders;
    if (!conn) {
      const msg = JSON.stringify(body?.errors || "no orders payload").slice(0, 300);
      await markState(shop, { cursor, status: "failed", error: msg });
      return { imported, pages, done: false, error: msg };
    }

    for (const node of conn.nodes || []) {
      const email = normalizeEmail(node.email);
      if (!email) continue; // anonymous order — nothing to attach it to

      const shopifyOrderId = numericId(node.id);
      const amount = Number(node.currentTotalPriceSet?.shopMoney?.amount || 0);
      const processedAt = new Date(node.processedAt || Date.now());

      await prisma.order.upsert({
        where: { shop_shopifyOrderId: { shop, shopifyOrderId } },
        create: {
          shop,
          shopifyOrderId,
          email,
          totalPrice: Number.isFinite(amount) ? amount : 0,
          currency: node.currentTotalPriceSet?.shopMoney?.currencyCode || "USD",
          financialStatus: String(node.displayFinancialStatus || "").toLowerCase(),
          processedAt: Number.isNaN(processedAt.getTime()) ? new Date() : processedAt,
          cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
        },
        // A backfill can overlap live ingestion, so an existing row is refreshed
        // rather than skipped — whichever source ran last leaves it correct.
        update: {
          totalPrice: Number.isFinite(amount) ? amount : 0,
          financialStatus: String(node.displayFinancialStatus || "").toLowerCase(),
          cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
        },
      });

      touchedEmails.add(email);
      imported++;
    }

    cursor = conn.pageInfo?.endCursor || cursor;
    hasNext = !!conn.pageInfo?.hasNextPage;
    pages++;

    // Recompute in chunks as we go, so a run that stops early still leaves the
    // contacts it touched with correct totals.
    if (touchedEmails.size >= 500) {
      await recalcManyContactOrderStats(shop, [...touchedEmails]);
      touchedEmails.clear();
    }
  }

  if (touchedEmails.size) {
    await recalcManyContactOrderStats(shop, [...touchedEmails]);
  }

  const done = !hasNext;
  // "partial", not "running": this run has returned, and the only thing standing
  // between the remaining pages and the cursor that reaches them is the next
  // trigger. Leaving it as "running" is what froze every shop over ~2,000
  // orders — the guard read it as a run already in flight and declined forever.
  await markState(shop, {
    cursor: done ? null : cursor,
    status: done ? "done" : "partial",
    error: "",
    completedAt: done ? new Date() : undefined,
  });

  return { imported, pages, done };
}

async function markState(shop, { cursor, status, error, completedAt }) {
  await prisma.shopSettings
    .update({
      where: { shop },
      data: {
        ordersBackfillCursor: cursor ?? null,
        ordersBackfillStatus: status,
        ordersBackfillError: (error || "").slice(0, 500),
        // Heartbeat. Written on every state change, so a "running" row can be
        // told apart from one abandoned by a process that died mid-run.
        ordersBackfillRunAt: new Date(),
        ...(completedAt ? { ordersBackfilledAt: completedAt } : {}),
      },
    })
    .catch((err) => console.error("[orders-backfill] state write failed:", err.message));
}

/**
 * How long a "running" backfill is believed before it is treated as abandoned.
 *
 * A run is bounded by MAX_PAGES_PER_RUN pages against the Admin API, which
 * finishes in well under a minute in practice. Fifteen minutes is therefore far
 * beyond any legitimate run, while still being short enough that a shop whose
 * worker was killed mid-backfill resumes the same day rather than never.
 */
export const BACKFILL_STALE_AFTER_MS = 15 * 60 * 1000;

/** @returns {boolean} true when a "running" flag is old enough to be abandoned. */
export function isBackfillStale(runAt, now = new Date()) {
  // Null means a row that predates the heartbeat column — the migration moved
  // those to "partial", so anything still claiming to run without one is left
  // over from a build that could not record it. Treat it as resumable.
  if (!runAt) return true;
  return now.getTime() - new Date(runAt).getTime() > BACKFILL_STALE_AFTER_MS;
}

/**
 * Run the backfill for a shop, resuming a partial run from its saved cursor.
 *
 * Called from the contacts and dashboard loaders in the same spirit as
 * runContactsBackfillIfNeeded — cheap to call, no-ops once complete.
 *
 * Not "once per shop, ever": a run covers at most MAX_PAGES_PER_RUN pages, so a
 * shop with years of orders needs several. What must happen once is the
 * *completion*, which ordersBackfilledAt records.
 */
export async function runOrdersBackfillIfNeeded(shop) {
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
    select: {
      ordersBackfilledAt: true,
      ordersBackfillStatus: true,
      ordersBackfillRunAt: true,
    },
  });
  if (!settings) return { didRun: false };
  if (settings.ordersBackfilledAt) return { didRun: false };

  // A run genuinely in flight is left alone: restarting it would walk the same
  // pages twice for no benefit. But "running" is only believed while the
  // heartbeat is fresh — a process killed mid-run leaves the flag set with
  // nothing to clear it, and trusting that forever is precisely the bug this
  // fixes. "partial" and "failed" both resume immediately; both carry a valid
  // cursor, so neither restarts from the beginning.
  if (
    settings.ordersBackfillStatus === "running" &&
    !isBackfillStale(settings.ordersBackfillRunAt)
  ) {
    return { didRun: false };
  }

  const result = await backfillOrders(shop).catch((err) => ({
    imported: 0,
    pages: 0,
    done: false,
    error: err.message,
  }));
  return { didRun: true, ...result };
}
