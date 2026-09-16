/* global globalThis */
/**
 * The orders backfill must resume, not freeze at its first page ceiling.
 *
 * Run: npm test   (or: node --test app/lib/orders/backfill-resume.db.test.js)
 *
 * ── What this pins ─────────────────────────────────────────────────────────
 * backfillOrders processes MAX_PAGES_PER_RUN pages and returns, and used to
 * leave ordersBackfillStatus = "running". runOrdersBackfillIfNeeded declines to
 * start while a run is "running", so the next trigger never resumed: a shop with
 * more than ~2,000 orders imported its first 2,000 and stopped there forever.
 * The cursor was saved correctly the entire time; nothing read it again.
 *
 * Two failure modes are covered, because fixing only the first leaves the shop
 * stuck in a different way:
 *   1. A clean partial run must resume from its cursor.
 *   2. A run whose process died mid-flight must not hold the lock forever.
 *
 * Shopify's Admin API is stubbed with a paged fake, so the resume is observed
 * through the cursor the code actually sends back — not merely asserted about
 * the status column.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.SHOPIFY_API_SECRET ||= "test_secret_backfill";
process.env.SHOPIFY_API_KEY ||= "test_key";
process.env.SHOPIFY_APP_URL ||= "https://example.test";
process.env.SCOPES ||= "read_orders";

const { default: prisma } = await import("../../db.server.js");
const { setAbstractFetchFunc } = await import("@shopify/shopify-api/runtime");
const { backfillOrders, runOrdersBackfillIfNeeded, isBackfillStale, BACKFILL_STALE_AFTER_MS } =
  await import("./backfill.server.js");

const SHOP = "retainify-test-backfill.myshopify.com";
const realFetch = globalThis.fetch;

/** Cursors the fake API hands out, so a resume can be checked by name. */
const cursorFor = (page) => `cursor-page-${page}`;

/**
 * A fake Admin API serving `totalPages` pages of one order each.
 *
 * Records every `after` cursor it is asked for, which is how the test observes
 * that a second run resumed instead of starting over.
 */
function stubOrdersApi(totalPages) {
  const asked = [];
  setAbstractFetchFunc(async (_url, init) => {
    const body = JSON.parse(init.body);
    const after = body.variables.after ?? null;
    asked.push(after);

    // Page numbering derives from the cursor, so the stub is stateless and a
    // resumed run lands on the right page without shared counters.
    const page = after ? Number(String(after).replace("cursor-page-", "")) + 1 : 1;
    return new Response(
      JSON.stringify({
        data: {
          orders: {
            pageInfo: { hasNextPage: page < totalPages, endCursor: cursorFor(page) },
            nodes: [
              {
                id: `gid://shopify/Order/${page}`,
                email: `buyer${page}@example.test`,
                processedAt: "2026-01-01T00:00:00Z",
                cancelledAt: null,
                displayFinancialStatus: "PAID",
                currentTotalPriceSet: { shopMoney: { amount: "10.00", currencyCode: "PKR" } },
                customer: null,
              },
            ],
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  return asked;
}

async function seed(settings = {}) {
  await cleanup();
  await prisma.shopSettings.create({ data: { shop: SHOP, ...settings } });
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

const state = () =>
  prisma.shopSettings.findUnique({
    where: { shop: SHOP },
    select: {
      ordersBackfillStatus: true,
      ordersBackfillCursor: true,
      ordersBackfilledAt: true,
      ordersBackfillRunAt: true,
    },
  });

test.after(async () => {
  setAbstractFetchFunc(realFetch);
  await cleanup();
});

test("a run that hits its page ceiling ends partial, not running", async () => {
  // The exact bug: this used to be "running", which the guard read as a lock.
  await seed();
  stubOrdersApi(10);

  const result = await backfillOrders(SHOP, { maxPages: 3 });

  assert.equal(result.done, false);
  assert.equal(result.pages, 3);

  const s = await state();
  assert.equal(s.ordersBackfillStatus, "partial", "a stopped run must be resumable");
  assert.equal(s.ordersBackfillCursor, cursorFor(3), "the cursor points at the next page");
  assert.equal(s.ordersBackfilledAt, null, "not finished, so no completion stamp");
  assert.ok(s.ordersBackfillRunAt, "the heartbeat is written");
});

test("the next trigger resumes from the saved cursor and completes", async () => {
  // The acceptance criterion: a multi-run backfill finishes across runs.
  await seed();
  const asked = stubOrdersApi(5);

  await backfillOrders(SHOP, { maxPages: 2 });
  assert.deepEqual(asked, [null, cursorFor(1)], "first run walks pages 1-2");

  // This is the call that used to return { didRun: false } forever.
  const second = await runOrdersBackfillIfNeeded(SHOP);
  assert.equal(second.didRun, true, "the guard must allow a partial run to continue");

  assert.deepEqual(
    asked.slice(2),
    [cursorFor(2), cursorFor(3), cursorFor(4)],
    "the resume starts at page 3 — it does not re-walk from the beginning",
  );

  const s = await state();
  assert.equal(s.ordersBackfillStatus, "done");
  assert.equal(s.ordersBackfillCursor, null, "a finished backfill holds no cursor");
  assert.ok(s.ordersBackfilledAt, "completion is stamped");

  // Five pages, one order each, and no duplicates despite two runs.
  assert.equal(await prisma.order.count({ where: { shop: SHOP } }), 5);
});

test("a completed backfill is never restarted", async () => {
  await seed({ ordersBackfilledAt: new Date(), ordersBackfillStatus: "done" });
  const asked = stubOrdersApi(5);

  const result = await runOrdersBackfillIfNeeded(SHOP);

  assert.equal(result.didRun, false);
  assert.equal(asked.length, 0, "no API call is made for a finished shop");
});

test("a run genuinely in flight is left alone", async () => {
  // A fresh heartbeat means another process is working. Restarting would walk
  // the same pages twice against a rate limit the backfill already lives near.
  await seed({ ordersBackfillStatus: "running", ordersBackfillRunAt: new Date() });
  const asked = stubOrdersApi(5);

  const result = await runOrdersBackfillIfNeeded(SHOP);

  assert.equal(result.didRun, false);
  assert.equal(asked.length, 0);
});

test("a stale 'running' is treated as abandoned and resumes", async () => {
  // The second freeze: a process killed mid-run leaves the flag set with nothing
  // to clear it. Without the heartbeat check that shop is locked out forever.
  await seed({
    ordersBackfillStatus: "running",
    ordersBackfillRunAt: new Date(Date.now() - BACKFILL_STALE_AFTER_MS - 60_000),
    ordersBackfillCursor: cursorFor(2),
  });
  const asked = stubOrdersApi(4);

  const result = await runOrdersBackfillIfNeeded(SHOP);

  assert.equal(result.didRun, true, "an abandoned run must not hold the lock");
  assert.equal(asked[0], cursorFor(2), "and it resumes from where that run left off");
  assert.equal((await state()).ordersBackfillStatus, "done");
});

test("a failed run resumes from its cursor rather than restarting", async () => {
  await seed({ ordersBackfillStatus: "failed", ordersBackfillCursor: cursorFor(1) });
  const asked = stubOrdersApi(3);

  const result = await runOrdersBackfillIfNeeded(SHOP);

  assert.equal(result.didRun, true);
  assert.equal(asked[0], cursorFor(1), "the cursor survives a failure");
  assert.equal((await state()).ordersBackfillStatus, "done");
});

test("isBackfillStale: null is stale, fresh is not, old is", () => {
  // Null means a row written before the heartbeat column existed. Treating it as
  // stale is what lets those shops resume at all.
  assert.equal(isBackfillStale(null), true);
  assert.equal(isBackfillStale(new Date()), false);
  assert.equal(isBackfillStale(new Date(Date.now() - BACKFILL_STALE_AFTER_MS - 1000)), true);
});
