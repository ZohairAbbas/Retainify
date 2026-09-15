/* global globalThis */
/**
 * Order webhooks: the states that arrive after checkout.
 *
 * Run: npm test   (or: node --test app/lib/orders/webhooks-orders.db.test.js)
 *
 * Lives under lib/ rather than beside the route: flatRoutes() treats every file
 * in app/routes/ as a route, so a test file there is built as one and the
 * client bundle then trips over its server-only imports. internal/routes.db.test.js
 * sets the same precedent.
 *
 * ── What this pins ─────────────────────────────────────────────────────────
 * Only orders/create and orders/paid were subscribed, so an order froze at the
 * state it held when it was placed. COD orders land as financial_status
 * "pending" and never moved off it, which meant attributed revenue and lifetime
 * value kept counting sales that were later cancelled or returned. Both queries
 * already excluded those states correctly — the data simply never arrived, so
 * the filters were never reached.
 *
 * The other half is retryability. The handler caught every error and returned
 * 200, so a transient failure silently discarded an order state that Shopify
 * would otherwise have redelivered. For a cancellation, which arrives once,
 * there is no later correction.
 *
 * The route action is exercised through a genuinely HMAC-signed Request, so the
 * topic dispatch and the auth seam are both real. Only Shopify's Admin API is
 * stubbed — refunds/create carries no order, so the refetch is the behaviour
 * under test, not a dependency to mock away.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.SHOPIFY_API_SECRET ||= "test_secret_orders_webhook";
process.env.SHOPIFY_API_KEY ||= "test_key";
process.env.SHOPIFY_APP_URL ||= "https://example.test";
process.env.SCOPES ||= "read_orders";

const { default: prisma } = await import("../../db.server.js");
const { action } = await import("../../routes/webhooks.orders.js");
const { recalcContactOrderStats } = await import("./orders.server.js");

// The Shopify client captures globalThis.fetch once, at adapter import time
// (adapters/node/index.mjs calls setAbstractFetchFunc(globalThis.fetch)), so
// reassigning globalThis.fetch afterwards has no effect on it. The setter is
// the supported seam, and the only one that actually intercepts admin.graphql.
const { setAbstractFetchFunc } = await import("@shopify/shopify-api/runtime");

// Must pass Shopify's own domain validation — authenticate.webhook rejects
// anything that isn't a well-formed *.myshopify.com, so the usual "__test__"
// prefix cannot be used here.
const SHOP = "retainify-test-orders.myshopify.com";
const EMAIL = "buyer@example.test";
const ORDER_ID = "5550001";

const realFetch = globalThis.fetch;

/** Answer the next Admin API call with this order, as GraphQL would shape it. */
function adminReturnsOrder(order) {
  setAbstractFetchFunc(async () =>
    new Response(JSON.stringify({ data: { order } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** Make the next Admin API call fail the way an outage would. */
function adminUnreachable() {
  setAbstractFetchFunc(async () => {
    throw new Error("network down");
  });
}

/** A signed webhook delivery, exactly as Shopify would send it. */
function webhook(topic, payload) {
  const body = JSON.stringify(payload);
  const hmac = createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(body, "utf8")
    .digest("base64");
  return new Request("https://example.test/webhooks/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-topic": topic,
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-shop-domain": SHOP,
      "x-shopify-api-version": "2025-10",
      "x-shopify-webhook-id": `test-${topic}-${Math.round(performance.now())}`,
    },
    body,
  });
}

const orderPayload = (extra = {}) => ({
  id: ORDER_ID,
  email: EMAIL,
  total_price: "100.00",
  currency: "PKR",
  financial_status: "pending",
  processed_at: "2026-09-01T10:00:00Z",
  cancelled_at: null,
  customer: { id: "99", first_name: "A", last_name: "B" },
  ...extra,
});

async function seed() {
  await cleanup();
  await prisma.shopSettings.create({ data: { shop: SHOP } });
  // The refund path calls unauthenticated.admin(shop), which loads an offline
  // session from storage before it ever reaches fetch. Without a row the
  // refetch fails for the wrong reason and the test proves nothing.
  await prisma.session.create({
    data: {
      id: `offline_${SHOP}`,
      shop: SHOP,
      state: "test",
      isOnline: false,
      accessToken: "test-token",
      scope: "read_orders",
    },
  });
}

async function cleanup() {
  await prisma.order.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.shopSettings.deleteMany({ where: { shop: SHOP } });
  await prisma.session.deleteMany({ where: { shop: SHOP } });
}

const storedOrder = () =>
  prisma.order.findUnique({
    where: { shop_shopifyOrderId: { shop: SHOP, shopifyOrderId: ORDER_ID } },
  });

test.beforeEach(seed);
test.after(async () => {
  // Restore the captured reference, not just globalThis — a stub left installed
  // would silently break every later test file in the same run.
  setAbstractFetchFunc(realFetch);
  await cleanup();
});

test("a COD order arrives pending and counts toward lifetime value", async () => {
  // The baseline the rest of the file measures against.
  const res = await action({ request: webhook("orders/create", orderPayload()) });
  assert.equal(res.status, 200);

  const order = await storedOrder();
  assert.equal(order.financialStatus, "pending");

  const stats = await recalcContactOrderStats(SHOP, EMAIL);
  assert.equal(stats.orderCount, 1);
  assert.equal(stats.totalSpent, 100);
});

test("orders/cancelled marks the order cancelled and drops it out of LTV", async () => {
  await action({ request: webhook("orders/create", orderPayload()) });

  const res = await action({
    request: webhook(
      "orders/cancelled",
      orderPayload({ cancelled_at: "2026-09-05T12:00:00Z", financial_status: "voided" }),
    ),
  });
  assert.equal(res.status, 200);

  const order = await storedOrder();
  assert.ok(order.cancelledAt, "the cancellation timestamp is recorded");
  assert.equal(order.financialStatus, "voided");

  // The exclusion that was always in the query and never had anything to act on.
  const stats = await recalcContactOrderStats(SHOP, EMAIL);
  assert.equal(stats.orderCount, 0, "a cancelled order is not lifetime value");
  assert.equal(stats.totalSpent, 0);
});

test("orders/updated moves a frozen COD order to paid", async () => {
  await action({ request: webhook("orders/create", orderPayload()) });

  const res = await action({
    request: webhook("orders/updated", orderPayload({ financial_status: "paid" })),
  });
  assert.equal(res.status, 200);
  assert.equal((await storedOrder()).financialStatus, "paid");

  // One order, not two: the upsert is keyed on shop + shopifyOrderId.
  assert.equal(await prisma.order.count({ where: { shop: SHOP } }), 1);
});

test("refunds/create refetches the order and records the real status", async () => {
  await action({ request: webhook("orders/create", orderPayload({ financial_status: "paid" })) });

  // A PARTIAL refund. Stamping "refunded" from the webhook alone would drop the
  // whole order out of attribution and LTV — which is why the refetch exists.
  adminReturnsOrder({
    id: `gid://shopify/Order/${ORDER_ID}`,
    email: EMAIL,
    processedAt: "2026-09-01T10:00:00Z",
    cancelledAt: null,
    displayFinancialStatus: "PARTIALLY_REFUNDED",
    currentTotalPriceSet: { shopMoney: { amount: "60.00", currencyCode: "PKR" } },
    customer: null,
  });

  const res = await action({
    request: webhook("refunds/create", { id: "777", order_id: ORDER_ID }),
  });
  assert.equal(res.status, 200);

  const order = await storedOrder();
  assert.equal(
    order.financialStatus,
    "partially_refunded",
    "GraphQL returns uppercase; it must be lowered to match webhook spelling",
  );
  assert.equal(order.totalPrice, 60, "the refetched current total replaces the original");

  // Partially refunded is not in EXCLUDED_STATUSES, so it still counts — at the
  // reduced amount. That distinction is the whole reason for the extra call.
  const stats = await recalcContactOrderStats(SHOP, EMAIL);
  assert.equal(stats.orderCount, 1);
  assert.equal(stats.totalSpent, 60);
});

test("a fully refunded order leaves lifetime value entirely", async () => {
  await action({ request: webhook("orders/create", orderPayload({ financial_status: "paid" })) });

  adminReturnsOrder({
    id: `gid://shopify/Order/${ORDER_ID}`,
    email: EMAIL,
    processedAt: "2026-09-01T10:00:00Z",
    cancelledAt: null,
    displayFinancialStatus: "REFUNDED",
    currentTotalPriceSet: { shopMoney: { amount: "0.00", currencyCode: "PKR" } },
    customer: null,
  });

  await action({ request: webhook("refunds/create", { id: "778", order_id: ORDER_ID }) });

  assert.equal((await storedOrder()).financialStatus, "refunded");
  const stats = await recalcContactOrderStats(SHOP, EMAIL);
  assert.equal(stats.orderCount, 0, "a refund takes the revenue back out");
});

test("a failed refund refetch returns a retryable status, not a silent 200", async () => {
  await action({ request: webhook("orders/create", orderPayload({ financial_status: "paid" })) });

  adminUnreachable();

  const res = await action({
    request: webhook("refunds/create", { id: "779", order_id: ORDER_ID }),
  });
  assert.equal(res.status, 500, "Shopify only retries on a non-2xx");

  // Unchanged, and therefore still wrong — which is exactly why it must retry.
  assert.equal((await storedOrder()).financialStatus, "paid");
});

test("an order write failure is retryable", async () => {
  // A shop row is required by the write path; removing it makes recordOrder's
  // dependencies fail the way a transient database problem would.
  const originalUpsert = prisma.order.upsert;
  prisma.order.upsert = async () => {
    throw new Error("connection reset");
  };

  try {
    const res = await action({ request: webhook("orders/cancelled", orderPayload()) });
    assert.equal(res.status, 500, "a lost cancellation has no second chance — it must retry");
  } finally {
    prisma.order.upsert = originalUpsert;
  }
});

test("a refund for an unreadable order is acknowledged, not retried forever", async () => {
  adminReturnsOrder(null);

  const res = await action({
    request: webhook("refunds/create", { id: "780", order_id: "does-not-exist" }),
  });
  assert.equal(res.status, 200, "retrying cannot conjure a deleted order");
});
