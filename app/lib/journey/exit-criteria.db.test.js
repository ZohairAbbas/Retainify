/**
 * Exit criteria with app-defined event keys.
 *
 * Run: npm test   (or: node --test app/lib/journey/exit-criteria.db.test.js)
 *
 * ── Why this needs a database ──────────────────────────────────────────────
 * The behaviour is a join between an enrollment and its journey's stored
 * criteria, and the thing being exited is a row. Mocking prisma would assert
 * the mock.
 *
 * ── What was wrong before ──────────────────────────────────────────────────
 * The evaluator guarded on a closed set of three commerce events, so an
 * internal flow exiting on "setup_completed" silently exited nobody: the drip
 * kept nagging users who had already finished setting up.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { evaluateExitCriteria } from "./exit-criteria.server.js";

const SHOP = "__test__exit_criteria";
const EMAIL = "user@example.com";

async function makeFlow(exitCriteria) {
  const journey = await prisma.journey.create({
    data: {
      shop: SHOP,
      name: "Test flow",
      trigger: "api_event",
      status: "published",
      exitCriteria: JSON.stringify(exitCriteria),
    },
  });
  const enrollment = await prisma.journeyEnrollment.create({
    data: { shop: SHOP, journeyId: journey.id, contactEmail: EMAIL },
  });
  return { journey, enrollment };
}

async function clear() {
  await prisma.journeyEnrollment.deleteMany({ where: { shop: SHOP } });
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
}

test.before(clear);
test.after(async () => {
  await clear();
  await prisma.$disconnect();
});

test("an app-defined event exits a flow that lists it", async (t) => {
  t.after(clear);
  const { enrollment } = await makeFlow(["setup_completed"]);

  assert.equal(await evaluateExitCriteria(SHOP, EMAIL, "setup_completed"), 1);

  const after = await prisma.journeyEnrollment.findUnique({ where: { id: enrollment.id } });
  assert.equal(after.exitReason, "exit_criteria:setup_completed");
  // The cursor and wake time must both be cleared, or the advance worker keeps
  // walking a contact through a flow they have just left.
  assert.equal(after.nextRunAt, null);
});

test("the commerce events still work", async (t) => {
  t.after(clear);
  await makeFlow(["order_placed"]);
  assert.equal(await evaluateExitCriteria(SHOP, EMAIL, "order_placed"), 1);
});

test("an event the flow does not list exits nobody", async (t) => {
  t.after(clear);
  await makeFlow(["setup_completed"]);
  assert.equal(await evaluateExitCriteria(SHOP, EMAIL, "something_else"), 0);
});

test("a malformed event key is refused without touching anything", async (t) => {
  t.after(clear);
  const { enrollment } = await makeFlow(["setup_completed"]);
  assert.equal(await evaluateExitCriteria(SHOP, EMAIL, "Setup Completed"), 0);

  const after = await prisma.journeyEnrollment.findUnique({ where: { id: enrollment.id } });
  assert.equal(after.exitReason, "");
});

test("an already-exited enrollment is not exited twice", async (t) => {
  t.after(clear);
  await makeFlow(["setup_completed"]);
  assert.equal(await evaluateExitCriteria(SHOP, EMAIL, "setup_completed"), 1);
  assert.equal(await evaluateExitCriteria(SHOP, EMAIL, "setup_completed"), 0);
});

test("another contact's enrollment is untouched", async (t) => {
  t.after(clear);
  const { journey } = await makeFlow(["setup_completed"]);
  const other = await prisma.journeyEnrollment.create({
    data: { shop: SHOP, journeyId: journey.id, contactEmail: "someone.else@example.com" },
  });

  assert.equal(await evaluateExitCriteria(SHOP, EMAIL, "setup_completed"), 1);

  const after = await prisma.journeyEnrollment.findUnique({ where: { id: other.id } });
  assert.equal(after.exitReason, "");
});
