/**
 * A/B tests end to end: a flow saves, a contact is assigned, the report reads.
 *
 * Run: npm test — needs a database.
 *
 * ab-assignment.test.js proves the division is correct and
 * ab-significance.test.js proves the verdict is honest. This is the seam
 * between them and the flow engine: that an A/B split survives being saved as
 * rows, that the walk actually sends people down an arm, and that the report
 * counts the whole branch rather than one message.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { saveDraft } from "./journey-lifecycle.server.js";
import { advanceEnrollment, createLazyEnrollment } from "./advance.server.js";
import { markJourneyJobDone } from "./journey-queue.server.js";
import { validateFlowForPublish } from "./flow-validation.server.js";
import { getCampaignAbBreakdown } from "../analytics/campaign.server.js";
import { serializeTree, TRIGGER_ID } from "./canvas-tree.js";
import { loadGraph, rootId, ARM_A, ARM_B, NEXT, BY_CHANCE } from "./graph.server.js";

const SHOP = "__ab-test.myshopify.com";

const toStep = (n) => {
  const key = n.stepKey ? { stepKey: n.stepKey } : {};
  if (n.kind === "exit") return { ...key, nodeType: "exit" };
  if (n.kind === "split") {
    return {
      ...key,
      nodeType: "split",
      emailName: n.emailName || "",
      splitMode: n.splitMode,
      splitWeight: n.splitWeight,
      splitMetric: n.splitMetric,
      splitCondition: n.splitCondition ?? null,
    };
  }
  return { ...key, nodeType: "email", emailName: n.emailName, subject: n.emailName, emailBlocks: "[]" };
};

const em = (name) => ({ kind: "email", emailName: name });

/** first ── test ⇒ A: a1 → a2 → exit | B: b1 → exit */
function abCanvas(over = {}) {
  return [
    { kind: "trigger", id: TRIGGER_ID },
    { ...em("first"), id: "f", parentId: TRIGGER_ID, branch: NEXT },
    {
      kind: "split", id: "t", parentId: "f", branch: NEXT,
      emailName: "Offer test",
      splitMode: BY_CHANCE, splitWeight: 50, splitMetric: "click",
      ...over,
    },
    // Arm A is two emails deep on purpose: the report must count the whole
    // branch, not just the first message.
    { ...em("A first"), id: "a1", parentId: "t", branch: ARM_A },
    { ...em("A second"), id: "a2", parentId: "a1", branch: NEXT },
    { kind: "exit", id: "ax", parentId: "a2", branch: NEXT },
    { ...em("B only"), id: "b1", parentId: "t", branch: ARM_B },
    { kind: "exit", id: "bx", parentId: "b1", branch: NEXT },
  ];
}

async function makeFlow(nodes, journeyData = {}) {
  const journey = await prisma.journey.create({
    data: { shop: SHOP, name: "ab", trigger: "customer_created", status: "published", ...journeyData },
  });
  const { steps, edges } = serializeTree(nodes, toStep);
  await saveDraft(journey.id, { steps, edges });
  return journey;
}

async function enroll(journey, email) {
  const graph = await loadGraph(journey.id);
  const root = rootId(graph);
  return createLazyEnrollment({
    journey,
    contactEmail: email,
    contactName: "",
    payloadObj: {},
    rootStepId: root,
    rootStepKey: graph.steps.get(root)?.stepKey,
  });
}

/** Run a contact past the first email and through the split. */
async function runToArm(journey, email) {
  const e = await enroll(journey, email);
  await advanceEnrollment(e.id);
  const [job] = await prisma.journeyJob.findMany({ where: { enrollmentId: e.id } });
  await markJourneyJobDone(job.id, { sentAt: new Date() });
  await advanceEnrollment(e.id);
  const ev = await prisma.journeyPathEvent.findFirst({ where: { enrollmentId: e.id } });
  return { enrollment: e, branch: ev?.branch, event: ev };
}

test.before(async () => {
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
});
test.after(async () => {
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.$disconnect();
});

// ── Saving ─────────────────────────────────────────────────────────────────

test("an A/B split saves with a/b edges and its settings intact", async () => {
  const j = await makeFlow(abCanvas({ splitWeight: 70, splitMetric: "order" }));
  const graph = await loadGraph(j.id);
  const split = [...graph.steps.values()].find((s) => s.nodeType === "split");

  assert.equal(split.splitMode, BY_CHANCE);
  assert.equal(split.splitWeight, 70);
  assert.equal(split.splitMetric, "order");

  const edges = await prisma.journeyEdge.findMany({
    where: { journeyId: j.id, fromStepId: split.id },
  });
  assert.deepEqual(edges.map((e) => e.branch).sort(), [ARM_A, ARM_B]);
});

test("a well-formed A/B flow publishes", async () => {
  const j = await makeFlow(abCanvas());
  const { ok, errors } = await validateFlowForPublish(j.id);
  assert.equal(ok, true, errors.map((e) => e.message).join(" | "));
});

test("saving clamps a weight that would send everyone one way", async () => {
  // Two layers guard this and they guard different things. saveDraft clamps,
  // so a slider or a hand-edited payload can never store a one-sided test —
  // which is why the flow below is valid rather than blocked.
  const j = await makeFlow(abCanvas({ splitWeight: 100 }));
  const graph = await loadGraph(j.id);
  const split = [...graph.steps.values()].find((s) => s.nodeType === "split");
  assert.equal(split.splitWeight, 99, "clamped on the way in");
  assert.equal((await validateFlowForPublish(j.id)).ok, true);
});

test("publish still refuses a one-sided weight that reached the database anyway", async () => {
  // The second layer: a row written before the clamp existed, or by anything
  // that bypasses saveDraft. A 0% arm would let the report declare a winner
  // from a sample of nobody, so publishing has to catch it too.
  const j = await makeFlow(abCanvas());
  const split = await prisma.journeyStep.findFirst({
    where: { journeyId: j.id, nodeType: "split" },
  });
  await prisma.journeyStep.update({ where: { id: split.id }, data: { splitWeight: 100 } });

  const { ok, errors } = await validateFlowForPublish(j.id);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /between 1% and 99%/.test(e.message)));
});

test("two tests in one flow publish, but with a warning", async () => {
  // Confounded, not broken. The merchant may well have meant it.
  const nodes = abCanvas();
  const second = [
    { kind: "split", id: "t2", parentId: "b1", branch: NEXT,
      emailName: "Second test", splitMode: BY_CHANCE, splitWeight: 50, splitMetric: "click" },
    { ...em("B-A"), id: "c1", parentId: "t2", branch: ARM_A },
    { kind: "exit", id: "c2", parentId: "c1", branch: NEXT },
    { kind: "exit", id: "c3", parentId: "t2", branch: ARM_B },
  ];
  const j = await makeFlow([...nodes.filter((n) => n.id !== "bx"), ...second]);
  const { ok, warnings } = await validateFlowForPublish(j.id);
  assert.equal(ok, true, "a second test must not block publishing");
  assert.ok(warnings.some((w) => /2 A\/B tests running at once/.test(w.message)));
});

// ── Assignment through the walk ────────────────────────────────────────────

test("a contact is sent down one arm and the decision is recorded", async () => {
  const j = await makeFlow(abCanvas());
  const { enrollment, branch, event } = await runToArm(j, "one@b.co");

  assert.ok(branch === ARM_A || branch === ARM_B, `unexpected branch ${branch}`);
  // A random assignment has no condition, so matched must be null rather than
  // claiming a rule was evaluated.
  assert.equal(event.matched, null);

  // And the send that follows belongs to that arm.
  const jobs = await prisma.journeyJob.findMany({
    where: { enrollmentId: enrollment.id },
    include: { step: true },
  });
  assert.equal(jobs.length, 2, "first email, then the arm's first email");
  assert.equal(jobs[1].step.emailName, branch === ARM_A ? "A first" : "B only");
});

test("a population divides roughly according to the weight", async () => {
  const j = await makeFlow(abCanvas({ splitWeight: 50 }));
  let a = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    const { branch } = await runToArm(j, `pop${i}@b.co`);
    if (branch === ARM_A) a++;
  }
  // Wide bounds: 40 contacts is a small sample and this is checking the wiring
  // reaches the hash, not the hash itself — ab-assignment.test.js does that at
  // 20,000.
  assert.ok(a > 8 && a < 32, `expected a rough split, got ${a}/${N} on A`);
});

test("re-advancing does not re-decide the split", async () => {
  const j = await makeFlow(abCanvas());
  const { enrollment, branch } = await runToArm(j, "stable@b.co");
  await advanceEnrollment(enrollment.id);
  const events = await prisma.journeyPathEvent.findMany({
    where: { enrollmentId: enrollment.id },
  });
  assert.equal(events.length, 1, "one decision, recorded once");
  assert.equal(events[0].branch, branch);
});

// ── The report ─────────────────────────────────────────────────────────────

test("the report counts the whole arm, not just its first message", async () => {
  const j = await makeFlow(abCanvas());
  // Push a contact all the way down arm A, marking both its emails opened.
  let target = null;
  for (let i = 0; i < 30 && !target; i++) {
    const r = await runToArm(j, `deep${i}@b.co`);
    if (r.branch === ARM_A) target = r.enrollment;
  }
  assert.ok(target, "no contact landed on arm A in 30 tries");

  // Settle A's first email as opened, then let the walk queue A's second.
  const first = await prisma.journeyJob.findFirst({
    where: { enrollmentId: target.id, sentAt: null },
    orderBy: { createdAt: "desc" },
  });
  await markJourneyJobDone(first.id, { sentAt: new Date(), openedAt: new Date() });
  await advanceEnrollment(target.id);

  const jobs = await prisma.journeyJob.findMany({
    where: { enrollmentId: target.id },
    include: { step: true },
  });
  assert.ok(
    jobs.some((x) => x.step.emailName === "A second"),
    "the arm's second email should have been queued",
  );

  const [report] = await getCampaignAbBreakdown(SHOP, j.id, 30);
  assert.equal(report.label, "Offer test");
  assert.equal(report.metric, "click");
  assert.ok(report.a.recipients + report.b.recipients > 0);
  assert.ok(report.a.opened >= 1, "the open on arm A must be counted");
});

test("a test nobody has reached reports zero and asks for more data", async () => {
  const j = await makeFlow(abCanvas());
  const [report] = await getCampaignAbBreakdown(SHOP, j.id, 30);
  assert.equal(report.a.recipients, 0);
  assert.equal(report.b.recipients, 0);
  // Never a winner from an empty sample.
  assert.equal(report.verdict.state, "not_enough");
  assert.equal(report.verdict.leader, null);
});

test("a flow with no A/B split reports none", async () => {
  const j = await makeFlow([
    { kind: "trigger", id: TRIGGER_ID },
    { ...em("only"), id: "o", parentId: TRIGGER_ID, branch: NEXT },
    { kind: "exit", id: "x", parentId: "o", branch: NEXT },
  ]);
  assert.deepEqual(await getCampaignAbBreakdown(SHOP, j.id, 30), []);
});
