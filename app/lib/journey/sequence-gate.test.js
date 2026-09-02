/**
 * Tests for step ordering.
 *
 * Run: npm test   (needs DATABASE_URL)
 *
 * ── Why these matter ───────────────────────────────────────────────────────
 * This gate is what stopped 7,201 enrollments sending "Your first order — 10%
 * off" to people whose welcome email had permanently failed. It has to keep
 * doing that under both schedulers at once, and the two disagree about what
 * "earlier" means: eager compares stepNumber, lazy walks the tree.
 *
 * The branched case below is the one the numeric rule gets wrong. Under
 * preorder numbering a step on the No branch has a HIGHER number than steps on
 * the Yes branch, so "every email step with a lower number" sweeps in messages
 * this contact was never on the path for.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { saveDraft } from "./journey-lifecycle.server.js";
import { checkStepSequence, PROCEED, WAIT, CANCEL } from "./sequence-gate.server.js";
import { loadGraph, rootId, NEXT, YES, NO } from "./graph.server.js";

const SHOP = "__sequence-test.myshopify.com";
const email = (subject) => ({ nodeType: "email", subject, emailName: subject, emailBlocks: "[]" });

async function makeFlow(steps, rewire) {
  const journey = await prisma.journey.create({
    data: { shop: SHOP, name: "seq test", trigger: "customer_created", status: "published" },
  });
  await saveDraft(journey.id, { steps });
  const rows = await prisma.journeyStep.findMany({
    where: { journeyId: journey.id, isArchived: false },
    orderBy: { stepNumber: "asc" },
  });
  if (rewire) await rewire(journey, rows);
  return { journey, rows };
}

async function makeEnrollment(journey, mode) {
  const graph = await loadGraph(journey.id);
  return prisma.journeyEnrollment.create({
    data: {
      shop: SHOP,
      journeyId: journey.id,
      contactEmail: `${mode}-${Math.random().toString(36).slice(2)}@b.co`,
      schedulingMode: mode,
      currentStepId: mode === "lazy" ? rootId(graph) : null,
    },
  });
}

const job = (enr, step, status) =>
  prisma.journeyJob.create({
    data: {
      shop: SHOP,
      enrollmentId: enr.id,
      stepId: step.id,
      scheduledFor: new Date(),
      status,
      sentAt: status === "done" ? new Date() : null,
    },
  });

test.before(async () => {
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
});
test.after(async () => {
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.$disconnect();
});

// ── Eager: unchanged ───────────────────────────────────────────────────────

test("eager still gates on stepNumber", async () => {
  const { journey, rows } = await makeFlow([email("one"), email("two")]);
  const [one, two] = rows;

  const failed = await makeEnrollment(journey, "eager");
  await job(failed, one, "failed");
  const blocked = await checkStepSequence(failed, two);
  assert.equal(blocked.verdict, CANCEL);
  assert.match(blocked.reason, /never reached the recipient/);

  const ok = await makeEnrollment(journey, "eager");
  await job(ok, one, "done");
  assert.equal((await checkStepSequence(ok, two)).verdict, PROCEED);

  const waiting = await makeEnrollment(journey, "eager");
  await job(waiting, one, "pending");
  assert.equal((await checkStepSequence(waiting, two)).verdict, WAIT);
});

test("a cancelled earlier step also stops the sequence", async () => {
  // How a closed shop, a stale job, or this gate itself retires work.
  const { journey, rows } = await makeFlow([email("one"), email("two")]);
  const enr = await makeEnrollment(journey, "eager");
  await job(enr, rows[0], "cancelled");
  assert.equal((await checkStepSequence(enr, rows[1])).verdict, CANCEL);
});

// ── Lazy, linear ───────────────────────────────────────────────────────────

test("lazy gates on ancestors", async () => {
  const { journey, rows } = await makeFlow([email("one"), email("two"), email("three")]);
  const [one, , three] = rows;

  const enr = await makeEnrollment(journey, "lazy");
  await job(enr, one, "failed");
  const v = await checkStepSequence(enr, three);
  assert.equal(v.verdict, CANCEL, "step one is an ancestor of step three");
});

test("lazy proceeds when every ancestor landed", async () => {
  const { journey, rows } = await makeFlow([email("one"), email("two")]);
  const enr = await makeEnrollment(journey, "lazy");
  await job(enr, rows[0], "done");
  assert.equal((await checkStepSequence(enr, rows[1])).verdict, PROCEED);
});

test("lazy ignores a disabled ancestor", async () => {
  // A disabled step never produces a job, so gating on it would hold the rest
  // of the flow forever.
  const { journey, rows } = await makeFlow([
    { ...email("off"), isEnabled: false },
    email("on"),
  ]);
  const enr = await makeEnrollment(journey, "lazy");
  assert.equal((await checkStepSequence(enr, rows[1])).verdict, PROCEED);
});

// ── Lazy, branched — the case the numeric rule gets wrong ──────────────────

/**
 *  one ── split ─┬─ yes ── yesMail ── yesExit
 *                └─ no ─── noMail  ── noExit
 *
 * Preorder numbering puts yesMail BELOW noMail, so "every email step with a
 * lower stepNumber" would sweep yesMail into noMail's history.
 */
async function branchedFlow() {
  return makeFlow(
    [email("one"), { nodeType: "exit" }, email("yesMail"), email("noMail")],
    async (journey, rows) => {
      const [one, split, yesMail, noMail] = rows;
      await prisma.journeyStep.update({
        where: { id: split.id },
        data: {
          nodeType: "split",
          splitCondition: {
            type: "group",
            match: "all",
            children: [{ type: "rule", field: "totalSpent", op: "gt", value: 1 }],
          },
        },
      });
      await prisma.journeyEdge.deleteMany({ where: { journeyId: journey.id } });
      await prisma.journeyEdge.createMany({
        data: [
          { journeyId: journey.id, fromStepId: one.id, toStepId: split.id, branch: NEXT },
          { journeyId: journey.id, fromStepId: split.id, toStepId: yesMail.id, branch: YES },
          { journeyId: journey.id, fromStepId: split.id, toStepId: noMail.id, branch: NO },
        ],
      });
    },
  );
}

test("a failure on the OTHER branch does not cancel this one", async () => {
  const { journey, rows } = await branchedFlow();
  const [one, , yesMail, noMail] = rows;
  assert.ok(yesMail.stepNumber < noMail.stepNumber, "preorder puts Yes above No");

  const enr = await makeEnrollment(journey, "lazy");
  await job(enr, one, "done");
  // A stray job for the branch this contact never took — a leftover from an
  // earlier run of the flow, or a step that was rewired.
  await job(enr, yesMail, "failed");

  const v = await checkStepSequence(enr, noMail);
  assert.equal(
    v.verdict,
    PROCEED,
    "yesMail is not an ancestor of noMail — it is a sibling on a path never taken",
  );
});

test("the same flow under the eager rule would wrongly cancel", async () => {
  // Documents exactly what the ancestry rule buys. Not a defect in the eager
  // path — no eager enrollment can ever be in a branched flow, because
  // branching shipped after lazy became the default — but it is the reason the
  // two rules cannot be one rule.
  const { journey, rows } = await branchedFlow();
  const [one, , yesMail, noMail] = rows;

  const enr = await makeEnrollment(journey, "eager");
  await job(enr, one, "done");
  await job(enr, yesMail, "failed");

  assert.equal((await checkStepSequence(enr, noMail)).verdict, CANCEL);
});

test("an ancestor failure still cancels on a branch", async () => {
  const { journey, rows } = await branchedFlow();
  const [one, , , noMail] = rows;
  const enr = await makeEnrollment(journey, "lazy");
  await job(enr, one, "failed");
  assert.equal((await checkStepSequence(enr, noMail)).verdict, CANCEL, "step one IS an ancestor");
});

// ── Editing a flow mid-flight ──────────────────────────────────────────────

test("an archived ancestor still gates, matched by stepKey", async () => {
  // The gate walks the LIVE graph, but the job hangs off the archived row that
  // was replaced. Matching on id alone would find no earlier jobs at all and
  // silently switch the gate off for every edited flow.
  const { journey, rows } = await makeFlow([email("one"), email("two")]);
  const [one, two] = rows;

  const enr = await makeEnrollment(journey, "lazy");
  await job(enr, one, "failed");

  // Editing archives step one (it has a job) and creates a replacement that
  // inherits its stepKey.
  await saveDraft(journey.id, {
    steps: [
      { ...email("one RENAMED"), stepKey: one.stepKey },
      { ...email("two"), stepKey: two.stepKey },
    ],
  });
  const live = await prisma.journeyStep.findMany({
    where: { journeyId: journey.id, isArchived: false },
    orderBy: { stepNumber: "asc" },
  });
  assert.equal(
    await prisma.journeyStep.count({ where: { journeyId: journey.id, isArchived: true } }),
    1,
    "step one should have been archived, not deleted",
  );

  const v = await checkStepSequence(enr, live[1]);
  assert.equal(v.verdict, CANCEL, "the archived predecessor's failure must still count");
});

test("a step the merchant deleted outright allows the send rather than cancelling it", async () => {
  const { journey, rows } = await makeFlow([email("one"), email("two")]);
  const enr = await makeEnrollment(journey, "lazy");
  const orphan = { id: "step_that_never_existed", stepNumber: 99, stepKey: "sk_gone" };
  const v = await checkStepSequence(enr, orphan);
  // "I cannot tell" is not evidence anything died. Only positive evidence
  // cancels a send.
  assert.equal(v.verdict, PROCEED);
  assert.match(v.reason, /could not be resolved/);
  assert.ok(rows.length);
});

test("missing context proceeds rather than throwing", async () => {
  assert.equal((await checkStepSequence(null, null)).verdict, PROCEED);
  assert.equal((await checkStepSequence({ id: "x" }, null)).verdict, PROCEED);
});
