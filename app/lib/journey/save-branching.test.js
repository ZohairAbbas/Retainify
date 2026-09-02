/**
 * saveDraft with a branched tree, end to end.
 *
 * Run: npm test — needs a database.
 *
 * canvas-tree.test.js proves the client builds the right shape; graph.test.js
 * proves the server reads it correctly. This is the seam between them: the
 * index-pair edges the canvas serialises have to survive being written as rows
 * and read back as a graph, and a mistake there is invisible until a contact
 * takes a branch that does not exist.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { saveDraft } from "./journey-lifecycle.server.js";
import { loadGraph, validateGraph, rootId, nextStepId, walkFrom, YES, NO, NEXT } from "./graph.server.js";
import { serializeTree, TRIGGER_ID } from "./canvas-tree.js";

const SHOP = "__save-branch-test.myshopify.com";
const email = (name) => ({ kind: "email", emailName: name, subject: name, emailBlocks: [] });

/** The canvas node → the step shape persistDraft sends. */
const toStep = (n) => {
  const key = n.stepKey ? { stepKey: n.stepKey } : {};
  if (n.kind === "delay") return { ...key, nodeType: "delay", delayHours: Number(n.hours) || 0 };
  if (n.kind === "exit") return { ...key, nodeType: "exit" };
  if (n.kind === "split") {
    return { ...key, nodeType: "split", emailName: n.emailName || "", splitCondition: n.splitCondition ?? null };
  }
  return {
    ...key,
    nodeType: "email",
    emailName: n.emailName || "",
    subject: n.subject || "",
    emailBlocks: "[]",
  };
};

const CONDITION = {
  type: "group",
  match: "all",
  children: [{ type: "rule", field: "totalSpent", op: "gt", value: 100 }],
};

/**
 *  a ── s ⇒ yes: y1 → y2(exit)
 *          no:  n1 → n2(exit)
 */
function branchedCanvas() {
  return [
    { kind: "trigger", id: TRIGGER_ID },
    { ...email("first"), id: "a", parentId: TRIGGER_ID, branch: NEXT },
    { kind: "split", id: "s", parentId: "a", branch: NEXT, emailName: "Opened?", splitCondition: CONDITION },
    { ...email("yes side"), id: "y1", parentId: "s", branch: YES },
    { kind: "exit", id: "y2", parentId: "y1", branch: NEXT },
    { ...email("no side"), id: "n1", parentId: "s", branch: NO },
    { kind: "exit", id: "n2", parentId: "n1", branch: NEXT },
  ];
}

async function save(nodes) {
  const journey = await prisma.journey.create({
    data: { shop: SHOP, name: "branch save", trigger: "customer_created", status: "draft" },
  });
  const { steps, edges } = serializeTree(nodes, toStep);
  await saveDraft(journey.id, { steps, edges });
  return journey;
}

test.before(async () => {
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
});
test.after(async () => {
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.$disconnect();
});

test("a branched canvas saves as a graph the server can walk", async () => {
  const journey = await save(branchedCanvas());
  const graph = await loadGraph(journey.id);

  assert.equal(graph.steps.size, 6);
  const root = rootId(graph);
  assert.ok(root, "exactly one starting step");
  assert.equal(graph.steps.get(root).emailName, "first");

  const split = nextStepId(graph, root, NEXT);
  assert.equal(graph.steps.get(split).nodeType, "split");

  const yes = graph.steps.get(nextStepId(graph, split, YES));
  const no = graph.steps.get(nextStepId(graph, split, NO));
  assert.equal(yes.emailName, "yes side");
  assert.equal(no.emailName, "no side");

  // Both branches must terminate in their own exit — no merge.
  assert.equal(graph.steps.get(nextStepId(graph, yes.id, NEXT)).nodeType, "exit");
  assert.equal(graph.steps.get(nextStepId(graph, no.id, NEXT)).nodeType, "exit");
});

test("the saved graph passes publish validation", async () => {
  const journey = await save(branchedCanvas());
  const { ok, errors } = validateGraph(await loadGraph(journey.id));
  assert.equal(ok, true, errors.map((e) => e.message).join(" | "));
});

test("the split's condition survives the round trip", async () => {
  const journey = await save(branchedCanvas());
  const graph = await loadGraph(journey.id);
  const split = [...graph.steps.values()].find((s) => s.nodeType === "split");
  assert.deepEqual(split.splitCondition, CONDITION);
  assert.equal(split.emailName, "Opened?");
});

test("stepNumber follows depth-first preorder, Yes before No", async () => {
  const journey = await save(branchedCanvas());
  const graph = await loadGraph(journey.id);
  const ordered = [...graph.steps.values()].sort((a, b) => a.stepNumber - b.stepNumber);
  assert.deepEqual(
    ordered.map((s) => s.emailName || s.nodeType),
    ["first", "Opened?", "yes side", "exit", "no side", "exit"],
  );
  // And the walk agrees with the numbering, so "lower number is upstream"
  // holds along any single path — what the eager sequence gate assumes.
  assert.deepEqual(walkFrom(graph), ordered.map((s) => s.id));
});

test("a split with no condition is rejected at publish, not silently accepted", async () => {
  const nodes = branchedCanvas().map((n) => (n.id === "s" ? { ...n, splitCondition: null } : n));
  const journey = await save(nodes);
  const { ok, errors } = validateGraph(await loadGraph(journey.id));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /no condition/.test(e.message)), errors.map((e) => e.message).join(" | "));
});

test("editing a branched flow keeps each step's history key", async () => {
  const journey = await save(branchedCanvas());
  const before = await prisma.journeyStep.findMany({
    where: { journeyId: journey.id, isArchived: false },
    orderBy: { stepNumber: "asc" },
  });
  const keys = Object.fromEntries(before.map((s) => [s.emailName || s.nodeType + s.stepNumber, s.stepKey]));

  // Reload into canvas shape, rename one branch, save again.
  const nodes = branchedCanvas().map((n) => {
    const match = before.find((s) => (s.emailName || "") === (n.emailName || "") && n.kind !== "trigger");
    return match ? { ...n, stepKey: match.stepKey } : n;
  }).map((n) => (n.id === "y1" ? { ...n, emailName: "yes side RENAMED" } : n));

  const { steps, edges } = serializeTree(nodes, toStep);
  await saveDraft(journey.id, { steps, edges });

  const after = await prisma.journeyStep.findMany({
    where: { journeyId: journey.id, isArchived: false },
  });
  const renamed = after.find((s) => s.emailName === "yes side RENAMED");
  assert.equal(renamed.stepKey, keys["yes side"], "a renamed step keeps its history");
  assert.equal(
    after.find((s) => s.emailName === "no side").stepKey,
    keys["no side"],
    "the other branch is undisturbed",
  );
});

test("a flow saved with no edges is still a straight line", async () => {
  // Templates and duplicated flows do not send edges.
  const journey = await prisma.journey.create({
    data: { shop: SHOP, name: "no edges", trigger: "customer_created", status: "draft" },
  });
  await saveDraft(journey.id, {
    steps: [toStep(email("one")), toStep(email("two")), { nodeType: "exit" }],
  });
  const graph = await loadGraph(journey.id);
  assert.equal(validateGraph(graph).ok, true);
  assert.equal(walkFrom(graph).length, 3, "chained end to end");
});

test("an edge naming a step that does not exist is dropped, not written", async () => {
  const journey = await prisma.journey.create({
    data: { shop: SHOP, name: "bad edge", trigger: "customer_created", status: "draft" },
  });
  await saveDraft(journey.id, {
    steps: [toStep(email("one")), toStep(email("two"))],
    // Index 5 does not exist. A partial graph is bad, but a graph pointing at
    // nothing would strand a contact mid-flow with no error anywhere.
    edges: [{ from: 0, to: 1, branch: NEXT }, { from: 1, to: 5, branch: NEXT }],
  });
  const edges = await prisma.journeyEdge.findMany({ where: { journeyId: journey.id } });
  assert.equal(edges.length, 1);
  const graph = await loadGraph(journey.id);
  assert.equal(walkFrom(graph).length, 2);
});
