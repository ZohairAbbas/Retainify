/**
 * Tests for the lazy scheduler.
 *
 * Run: npm test   (or: node --test app/lib/journey/advance.test.js)
 *
 * ── These need a database ──────────────────────────────────────────────────
 * Unlike graph.test.js, the walk is not a pure function: it reads a graph,
 * writes jobs, and moves a cursor. Mocking that would test the mocks. Every
 * test here builds a real flow under a reserved shop key and deletes it
 * afterwards, so it needs DATABASE_URL and will fail loudly without one.
 *
 * ── What is worth testing here ─────────────────────────────────────────────
 * Every failure mode of this module is silent. A cursor that stops moving, a
 * wake time that never gets set, an exit that does not stick — none of them
 * produce an error, a failed job, or a line in any report. They produce a
 * contact who stops hearing from the merchant, discovered weeks later if at
 * all. The assertions below are mostly about states that should be
 * unreachable, because unreachable states are exactly what this file has to
 * keep unreachable.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { saveDraft } from "./journey-lifecycle.server.js";
import { advanceEnrollment, createLazyEnrollment, runEnrollmentAdvanceWorker } from "./advance.server.js";
import {
  settleEnrollmentIfFinished,
  exitEnrollment,
  markJourneyJobDone,
  markJourneyJobFailed,
} from "./journey-queue.server.js";
import { runEnrollmentStallReaper, STALL_AFTER_MS } from "./stuck-jobs.server.js";
import { loadGraph, rootId, YES, NO, NEXT } from "./graph.server.js";
import { PERMANENT } from "./failure-policy.server.js";

const SHOP = "__advance-test.myshopify.com";

/** Build a published flow from canvas-shaped steps, plus optional edge rewiring. */
async function makeFlow(steps, rewire) {
  const journey = await prisma.journey.create({
    data: { shop: SHOP, name: "advance test", trigger: "customer_created", status: "published" },
  });
  await saveDraft(journey.id, { steps });
  if (rewire) {
    const rows = await prisma.journeyStep.findMany({
      where: { journeyId: journey.id, isArchived: false },
      orderBy: { stepNumber: "asc" },
    });
    await rewire(journey, rows);
  }
  return journey;
}

async function enroll(journey, email = "a@b.co") {
  const graph = await loadGraph(journey.id);
  const root = rootId(graph);
  return createLazyEnrollment({
    journey,
    contactEmail: email,
    contactName: "Test Person",
    payloadObj: {},
    rootStepId: root,
    rootStepKey: graph.steps.get(root)?.stepKey,
  });
}

const reload = (id) => prisma.journeyEnrollment.findUnique({ where: { id } });
const liveJobs = (id) =>
  prisma.journeyJob.findMany({ where: { enrollmentId: id }, orderBy: { createdAt: "asc" } });

const email = (subject) => ({ nodeType: "email", subject, emailBlocks: "[]" });

test.before(async () => {
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
});
test.after(async () => {
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.$disconnect();
});

// ── The basic walk ─────────────────────────────────────────────────────────

test("enrolling schedules nothing but the first wake-up", async () => {
  const j = await makeFlow([email("one"), email("two")]);
  const e = await enroll(j);

  // The whole point of lazy: no jobs exist yet. Under the old scheduler both
  // would already have been created.
  assert.equal((await liveJobs(e.id)).length, 0);
  assert.equal(e.schedulingMode, "lazy");
  assert.ok(e.nextRunAt, "should be due immediately");
  assert.ok(e.currentStepId, "cursor should sit on the first step");
});

test("one advance queues exactly one send, then waits", async () => {
  const j = await makeFlow([email("one"), email("two")]);
  const e = await enroll(j);

  const r = await advanceEnrollment(e.id);
  assert.equal(r.verdict, "sending");

  const jobs = await liveJobs(e.id);
  assert.equal(jobs.length, 1, "exactly one job — not the whole flow");

  const after = await reload(e.id);
  // "waiting on a job": no wake time, cursor already past the send.
  assert.equal(after.nextRunAt, null);
  assert.notEqual(after.currentStepId, e.currentStepId);

  // Advancing again must not double-send. The worker only claims enrollments
  // with a wake time, but the guard belongs here too.
  await advanceEnrollment(e.id);
  assert.equal((await liveJobs(e.id)).length, 1, "no second job while one is outstanding");
});

test("a settled send hands back to the walker, which queues the next", async () => {
  const j = await makeFlow([email("one"), email("two"), { nodeType: "exit" }]);
  const e = await enroll(j);

  await advanceEnrollment(e.id);
  const [first] = await liveJobs(e.id);
  await markJourneyJobDone(first.id, { sentAt: new Date() });

  // The hand-off: settling must wake, not close.
  const woken = await reload(e.id);
  assert.equal(woken.exitReason, "", "a settled job must NOT close a lazy enrollment");
  assert.ok(woken.nextRunAt, "settling should set a wake time");

  await advanceEnrollment(e.id);
  assert.equal((await liveJobs(e.id)).length, 2, "second step queued");
});

test("a flow runs to its exit and closes exactly once", async () => {
  const j = await makeFlow([email("one"), email("two"), { nodeType: "exit" }]);
  const e = await enroll(j);

  for (let i = 0; i < 2; i++) {
    await advanceEnrollment(e.id);
    const jobs = await liveJobs(e.id);
    await markJourneyJobDone(jobs[jobs.length - 1].id, { sentAt: new Date() });
  }
  await advanceEnrollment(e.id);

  const done = await reload(e.id);
  assert.equal(done.exitReason, "completed");
  assert.ok(done.completedAt);
  assert.equal(done.nextRunAt, null, "a closed enrollment must never be woken again");
  assert.equal((await liveJobs(e.id)).length, 2, "two steps, two sends");
});

test("a flow with no exit node still ends when it runs out of steps", async () => {
  const j = await makeFlow([email("only")]);
  const e = await enroll(j);
  await advanceEnrollment(e.id);
  const [job] = await liveJobs(e.id);
  await markJourneyJobDone(job.id, { sentAt: new Date() });
  await advanceEnrollment(e.id);
  assert.equal((await reload(e.id)).exitReason, "completed");
});

// ── Waits ──────────────────────────────────────────────────────────────────

test("a Wait parks the enrollment for its own duration, from now", async () => {
  const j = await makeFlow([email("one"), { nodeType: "delay", delayHours: 48 }, email("two")]);
  const e = await enroll(j);

  await advanceEnrollment(e.id);
  const [job] = await liveJobs(e.id);
  await markJourneyJobDone(job.id, { sentAt: new Date() });

  const r = await advanceEnrollment(e.id);
  assert.equal(r.verdict, "parked");

  const parked = await reload(e.id);
  const hours = (parked.nextRunAt - Date.now()) / 3_600_000;
  // 48 hours from NOW — the moment the previous step settled — not 48 hours
  // from the trigger. On a tree that is the only definition that works.
  assert.ok(hours > 47.9 && hours < 48.1, `expected ~48h, got ${hours}`);
  assert.equal((await liveJobs(e.id)).length, 1, "parking must not queue anything");
});

test("a Wait's own delayHours is used, not the send step's cumulative value", async () => {
  // saveDraft still writes cumulative-from-trigger delayHours onto SEND steps
  // (phase 5 changes that). If the walk read it, every step would re-serve the
  // whole flow's waits.
  const j = await makeFlow([
    { nodeType: "delay", delayHours: 5 },
    email("one"),
    { nodeType: "delay", delayHours: 5 },
    email("two"),
  ]);
  const e = await enroll(j);

  await advanceEnrollment(e.id); // parks 5h
  await prisma.journeyEnrollment.update({ where: { id: e.id }, data: { nextRunAt: new Date() } });
  await advanceEnrollment(e.id); // queues email one
  const [job] = await liveJobs(e.id);
  const before = Date.now();
  await markJourneyJobDone(job.id, { sentAt: new Date() });
  await advanceEnrollment(e.id); // parks 5h again, NOT 10h

  const parked = await reload(e.id);
  const hours = (parked.nextRunAt - before) / 3_600_000;
  assert.ok(hours > 4.9 && hours < 5.1, `expected ~5h, got ${hours}`);
});

// ── Skips ──────────────────────────────────────────────────────────────────

test("a disabled step is walked straight past", async () => {
  const j = await makeFlow([
    { ...email("off"), isEnabled: false },
    email("on"),
  ]);
  const e = await enroll(j);
  const r = await advanceEnrollment(e.id);

  assert.equal(r.verdict, "sending");
  const jobs = await liveJobs(e.id);
  assert.equal(jobs.length, 1);
  const step = await prisma.journeyStep.findUnique({ where: { id: jobs[0].stepId } });
  assert.equal(step.subject, "on", "the disabled step must not have been sent");
});

// ── Splits ─────────────────────────────────────────────────────────────────

/** A split whose condition every contact fails (no Contact row exists). */
async function splitFlow() {
  return makeFlow(
    [email("before"), { nodeType: "exit" }, email("yes"), email("no")],
    async (journey, rows) => {
      const [before, exit, yesStep, noStep] = rows;
      // Turn the exit into a split by hand — the canvas cannot make one yet.
      await prisma.journeyStep.update({
        where: { id: exit.id },
        data: {
          nodeType: "split",
          splitCondition: {
            type: "group",
            match: "all",
            children: [{ type: "rule", field: "totalSpent", op: "gt", value: 999999 }],
          },
        },
      });
      await prisma.journeyEdge.deleteMany({ where: { journeyId: journey.id } });
      await prisma.journeyEdge.createMany({
        data: [
          { journeyId: journey.id, fromStepId: before.id, toStepId: exit.id, branch: NEXT },
          { journeyId: journey.id, fromStepId: exit.id, toStepId: yesStep.id, branch: YES },
          { journeyId: journey.id, fromStepId: exit.id, toStepId: noStep.id, branch: NO },
        ],
      });
    },
  );
}

test("a split evaluates on arrival, records the branch, and keeps walking", async () => {
  const j = await splitFlow();
  const e = await enroll(j, "nobody-we-know@b.co");

  await advanceEnrollment(e.id);
  const [first] = await liveJobs(e.id);
  await markJourneyJobDone(first.id, { sentAt: new Date() });

  // One advance crosses the split AND queues the next send — a split schedules
  // nothing itself, so stopping on one would be a stall.
  const r = await advanceEnrollment(e.id);
  assert.equal(r.verdict, "sending");

  const events = await prisma.journeyPathEvent.findMany({ where: { enrollmentId: e.id } });
  assert.equal(events.length, 1, "the decision must be recorded");
  assert.equal(events[0].branch, NO, "unknown contact takes the conservative branch");
  assert.equal(events[0].matched, false);
  assert.ok(events[0].stepKey, "stepKey travels with the event so the report survives edits");

  const jobs = await liveJobs(e.id);
  const step = await prisma.journeyStep.findUnique({ where: { id: jobs[1].stepId } });
  assert.equal(step.subject, "no");
});

test("an unevaluable split takes No rather than stranding the contact", async () => {
  // No Contact row exists for this address at all. Entry filters would refuse
  // to enrol; a split must NOT drop someone out of a flow they are already in.
  const j = await splitFlow();
  const e = await enroll(j, "ghost@b.co");
  await advanceEnrollment(e.id);
  const [first] = await liveJobs(e.id);
  await markJourneyJobDone(first.id, { sentAt: new Date() });
  await advanceEnrollment(e.id);

  const after = await reload(e.id);
  assert.equal(after.exitReason, "", "must still be in the flow");
  assert.equal((await liveJobs(e.id)).length, 2, "must have been sent the No branch");
});

// ── Failure handling ───────────────────────────────────────────────────────

test("a permanently failed email ends the flow", async () => {
  const j = await makeFlow([email("one"), email("two")]);
  const e = await enroll(j);
  await advanceEnrollment(e.id);
  const [job] = await liveJobs(e.id);

  await markJourneyJobFailed(job.id, "bad address", PERMANENT);

  const after = await reload(e.id);
  // Step 2 assumes step 1 landed. Continuing would queue it only for the
  // sequence gate to cancel it, leaving a cancelled row in the report for
  // every remaining step.
  assert.equal(after.exitReason, "ended_failed");
  assert.equal(after.nextRunAt, null);
  assert.equal((await liveJobs(e.id)).length, 1, "nothing further queued");
});

test("a failed push does NOT end the flow", async () => {
  const j = await makeFlow([email("one")]);
  const e = await enroll(j);
  await advanceEnrollment(e.id);
  const [job] = await liveJobs(e.id);
  await markJourneyJobDone(job.id, { sentAt: new Date() });

  // No browser subscription is benign and must not kill a good email sequence
  // — the rule sequence-gate.server.js already applies to gating.
  await settleEnrollmentIfFinished(e.id, { failed: true, channel: "push" });
  const after = await reload(e.id);
  assert.equal(after.exitReason, "", "a push failure must not end the flow");
  assert.ok(after.nextRunAt, "it should still be woken");
});

// ── Exits ──────────────────────────────────────────────────────────────────

test("exiting stops the walk dead", async () => {
  const j = await makeFlow([email("one"), email("two")]);
  const e = await enroll(j);
  await advanceEnrollment(e.id);

  await exitEnrollment(e.id, "exit_criteria:order_placed");

  const exited = await reload(e.id);
  assert.equal(exited.nextRunAt, null);
  assert.equal(exited.currentStepId, null);

  // Even if something wakes it anyway, the walk must refuse.
  await prisma.journeyEnrollment.update({ where: { id: e.id }, data: { nextRunAt: new Date() } });
  const r = await advanceEnrollment(e.id);
  assert.equal(r.verdict, "skipped");
  assert.equal((await liveJobs(e.id)).length, 1, "no send after an exit");
  assert.equal((await reload(e.id)).exitReason, "exit_criteria:order_placed", "reason is preserved");
});

// ── Editing a flow mid-flight ──────────────────────────────────────────────

test("a contact standing on a step the merchant just replaced is resumed, not dropped", async () => {
  const j = await makeFlow([email("one"), email("two")]);
  const e = await enroll(j);
  await advanceEnrollment(e.id);
  const [job] = await liveJobs(e.id);
  await markJourneyJobDone(job.id, { sentAt: new Date() });

  const cursorBefore = (await reload(e.id)).currentStepId;
  const stepBefore = await prisma.journeyStep.findUnique({ where: { id: cursorBefore } });

  // The merchant edits the flow. saveDraft recreates every step, so the id
  // under the cursor stops existing — but stepKey survives, and the contact is
  // still standing on that step conceptually.
  await saveDraft(j.id, {
    steps: [
      email("one"),
      { ...email("two RENAMED"), stepKey: stepBefore.stepKey },
    ],
  });
  assert.equal(
    await prisma.journeyStep.count({ where: { id: cursorBefore, isArchived: false } }),
    0,
    "the step under the cursor should genuinely be gone",
  );

  const r = await advanceEnrollment(e.id);
  assert.equal(r.verdict, "sending", "the contact must not be dropped out of the flow");

  const jobs = await liveJobs(e.id);
  const sent = await prisma.journeyStep.findUnique({ where: { id: jobs[jobs.length - 1].stepId } });
  assert.equal(sent.subject, "two RENAMED", "resumed onto the step that replaced the old one");
});

// ── Concurrency ────────────────────────────────────────────────────────────

test("two workers ticking together advance an enrollment once, not twice", async () => {
  const j = await makeFlow([email("one"), email("two")]);
  const e = await enroll(j);

  // Both instances see the same due enrollment and race for it.
  await Promise.all([runEnrollmentAdvanceWorker(), runEnrollmentAdvanceWorker()]);

  const jobs = await prisma.journeyJob.findMany({ where: { enrollmentId: e.id } });
  assert.equal(jobs.length, 1, "the claim must let exactly one worker through");
});

test("the worker leaves eager enrollments alone", async () => {
  const j = await makeFlow([email("one")]);
  const e = await enroll(j);
  await prisma.journeyEnrollment.update({
    where: { id: e.id },
    data: { schedulingMode: "eager", nextRunAt: new Date() },
  });

  const r = await advanceEnrollment(e.id);
  assert.equal(r.verdict, "skipped");
  assert.equal((await liveJobs(e.id)).length, 0, "eager jobs are pre-materialized — never re-created");
});

// ── Stall detection ────────────────────────────────────────────────────────

test("the stall reaper finds an enrollment nobody will wake, and ignores healthy ones", async () => {
  const j = await makeFlow([email("one"), email("two")]);

  // Healthy: waiting on an outstanding job.
  const busy = await enroll(j, "busy@b.co");
  await advanceEnrollment(busy.id);

  // Healthy: parked on a wake time.
  const parked = await enroll(j, "parked@b.co");
  await prisma.journeyEnrollment.update({
    where: { id: parked.id },
    data: { nextRunAt: new Date(Date.now() + 3_600_000) },
  });

  // Stalled: no wake time, no job. This is the state that is otherwise silent.
  const lost = await enroll(j, "lost@b.co");
  await prisma.journeyEnrollment.update({
    where: { id: lost.id },
    data: { nextRunAt: null, enrolledAt: new Date(Date.now() - STALL_AFTER_MS - 60_000) },
  });

  const { stalled, sample } = await runEnrollmentStallReaper();
  assert.ok(stalled >= 1, "the stalled enrollment must be reported");
  assert.ok(sample.includes(lost.id), "and named");
  assert.ok(!sample.includes(busy.id), "an enrollment awaiting a send is not stalled");
  assert.ok(!sample.includes(parked.id), "an enrollment parked on a delay is not stalled");
});
