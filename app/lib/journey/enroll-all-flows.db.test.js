/**
 * Every published flow on a trigger gets the contact, not just the first one.
 *
 * Run: npm test   (or: node --test app/lib/journey/enroll-all-flows.db.test.js)
 *
 * ── What this pins ─────────────────────────────────────────────────────────
 * The three webhook triggers used findFirst, so a merchant running two published
 * flows on the same trigger — email-only and WhatsApp-only variants, or a
 * flow-level A/B — silently got whichever row the database returned first. The
 * second flow looked published in the UI and never enrolled anyone.
 *
 * The risk in fixing it is the opposite failure: enrolling into everything,
 * including flows that should have declined. So these tests check both
 * directions — that every eligible flow is reached, AND that each flow's own
 * entry rules, status and archived state still decide independently.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { default: prisma } = await import("../../db.server.js");
const { enrollInAllFlows } = await import("./journey-queue.server.js");

const SHOP = "__test__enroll-all-flows";
const EMAIL = "buyer@example.test";
const TRIGGER = "cart_abandoned";

/**
 * A flow with one email step, which is the minimum enrollContact will accept —
 * it builds jobs from the graph, so a stepless flow enrolls nobody and would
 * make every assertion here vacuous.
 */
async function flow(name, overrides = {}) {
  const journey = await prisma.journey.create({
    data: {
      shop: SHOP,
      name,
      trigger: TRIGGER,
      status: "published",
      entryFrequency: "immediate",
      ...overrides,
    },
  });
  await prisma.journeyStep.create({
    data: {
      journeyId: journey.id,
      stepNumber: 1,
      nodeType: "email",
      subject: "hello",
      delayHours: 0,
    },
  });
  return journey;
}

const enrollmentsFor = (journeyId) =>
  prisma.journeyEnrollment.count({ where: { journeyId, contactEmail: EMAIL } });

async function cleanup() {
  await prisma.journeyJob.deleteMany({ where: { shop: SHOP } });
  await prisma.journeyEnrollment.deleteMany({ where: { shop: SHOP } });
  await prisma.journeyStep.deleteMany({ where: { journey: { shop: SHOP } } });
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
}

test.beforeEach(cleanup);
test.after(cleanup);

test("two published flows on one trigger both enroll the contact", async () => {
  // The original bug: only one of these ever ran.
  const a = await flow("email variant");
  const b = await flow("whatsapp variant");

  const result = await enrollInAllFlows(SHOP, TRIGGER, EMAIL, "Buyer", { cartId: "c1" });

  assert.equal(result.flows, 2);
  assert.equal(result.enrolled, 2);
  assert.equal(await enrollmentsFor(a.id), 1, "first flow enrolled");
  assert.equal(await enrollmentsFor(b.id), 1, "second flow enrolled — this is the fix");
});

test("draft, paused and archived flows are skipped", async () => {
  const published = await flow("published");
  const draft = await flow("draft", { status: "draft" });
  const paused = await flow("paused", { status: "paused" });
  // Archiving sets status paused AND archivedAt; a row where the two disagree
  // must still be excluded, which is why the query checks both.
  const archived = await flow("archived", { status: "published", archivedAt: new Date() });

  const result = await enrollInAllFlows(SHOP, TRIGGER, EMAIL, "Buyer", {});

  assert.equal(result.flows, 1, "only the published, non-archived flow is a candidate");
  assert.equal(await enrollmentsFor(published.id), 1);
  assert.equal(await enrollmentsFor(draft.id), 0);
  assert.equal(await enrollmentsFor(paused.id), 0);
  assert.equal(await enrollmentsFor(archived.id), 0, "archived must not enroll");
});

test("each flow's own re-entry rule still decides — one no_reentry, one immediate", async () => {
  // Enrolling into "every" flow must not mean overriding what a flow says about
  // repeat entry. The two rules have to diverge on the second call.
  const once = await flow("no reentry", { entryFrequency: "no_reentry" });
  const repeat = await flow("immediate", { entryFrequency: "immediate" });

  await enrollInAllFlows(SHOP, TRIGGER, EMAIL, "Buyer", {});
  // Past the 30s duplicate-webhook guard that "immediate" applies.
  await prisma.journeyEnrollment.updateMany({
    where: { shop: SHOP },
    data: { enrolledAt: new Date(Date.now() - 60 * 1000) },
  });
  await enrollInAllFlows(SHOP, TRIGGER, EMAIL, "Buyer", {});

  assert.equal(await enrollmentsFor(once.id), 1, "no_reentry stays at one");
  assert.equal(await enrollmentsFor(repeat.id), 2, "immediate enrolls again");
});

test("the 30-second duplicate guard still absorbs the double webhook", async () => {
  // orders/create and orders/paid fire for the same order within ~3-10s. Both
  // flows must ignore the second one.
  const a = await flow("a");
  const b = await flow("b");

  await enrollInAllFlows(SHOP, TRIGGER, EMAIL, "Buyer", {});
  await enrollInAllFlows(SHOP, TRIGGER, EMAIL, "Buyer", {});

  assert.equal(await enrollmentsFor(a.id), 1);
  assert.equal(await enrollmentsFor(b.id), 1);
});

test("one broken flow does not stop the others enrolling", async () => {
  // A flow with no steps makes enrollContact bail. The healthy flow beside it
  // must still get the contact — the webhook has already committed its work.
  const healthy = await flow("healthy");
  const broken = await prisma.journey.create({
    data: { shop: SHOP, name: "no steps", trigger: TRIGGER, status: "published" },
  });

  const result = await enrollInAllFlows(SHOP, TRIGGER, EMAIL, "Buyer", {});

  assert.equal(result.flows, 2, "both were candidates");
  assert.equal(await enrollmentsFor(healthy.id), 1, "the healthy flow is unaffected");
  assert.equal(await enrollmentsFor(broken.id), 0);
});

test("no published flow on the trigger is a no-op, not an error", async () => {
  await flow("other trigger", { trigger: "order_placed" });

  const result = await enrollInAllFlows(SHOP, TRIGGER, EMAIL, "Buyer", {});

  assert.deepEqual(result, { enrolled: 0, flows: 0 });
});

test("a per-flow payload function receives the flow", async () => {
  // Used where the payload depends on which flow is being entered.
  const a = await flow("a");
  const b = await flow("b");

  await enrollInAllFlows(SHOP, TRIGGER, EMAIL, "Buyer", (j) => ({ flowName: j.name }));

  const rows = await prisma.journeyEnrollment.findMany({
    where: { shop: SHOP },
    select: { journeyId: true, payload: true },
  });
  const byId = new Map(rows.map((r) => [r.journeyId, JSON.parse(r.payload)]));
  assert.equal(byId.get(a.id).flowName, "a");
  assert.equal(byId.get(b.id).flowName, "b");
});
