/**
 * The step graph of a flow.
 *
 * ── What this replaces ─────────────────────────────────────────────────────
 * A flow used to be a list. "The next step" was `stepNumber + 1`, "the steps
 * before this one" was `stepNumber < mine`, and both facts were reconstructed
 * by arithmetic wherever they were needed. Neither survives branching: on a
 * tree, a position is not an identity and a number is not an order.
 *
 * Every question the rest of the engine asks about flow structure is answered
 * here instead, from JourneyEdge — which node comes next, which nodes came
 * before, does this flow make sense at all.
 *
 * ── Pure, apart from loadGraph ─────────────────────────────────────────────
 * loadGraph() is the only function that touches the database. Everything else
 * takes the object it returns and computes with it, so the tree rules can be
 * tested without a database, a queue, or an enrollment. See graph.test.js.
 *
 * ── The tree invariant ─────────────────────────────────────────────────────
 * Branches never merge back: each side of a split runs to its own exit. That
 * makes a flow a tree rather than a general graph, and buys three things worth
 * having.
 *
 *   1. Every node has at most one parent, so the path from the trigger to any
 *      node is unique. `ancestorsOf` is therefore a structural fact — it needs
 *      no record of what a particular contact did.
 *   2. There is exactly one root, so "where does this flow start" has an
 *      answer that does not depend on stepNumber.
 *   3. Cycles cannot arise from a merge, only from a genuine mistake.
 *
 * The database enforces only half of this: @@unique([fromStepId, branch]) stops
 * a step having two "yes" edges, but nothing stops two steps pointing at the
 * same target. validateGraph() enforces the rest.
 */

import prisma from "../../db.server.js";

/** Node types that send something, and therefore create a job. */
export const SENDABLE = ["email", "push", "whatsapp"];

/** How deep splits may nest. Beyond this the canvas is unreadable. */
export const MAX_SPLIT_DEPTH = 3;

/** The two edges out of a conditional split. */
export const YES = "yes";
export const NO = "no";
/**
 * The two edges out of an A/B split.
 *
 * Distinct values rather than reusing yes/no. The branch column is free text
 * with a unique constraint per step, so this costs nothing at the schema
 * level — and it means a path event for a random assignment reads "a" rather
 * than claiming a condition was true. Anyone reading the table later can tell
 * the two kinds of decision apart without knowing which splits were tests.
 */
export const ARM_A = "a";
export const ARM_B = "b";
/** The single edge out of every other node. */
export const NEXT = "next";

/**
 * What an A/B test can be judged on.
 *
 * Per test rather than fixed: a subject-line test is decided on opens, an
 * offer test on orders. Reporting significance on the wrong number is worse
 * than reporting none, because it looks equally authoritative.
 */
export const AB_METRICS = ["open", "click", "order", "revenue"];

/** Assignment modes for a split. */
export const BY_CONDITION = "condition";
export const BY_CHANCE = "random";

/**
 * The branches leading out of a step.
 *
 * Mode-aware, so every walk, validation and render asks this rather than
 * hard-coding a pair. Adding a third kind of branching node later means
 * changing this one function.
 */
export function branchesOf(step) {
  if (!step || step.nodeType !== "split") return [NEXT];
  return step.splitMode === BY_CHANCE ? [ARM_A, ARM_B] : [YES, NO];
}

/** Human label for a branch, for error copy and the report. */
export function branchLabel(branch) {
  if (branch === YES) return "Yes";
  if (branch === NO) return "No";
  if (branch === ARM_A) return "A";
  if (branch === ARM_B) return "B";
  return branch;
}

/**
 * @typedef {{ message: string, stepNumber?: number }} FlowIssue
 *   Same shape flow-validation.server.js already speaks, so publish-time
 *   errors from here render exactly like the ones beside them.
 *
 * @typedef {object} Graph
 * @property {string} journeyId
 * @property {Map<string, object>} steps     live steps by id
 * @property {Map<string, Map<string, string>>} out   fromStepId → branch → toStepId
 * @property {Map<string, {from: string, branch: string}>} parent  toStepId → its one edge in
 * @property {string[]} rootIds  nodes with no incoming edge (exactly one in a valid flow)
 */

/**
 * Load one flow's graph.
 *
 * Live steps only. An archived step is kept solely so its jobs are not
 * cascade-deleted; it is already out of the canvas and every other read, and a
 * walker that stepped onto one would be walking a path the merchant cannot see.
 *
 * @param {string} journeyId
 * @returns {Promise<Graph>}
 */
export async function loadGraph(journeyId) {
  const [steps, edges] = await Promise.all([
    prisma.journeyStep.findMany({
      where: { journeyId, isArchived: false },
      orderBy: [{ stepNumber: "asc" }, { id: "asc" }],
    }),
    prisma.journeyEdge.findMany({ where: { journeyId } }),
  ]);
  return buildGraph({ journeyId, steps, edges });
}

/**
 * Index steps and edges into the shape every other function here reads.
 *
 * Separate from loadGraph so callers that already hold the rows — a validator
 * running inside the save transaction, a test — need no second query.
 *
 * Edges pointing at or from a step that is not in `steps` are dropped rather
 * than trusted. Nothing should produce one (saveDraft rebuilds edges in the
 * same transaction that writes the steps), but a dangling edge is exactly the
 * kind of thing that would otherwise send a walker to a step that does not
 * exist, and a silent drop is far better than a crash at send time.
 *
 * @param {{ journeyId?: string, steps: object[], edges: object[] }} input
 * @returns {Graph}
 */
export function buildGraph({ journeyId = "", steps = [], edges = [] }) {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  /** @type {Map<string, Map<string, string>>} */
  const out = new Map();
  /** @type {Map<string, {from: string, branch: string}>} */
  const parent = new Map();

  for (const e of edges) {
    if (!stepMap.has(e.fromStepId) || !stepMap.has(e.toStepId)) continue;
    if (!out.has(e.fromStepId)) out.set(e.fromStepId, new Map());
    out.get(e.fromStepId).set(e.branch, e.toStepId);
    // First edge in wins. A second one is a merge, which validateGraph reports;
    // recording only the first keeps every walk here terminating regardless.
    if (!parent.has(e.toStepId)) {
      parent.set(e.toStepId, { from: e.fromStepId, branch: e.branch });
    }
  }

  const rootIds = steps.filter((s) => !parent.has(s.id)).map((s) => s.id);

  return { journeyId, steps: stepMap, out, parent, rootIds };
}

/**
 * The step a contact moves to from here.
 *
 * @param {Graph} graph
 * @param {string} stepId
 * @param {string} [branch] which way out of a split; ignored elsewhere
 * @returns {string|null} null means the flow ends here
 */
export function nextStepId(graph, stepId, branch = NEXT) {
  return graph.out.get(stepId)?.get(branch) ?? null;
}

/** Where the flow begins, or null if it is empty or has no single entry. */
export function rootId(graph) {
  return graph.rootIds.length === 1 ? graph.rootIds[0] : null;
}

/**
 * Every step reachable from `stepId`, in depth-first preorder, Yes before No.
 *
 * The order is not cosmetic: it is what stepNumber is assigned from, so a
 * merchant reading their flow top to bottom sees the numbers ascend, and
 * "lower number is upstream" stays true along any single path — which is
 * exactly what the eager sequence gate assumes.
 *
 * Guarded against cycles so a malformed graph cannot hang a worker. A cycle is
 * a bug validateGraph reports; this function must not be the place it becomes
 * an outage.
 *
 * @param {Graph} graph
 * @param {string} [fromId] defaults to the flow's root
 * @returns {string[]}
 */
export function walkFrom(graph, fromId = rootId(graph)) {
  const order = [];
  if (!fromId || !graph.steps.has(fromId)) return order;

  const seen = new Set();
  const stack = [fromId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);

    const edges = graph.out.get(id);
    if (!edges) continue;
    // Pushed in reverse so the pop order is first-branch-first: next, then
    // Yes before No, or A before B.
    for (const branch of [...branchesOf(graph.steps.get(id))].reverse()) {
      const to = edges.get(branch);
      if (to && !seen.has(to)) stack.push(to);
    }
  }
  return order;
}

/**
 * The steps between the trigger and this one, nearest first.
 *
 * Purely structural, with no reference to what any particular contact did.
 * That is only sound because branches never merge: exactly one path reaches any
 * node, so the ancestors of a step are the same for everyone who arrives there.
 * If merge-back is ever added this function needs an enrollment's path events
 * to disambiguate, and every caller needs revisiting.
 *
 * @param {Graph} graph
 * @param {string} stepId
 * @returns {string[]} closest ancestor first, root last
 */
export function ancestorsOf(graph, stepId) {
  const chain = [];
  const seen = new Set([stepId]);
  let cur = graph.parent.get(stepId)?.from;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = graph.parent.get(cur)?.from;
  }
  return chain;
}

/**
 * Ancestors of `stepId` that are enabled sends, nearest first.
 *
 * What the sequence gate actually wants: "which messages was this one supposed
 * to follow". Disabled steps are excluded because they never produce a job, so
 * gating on one would hold a step forever.
 *
 * @param {Graph} graph
 * @param {string} stepId
 * @param {string[]} [types] defaults to email — the channel that carries the
 *        narrative. See sequence-gate.server.js for why push and WhatsApp
 *        must not gate anything.
 * @returns {object[]} step rows
 */
export function sendableAncestors(graph, stepId, types = ["email"]) {
  return ancestorsOf(graph, stepId)
    .map((id) => graph.steps.get(id))
    .filter((s) => s && types.includes(s.nodeType) && s.isEnabled !== false);
}

/**
 * Hours from the trigger to this step, along the one path that reaches it.
 *
 * ── Why this is computed rather than stored ────────────────────────────────
 * JourneyStep.delayHours used to hold this figure on every sendable step:
 * saveDraft accumulated the Wait nodes above a step and wrote the running
 * total onto it, so a step "knew" how long after the trigger it went out.
 *
 * That only works on a straight line. On a tree the answer depends on which
 * branch a contact took, so it is a property of a path and not of a step, and
 * a stored number would be right for one branch and wrong for the other.
 * delayHours now holds only what a Wait node itself waits for, and anything
 * wanting "how far into the flow is this" asks here.
 *
 * Reporting only. The scheduler never uses it — under lazy scheduling each
 * Wait is served as it is reached, measured from the previous step settling.
 *
 * @param {Graph} graph
 * @param {string} stepId
 * @returns {number} hours
 */
export function delayFromRoot(graph, stepId) {
  let total = 0;
  for (const id of ancestorsOf(graph, stepId)) {
    const step = graph.steps.get(id);
    if (step?.nodeType === "delay") total += Number(step.delayHours) || 0;
  }
  return total;
}

/**
 * How many splits sit between the root and this step, inclusive of one here.
 *
 * @param {Graph} graph
 * @param {string} stepId
 * @returns {number}
 */
export function splitDepth(graph, stepId) {
  const self = graph.steps.get(stepId)?.nodeType === "split" ? 1 : 0;
  return (
    self +
    ancestorsOf(graph, stepId).filter((id) => graph.steps.get(id)?.nodeType === "split").length
  );
}

/**
 * Is this flow structurally sound enough to publish?
 *
 * Scope is structure only — whether the shape is a tree, whether every path
 * ends, whether a split can actually choose. Whether a given email has a
 * subject line belongs to flow-validation.server.js, which calls this and
 * merges the two lists.
 *
 * Every rule here blocks a flow that would otherwise fail silently at send
 * time, which is the bar the existing publish validation sets.
 *
 * @param {Graph} graph
 * @returns {{ ok: boolean, errors: FlowIssue[] }}
 */
export function validateGraph(graph) {
  /** @type {FlowIssue[]} */
  const errors = [];
  const steps = [...graph.steps.values()];
  if (!steps.length) return { ok: true, errors };

  const at = (id) => graph.steps.get(id)?.stepNumber;

  // ── One entry point ──────────────────────────────────────────────────────
  // Zero roots means every node has a parent, which in a finite graph means a
  // cycle. More than one means a fragment floating loose — steps the merchant
  // can see on the canvas that no contact will ever reach.
  if (graph.rootIds.length === 0) {
    errors.push({
      message: "This flow loops back on itself, so it has no starting point. Remove the connection that goes backwards.",
    });
  } else if (graph.rootIds.length > 1) {
    for (const id of graph.rootIds.slice(1)) {
      errors.push({
        stepNumber: at(id),
        message: `Step ${at(id)} isn't connected to the rest of the flow, so nobody will ever reach it. Connect it or delete it.`,
      });
    }
  }

  // ── No merges ────────────────────────────────────────────────────────────
  // The database allows two steps to point at the same target; the engine does
  // not. A merged node has two possible histories, which makes "did the email
  // before this one land" unanswerable — the question the sequence gate exists
  // to ask.
  // Counted from every edge, not from graph.parent — which records only the
  // first edge into a node, precisely so the walks above stay well-behaved on a
  // malformed graph. The second edge is the one being reported here.
  const incoming = new Map();
  for (const branches of graph.out.values()) {
    for (const to of branches.values()) {
      incoming.set(to, (incoming.get(to) || 0) + 1);
    }
  }
  for (const [id, count] of incoming) {
    if (count > 1) {
      errors.push({
        stepNumber: at(id),
        message: `Step ${at(id)} is joined to from more than one place. Branches can't merge back together — give each branch its own steps.`,
      });
    }
  }

  // ── Reachability and cycles ──────────────────────────────────────────────
  const reachable = new Set(graph.rootIds.length ? walkFrom(graph, graph.rootIds[0]) : []);
  for (const s of steps) {
    if (!reachable.has(s.id) && !graph.rootIds.includes(s.id)) {
      errors.push({
        stepNumber: s.stepNumber,
        message: `Step ${s.stepNumber} can't be reached from the start of the flow.`,
      });
    }
  }
  for (const id of detectCycle(graph)) {
    errors.push({
      stepNumber: at(id),
      message: `Step ${at(id)} is part of a loop. A flow has to move forwards — remove the step that connects back.`,
    });
  }

  // ── Per-node shape ───────────────────────────────────────────────────────
  for (const s of steps) {
    const branches = graph.out.get(s.id) || new Map();

    if (s.nodeType === "split") {
      const isTest = s.splitMode === BY_CHANCE;
      const pair = branchesOf(s);

      // A split with one side missing is not a split; whoever takes the empty
      // branch falls out of the flow without being told. Both sides must exist,
      // even if one is only an exit.
      for (const b of pair) {
        if (!branches.get(b)) {
          errors.push({
            stepNumber: s.stepNumber,
            message: `Step ${s.stepNumber}: the "${branchLabel(b)}" ${isTest ? "variant" : "branch"} is empty. Add a step to it, or remove the split.`,
          });
        }
      }
      if (branches.get(NEXT)) {
        errors.push({
          stepNumber: s.stepNumber,
          message: `Step ${s.stepNumber}: a split can only lead to its ${branchLabel(pair[0])} and ${branchLabel(pair[1])} branches.`,
        });
      }
      // An edge belonging to the OTHER mode. Left behind when a merchant flips
      // a split between a condition and a test; the walk would follow neither,
      // so the contact would fall out of the flow with no job and no error.
      for (const stray of [YES, NO, ARM_A, ARM_B]) {
        if (!pair.includes(stray) && branches.get(stray)) {
          errors.push({
            stepNumber: s.stepNumber,
            message: `Step ${s.stepNumber}: this split still has a "${branchLabel(stray)}" branch from before it was changed. Reconnect it or remove it.`,
          });
        }
      }

      if (isTest) {
        // A test that sends everyone one way is not a test, and reports a
        // winner from a sample of nobody.
        const w = Number(s.splitWeight);
        if (!Number.isFinite(w) || w < 1 || w > 99) {
          errors.push({
            stepNumber: s.stepNumber,
            message: `Step ${s.stepNumber}: the split has to send between 1% and 99% down each side. It's currently set to ${s.splitWeight}%.`,
          });
        }
        if (!AB_METRICS.includes(s.splitMetric)) {
          errors.push({
            stepNumber: s.stepNumber,
            message: `Step ${s.stepNumber}: pick which result decides this test.`,
          });
        }
      } else if (isEmptyCondition(s.splitCondition)) {
        errors.push({
          stepNumber: s.stepNumber,
          message: `Step ${s.stepNumber}: this split has no condition, so it can't decide which way to send anyone. Add a condition.`,
        });
      }
      if (splitDepth(graph, s.id) > MAX_SPLIT_DEPTH) {
        errors.push({
          stepNumber: s.stepNumber,
          message: `Step ${s.stepNumber}: splits can be nested ${MAX_SPLIT_DEPTH} deep at most.`,
        });
      }
    } else {
      for (const b of [YES, NO, ARM_A, ARM_B]) {
        if (branches.get(b)) {
          errors.push({
            stepNumber: s.stepNumber,
            message: `Step ${s.stepNumber} has a branch but isn't a split.`,
          });
        }
      }
      // An exit is terminal by definition. Anything after it is unreachable in
      // a way the canvas would happily draw.
      if (s.nodeType === "exit" && branches.get(NEXT)) {
        errors.push({
          stepNumber: s.stepNumber,
          message: `Step ${s.stepNumber} is an exit, so nothing can come after it.`,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Ids that sit on a cycle.
 *
 * Iterative rather than recursive: a flow is small, but a stack overflow inside
 * publish validation would be a spectacularly unhelpful error message.
 *
 * @param {Graph} graph
 * @returns {string[]}
 */
function detectCycle(graph) {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map([...graph.steps.keys()].map((id) => [id, WHITE]));
  const onCycle = new Set();

  for (const start of graph.steps.keys()) {
    if (colour.get(start) !== WHITE) continue;
    const stack = [{ id: start, edges: [...(graph.out.get(start)?.values() || [])] }];
    colour.set(start, GREY);

    while (stack.length) {
      const frame = stack[stack.length - 1];
      const next = frame.edges.pop();
      if (next === undefined) {
        colour.set(frame.id, BLACK);
        stack.pop();
        continue;
      }
      if (!graph.steps.has(next)) continue;
      const c = colour.get(next);
      if (c === GREY) {
        // Back edge — everything still open on the stack from `next` onwards is
        // part of the loop.
        const from = stack.findIndex((f) => f.id === next);
        if (from >= 0) for (const f of stack.slice(from)) onCycle.add(f.id);
        else onCycle.add(next);
      } else if (c === WHITE) {
        colour.set(next, GREY);
        stack.push({ id: next, edges: [...(graph.out.get(next)?.values() || [])] });
      }
    }
  }
  return [...onCycle];
}

/**
 * A condition with no rules in it decides nothing.
 *
 * Same test entry-filters.server.js applies to Journey.entryFilters, and for
 * the same reason — an empty tree is indistinguishable from "no condition at
 * all", and must not be mistaken for one that matches everybody.
 */
export function isEmptyCondition(tree) {
  if (!tree) return true;
  if (tree.type !== "group") return true;
  return !Array.isArray(tree.children) || tree.children.length === 0;
}

/**
 * The order steps should be numbered and listed in.
 *
 * Depth-first preorder from the root, then anything unreachable appended so a
 * broken flow still renders every step it has rather than losing some silently.
 *
 * @param {Graph} graph
 * @returns {object[]} step rows in display order
 */
export function orderedSteps(graph) {
  const walked = walkFrom(graph);
  const seen = new Set(walked);
  const rest = [...graph.steps.keys()].filter((id) => !seen.has(id));
  return [...walked, ...rest].map((id) => graph.steps.get(id)).filter(Boolean);
}
