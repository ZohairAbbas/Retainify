/**
 * Publish validation and the branch report.
 *
 * Run: npm test — needs a database.
 *
 * Publishing is the last point at which a broken flow can be stopped. Past it
 * every failure is silent: a split with no condition sends its whole audience
 * down one side, a branch that leads nowhere drops people out of the flow
 * without a job or an error, and a rule naming a step that has moved can never
 * be true. None of them look wrong on the canvas.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { saveDraft } from "./journey-lifecycle.server.js";
import { validateFlowForPublish } from "./flow-validation.server.js";
import { getCampaignSplitBreakdown } from "../analytics/campaign.server.js";
import { serializeTree, TRIGGER_ID } from "./canvas-tree.js";
import { YES, NO, NEXT } from "./graph.server.js";

const SHOP = "__publish-test.myshopify.com";

const CONDITION = {
  type: "group",
  match: "all",
  children: [{ type: "rule", field: "totalSpent", op: "gt", value: 100 }],
};

const toStep = (n) => {
  const key = n.stepKey ? { stepKey: n.stepKey } : {};
  if (n.kind === "exit") return { ...key, nodeType: "exit" };
  if (n.kind === "delay") return { ...key, nodeType: "delay", delayHours: n.hours || 1 };
  if (n.kind === "split") {
    return { ...key, nodeType: "split", emailName: n.emailName || "", splitCondition: n.splitCondition ?? null };
  }
  // `??` not `||`: an empty subject has to reach the server as empty, since
  // that is precisely what publish validation is being asked about.
  return { ...key, nodeType: "email", emailName: n.emailName || "", subject: n.subject ?? "s", emailBlocks: "[]" };
};

const em = (name) => ({ kind: "email", emailName: name, subject: name });

/** first ── split ⇒ yes: y1 → exit | no: n1 → exit */
function branched({ condition = CONDITION } = {}) {
  return [
    { kind: "trigger", id: TRIGGER_ID },
    { ...em("first"), id: "a", parentId: TRIGGER_ID, branch: NEXT },
    { kind: "split", id: "s", parentId: "a", branch: NEXT, emailName: "Big spender?", splitCondition: condition },
    { ...em("yes side"), id: "y1", parentId: "s", branch: YES },
    { kind: "exit", id: "y2", parentId: "y1", branch: NEXT },
    { ...em("no side"), id: "n1", parentId: "s", branch: NO },
    { kind: "exit", id: "n2", parentId: "n1", branch: NEXT },
  ];
}

async function makeFlow(nodes, journeyData = {}) {
  const journey = await prisma.journey.create({
    data: {
      shop: SHOP,
      name: "publish test",
      trigger: "customer_created",
      status: "draft",
      ...journeyData,
    },
  });
  const { steps, edges } = serializeTree(nodes, toStep);
  await saveDraft(journey.id, { steps, edges });
  return journey;
}

const messages = async (j) => (await validateFlowForPublish(j.id)).errors.map((e) => e.message).join(" | ");

test.before(async () => {
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
});
test.after(async () => {
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.$disconnect();
});

// ── Structure ──────────────────────────────────────────────────────────────

test("a well-formed branched flow publishes", async () => {
  const j = await makeFlow(branched());
  const { ok, errors } = await validateFlowForPublish(j.id);
  assert.equal(ok, true, errors.map((e) => e.message).join(" | "));
});

test("a split with no condition is blocked", async () => {
  const j = await makeFlow(branched({ condition: null }));
  const msg = await messages(j);
  assert.match(msg, /no condition/);
  // Reported once, not twice: validateGraph and the split checker both notice
  // it, and two errors about one missing thing reads as two problems.
  assert.equal(msg.split("no condition").length - 1, 1, msg);
});

test("a split with an empty branch is blocked", async () => {
  const nodes = branched().filter((n) => n.id !== "n1" && n.id !== "n2");
  const j = await makeFlow(nodes);
  assert.match(await messages(j), /"No" branch is empty/);
});

test("a condition naming a step that isn't above the split is blocked", async () => {
  // The rule points at the Yes branch's own email, which is downstream of the
  // split — so it could never be true, and the split would silently send
  // everybody down No.
  const j = await makeFlow(branched());
  const steps = await prisma.journeyStep.findMany({ where: { journeyId: j.id, isArchived: false } });
  const yesStep = steps.find((s) => s.emailName === "yes side");
  const split = steps.find((s) => s.nodeType === "split");
  await prisma.journeyStep.update({
    where: { id: split.id },
    data: {
      splitCondition: {
        type: "group",
        match: "all",
        children: [{ type: "rule", field: `flow.opened:${yesStep.stepKey}`, op: "is_true" }],
      },
    },
  });
  assert.match(await messages(j), /no longer above it/);
});

test("a condition naming a step genuinely above the split is fine", async () => {
  const j = await makeFlow(branched());
  const steps = await prisma.journeyStep.findMany({ where: { journeyId: j.id, isArchived: false } });
  const first = steps.find((s) => s.emailName === "first");
  const split = steps.find((s) => s.nodeType === "split");
  await prisma.journeyStep.update({
    where: { id: split.id },
    data: {
      splitCondition: {
        type: "group",
        match: "all",
        children: [{ type: "rule", field: `flow.opened:${first.stepKey}`, op: "is_true" }],
      },
    },
  });
  const { ok, errors } = await validateFlowForPublish(j.id);
  assert.equal(ok, true, errors.map((e) => e.message).join(" | "));
});

test("a broadcast cannot contain a split, whatever the builder allowed", async () => {
  // Enforced on the trigger, so a flow switched to broadcast cannot carry a
  // split in from what it was before.
  const j = await makeFlow(branched(), { trigger: "broadcast" });
  assert.match(await messages(j), /can't contain a split/);
});

test("a straight-line flow is unaffected by any of this", async () => {
  const j = await makeFlow([
    { kind: "trigger", id: TRIGGER_ID },
    { ...em("one"), id: "a", parentId: TRIGGER_ID, branch: NEXT },
    { kind: "exit", id: "x", parentId: "a", branch: NEXT },
  ]);
  const { ok, errors } = await validateFlowForPublish(j.id);
  assert.equal(ok, true, errors.map((e) => e.message).join(" | "));
});

test("step-level and structural errors arrive together", async () => {
  // A merchant fixing one problem at a time, republishing between each, is a
  // miserable experience — the list has to be complete.
  const nodes = branched({ condition: null }).map((n) =>
    n.id === "y1" ? { ...n, subject: "" } : n,
  );
  const j = await makeFlow(nodes);
  const { errors } = await validateFlowForPublish(j.id);
  assert.ok(errors.some((e) => /subject line/.test(e.message)), "the empty subject");
  assert.ok(errors.some((e) => /no condition/.test(e.message)), "and the split");
});

// ── Branch report ──────────────────────────────────────────────────────────

test("the branch report counts which way people went", async () => {
  const j = await makeFlow(branched());
  const split = await prisma.journeyStep.findFirst({
    where: { journeyId: j.id, nodeType: "split" },
  });

  const record = async (branch, matched) => {
    const e = await prisma.journeyEnrollment.create({
      data: { shop: SHOP, journeyId: j.id, contactEmail: `${branch}-${Math.random()}@b.co` },
    });
    await prisma.journeyPathEvent.create({
      data: { enrollmentId: e.id, stepId: split.id, stepKey: split.stepKey, branch, matched },
    });
  };
  for (let i = 0; i < 3; i++) await record(YES, true);
  for (let i = 0; i < 7; i++) await record(NO, false);

  const [row] = await getCampaignSplitBreakdown(SHOP, j.id, 30);
  assert.equal(row.label, "Big spender?");
  assert.equal(row.yes, 3);
  assert.equal(row.no, 7);
  assert.equal(row.total, 10);
  assert.equal(row.yesRate, 30);
});

test("a split nobody has reached reports zero rather than a misleading rate", async () => {
  const j = await makeFlow(branched());
  const [row] = await getCampaignSplitBreakdown(SHOP, j.id, 30);
  assert.equal(row.total, 0);
  // The page renders a dash for total 0 — a 0% yes rate would read as
  // "everyone took No", which is a different and wrong claim.
  assert.equal(row.yes, 0);
  assert.equal(row.no, 0);
});

test("a flow with no splits reports no branches", async () => {
  const j = await makeFlow([
    { kind: "trigger", id: TRIGGER_ID },
    { ...em("one"), id: "a", parentId: TRIGGER_ID, branch: NEXT },
  ]);
  assert.deepEqual(await getCampaignSplitBreakdown(SHOP, j.id, 30), []);
});

test("branch history survives the merchant editing the flow", async () => {
  const j = await makeFlow(branched());
  const split = await prisma.journeyStep.findFirst({ where: { journeyId: j.id, nodeType: "split" } });
  const e = await prisma.journeyEnrollment.create({
    data: { shop: SHOP, journeyId: j.id, contactEmail: "edit@b.co" },
  });
  await prisma.journeyPathEvent.create({
    data: { enrollmentId: e.id, stepId: split.id, stepKey: split.stepKey, branch: YES, matched: true },
  });

  // Re-save with the same stepKeys, renaming the split.
  const steps = await prisma.journeyStep.findMany({ where: { journeyId: j.id, isArchived: false } });
  const keyOf = (name) => steps.find((s) => (s.emailName || "") === name)?.stepKey;
  const nodes = branched().map((n) => {
    if (n.id === "s") return { ...n, stepKey: keyOf("Big spender?"), emailName: "Renamed split" };
    if (n.kind === "email") return { ...n, stepKey: keyOf(n.emailName) };
    return n;
  });
  const { steps: s2, edges } = serializeTree(nodes, toStep);
  await saveDraft(j.id, { steps: s2, edges });

  const [row] = await getCampaignSplitBreakdown(SHOP, j.id, 30);
  assert.equal(row.label, "Renamed split");
  assert.equal(row.yes, 1, "the decision is still counted after the edit");
});
