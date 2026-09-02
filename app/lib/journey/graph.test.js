/**
 * Tests for the flow step graph.
 *
 * Run: node --test app/lib/journey/graph.test.js
 *
 * These use node:test — Node's built-in runner, no dependency to add. Every
 * function under test is pure, so the whole file runs without a database, a
 * queue or an enrollment; buildGraph takes plain rows and that is deliberate.
 *
 * The rules here are the ones that decide whether a merchant's flow sends the
 * right thing, and most of them fail silently in production if they are wrong —
 * a step that never fires, a contact that falls out of a flow unannounced. They
 * are worth pinning down before anything is built on top of them.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGraph,
  nextStepId,
  rootId,
  walkFrom,
  ancestorsOf,
  sendableAncestors,
  splitDepth,
  validateGraph,
  orderedSteps,
  isEmptyCondition,
  MAX_SPLIT_DEPTH,
  YES,
  NO,
  NEXT,
} from "./graph.server.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

let n = 0;
const step = (id, nodeType = "email", extra = {}) => ({
  id,
  stepKey: `k_${id}`,
  stepNumber: ++n,
  nodeType,
  isEnabled: true,
  splitCondition: null,
  ...extra,
});
const edge = (from, to, branch = NEXT) => ({ fromStepId: from, toStepId: to, branch });

const CONDITION = { type: "group", op: "and", children: [{ field: "totalSpent", op: "gt", value: 100 }] };

/** A ── B ── C */
function linear() {
  n = 0;
  return buildGraph({
    steps: [step("a"), step("b"), step("c", "exit")],
    edges: [edge("a", "b"), edge("b", "c")],
  });
}

/**
 *              ┌─ yes ─ y1 ── y2(exit)
 *  a ── s(split)
 *              └─ no ── n1(exit)
 */
function branched() {
  n = 0;
  return buildGraph({
    steps: [
      step("a"),
      step("s", "split", { splitCondition: CONDITION }),
      step("y1"),
      step("y2", "exit"),
      step("n1", "exit"),
    ],
    edges: [
      edge("a", "s"),
      edge("s", "y1", YES),
      edge("s", "n1", NO),
      edge("y1", "y2"),
    ],
  });
}

// ── Structure ──────────────────────────────────────────────────────────────

test("linear flow: one root, walked in order", () => {
  const g = linear();
  assert.equal(rootId(g), "a");
  assert.deepEqual(walkFrom(g), ["a", "b", "c"]);
});

test("nextStepId follows the named branch", () => {
  const g = branched();
  assert.equal(nextStepId(g, "a"), "s");
  assert.equal(nextStepId(g, "s", YES), "y1");
  assert.equal(nextStepId(g, "s", NO), "n1");
  // A branch that isn't there is the end of the road, not an error.
  assert.equal(nextStepId(g, "s", NEXT), null);
  assert.equal(nextStepId(g, "y2"), null);
});

test("walk is depth-first, Yes branch before No", () => {
  // The order stepNumber is assigned from. If this flips, a merchant's flow
  // renumbers itself and every step label in the report moves.
  assert.deepEqual(walkFrom(branched()), ["a", "s", "y1", "y2", "n1"]);
});

test("ancestors are structural — unique path to any node", () => {
  const g = branched();
  assert.deepEqual(ancestorsOf(g, "y2"), ["y1", "s", "a"]);
  assert.deepEqual(ancestorsOf(g, "n1"), ["s", "a"]);
  assert.deepEqual(ancestorsOf(g, "a"), []);
  // The Yes branch is not an ancestor of the No branch, and vice versa. This is
  // the whole point: a contact on one side was never sent the other side's mail.
  assert.ok(!ancestorsOf(g, "n1").includes("y1"));
});

test("sendableAncestors skips splits, exits and disabled steps", () => {
  n = 0;
  const g = buildGraph({
    steps: [
      step("e1"),
      step("off", "email", { isEnabled: false }),
      step("s", "split", { splitCondition: CONDITION }),
      step("e2"),
      step("x", "exit"),
    ],
    edges: [edge("e1", "off"), edge("off", "s"), edge("s", "e2", YES), edge("s", "x", NO)],
  });
  // A disabled step never produces a job, so gating on it would hold e2 forever.
  assert.deepEqual(sendableAncestors(g, "e2").map((s) => s.id), ["e1"]);
});

test("splitDepth counts splits on the path, including this one", () => {
  n = 0;
  const g = buildGraph({
    steps: [
      step("s1", "split", { splitCondition: CONDITION }),
      step("s2", "split", { splitCondition: CONDITION }),
      step("leaf", "exit"),
      step("o1", "exit"),
      step("o2", "exit"),
    ],
    edges: [
      edge("s1", "s2", YES), edge("s1", "o1", NO),
      edge("s2", "leaf", YES), edge("s2", "o2", NO),
    ],
  });
  assert.equal(splitDepth(g, "s1"), 1);
  assert.equal(splitDepth(g, "s2"), 2);
  assert.equal(splitDepth(g, "leaf"), 2);
});

// ── Robustness ─────────────────────────────────────────────────────────────

test("edges to steps that don't exist are dropped, not trusted", () => {
  n = 0;
  const g = buildGraph({
    steps: [step("a")],
    edges: [edge("a", "ghost"), edge("ghost", "a")],
  });
  assert.equal(nextStepId(g, "a"), null);
  assert.deepEqual(walkFrom(g), ["a"]);
});

test("a cycle cannot hang the walker", () => {
  n = 0;
  const g = buildGraph({
    steps: [step("a"), step("b")],
    edges: [edge("a", "b"), edge("b", "a")],
  });
  // Terminates, and visits each node once.
  assert.equal(walkFrom(g, "a").length, 2);
  assert.ok(ancestorsOf(g, "a").length <= 2);
});

test("empty flow is handled everywhere", () => {
  const g = buildGraph({ steps: [], edges: [] });
  assert.equal(rootId(g), null);
  assert.deepEqual(walkFrom(g), []);
  assert.deepEqual(orderedSteps(g), []);
  assert.equal(validateGraph(g).ok, true);
});

// ── Validation ─────────────────────────────────────────────────────────────

const messages = (g) => validateGraph(g).errors.map((e) => e.message).join(" | ");

test("valid flows pass", () => {
  assert.equal(validateGraph(linear()).ok, true);
  assert.equal(validateGraph(branched()).ok, true);
});

test("rejects a split with an empty branch", () => {
  n = 0;
  const g = buildGraph({
    steps: [step("s", "split", { splitCondition: CONDITION }), step("y", "exit")],
    edges: [edge("s", "y", YES)],
  });
  assert.match(messages(g), /"No" branch is empty/);
});

test("rejects a split with no condition", () => {
  n = 0;
  const g = buildGraph({
    steps: [step("s", "split"), step("y", "exit"), step("no", "exit")],
    edges: [edge("s", "y", YES), edge("s", "no", NO)],
  });
  assert.match(messages(g), /no condition/);
});

test("rejects an empty condition tree as if it were absent", () => {
  // A group with no children matches everybody, which is the opposite of what
  // the merchant sees on screen. Same rule entry filters apply.
  n = 0;
  const g = buildGraph({
    steps: [
      step("s", "split", { splitCondition: { type: "group", op: "and", children: [] } }),
      step("y", "exit"),
      step("no", "exit"),
    ],
    edges: [edge("s", "y", YES), edge("s", "no", NO)],
  });
  assert.match(messages(g), /no condition/);
});

test("rejects a merge — two steps pointing at one", () => {
  n = 0;
  const g = buildGraph({
    steps: [
      step("s", "split", { splitCondition: CONDITION }),
      step("y"), step("no"), step("join", "exit"),
    ],
    edges: [
      edge("s", "y", YES), edge("s", "no", NO),
      edge("y", "join"), edge("no", "join"),
    ],
  });
  assert.match(messages(g), /Branches can't merge back together/);
});

test("rejects an unreachable fragment", () => {
  n = 0;
  const g = buildGraph({
    steps: [step("a"), step("b", "exit"), step("orphan")],
    edges: [edge("a", "b")],
  });
  assert.match(messages(g), /isn't connected to the rest of the flow/);
});

test("rejects a cycle", () => {
  n = 0;
  const g = buildGraph({
    steps: [step("a"), step("b"), step("c")],
    edges: [edge("a", "b"), edge("b", "c"), edge("c", "b")],
  });
  const msg = messages(g);
  assert.ok(/loop/.test(msg), msg);
});

test("rejects a branch on a step that isn't a split", () => {
  n = 0;
  const g = buildGraph({
    steps: [step("a"), step("y", "exit"), step("no", "exit")],
    edges: [edge("a", "y", YES), edge("a", "no", NO)],
  });
  assert.match(messages(g), /isn't a split/);
});

test("rejects anything after an exit", () => {
  n = 0;
  const g = buildGraph({
    steps: [step("x", "exit"), step("after")],
    edges: [edge("x", "after")],
  });
  assert.match(messages(g), /nothing can come after it/);
});

test("rejects a split nested past the depth cap", () => {
  n = 0;
  const steps = [];
  const edges = [];
  // A chain of splits, each hanging off the previous one's Yes branch.
  for (let i = 0; i <= MAX_SPLIT_DEPTH; i++) {
    steps.push(step(`s${i}`, "split", { splitCondition: CONDITION }));
    steps.push(step(`o${i}`, "exit"));
    edges.push(edge(`s${i}`, `o${i}`, NO));
    if (i > 0) edges.push(edge(`s${i - 1}`, `s${i}`, YES));
  }
  steps.push(step("leaf", "exit"));
  edges.push(edge(`s${MAX_SPLIT_DEPTH}`, "leaf", YES));

  const g = buildGraph({ steps, edges });
  assert.match(messages(g), new RegExp(`nested ${MAX_SPLIT_DEPTH} deep at most`));

  // One level shallower is fine.
  const ok = buildGraph({
    steps: steps.filter((s) => s.id !== `s${MAX_SPLIT_DEPTH}` && s.id !== `o${MAX_SPLIT_DEPTH}`),
    edges: edges.filter(
      (e) => !e.fromStepId.startsWith(`s${MAX_SPLIT_DEPTH}`) && !e.toStepId.startsWith(`s${MAX_SPLIT_DEPTH}`),
    ).concat([edge(`s${MAX_SPLIT_DEPTH - 1}`, "leaf", YES)]),
  });
  assert.equal(validateGraph(ok).ok, true, messages(ok));
});

test("reports several problems at once", () => {
  // Publish validation lists everything wrong in one go — a merchant fixing one
  // error at a time, republishing between each, is a miserable experience.
  n = 0;
  const g = buildGraph({
    steps: [step("s", "split"), step("y", "exit"), step("orphan")],
    edges: [edge("s", "y", YES)],
  });
  const { ok, errors } = validateGraph(g);
  assert.equal(ok, false);
  assert.ok(errors.length >= 3, `expected several errors, got ${errors.length}`);
});

test("every error carries a stepNumber where one applies", () => {
  // The builder highlights the offending node from this field.
  n = 0;
  const g = buildGraph({
    steps: [step("s", "split", { splitCondition: CONDITION }), step("y", "exit")],
    edges: [edge("s", "y", YES)],
  });
  for (const e of validateGraph(g).errors) {
    assert.equal(typeof e.stepNumber, "number", e.message);
  }
});

// ── Ordering ───────────────────────────────────────────────────────────────

test("orderedSteps returns every step, walked first then stragglers", () => {
  n = 0;
  const g = buildGraph({
    steps: [step("a"), step("b", "exit"), step("orphan")],
    edges: [edge("a", "b")],
  });
  assert.deepEqual(orderedSteps(g).map((s) => s.id), ["a", "b", "orphan"]);
});

test("isEmptyCondition", () => {
  assert.equal(isEmptyCondition(null), true);
  assert.equal(isEmptyCondition(undefined), true);
  assert.equal(isEmptyCondition({}), true);
  assert.equal(isEmptyCondition({ type: "group", children: [] }), true);
  assert.equal(isEmptyCondition(CONDITION), false);
});
