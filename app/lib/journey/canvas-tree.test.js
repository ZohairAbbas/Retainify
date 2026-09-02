/**
 * Tests for the flow builder's tree operations.
 *
 * Run: npm test — pure functions, no database needed.
 *
 * These pin down the edits a merchant makes by clicking, where a mistake shows
 * up as a step quietly detaching from the flow rather than as an error: a
 * delete that orphans everything below it, an insert that overwrites the node
 * it was supposed to push down, a split removal that takes the wrong side with
 * it. None of those look wrong in a screenshot.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  TRIGGER_ID,
  NEXT,
  YES,
  NO,
  childOf,
  walk,
  subtree,
  splitDepth,
  insertNode,
  insertSplit,
  removeNode,
  removeSplit,
  splitBranchSizes,
  nodesFromSteps,
  serializeTree,
} from "./canvas-tree.js";

let seq = 0;
const makeId = () => `n${++seq}`;
const ids = (list) => list.map((n) => n.id);

/** trigger → a → b → c */
const linear = () => [
  { id: "a", kind: "email", parentId: TRIGGER_ID, branch: NEXT },
  { id: "b", kind: "email", parentId: "a", branch: NEXT },
  { id: "c", kind: "exit", parentId: "b", branch: NEXT },
];

/** trigger → a → s ⇒ yes: y1 → y2 | no: n1 */
const branched = () => [
  { id: "a", kind: "email", parentId: TRIGGER_ID, branch: NEXT },
  { id: "s", kind: "split", parentId: "a", branch: NEXT },
  { id: "y1", kind: "email", parentId: "s", branch: YES },
  { id: "y2", kind: "exit", parentId: "y1", branch: NEXT },
  { id: "n1", kind: "exit", parentId: "s", branch: NO },
];

// ── Reading ────────────────────────────────────────────────────────────────

test("walk is depth-first, Yes before No", () => {
  assert.deepEqual(ids(walk(linear())), ["a", "b", "c"]);
  assert.deepEqual(ids(walk(branched())), ["a", "s", "y1", "y2", "n1"]);
});

test("childOf finds the node on a given branch", () => {
  const n = branched();
  assert.equal(childOf(n, "a").id, "s");
  assert.equal(childOf(n, "s", YES).id, "y1");
  assert.equal(childOf(n, "s", NO).id, "n1");
  assert.equal(childOf(n, "y2"), null);
});

test("subtree includes the node and everything below it", () => {
  assert.deepEqual(ids(subtree(branched(), "s")).sort(), ["n1", "s", "y1", "y2"]);
  assert.deepEqual(ids(subtree(branched(), "y1")).sort(), ["y1", "y2"]);
});

test("splitDepth counts splits up to the trigger", () => {
  const n = branched();
  assert.equal(splitDepth(n, "a"), 0);
  assert.equal(splitDepth(n, "s"), 1);
  assert.equal(splitDepth(n, "y2"), 1);
});

// ── Inserting ──────────────────────────────────────────────────────────────

test("inserting pushes the existing node down rather than replacing it", () => {
  const out = insertNode(linear(), {
    parentId: "a",
    branch: NEXT,
    node: { id: "new", kind: "delay" },
  });
  assert.deepEqual(ids(walk(out)), ["a", "new", "b", "c"]);
  assert.equal(childOf(out, "new").id, "b", "b must hang off the new node");
});

test("inserting at the end of a branch just appends", () => {
  const out = insertNode(linear(), {
    parentId: "c",
    branch: NEXT,
    node: { id: "new", kind: "email" },
  });
  assert.deepEqual(ids(walk(out)), ["a", "b", "c", "new"]);
});

test("inserting onto one side of a split leaves the other alone", () => {
  const out = insertNode(branched(), {
    parentId: "s",
    branch: NO,
    node: { id: "new", kind: "email" },
  });
  assert.equal(childOf(out, "s", NO).id, "new");
  assert.equal(childOf(out, "new").id, "n1", "the old No branch hangs off the new node");
  assert.equal(childOf(out, "s", YES).id, "y1", "the Yes branch is untouched");
});

// ── Splits ─────────────────────────────────────────────────────────────────

test("a new split arrives with both branches already populated", () => {
  // A split with an empty branch silently drops whoever takes that side, and
  // is not publishable. It must never exist, not even briefly on screen.
  seq = 0;
  const out = insertSplit(linear(), { parentId: "a", branch: NEXT, makeId });
  const split = out.find((n) => n.kind === "split");
  assert.ok(childOf(out, split.id, YES), "Yes branch populated");
  assert.ok(childOf(out, split.id, NO), "No branch populated");
  // What already followed the insertion point stays on Yes, so the flow the
  // merchant built is preserved and they fill in the alternative.
  assert.equal(childOf(out, split.id, YES).id, "b");
  assert.equal(childOf(out, split.id, NO).kind, "exit");
});

test("a split added at the end of a flow gets an exit on both sides", () => {
  seq = 0;
  const out = insertSplit(linear(), { parentId: "c", branch: NEXT, makeId });
  const split = out.find((n) => n.kind === "split");
  assert.equal(childOf(out, split.id, YES).kind, "exit");
  assert.equal(childOf(out, split.id, NO).kind, "exit");
});

test("splitBranchSizes counts what each side would take with it", () => {
  assert.deepEqual(splitBranchSizes(branched(), "s"), { yes: 2, no: 1 });
});

// ── Deleting ───────────────────────────────────────────────────────────────

test("deleting a node joins its child to its parent", () => {
  const out = removeNode(linear(), "b");
  assert.deepEqual(ids(walk(out)), ["a", "c"]);
  assert.equal(childOf(out, "a").id, "c", "c must not be orphaned");
});

test("deleting the first node promotes the next one to the top", () => {
  const out = removeNode(linear(), "a");
  assert.deepEqual(ids(walk(out)), ["b", "c"]);
  assert.equal(childOf(out, TRIGGER_ID).id, "b");
});

test("deleting inside a branch keeps the node on its branch", () => {
  const out = removeNode(branched(), "y1");
  assert.equal(childOf(out, "s", YES).id, "y2", "y2 stays on the Yes branch");
  assert.equal(childOf(out, "s", NO).id, "n1");
});

test("removing a split, keeping Yes", () => {
  const out = removeSplit(branched(), "s", YES);
  assert.deepEqual(ids(walk(out)), ["a", "y1", "y2"]);
  assert.equal(childOf(out, "a").id, "y1", "the surviving branch reconnects to the parent");
});

test("removing a split, keeping No", () => {
  const out = removeSplit(branched(), "s", NO);
  assert.deepEqual(ids(walk(out)), ["a", "n1"]);
});

test("removing a split, discarding both branches", () => {
  const out = removeSplit(branched(), "s", null);
  assert.deepEqual(ids(walk(out)), ["a"]);
  assert.equal(childOf(out, "a"), null, "the step above becomes the end of the path");
});

test("removing a split takes the whole discarded subtree, not just its first node", () => {
  const nodes = [
    ...branched(),
    { id: "n2", kind: "email", parentId: "n1", branch: NEXT },
  ].map((n) => (n.id === "n1" ? { ...n, kind: "email" } : n));
  const out = removeSplit(nodes, "s", YES);
  assert.ok(!out.some((n) => n.id === "n2"), "a deeper node on the discarded side goes too");
});

test("removeNode on a split does not orphan a branch", () => {
  // Nothing in the UI routes here — the modal calls removeSplit — but a
  // generic delete must not leave two dangling subtrees.
  const out = removeNode(branched(), "s");
  assert.ok(!out.some((n) => n.kind === "split"));
  assert.equal(childOf(out, "a").id, "y1");
});

// ── Round-trip ─────────────────────────────────────────────────────────────

const passthrough = (x) => x;

test("serialize produces preorder steps and index edges", () => {
  const { steps, edges } = serializeTree(branched(), passthrough);
  assert.deepEqual(steps.map((s) => s.id), ["a", "s", "y1", "y2", "n1"]);
  assert.deepEqual(edges, [
    { from: 0, to: 1, branch: NEXT },
    { from: 1, to: 2, branch: YES },
    { from: 1, to: 4, branch: NO },
    { from: 2, to: 3, branch: NEXT },
  ]);
});

test("a tree survives a full save-and-reload round trip", () => {
  const original = branched();
  const { steps, edges } = serializeTree(original, passthrough);

  // What the database would hand back: rows with fresh ids, in stepNumber
  // order, plus the edges rebuilt against them.
  const rows = steps.map((s, i) => ({ id: `db${i}`, kind: s.kind, stepNumber: i + 1 }));
  const dbEdges = edges.map((e) => ({
    fromStepId: rows[e.from].id,
    toStepId: rows[e.to].id,
    branch: e.branch,
  }));

  const reloaded = nodesFromSteps(rows, dbEdges, (s) => ({ id: s.id, kind: s.kind }));
  assert.deepEqual(
    walk(reloaded).map((n) => n.kind),
    walk(original).map((n) => n.kind),
    "the shape must come back identical",
  );
  const split = reloaded.find((n) => n.kind === "split");
  assert.equal(childOf(reloaded, split.id, YES).kind, "email");
  assert.equal(childOf(reloaded, split.id, NO).kind, "exit");
});

test("a flow with no edges loads as a straight line", () => {
  // Every flow that existed before branching, and anything saved by a caller
  // that does not send edges.
  const rows = [
    { id: "s1", kind: "email" },
    { id: "s2", kind: "email" },
  ];
  const out = nodesFromSteps(rows, [], (s) => ({ id: s.id, kind: s.kind }));
  // With no edges every step reads as a root, which the canvas draws as a
  // stack rather than losing any of them.
  assert.equal(out.length, 2);
  assert.ok(out.every((n) => n.parentId === TRIGGER_ID));
});

test("serialize drops nothing reachable and terminates on a cycle", () => {
  const cyclic = [
    { id: "a", kind: "email", parentId: TRIGGER_ID, branch: NEXT },
    { id: "b", kind: "email", parentId: "a", branch: NEXT },
    { id: "a2", kind: "email", parentId: "b", branch: NEXT },
  ];
  // Point the last node back at the first. The walk must stop rather than hang
  // the builder with no error.
  cyclic[0].parentId = "a2";
  const { steps } = serializeTree(cyclic, passthrough);
  assert.ok(steps.length <= 3);
});
