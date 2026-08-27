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
  await markState(shop, {
    cursor: done ? null : cursor,
    status: done ? "done" : "running",
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
        ...(completedAt ? { ordersBackfilledAt: completedAt } : {}),
      },
    })
    .catch((err) => console.error("[orders-backfill] state write failed:", err.message));
}

/**
 * Run the backfill once per shop, the first time it's needed.
 *
 * Called from the contacts and dashboard loaders in the same spirit as
 * runContactsBackfillIfNeeded — cheap to call, no-ops once complete.
 */
export async function runOrdersBackfillIfNeeded(shop) {
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
    select: { ordersBackfilledAt: true, ordersBackfillStatus: true },
  });
  if (!settings) return { didRun: false };
  if (settings.ordersBackfilledAt) return { didRun: false };
  // A failed run is retried on the next load; a run already in flight is not
  // restarted, which would double the API calls for no benefit.
  if (settings.ordersBackfillStatus === "running") return { didRun: false };

  const result = await backfillOrders(shop).catch((err) => ({
    imported: 0,
    pages: 0,
    done: false,
    error: err.message,
  }));
  return { didRun: true, ...result };
}
