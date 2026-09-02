/**
 * Deciding which way an enrollment goes at a split.
 *
 * ── Two kinds of rule ──────────────────────────────────────────────────────
 * A split can ask two different questions, and they are answered from
 * different places:
 *
 *   who they are    totalSpent, tags, lifecycle stage, subscription status…
 *                   → the segment rule tree, evaluated by evalTreeForContact
 *                     against the Contact row. A rule means exactly what it
 *                     means in the segment builder, and the two cannot drift.
 *
 *   what they did   opened / clicked / was sent a particular earlier step
 *                   → this enrollment's OWN jobs. Not the contact's lifetime
 *                     engagement — "did THIS person open THAT email in THIS
 *                     run of the flow". A contact who opened the same email in
 *                     a previous enrollment has not opened this one.
 *
 * The second kind is what merchants mean by "if they opened", and it is the
 * headline of FB-1. It cannot be a normal segment field: segment fields are
 * per-contact and lifetime, and there is no way to say "step 2 of the flow
 * you are currently in" in that vocabulary.
 *
 * ── Why the tree is walked here rather than handed to evalTreeForContact ────
 * evalRuleJs treats any field it does not recognise as a no-op that returns
 * TRUE — a deliberate choice for segments, where a gated field should not
 * shrink a count. Passing a flow rule through it would therefore match
 * everybody: the split would send its Yes branch to the entire audience while
 * the merchant read "opened the welcome email" on screen.
 *
 * So the walk is done here: flow rules are answered from the enrollment's
 * jobs, and everything else is delegated to evalTreeForContact one rule at a
 * time, so contact semantics stay byte-identical to the segment builder.
 *
 * ── Why an unevaluable condition takes the No branch ────────────────────────
 * Missing Contact row, evaluation throws, a rule naming a step that has since
 * been deleted: all resolve to false, and the enrollment continues down No.
 *
 * This is the opposite of the choice entry filters make, deliberately. An
 * entry filter failing closed costs one send the trigger will offer again. A
 * split failing closed would drop somebody out of the middle of a flow they
 * are already in — silently, with no job to show for it, which is the hardest
 * kind of bug to see in this system. Continuing down the conservative branch
 * keeps them moving and leaves a log line saying why.
 *
 * In practice No is also the harmless branch: it is normally the
 * re-engagement path, and someone we know nothing about is exactly who that
 * path is for.
 */

import prisma from "../../db.server.js";
import { evalTreeForContact } from "../segments/evaluator.server.js";
import {
  getContactStats,
  computeLifecycle,
  normalizeEmail,
} from "../contacts/contacts.server.js";
import { isEmptyCondition, sendableAncestors } from "./graph.server.js";

/**
 * Flow-scoped rule ids are `flow.<metric>:<stepKey>`.
 *
 * The step is baked into the field id rather than carried as a separate
 * property on the rule, so the existing FilterTree component renders one of
 * these as an ordinary boolean field with no changes: the merchant picks
 * "Opened: Welcome email" from the field list exactly as they would pick
 * "Total spent".
 */
export const FLOW_FIELD_PREFIX = "flow.";

/** What a flow rule can ask about an earlier step. */
export const FLOW_METRICS = {
  opened: { label: "Opened", column: "openedAt" },
  clicked: { label: "Clicked", column: "clickedAt" },
  sent: { label: "Was sent", column: "sentAt" },
};

/** Parse `flow.opened:sk_abc` → { metric: "opened", stepKey: "sk_abc" }. */
export function parseFlowField(fieldId) {
  if (typeof fieldId !== "string" || !fieldId.startsWith(FLOW_FIELD_PREFIX)) return null;
  const rest = fieldId.slice(FLOW_FIELD_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon < 1) return null;
  const metric = rest.slice(0, colon);
  const stepKey = rest.slice(colon + 1);
  if (!FLOW_METRICS[metric] || !stepKey) return null;
  return { metric, stepKey };
}

/**
 * The flow-scoped fields a given split may offer.
 *
 * Only steps genuinely UPSTREAM of this split, and only email ones.
 *
 * Upstream matters: a rule about a step further down the flow can never be
 * true when the split is evaluated, so offering one would hand the merchant a
 * condition that silently always takes No. Because branches never merge, "the
 * steps before this one" is a structural fact — see ancestorsOf.
 *
 * Email only: openedAt and clickedAt are email columns. Push reports clicks
 * but no opens, and WhatsApp reports reads and replies rather than either, so
 * offering "opened" across channels would mean three different things under
 * one label. Worth revisiting per-channel, but not by pretending they are the
 * same measurement.
 *
 * @param {object} graph  from loadGraph
 * @param {string} splitStepId
 * @returns {Array<{id: string, label: string, group: string, type: string, supported: boolean}>}
 */
export function flowFieldsForSplit(graph, splitStepId) {
  const upstream = sendableAncestors(graph, splitStepId, ["email"]);
  const fields = [];
  // Nearest ancestor first is the order sendableAncestors returns, and the
  // order a merchant thinks in: the step just above the split is the one they
  // are almost always asking about.
  for (const step of upstream) {
    const name = step.emailName || step.subject || `Step ${step.stepNumber}`;
    for (const [metric, { label }] of Object.entries(FLOW_METRICS)) {
      fields.push({
        id: `${FLOW_FIELD_PREFIX}${metric}:${step.stepKey}`,
        label: `${label}: ${name}`,
        group: "In this flow",
        type: "boolean",
        supported: true,
      });
    }
  }
  return fields;
}

/**
 * Is this tree something a split can actually act on?
 *
 * Mirrors validateFilterTree, which throws on any field it does not know —
 * and does not know the flow-scoped ones, since they exist only per flow.
 *
 * @param {object} tree
 * @param {Set<string>} allowedFieldIds  ids offered for THIS split
 * @returns {string[]} problems, empty when fine
 */
export function validateSplitCondition(tree, allowedFieldIds) {
  const problems = [];
  if (isEmptyCondition(tree)) return ["This split has no condition."];

  const walk = (node) => {
    if (!node) return;
    if (node.type === "group") {
      for (const child of node.children || []) walk(child);
      return;
    }
    if (node.type !== "rule") {
      problems.push("Unrecognised item in the condition.");
      return;
    }
    const flow = parseFlowField(node.field);
    if (!flow) return; // an ordinary contact field; validateFilterTree covers it
    if (allowedFieldIds && !allowedFieldIds.has(node.field)) {
      // Almost always a step that used to be above this split and has since
      // been moved or deleted. Left as a rule the merchant must fix rather
      // than quietly dropped, because dropping it changes who gets what.
      problems.push(
        `This split asks about a step that is no longer above it (${flow.metric}).`,
      );
    }
  };
  walk(tree);
  return problems;
}

/**
 * Which branch does this enrollment take?
 *
 * Never throws. A split that cannot answer still has to answer.
 *
 * @param {{ shop: string, enrollment: object, step: object, graph: object }} input
 * @returns {Promise<{ matched: boolean, reason: string }>}
 */
export async function evaluateSplit({ shop, enrollment, step, graph }) {
  const tree = step.splitCondition;

  // An empty condition matches everybody, which is never what the merchant saw
  // on screen. validateGraph blocks publishing one, so reaching here means the
  // flow was published before that rule existed, or edited around it.
  if (isEmptyCondition(tree)) {
    return { matched: false, reason: "no condition set — taking the No branch" };
  }

  const email = normalizeEmail(enrollment.contactEmail);
  if (!email) return { matched: false, reason: "no email to evaluate against" };

  try {
    const needsContact = treeUsesContactFields(tree);
    const needsFlow = treeUsesFlowFields(tree);

    let contactCtx = null;
    if (needsContact) {
      const contact = await prisma.contact.findUnique({
        where: { shop_email: { shop, email } },
        // Tags come as a relation because the hasTag rule reads contact.tags[].tagId.
        include: { tags: { select: { tagId: true } } },
      });
      if (!contact) {
        return { matched: false, reason: "no contact record to evaluate against" };
      }
      const stats = await getContactStats(shop, email);
      contactCtx = { contact, stats, lifecycle: computeLifecycle(contact, stats) };
    }

    const flowCtx = needsFlow ? await loadFlowEngagement(enrollment.id) : new Map();

    const matched = Boolean(evalNode(tree, { contactCtx, flowCtx, graph }));
    return { matched, reason: matched ? "matched" : "did not match" };
  } catch (err) {
    console.error(
      `[split] enrollment ${enrollment.id} step ${step.stepNumber} — evaluation failed, taking No: ${err.message}`,
    );
    return { matched: false, reason: `evaluation failed: ${err.message}` };
  }
}

// ── internals ──────────────────────────────────────────────────────────────

/**
 * This enrollment's own email engagement, keyed by the step's stepKey.
 *
 * Scoped to the enrollment, not the contact: "did they open THAT email in THIS
 * run of the flow". Keyed on stepKey rather than stepId so a merchant editing
 * the flow mid-flight does not detach the answer from the rule — the same
 * reason every other report keys on it.
 *
 * A step can appear more than once here (a step archived and replaced shares
 * its key with its replacement), so the flags are OR-ed across rows.
 */
async function loadFlowEngagement(enrollmentId) {
  const jobs = await prisma.journeyJob.findMany({
    where: { enrollmentId },
    select: {
      sentAt: true,
      openedAt: true,
      clickedAt: true,
      step: { select: { stepKey: true } },
    },
  });

  const byKey = new Map();
  for (const job of jobs) {
    const key = job.step?.stepKey;
    if (!key) continue;
    const acc = byKey.get(key) || { sent: false, opened: false, clicked: false };
    // A step marked done WITHOUT sending — suppressed recipient, no settings
    // row, quota block — has sentAt null, so it reads as not sent and
    // therefore not opened. That is the intended answer: a message nobody
    // received was not opened, and the contact takes the No branch, which is
    // normally the re-engagement path suppression would block anyway.
    acc.sent = acc.sent || job.sentAt != null;
    acc.opened = acc.opened || job.openedAt != null;
    acc.clicked = acc.clicked || job.clickedAt != null;
    byKey.set(key, acc);
  }
  return byKey;
}

function treeUsesFlowFields(node) {
  if (!node) return false;
  if (node.type === "group") return (node.children || []).some(treeUsesFlowFields);
  return node.type === "rule" && parseFlowField(node.field) != null;
}

function treeUsesContactFields(node) {
  if (!node) return false;
  if (node.type === "group") return (node.children || []).some(treeUsesContactFields);
  return node.type === "rule" && parseFlowField(node.field) == null;
}

/**
 * Walk the tree, routing each rule to whichever evaluator can answer it.
 *
 * Group semantics ("all" / "any", empty group is true) are copied from
 * evalTreeJs exactly, so a tree means the same thing here as in the segment
 * builder.
 */
function evalNode(node, ctx) {
  if (!node) return false;
  if (node.type === "group") {
    const children = node.children || [];
    if (children.length === 0) return true;
    return node.match === "any"
      ? children.some((c) => evalNode(c, ctx))
      : children.every((c) => evalNode(c, ctx));
  }
  // Anything that is neither a group nor a rule is a malformed condition, and
  // resolves to FALSE — where the segment evaluator resolves the same thing to
  // true.
  //
  // The asymmetry is the point, and it is the same one this whole module is
  // built on. In a segment a stray node makes a count slightly too large. In a
  // split it decides who gets which email, so a node we cannot read must never
  // be the reason an audience goes down the Yes branch.
  if (node.type !== "rule") {
    console.warn(`[split] unreadable node in condition (type "${node.type}") — treating as false`);
    return false;
  }

  const flow = parseFlowField(node.field);
  if (flow) return evalFlowRule(flow, node.op, ctx.flowCtx);

  // Not a flow rule — hand it back to the segment evaluator verbatim, wrapped
  // in a single-rule group so contact semantics are literally the same code.
  if (!ctx.contactCtx) return false;
  return evalTreeForContact({ type: "group", match: "all", children: [node] }, ctx.contactCtx);
}

function evalFlowRule({ metric, stepKey }, op, flowCtx) {
  const row = flowCtx.get(stepKey);
  // No row means no job for that step in this enrollment — the step was
  // skipped, disabled, or has not been reached. All of them mean "it didn't
  // happen", which is false rather than unknown.
  const value = row ? Boolean(row[metric]) : false;
  return op === "is_false" ? !value : value;
}
