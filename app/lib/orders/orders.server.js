/**
 * Order ingestion and per-contact purchase aggregates.
 *
 * ── Why the aggregates are denormalized ─────────────────────────────────────
 * Segment evaluation compares fields across the whole audience. If total spend
 * and order count had to be aggregated per contact at evaluation time, every
 * Purchase rule would force the evaluator down its JS path — loading contacts
 * and summing orders for each — which is why those fields shipped disabled.
 * Recomputed on each order write, they are ordinary indexed columns and
 * translate straight into a Prisma WHERE.
 *
 * ── Which orders count ──────────────────────────────────────────────────────
 * Cancelled, voided and refunded orders are excluded from the aggregates but
 * kept as rows, so a refund correctly reduces a customer's lifetime value
 * rather than leaving it inflated. Those states arrive as an update to the same
 * order id, which the upsert below applies.
 */
import prisma from "../../db.server.js";
import { normalizeEmail, upsertContact } from "../contacts/contacts.server.js";

/** Financial states excluded from lifetime value. */
const EXCLUDED_STATUSES = ["voided", "refunded"];

/**
 * Record (or update) one order and refresh the buyer's aggregates.
 *
 * Idempotent on shop + shopifyOrderId: orders/create and orders/paid both fire
 * for the same order, and Shopify retries webhooks, so this must be safe to run
 * repeatedly. Returns null when the payload carries no email — every contact is
 * keyed on email, so an anonymous order has nothing to attach to.
 *
 * @param {string} shop
 * @param {object} payload Shopify order webhook payload
 */
export async function recordOrder(shop, payload) {
  const email = normalizeEmail(payload?.email || payload?.contact_email || "");
  const shopifyOrderId = String(payload?.id ?? "");
  if (!shop || !email || !shopifyOrderId) return null;

  const processedAt = new Date(payload.processed_at || payload.created_at || Date.now());

  const data = {
    shop,
    shopifyOrderId,
    email,
    totalPrice: Number.parseFloat(payload.total_price ?? "0") || 0,
    currency: payload.currency || "USD",
    financialStatus: String(payload.financial_status || ""),
    processedAt: Number.isNaN(processedAt.getTime()) ? new Date() : processedAt,
    cancelledAt: payload.cancelled_at ? new Date(payload.cancelled_at) : null,
  };

  await prisma.order.upsert({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId } },
    create: data,
    update: {
      // Identity fields never change; everything else can, as an order moves
      // from pending to paid to refunded or cancelled.
      totalPrice: data.totalPrice,
      currency: data.currency,
      financialStatus: data.financialStatus,
      processedAt: data.processedAt,
      cancelledAt: data.cancelledAt,
    },
  });

  // Ensure a Contact exists to hang the aggregates on. Someone who has only
  // ever ordered — never signed up — still belongs in the audience.
  await upsertContact({
    shop,
    email,
    name: customerName(payload),
    phone: payload.phone || payload.customer?.phone || undefined,
    source: "shopify_customer",
    shopifyCustomerId: payload.customer?.id ? String(payload.customer.id) : undefined,
  }).catch((err) => console.error("[orders] upsertContact failed:", err.message));

  await recalcContactOrderStats(shop, email);
  return { shopifyOrderId, email, totalPrice: data.totalPrice };
}

function customerName(payload) {
  const c = payload?.customer;
  if (!c) return payload?.billing_address?.name || "";
  const joined = `${c.first_name || ""} ${c.last_name || ""}`.trim();
  return joined || payload?.billing_address?.name || "";
}

/**
 * Recompute one contact's purchase aggregates from their orders.
 *
 * A full recompute rather than an increment: increments drift the moment a
 * webhook is retried, an order is refunded, or a backfill overlaps live
 * ingestion — and a wrong lifetime-value figure is worse than a slightly more
 * expensive write.
 */
export async function recalcContactOrderStats(shop, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!shop || !email) return null;

  const agg = await prisma.order.aggregate({
    where: { shop, email, cancelledAt: null, financialStatus: { notIn: EXCLUDED_STATUSES } },
    _count: { _all: true },
    _sum: { totalPrice: true },
    _min: { processedAt: true },
    _max: { processedAt: true },
  });

  const stats = {
    orderCount: agg._count._all || 0,
    totalSpent: Number(agg._sum.totalPrice || 0),
    firstOrderAt: agg._min.processedAt || null,
    lastOrderAt: agg._max.processedAt || null,
  };

  await prisma.contact.updateMany({ where: { shop, email }, data: stats });
  return stats;
}

/**
 * Recompute aggregates for many contacts at once, for the backfill.
 *
 * One grouped query plus one update per affected contact, rather than the
 * aggregate query per contact recalcContactOrderStats would cost.
 */
export async function recalcManyContactOrderStats(shop, emails) {
  const list = [...new Set((emails || []).map(normalizeEmail).filter(Boolean))];
  if (!shop || list.length === 0) return 0;

  const rows = await prisma.order.groupBy({
    by: ["email"],
    where: {
      shop,
      email: { in: list },
      cancelledAt: null,
      financialStatus: { notIn: EXCLUDED_STATUSES },
    },
    _count: { _all: true },
    _sum: { totalPrice: true },
    _min: { processedAt: true },
    _max: { processedAt: true },
  });

  const byEmail = new Map(rows.map((r) => [r.email, r]));

  for (const email of list) {
    const r = byEmail.get(email);
    await prisma.contact.updateMany({
      where: { shop, email },
      // An email with no surviving orders resets to zero rather than keeping a
      // stale total — that is the refund and cancellation case.
      data: {
        orderCount: r?._count._all || 0,
        totalSpent: Number(r?._sum.totalPrice || 0),
        firstOrderAt: r?._min.processedAt || null,
        lastOrderAt: r?._max.processedAt || null,
      },
    });
  }
  return list.length;
}

/** Average order value, derived rather than stored so it cannot drift. */
export function averageOrderValue(contact) {
  const n = Number(contact?.orderCount) || 0;
  if (!n) return 0;
  return (Number(contact?.totalSpent) || 0) / n;
}
