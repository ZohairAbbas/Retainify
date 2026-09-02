/**
 * Tests for split condition evaluation.
 *
 * Run: npm test
 *
 * Needs a database — evaluation reads a Contact row and the enrollment's own
 * jobs, and mocking either would test the mocks rather than the rule.
 *
 * ── The failure mode these exist for ───────────────────────────────────────
 * Every wrong answer here is silent and inverted. A flow rule routed through
 * the segment evaluator returns TRUE for everybody, so the merchant reads
 * "opened the welcome email" on screen and the entire audience takes the Yes
 * branch. Nothing errors, nothing fails, and the only symptom is that the
 * wrong half of a list gets the wrong email. Most of what follows is checking
 * that a rule which cannot be answered says NO rather than yes.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { saveDraft } from "./journey-lifecycle.server.js";
import { loadGraph, rootId, NEXT, YES, NO } from "./graph.server.js";
import {
  evaluateSplit,
  flowFieldsForSplit,
  parseFlowField,
  validateSplitCondition,
  FLOW_METRICS,
} from "./split-conditions.server.js";

const SHOP = "__split-test.myshopify.com";
const email = (subject) => ({ nodeType: "email", subject, emailName: subject, emailBlocks: "[]" });

/** email(one) → email(two) → split → [yes|no] */
async function flowWithSplit(condition) {
  const journey = await prisma.journey.create({
    data: { shop: SHOP, name: "split test", trigger: "customer_created", status: "published" },
  });
  await saveDraft(journey.id, {
    steps: [email("one"), email("two"), { nodeType: "exit" }, email("yes"), email("no")],
  });
  const rows = await prisma.journeyStep.findMany({
    where: { journeyId: journey.id, isArchived: false },
    orderBy: { stepNumber: "asc" },
  });
  const [one, two, split, yesStep, noStep] = rows;
  await prisma.journeyStep.update({
    where: { id: split.id },
    data: { nodeType: "split", splitCondition: condition },
  });
  await prisma.journeyEdge.deleteMany({ where: { journeyId: journey.id } });
  await prisma.journeyEdge.createMany({
    data: [
      { journeyId: journey.id, fromStepId: one.id, toStepId: two.id, branch: NEXT },
      { journeyId: journey.id, fromStepId: two.id, toStepId: split.id, branch: NEXT },
      { journeyId: journey.id, fromStepId: split.id, toStepId: yesStep.id, branch: YES },
      { journeyId: journey.id, fromStepId: split.id, toStepId: noStep.id, branch: NO },
    ],
  });
  return { journey, steps: { one, two, split, yesStep, noStep } };
}

async function enrollment(journey, contactEmail) {
  const graph = await loadGraph(journey.id);
  return prisma.journeyEnrollment.create({
    data: {
      shop: SHOP,
      journeyId: journey.id,
      contactEmail,
      schedulingMode: "lazy",
      currentStepId: rootId(graph),
    },
  });
}

/** Give an enrollment a settled job for one step, with chosen engagement. */
async function recordSend(enr, step, { sent = true, opened = false, clicked = false } = {}) {
  const now = new Date();
  return prisma.journeyJob.create({
    data: {
      shop: SHOP,
      enrollmentId: enr.id,
      stepId: step.id,
      scheduledFor: now,
      status: "done",
      sentAt: sent ? now : null,
      openedAt: opened ? now : null,
      clickedAt: clicked ? now : null,
    },
  });
}

const rule = (field, op = "is_true") => ({
  type: "group",
  match: "all",
  children: [{ type: "rule", field, op }],
});

const evalFor = async (journey, enr, split) => {
  const graph = await loadGraph(journey.id);
  return evaluateSplit({
    shop: SHOP,
    enrollment: enr,
    step: graph.steps.get(split.id),
    graph,
  });
};

test.before(async () => {
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
});
test.after(async () => {
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.$disconnect();
});

// ── Field ids ──────────────────────────────────────────────────────────────

test("flow field ids round-trip", () => {
  assert.deepEqual(parseFlowField("flow.opened:sk_abc"), { metric: "opened", stepKey: "sk_abc" });
  assert.deepEqual(parseFlowField("flow.clicked:sk_x:y"), { metric: "clicked", stepKey: "sk_x:y" });
  // Anything malformed must parse as "not a flow field" rather than a partial
  // one — a half-parsed rule would be evaluated against the wrong thing.
  assert.equal(parseFlowField("totalSpent"), null);
  assert.equal(parseFlowField("flow.opened"), null);
  assert.equal(parseFlowField("flow.opened:"), null);
  assert.equal(parseFlowField("flow.bogus:sk_abc"), null);
  assert.equal(parseFlowField(null), null);
});

test("a split is only offered steps above it", async () => {
  const { journey, steps } = await flowWithSplit(null);
  const graph = await loadGraph(journey.id);
  const fields = flowFieldsForSplit(graph, steps.split.id);

  const keys = new Set(fields.map((f) => parseFlowField(f.id).stepKey));
  assert.ok(keys.has(steps.one.stepKey), "step one is upstream");
  assert.ok(keys.has(steps.two.stepKey), "step two is upstream");
  // A rule about a downstream step could never be true when the split runs,
  // so offering one would hand the merchant a permanent No.
  assert.ok(!keys.has(steps.yesStep.stepKey), "the Yes branch is NOT upstream");
  assert.ok(!keys.has(steps.noStep.stepKey), "the No branch is NOT upstream");

  assert.equal(fields.length, 2 * Object.keys(FLOW_METRICS).length);
  assert.ok(fields.every((f) => f.type === "boolean" && f.supported));
  assert.ok(fields.some((f) => f.label === "Opened: two"), "labels name the step");
});

// ── Flow rules ─────────────────────────────────────────────────────────────

test("opened is true only when this enrollment opened that step", async () => {
  const { journey, steps } = await flowWithSplit(null);
  const cond = rule(`flow.opened:${steps.two.stepKey}`);
  await prisma.journeyStep.update({ where: { id: steps.split.id }, data: { splitCondition: cond } });

  const opener = await enrollment(journey, "opener@b.co");
  await recordSend(opener, steps.two, { opened: true });
  assert.equal((await evalFor(journey, opener, steps.split)).matched, true);

  const nonOpener = await enrollment(journey, "quiet@b.co");
  await recordSend(nonOpener, steps.two, { opened: false });
  assert.equal((await evalFor(journey, nonOpener, steps.split)).matched, false);
});

test("engagement is scoped to THIS enrollment, not the contact's history", async () => {
  const { journey, steps } = await flowWithSplit(null);
  await prisma.journeyStep.update({
    where: { id: steps.split.id },
    data: { splitCondition: rule(`flow.opened:${steps.two.stepKey}`) },
  });

  // Same address, two runs of the flow. The first opened; the second did not.
  const first = await enrollment(journey, "repeat@b.co");
  await recordSend(first, steps.two, { opened: true });
  const second = await enrollment(journey, "repeat@b.co");
  await recordSend(second, steps.two, { opened: false });

  assert.equal((await evalFor(journey, first, steps.split)).matched, true);
  assert.equal(
    (await evalFor(journey, second, steps.split)).matched,
    false,
    "opening a previous run's email is not opening this one",
  );
});

test("a step marked done without sending reads as not sent and not opened", async () => {
  // Suppressed recipient, missing settings row, quota block: markDone with no
  // sentAt. A message nobody received was not opened.
  const { journey, steps } = await flowWithSplit(null);
  const enr = await enrollment(journey, "suppressed@b.co");
  await recordSend(enr, steps.two, { sent: false });

  for (const [metric, expected] of [["sent", false], ["opened", false], ["clicked", false]]) {
    await prisma.journeyStep.update({
      where: { id: steps.split.id },
      data: { splitCondition: rule(`flow.${metric}:${steps.two.stepKey}`) },
    });
    const { matched } = await evalFor(journey, enr, steps.split);
    assert.equal(matched, expected, `${metric} should be ${expected}`);
  }
});

test("a rule about a step with no job at all is false, not true", async () => {
  const { journey, steps } = await flowWithSplit(null);
  await prisma.journeyStep.update({
    where: { id: steps.split.id },
    data: { splitCondition: rule(`flow.opened:${steps.one.stepKey}`) },
  });
  const enr = await enrollment(journey, "nojobs@b.co");
  // No job was ever created for step one — disabled, skipped, or never reached.
  assert.equal((await evalFor(journey, enr, steps.split)).matched, false);
});

test("is_false inverts a flow rule", async () => {
  const { journey, steps } = await flowWithSplit(null);
  await prisma.journeyStep.update({
    where: { id: steps.split.id },
    data: { splitCondition: rule(`flow.opened:${steps.two.stepKey}`, "is_false") },
  });
  const enr = await enrollment(journey, "didnt-open@b.co");
  await recordSend(enr, steps.two, { opened: false });
  assert.equal((await evalFor(journey, enr, steps.split)).matched, true, "did not open → is_false is true");
});

test("an unknown flow field does NOT match everybody", async () => {
  // The whole reason this module walks the tree itself. Routed through
  // evalTreeForContact, an unrecognised field is a no-op returning true, and
  // the entire audience would take the Yes branch.
  const { journey, steps } = await flowWithSplit(rule("flow.opened:sk_does_not_exist"));
  const enr = await enrollment(journey, "anyone@b.co");
  await recordSend(enr, steps.two, { opened: true });
  assert.equal((await evalFor(journey, enr, steps.split)).matched, false);
});

// ── Contact rules, unchanged semantics ─────────────────────────────────────

test("contact rules still mean what they mean in the segment builder", async () => {
  const { journey, steps } = await flowWithSplit({
    type: "group",
    match: "all",
    children: [{ type: "rule", field: "totalSpent", op: "gt", value: 100 }],
  });

  await prisma.contact.create({
    data: { shop: SHOP, email: "rich@b.co", totalSpent: 500, orderCount: 2 },
  });
  await prisma.contact.create({
    data: { shop: SHOP, email: "poor@b.co", totalSpent: 5, orderCount: 1 },
  });

  const rich = await enrollment(journey, "rich@b.co");
  const poor = await enrollment(journey, "poor@b.co");
  assert.equal((await evalFor(journey, rich, steps.split)).matched, true);
  assert.equal((await evalFor(journey, poor, steps.split)).matched, false);
});

test("no contact row takes No rather than stranding anyone", async () => {
  const { journey, steps } = await flowWithSplit({
    type: "group",
    match: "all",
    children: [{ type: "rule", field: "totalSpent", op: "gt", value: 1 }],
  });
  const enr = await enrollment(journey, "ghost@b.co");
  const { matched, reason } = await evalFor(journey, enr, steps.split);
  assert.equal(matched, false);
  assert.match(reason, /no contact record/);
});

test("a malformed rule takes No, where a segment would treat it as a no-op", async () => {
  // A node missing its `type` — a hand-edited condition, or a shape from a
  // future version. evalTreeJs would skip it and return true, which in a
  // segment costs a slightly inflated count. Here it would send the entire
  // audience down the Yes branch, so it has to read as false.
  const { journey, steps } = await flowWithSplit({
    type: "group",
    match: "all",
    children: [{ field: "totalSpent", op: "gt", value: 1 }],
  });
  await prisma.contact.create({
    data: { shop: SHOP, email: "malformed@b.co", totalSpent: 500, orderCount: 1 },
  });
  const enr = await enrollment(journey, "malformed@b.co");
  assert.equal((await evalFor(journey, enr, steps.split)).matched, false);
});

test("an empty condition takes No, never everybody", async () => {
  for (const cond of [null, { type: "group", match: "all", children: [] }]) {
    const { journey, steps } = await flowWithSplit(cond);
    const enr = await enrollment(journey, "x@b.co");
    assert.equal((await evalFor(journey, enr, steps.split)).matched, false);
  }
});

// ── Mixed trees ────────────────────────────────────────────────────────────

test("a tree mixing contact and flow rules evaluates both halves", async () => {
  const { journey, steps } = await flowWithSplit(null);
  const cond = {
    type: "group",
    match: "all",
    children: [
      { type: "rule", field: "totalSpent", op: "gt", value: 100 },
      { type: "rule", field: `flow.opened:${steps.two.stepKey}`, op: "is_true" },
    ],
  };
  await prisma.journeyStep.update({ where: { id: steps.split.id }, data: { splitCondition: cond } });
  await prisma.contact.create({
    data: { shop: SHOP, email: "both@b.co", totalSpent: 500, orderCount: 1 },
  });

  // Spends enough but did not open → "all" must fail.
  const half = await enrollment(journey, "both@b.co");
  await recordSend(half, steps.two, { opened: false });
  assert.equal((await evalFor(journey, half, steps.split)).matched, false, "AND must require both");

  const full = await enrollment(journey, "both@b.co");
  await recordSend(full, steps.two, { opened: true });
  assert.equal((await evalFor(journey, full, steps.split)).matched, true);
});

test("an 'any' group is satisfied by either half", async () => {
  const { journey, steps } = await flowWithSplit(null);
  await prisma.journeyStep.update({
    where: { id: steps.split.id },
    data: {
      splitCondition: {
        type: "group",
        match: "any",
        children: [
          { type: "rule", field: "totalSpent", op: "gt", value: 999999 },
          { type: "rule", field: `flow.clicked:${steps.two.stepKey}`, op: "is_true" },
        ],
      },
    },
  });
  await prisma.contact.create({
    data: { shop: SHOP, email: "clicker@b.co", totalSpent: 1, orderCount: 0 },
  });
  const enr = await enrollment(journey, "clicker@b.co");
  await recordSend(enr, steps.two, { clicked: true });
  assert.equal((await evalFor(journey, enr, steps.split)).matched, true);
});

// ── Validation ─────────────────────────────────────────────────────────────

test("validateSplitCondition flags a rule about a step no longer above the split", async () => {
  const { journey, steps } = await flowWithSplit(null);
  const graph = await loadGraph(journey.id);
  const allowed = new Set(flowFieldsForSplit(graph, steps.split.id).map((f) => f.id));

  assert.deepEqual(validateSplitCondition(rule(`flow.opened:${steps.two.stepKey}`), allowed), []);

  const stale = validateSplitCondition(rule(`flow.opened:${steps.yesStep.stepKey}`), allowed);
  assert.equal(stale.length, 1);
  assert.match(stale[0], /no longer above it/);

  assert.match(validateSplitCondition(null, allowed)[0], /no condition/);
});
