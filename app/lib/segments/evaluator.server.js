// Segment evaluator.
//
// Given a filterTree (root group), produce { count, sample, capped } for the
// preview pane and the segment list count cache.
//
// Strategy:
//   1. Build a Prisma `where` clause for the rule leaves the DB can handle
//      directly (subscription status, source, has-tag, firstSeen/lastSeen,
//      lifecycle by date proxy). This narrows the candidate set cheaply.
//   2. For leaves that depend on per-contact aggregates (cart counts, email
//      counts, lifecycle by stats), load up to MAX_SCAN contacts and finish
//      the filter in JS using getContactStats + computeLifecycle.
//   3. Nested groups recurse: AND intersects, OR unions on contact-id sets.
//
// "Unsupported" fields (orders, AOV, rates, lastEmailOpened, push enabled)
// short-circuit to true (treat the rule as a no-op). This keeps templates
// like "Big spenders" loadable without throwing — the merchant sees the
// rule rendered as disabled with a Soon chip, and the count is computed
// as if that rule weren't there.

import prisma from "../../db.server.js";
import { FIELD_BY_ID } from "./fields.server.js";
import { computeLifecycle, getContactStats } from "../contacts/contacts.server.js";

const MAX_SCAN = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

const PRISMA_SAFE_FIELDS = new Set([
  "subscriptionStatus",
  "source",
  "hasTag",
  "firstSeenAt",
  "lastSeenAt",
]);
const STATS_FIELDS = new Set([
  "cartAbandonCount",
  "lastCartAt",
  "lastCartValue",
  "hasActiveCart",
  "emailsSent",
  "emailsOpened",
  "emailsClicked",
  "lifecycleStage",
]);

function isGroup(node) {
  return node && node.type === "group";
}

function isRule(node) {
  return node && node.type === "rule";
}

function dateThreshold(value, unit = "days") {
  const n = Number(value) || 0;
  const ms = unit === "hours" ? n * 60 * 60 * 1000 : n * DAY_MS;
  return new Date(Date.now() - ms);
}

// ── Prisma WHERE translation ────────────────────────────────────────────
// Returns a Prisma where-fragment for the rule, or null when the rule must
// be evaluated in JS.
function ruleToPrisma(rule) {
  const field = FIELD_BY_ID[rule.field];
  if (!field) return null;
  if (!field.supported) return null;
  if (!PRISMA_SAFE_FIELDS.has(rule.field)) return null;

  switch (rule.field) {
    case "subscriptionStatus": {
      if (rule.op === "is")     return { subscriptionStatus: rule.value };
      if (rule.op === "is_not") return { NOT: { subscriptionStatus: rule.value } };
      if (rule.op === "is_one_of") {
        const arr = Array.isArray(rule.value) ? rule.value : [rule.value];
        return { subscriptionStatus: { in: arr } };
      }
      return null;
    }
    case "source": {
      if (rule.op === "is")     return { source: rule.value };
      if (rule.op === "is_not") return { NOT: { source: rule.value } };
      if (rule.op === "is_one_of") {
        const arr = Array.isArray(rule.value) ? rule.value : [rule.value];
        return { source: { in: arr } };
      }
      return null;
    }
    case "hasTag": {
      const arr = Array.isArray(rule.value) ? rule.value : [rule.value];
      if (rule.op === "has")     return { tags: { some: { tagId: rule.value } } };
      if (rule.op === "has_not") return { NOT: { tags: { some: { tagId: rule.value } } } };
      if (rule.op === "has_any") return { tags: { some: { tagId: { in: arr } } } };
      return null;
    }
    case "firstSeenAt":
    case "lastSeenAt": {
      const col = rule.field;
      if (rule.op === "in_last")   return { [col]: { gte: dateThreshold(rule.value, rule.unit) } };
      if (rule.op === "more_than") return { [col]: { lt: dateThreshold(rule.value, rule.unit) } };
      if (rule.op === "before")    return { [col]: { lt: new Date(rule.value) } };
      if (rule.op === "after")     return { [col]: { gt: new Date(rule.value) } };
      if (rule.op === "empty")     return { [col]: null };
      return null;
    }
    default:
      return null;
  }
}

// Build a Prisma where for the *entire* tree if it's all prisma-safe.
// Returns { where, allSafe }.
function treeToPrisma(node) {
  if (isRule(node)) {
    const w = ruleToPrisma(node);
    if (!w) return { where: null, allSafe: false };
    return { where: w, allSafe: true };
  }
  if (isGroup(node)) {
    const parts = [];
    let allSafe = true;
    for (const child of node.children || []) {
      const r = treeToPrisma(child);
      if (!r.allSafe) allSafe = false;
      if (r.where) parts.push(r.where);
    }
    if (parts.length === 0) return { where: null, allSafe };
    const combined = node.match === "any" ? { OR: parts } : { AND: parts };
    return { where: combined, allSafe };
  }
  return { where: null, allSafe: false };
}

// ── JS predicate ────────────────────────────────────────────────────────
// Evaluate a single rule against a {contact, stats, lifecycle} row.
function evalRuleJs(rule, ctx) {
  const field = FIELD_BY_ID[rule.field];
  if (!field) return true;
  if (!field.supported) return true; // unsupported fields are no-ops

  const { contact, stats, lifecycle } = ctx;

  // Helpers
  const num = (v) => (v == null ? 0 : Number(v));
  const cmp = (left, op, right) => {
    if (op === "gt") return left > right;
    if (op === "lt") return left < right;
    if (op === "eq") return left === right;
    if (op === "between") return left >= right[0] && left <= right[1];
    return false;
  };

  switch (rule.field) {
    // Profile (also handled in Prisma; kept here for in-memory union/intersect)
    case "subscriptionStatus": {
      const v = contact.subscriptionStatus;
      if (rule.op === "is") return v === rule.value;
      if (rule.op === "is_not") return v !== rule.value;
      if (rule.op === "is_one_of") return (Array.isArray(rule.value) ? rule.value : [rule.value]).includes(v);
      return true;
    }
    case "source": {
      const v = contact.source;
      if (rule.op === "is") return v === rule.value;
      if (rule.op === "is_not") return v !== rule.value;
      if (rule.op === "is_one_of") return (Array.isArray(rule.value) ? rule.value : [rule.value]).includes(v);
      return true;
    }
    case "hasTag": {
      const tagIds = (contact.tags || []).map((t) => t.tagId);
      if (rule.op === "has") return tagIds.includes(rule.value);
      if (rule.op === "has_not") return !tagIds.includes(rule.value);
      if (rule.op === "has_any") return (Array.isArray(rule.value) ? rule.value : [rule.value]).some((t) => tagIds.includes(t));
      return true;
    }
    case "firstSeenAt":
    case "lastSeenAt": {
      const ts = new Date(contact[rule.field]).getTime();
      if (rule.op === "in_last")   return ts >= dateThreshold(rule.value, rule.unit).getTime();
      if (rule.op === "more_than") return ts <  dateThreshold(rule.value, rule.unit).getTime();
      if (rule.op === "before")    return ts <  new Date(rule.value).getTime();
      if (rule.op === "after")     return ts >  new Date(rule.value).getTime();
      if (rule.op === "empty")     return !contact[rule.field];
      return true;
    }
    case "lifecycleStage": {
      if (rule.op === "is") return lifecycle === rule.value;
      if (rule.op === "is_not") return lifecycle !== rule.value;
      if (rule.op === "is_one_of") return (Array.isArray(rule.value) ? rule.value : [rule.value]).includes(lifecycle);
      return true;
    }
    // Cart stats
    case "cartAbandonCount": return cmp(num(stats.cartAbandonCount), rule.op, num(rule.value));
    case "lastCartValue":    return cmp(num(stats.lastCartValue),    rule.op, num(rule.value));
    case "hasActiveCart": {
      const recent = stats.lastCartAbandonAt
        ? Date.now() - new Date(stats.lastCartAbandonAt).getTime() < 24 * 60 * 60 * 1000
        : false;
      return rule.op === "is_true" ? recent : !recent;
    }
    case "lastCartAt": {
      const ts = stats.lastCartAbandonAt ? new Date(stats.lastCartAbandonAt).getTime() : null;
      if (rule.op === "empty") return !ts;
      if (ts == null) return false;
      if (rule.op === "in_last")   return ts >= dateThreshold(rule.value, rule.unit).getTime();
      if (rule.op === "more_than") return ts <  dateThreshold(rule.value, rule.unit).getTime();
      if (rule.op === "before")    return ts <  new Date(rule.value).getTime();
      if (rule.op === "after")     return ts >  new Date(rule.value).getTime();
      return true;
    }
    // Email counts
    case "emailsSent":    return cmp(num(stats.emailsSent),    rule.op, num(rule.value));
    case "emailsOpened":  return cmp(num(stats.emailsOpened),  rule.op, num(rule.value));
    case "emailsClicked": return cmp(num(stats.emailsClicked), rule.op, num(rule.value));
    default:
      return true;
  }
}

function evalTreeJs(node, ctx) {
  if (isRule(node)) return evalRuleJs(node, ctx);
  if (!isGroup(node)) return true;
  const children = node.children || [];
  if (children.length === 0) return true;
  if (node.match === "any") return children.some((c) => evalTreeJs(c, ctx));
  return children.every((c) => evalTreeJs(c, ctx));
}

// Whether the tree references any rule that needs JS-side evaluation.
function needsJsEval(node) {
  if (isRule(node)) {
    const f = FIELD_BY_ID[node.field];
    if (!f) return false;
    if (!f.supported) return false;
    return STATS_FIELDS.has(node.field);
  }
  if (!isGroup(node)) return false;
  return (node.children || []).some(needsJsEval);
}

// Build a Prisma where-fragment that prefilters to a smaller candidate set
// before JS evaluation. Conservative: only ANDs in safe positive leaves at
// the root, so we never over-narrow when the tree contains OR groups.
function prefilterWhere(tree) {
  if (!isGroup(tree)) return null;
  if (tree.match !== "all") return null;
  const safe = (tree.children || [])
    .filter(isRule)
    .map(ruleToPrisma)
    .filter(Boolean);
  if (safe.length === 0) return null;
  return { AND: safe };
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Validate a filter tree. Throws on unknown field/op combinations.
 * Unsupported (gated) fields ARE allowed — they just no-op at eval time.
 */
export function validateFilterTree(tree) {
  function walk(node) {
    if (isGroup(node)) {
      if (node.match !== "all" && node.match !== "any") {
        throw new Error(`Invalid group match: ${node.match}`);
      }
      for (const c of node.children || []) walk(c);
      return;
    }
    if (isRule(node)) {
      const field = FIELD_BY_ID[node.field];
      if (!field) throw new Error(`Unknown field: ${node.field}`);
      return;
    }
    throw new Error("Unknown node type in filter tree");
  }
  walk(tree);
}

/**
 * Evaluate a segment.
 *
 *   segment.kind === "static"  → count + sample come from SegmentMembership.
 *   segment.kind === "dynamic" → evaluate filterTree against contacts.
 *
 * Returns: { count, sample, capped, lifecycleMix }.
 */
export async function evaluateSegment(shop, segment, { sampleSize = 5 } = {}) {
  if (!segment || segment.kind === "static") {
    return evaluateStatic(shop, segment, sampleSize);
  }
  return evaluateDynamic(shop, segment.filterTree, sampleSize);
}

async function evaluateStatic(shop, segment, sampleSize) {
  if (!segment?.id) return { count: 0, sample: [], capped: false, lifecycleMix: emptyMix() };
  const memberships = await prisma.segmentMembership.findMany({
    where: { segmentId: segment.id },
    orderBy: { addedAt: "desc" },
  });
  if (memberships.length === 0) {
    return { count: 0, sample: [], capped: false, lifecycleMix: emptyMix() };
  }
  const ids = memberships.map((m) => m.contactId);
  const contacts = await prisma.contact.findMany({
    where: { id: { in: ids }, shop, deletedAt: null },
    include: { tags: { include: { tag: true } } },
  });
  const sampleContacts = contacts.slice(0, sampleSize);
  const sample = await Promise.all(
    sampleContacts.map(async (c) => {
      const stats = await getContactStats(shop, c.email);
      return { id: c.id, email: c.email, name: c.name, lifecycle: computeLifecycle(c, stats) };
    }),
  );
  return {
    count: contacts.length,
    sample,
    capped: false,
    lifecycleMix: await mixFromContacts(shop, contacts.slice(0, MAX_SCAN)),
  };
}

async function evaluateDynamic(shop, tree, sampleSize) {
  // No tree → treat as "all contacts in shop".
  if (!tree || !isGroup(tree) || (tree.children || []).length === 0) {
    const count = await prisma.contact.count({ where: { shop, deletedAt: null } });
    const sampleRows = await prisma.contact.findMany({
      where: { shop, deletedAt: null },
      take: sampleSize,
      orderBy: { lastSeenAt: "desc" },
      include: { tags: { include: { tag: true } } },
    });
    const sample = await Promise.all(
      sampleRows.map(async (c) => ({
        id: c.id, email: c.email, name: c.name,
        lifecycle: computeLifecycle(c, await getContactStats(shop, c.email)),
      })),
    );
    return { count, sample, capped: false, lifecycleMix: await mixFromContacts(shop, sampleRows) };
  }

  const { where: fullWhere, allSafe } = treeToPrisma(tree);

  // Path A: every leaf is prisma-safe → count + sample with raw queries.
  if (allSafe && fullWhere) {
    const finalWhere = { shop, deletedAt: null, ...fullWhere };
    const [count, sampleRows] = await Promise.all([
      prisma.contact.count({ where: finalWhere }),
      prisma.contact.findMany({
        where: finalWhere,
        take: sampleSize,
        orderBy: { lastSeenAt: "desc" },
        include: { tags: { include: { tag: true } } },
      }),
    ]);
    const sample = await Promise.all(
      sampleRows.map(async (c) => ({
        id: c.id, email: c.email, name: c.name,
        lifecycle: computeLifecycle(c, await getContactStats(shop, c.email)),
      })),
    );
    return {
      count,
      sample,
      capped: false,
      lifecycleMix: await mixFromContacts(shop, sampleRows),
    };
  }

  // Path B: needs JS eval. Pre-narrow with whatever safe ANDs we can pull
  // from the root, then scan up to MAX_SCAN contacts.
  const prefilter = prefilterWhere(tree);
  const baseWhere = { shop, deletedAt: null, ...(prefilter || {}) };
  const candidates = await prisma.contact.findMany({
    where: baseWhere,
    take: MAX_SCAN + 1,
    orderBy: { lastSeenAt: "desc" },
    include: { tags: { include: { tag: true } } },
  });
  const capped = candidates.length > MAX_SCAN;
  const scanList = capped ? candidates.slice(0, MAX_SCAN) : candidates;

  const matched = [];
  for (const c of scanList) {
    const stats = await getContactStats(shop, c.email);
    const lifecycle = computeLifecycle(c, stats);
    if (evalTreeJs(tree, { contact: c, stats, lifecycle })) {
      matched.push({ contact: c, lifecycle });
      if (matched.length >= sampleSize * 4 && needsJsEval(tree)) {
        // Continue scanning but no need to accumulate further — we only
        // need the sample. We still want a true count so don't break.
      }
    }
  }

  const sample = matched.slice(0, sampleSize).map(({ contact, lifecycle }) => ({
    id: contact.id, email: contact.email, name: contact.name, lifecycle,
  }));
  const lifecycleMix = mixFromLifecycles(matched.map((m) => m.lifecycle));
  return {
    count: matched.length,
    sample,
    capped,
    lifecycleMix,
  };
}

// ── Lifecycle mix helpers ───────────────────────────────────────────────

function emptyMix() {
  return { new: 0, active: 0, at_risk: 0, churned: 0, never_purchased: 0 };
}

function mixFromLifecycles(stages) {
  const mix = emptyMix();
  for (const s of stages) {
    if (mix[s] != null) mix[s] += 1;
  }
  return mix;
}

async function mixFromContacts(shop, contacts) {
  const stages = [];
  for (const c of contacts) {
    const stats = await getContactStats(shop, c.email);
    stages.push(computeLifecycle(c, stats));
  }
  return mixFromLifecycles(stages);
}
