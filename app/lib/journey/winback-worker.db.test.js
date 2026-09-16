/**
 * Win-back: enroll on crossing the inactivity line, exactly once.
 *
 * Run: npm test   (or: node --test app/lib/journey/winback-worker.db.test.js)
 *
 * ── What this pins ─────────────────────────────────────────────────────────
 * "Inactive 90 days" was selectable in the builder and shipped as a template,
 * but nothing enrolled anyone: every other trigger reacts to a Shopify webhook,
 * and this one describes the absence of an event. A merchant could publish a
 * win-back flow and watch it sit at zero forever.
 *
 * The property that matters is "exactly once". A sweep that re-reads the whole
 * dormant population every tick would mail the same people repeatedly the moment
 * a flow is set to an entryFrequency that permits re-entry — so the test that
 * earns its keep is the one that runs the worker twice and asserts nothing
 * happens the second time.
 *
 * Shop health is stubbed to live: this is a poller, so it checks, and without a
 * stub every test here would depend on a Shopify probe.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { default: prisma } = await import("../../db.server.js");
const {
  runWinbackWorker,
  INACTIVITY_DAYS,
  FIRST_RUN_LOOKBACK_MS,
  MAX_PER_FLOW_PER_RUN,
} = await import("./winback-worker.server.js");

const SHOP = "__test__winback";
const DAY = 24 * 60 * 60 * 1000;
const INACTIVITY_MS = INACTIVITY_DAYS * DAY;

/** A contact whose last order was `days` ago. */
async function contact(email, days) {
  return prisma.contact.create({
    data: {
      shop: SHOP,
      email,
      name: "Buyer",
      lastOrderAt: new Date(Date.now() - days * DAY),
      orderCount: 1,
      totalSpent: 10,
    },
  });
}

async function winbackFlow(overrides = {}) {
  const journey = await prisma.journey.create({
    data: {
      shop: SHOP,
      name: "win back",
      trigger: "win_back",
      status: "published",
      entryFrequency: "immediate",
      ...overrides,
    },
  });
  await prisma.journeyStep.create({
    data: { journeyId: journey.id, stepNumber: 1, nodeType: "email", subject: "miss you" },
  });
  return journey;
}

const enrolledEmails = async () => {
  const rows = await prisma.journeyEnrollment.findMany({
    where: { shop: SHOP },
    select: { contactEmail: true },
  });
  return rows.map((r) => r.contactEmail).sort();
};

async function cleanup() {
  await prisma.journeyJob.deleteMany({ where: { shop: SHOP } });
  await prisma.journeyEnrollment.deleteMany({ where: { shop: SHOP } });
  await prisma.journeyStep.deleteMany({ where: { journey: { shop: SHOP } } });
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.shopSettings.deleteMany({ where: { shop: SHOP } });
  await prisma.account.deleteMany({ where: { key: SHOP } });
}

test.beforeEach(async () => {
  await cleanup();
  // kind "direct" makes checkShopHealth short-circuit to SHOP_LIVE without a
  // Shopify probe — the same trick the WhatsApp worker tests use.
  await prisma.account.create({ data: { key: SHOP, kind: "direct", name: "winback test" } });
  await prisma.shopSettings.create({ data: { shop: SHOP } });
});

test.after(cleanup);

test("a contact who just crossed 90 days is enrolled", async () => {
  await winbackFlow();
  await contact("dormant@example.test", INACTIVITY_DAYS + 1);

  const result = await runWinbackWorker();

  assert.equal(result.flows, 1);
  assert.equal(result.enrolled, 1);
  assert.deepEqual(await enrolledEmails(), ["dormant@example.test"]);
});

test("crossing enrolls exactly once, however often the sweep runs", async () => {
  // The acceptance criterion, and the reason the window exists at all. With a
  // plain "older than 90 days" scan and entryFrequency immediate, this contact
  // would be re-enrolled on every tick forever.
  await winbackFlow({ entryFrequency: "immediate" });
  await contact("dormant@example.test", INACTIVITY_DAYS + 1);

  await runWinbackWorker();
  const second = await runWinbackWorker();
  const third = await runWinbackWorker();

  assert.equal(second.enrolled, 0, "the second sweep must find nobody new");
  assert.equal(third.enrolled, 0);
  assert.equal((await enrolledEmails()).length, 1, "one enrollment, not three");
});

test("a contact still inside the window is left alone until they cross", async () => {
  await winbackFlow();
  await contact("active@example.test", INACTIVITY_DAYS - 5);

  const result = await runWinbackWorker();

  assert.equal(result.enrolled, 0);
  assert.deepEqual(await enrolledEmails(), []);
});

test("the first sweep does not enroll the shop's entire dormant history", async () => {
  // Without a bounded first window, publishing a flow would mail every customer
  // who has ever gone quiet — years of them, in one tick.
  await winbackFlow();
  await contact("just-crossed@example.test", INACTIVITY_DAYS + 1);
  await contact("long-gone@example.test", INACTIVITY_DAYS + 400);
  await contact("ancient@example.test", INACTIVITY_DAYS + 1000);

  const result = await runWinbackWorker();

  assert.equal(result.enrolled, 1, "only the recent crossing");
  assert.deepEqual(await enrolledEmails(), ["just-crossed@example.test"]);
});

test("someone who never ordered is not 'inactive'", async () => {
  await winbackFlow();
  await prisma.contact.create({
    data: { shop: SHOP, email: "never@example.test", name: "Lead", lastOrderAt: null },
  });

  const result = await runWinbackWorker();

  assert.equal(result.enrolled, 0);
});

test("a deleted contact is skipped", async () => {
  await winbackFlow();
  const c = await contact("gone@example.test", INACTIVITY_DAYS + 1);
  await prisma.contact.update({ where: { id: c.id }, data: { deletedAt: new Date() } });

  const result = await runWinbackWorker();

  assert.equal(result.enrolled, 0);
});

test("draft, paused and archived win-back flows are skipped", async () => {
  await winbackFlow({ status: "draft" });
  await winbackFlow({ status: "paused" });
  await winbackFlow({ status: "published", archivedAt: new Date() });
  await contact("dormant@example.test", INACTIVITY_DAYS + 1);

  const result = await runWinbackWorker();

  assert.equal(result.flows, 0, "no flow is a candidate");
  assert.deepEqual(await enrolledEmails(), []);
});

test("flows on other triggers are not swept", async () => {
  await winbackFlow({ trigger: "order_placed" });
  await contact("dormant@example.test", INACTIVITY_DAYS + 1);

  const result = await runWinbackWorker();

  assert.equal(result.flows, 0);
});

test("a capped run resumes rather than skipping the overflow", async () => {
  // The marker must not jump past contacts the cap cut off, or they are dormant
  // forever with nothing to catch them.
  await winbackFlow();
  const total = MAX_PER_FLOW_PER_RUN + 5;
  // Spread across the first-run window so they are all eligible at once.
  for (let i = 0; i < total; i++) {
    await prisma.contact.create({
      data: {
        shop: SHOP,
        email: `bulk${i}@example.test`,
        name: "B",
        // Staggered within the 7-day first-run lookback, oldest first.
        lastOrderAt: new Date(
          Date.now() - INACTIVITY_MS - FIRST_RUN_LOOKBACK_MS + (i + 1) * (FIRST_RUN_LOOKBACK_MS / total),
        ),
        orderCount: 1,
      },
    });
  }

  const first = await runWinbackWorker();
  assert.equal(first.enrolled, MAX_PER_FLOW_PER_RUN, "the cap holds");

  const second = await runWinbackWorker();
  assert.equal(second.enrolled, 5, "the overflow is picked up, not skipped");
  assert.equal((await enrolledEmails()).length, total, "everyone eligible is reached");
});

test("two published win-back flows both enroll the contact", async () => {
  // Consistent with RTF-3: a trigger is not owned by one flow.
  await winbackFlow({ name: "a" });
  await winbackFlow({ name: "b" });
  await contact("dormant@example.test", INACTIVITY_DAYS + 1);

  const result = await runWinbackWorker();

  assert.equal(result.flows, 2);
  assert.equal(result.enrolled, 2);
});

test("no published win-back flow is a cheap no-op", async () => {
  await contact("dormant@example.test", INACTIVITY_DAYS + 1);

  const result = await runWinbackWorker();

  assert.deepEqual(result, { flows: 0, enrolled: 0 });
});
