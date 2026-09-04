// Segment evaluator.
//
// Given a filterTree (root group), produce { count, sample, lifecycleMix } for
// the preview pane and the segment list count cache.
//
// ── Every rule is a column comparison ──────────────────────────────────────
// The whole tree compiles to one Prisma `where`, so a segment costs a COUNT and
// a paged id query no matter how large the audience is.
//
// It was not always so. Fields backed by a per-contact aggregate — purchase
// totals, engagement rates, cart counts — had no column to compare, so any tree
// containing one fell back to loading contacts and filtering them in JS, capped
// at 5,000 rows. That cap read as a performance guard and was actually a
// correctness bug: a shop above it evaluated a partial audience with no error
// anywhere, and because the scan was ordered by lastSeenAt DESC, the contacts it
// skipped were precisely the dormant ones that recency segments exist to find.
// A 16,472-contact shop counted its "churned" segment from its 5,000 most
// recently active people.
//
// Each of those aggregates now lives on Contact, maintained on write by
// lib/orders, lib/contacts/engagement and lib/contacts/carts. Two fields are
// still derived here rather than stored, because their value changes with the
// clock rather than with a write, so a column would be stale for most of every
// day:
//
//   hasActiveCart   — lastCartAt within 24 hours
//   lifecycleStage  — date arithmetic over firstSeenAt / lastSeenAt /
//                     lastOrderAt / lastCartAt
//
// Both are expressible as date comparisons in the WHERE, which is why neither
// needs a column and neither reopens the in-memory path.
//
// ── evalTreeJs is for one contact, never for counting ──────────────────────
// The JS matcher below still exists, reached only through evalTreeForContact:
// flow entry filters and segment-membership lookups ask "does THIS contact
// match", where there is no audience to scan. It reads the same columns as the
// SQL translation, and evaluator.test.js checks the two agree.
//
// A field marked unsupported in fields.server.js short-circuits to true — the
// rule becomes a no-op. Nothing is currently in that state; the mechanism stays
// because a field can only ever be added to the picker before its data exists,
// and a tree loading with a rule the evaluator has never heard of must render
// rather than throw.

import prisma from "../../db.server.js";
import { FIELD_BY_ID } from "./fields.server.js";
import { computeLifecycle } from "../contacts/contacts.server.js";

// How many contact ids the enrollment worker can diff in one pass. Not a
// correctness limit the way MAX_SCAN was — counts are exact regardless; this
// only bounds the id list handed to segment_entered.
const MAX_MATCHED_IDS = 50000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_CART_MS = 24 * 60 * 60 * 1000;

// Lifecycle thresholds, in days. Shared by the SQL translation and the JS
// matcher so the two cannot drift; computeLifecycle in lib/contacts holds the
// same numbers and the test asserts all three agree.
const LIFECYCLE_NEW_DAYS = 14;
const LIFECYCLE_ACTIVE_DAYS = 30;
const LIFECYCLE_AT_RISK_DAYS = 90;

const PRISMA_SAFE_FIELDS = new Set([
  "subscriptionStatus",
  "whatsappStatus",
  "source",
  "hasTag",
  "firstSeenAt",
  "lastSeenAt",
  // Purchase facts are denormalized onto Contact by lib/orders, so they compare
  // as indexed columns. This is the whole reason for denormalizing them: as a
  // per-contact aggregate they would force every Purchase rule down the JS path
  // below, scanning the audience one contact at a time.
  "totalSpent",
  "orderCount",
  "lastOrderAt",
  // Engagement facts, denormalized onto Contact by lib/contacts/engagement.
  // Same reasoning: these were the four fields the picker showed greyed out,
  // because as a live join over JourneyJob they could only be compared inside
  // the capped JS scan below.
  "emailsSent",
  "emailsOpened",
  "emailsClicked",
  "openRate",
  "clickRate",
  "lastEmailOpenedAt",
  "pushEnabled",
  // AOV is stored rather than divided at query time purely so it can appear
  // here — a Prisma WHERE cannot compare one column against another.
  "aov",
  // Cart facts, denormalized onto Contact by lib/contacts/carts.
  "cartAbandonCount",
  "lastCartAt",
  "lastCartValue",
  // Derived at query time from the columns above, not stored: both answers move
  // with the clock rather than with a write.
  "hasActiveCart",
  "lifecycleStage",
]);
// Nothing is missing from this set. Every field in fields.server.js translates,
// which is what lets evaluateDynamic below be a COUNT rather than a scan. If a
// future field cannot translate, it must not silently fall back to filtering in
// memory — see the header.

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

/**
 * Which column has to be non-zero for a rate to mean anything.
 *
 * Not the same column for the two rates. Click rate is measured only over sends
 * whose domain had click tracking active — a send without it cannot record a
 * click, so counting it would report a measurement gap as a 0% click rate. See
 * lib/contacts/engagement.server.js.
 */
function denominatorFor(rateField) {
  return rateField === "clickRate" ? "emailsClickTracked" : "emailsSent";
}

/** The numeric half of a rate comparison, without its denominator guard. */
function numericComparison(col, rule) {
  if (rule.op === "gt") return { [col]: { gt: Number(rule.value) || 0 } };
  if (rule.op === "lt") return { [col]: { lt: Number(rule.value) || 0 } };
  if (rule.op === "eq") return { [col]: Number(rule.value) || 0 };
  if (rule.op === "between") {
    const [lo, hi] = Array.isArray(rule.value) ? rule.value : [rule.value, rule.value2];
    return { [col]: { gte: Number(lo) || 0, lte: Number(hi) || 0 } };
  }
  return null;
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
    case "whatsappStatus": {
      if (rule.op === "is")     return { whatsappStatus: rule.value };
      if (rule.op === "is_not") return { NOT: { whatsappStatus: rule.value } };
      if (rule.op === "is_one_of") {
        const arr = Array.isArray(rule.value) ? rule.value : [rule.value];
        return { whatsappStatus: { in: arr } };
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
    case "totalSpent":
    case "orderCount":
    case "emailsSent":
    case "emailsOpened":
    case "emailsClicked": {
      const col = rule.field;
      const n = Number(rule.value) || 0;
      if (rule.op === "gt") return { [col]: { gt: n } };
      if (rule.op === "lt") return { [col]: { lt: n } };
      if (rule.op === "eq") return { [col]: n };
      if (rule.op === "between") {
        const [lo, hi] = Array.isArray(rule.value) ? rule.value : [rule.value, rule.value2];
        return { [col]: { gte: Number(lo) || 0, lte: Number(hi) || 0 } };
      }
      return null;
    }
    case "openRate":
    case "clickRate": {
      const col = rule.field;
      const cmpPart = numericComparison(col, rule);
      if (!cmpPart) return null;
      // A contact with nothing in the denominator has no rate, and 0 is not a
      // stand-in for one. Without this guard "open rate is less than 20%" would
      // sweep in everyone who has never been emailed — and the same tree is what
      // a flow entry filter runs, so it would mail exactly the people the
      // merchant was trying to exclude. See the JS branch for the full note.
      return { AND: [{ [denominatorFor(col)]: { gt: 0 } }, cmpPart] };
    }
    case "lastEmailOpenedAt": {
      if (rule.op === "empty")   return { lastEmailOpenedAt: null };
      if (rule.op === "in_last") return { lastEmailOpenedAt: { gte: dateThreshold(rule.value, rule.unit) } };
      // Never opened counts as "hasn't opened in 90 days". This deliberately
      // differs from every other date field here, where a null matches nothing
      // — see the JS branch for why this one field is the exception.
      if (rule.op === "more_than") {
        return { OR: [{ lastEmailOpenedAt: null }, { lastEmailOpenedAt: { lt: dateThreshold(rule.value, rule.unit) } }] };
      }
      if (rule.op === "before") {
        return { OR: [{ lastEmailOpenedAt: null }, { lastEmailOpenedAt: { lt: new Date(rule.value) } }] };
      }
      if (rule.op === "after") return { lastEmailOpenedAt: { gt: new Date(rule.value) } };
      return null;
    }
    case "pushEnabled": {
      if (rule.op === "is_true")  return { pushEnabled: true };
      if (rule.op === "is_false") return { pushEnabled: false };
      return null;
    }
    case "lastOrderAt":
    case "firstSeenAt":
    case "lastSeenAt":
    case "lastCartAt": {
      const col = rule.field;
      if (rule.op === "in_last")   return { [col]: { gte: dateThreshold(rule.value, rule.unit) } };
      if (rule.op === "more_than") return { [col]: { lt: dateThreshold(rule.value, rule.unit) } };
      if (rule.op === "before")    return { [col]: { lt: new Date(rule.value) } };
      if (rule.op === "after")     return { [col]: { gt: new Date(rule.value) } };
      if (rule.op === "empty")     return { [col]: null };
      return null;
    }
    case "cartAbandonCount":
    case "lastCartValue":
    case "aov": {
      return numericComparison(rule.field, rule);
    }
    case "hasActiveCart": {
      // Not a column: "active" means abandoned in the last 24 hours, an answer
      // that changes as time passes rather than when anything is written. A
      // stored boolean would be right just after a rollup and wrong for the rest
      // of the day.
      const since = new Date(Date.now() - ACTIVE_CART_MS);
      if (rule.op === "is_true")  return { lastCartAt: { gte: since } };
      // Never abandoned counts as "no active cart", so the null has to be
      // spelled out — a bare `lt` would silently drop those contacts.
      if (rule.op === "is_false") return { OR: [{ lastCartAt: null }, { lastCartAt: { lt: since } }] };
      return null;
    }
    case "lifecycleStage": {
      return lifecycleToPrisma(rule);
    }
    default:
      return null;
  }
}

/**
 * Lifecycle as a WHERE fragment, mirroring computeLifecycle().
 *
 * Derived rather than stored for the same reason as hasActiveCart: a contact
 * moves from active to at-risk to churned by the calendar advancing, with no
 * write to trigger a refresh. A stored stage would be wrong for everyone who
 * simply went quiet — which is the entire population these rules are used to
 * find.
 *
 * computeLifecycle takes the most recent of lastSeenAt, lastOrderAt and
 * lastCartAt. Postgres has GREATEST for that, but a Prisma WHERE does not, so
 * "the newest of the three is within N days" is expressed as "any one of the
 * three is within N days" — which is the same statement, and unlike GREATEST it
 * needs no COALESCE to handle the nullable two.
 */
function lifecycleToPrisma(rule) {
  const stages = rule.op === "is_one_of"
    ? (Array.isArray(rule.value) ? rule.value : [rule.value])
    : [rule.value];

  // "is_not" is expressed as the union of the OTHER stages rather than as a
  // NOT around this one. The four stages partition the audience exactly, so the
  // two are logically identical — but a NOT wrapped around a comparison against
  // a nullable column is not: see nullSafeInactive below.
  const wanted = rule.op === "is_not"
    ? ALL_STAGES.filter((st) => !stages.includes(st))
    : stages;

  const parts = wanted.map(stageToPrisma).filter(Boolean);
  if (parts.length === 0) return null;
  if (rule.op !== "is" && rule.op !== "is_not" && rule.op !== "is_one_of") return null;
  return parts.length === 1 ? parts[0] : { OR: parts };
}

const ALL_STAGES = ["new", "active", "at_risk", "churned"];

/** Any activity signal newer than `since`. */
function activeSince(since) {
  return {
    OR: [
      { lastSeenAt: { gte: since } },
      { lastOrderAt: { gte: since } },
      { lastCartAt: { gte: since } },
    ],
  };
}

/**
 * No activity signal newer than `since` — the null-safe inverse of activeSince.
 *
 * NOT the same as `{ NOT: activeSince(since) }`, and the difference is a silent
 * wrong answer rather than an error. lastOrderAt and lastCartAt are nullable, so
 * for a contact who has never ordered and never abandoned a cart, SQL evaluates
 * `NOT (lastSeenAt >= x OR NULL >= x OR NULL >= x)` as NOT NULL, which is NULL,
 * which does not match. Every such contact silently dropped out of the at-risk
 * and churned segments — and "never ordered, long dormant" is the definition of
 * the population those segments exist to find. On one shop here that was 2,428
 * at-risk contacts reported as 614.
 *
 * Spelling the null out per column keeps the comparison two-valued.
 */
function nullSafeInactive(since) {
  // Only the two nullable columns get a null branch. lastSeenAt is NOT NULL —
  // it defaults to now() on insert — so a null test on it is not just redundant,
  // Prisma rejects it outright.
  const olderOrAbsent = (col) => ({ OR: [{ [col]: null }, { [col]: { lt: since } }] });
  return {
    AND: [
      { lastSeenAt: { lt: since } },
      olderOrAbsent("lastOrderAt"),
      olderOrAbsent("lastCartAt"),
    ],
  };
}

function stageToPrisma(stage) {
  const newCutoff = new Date(Date.now() - LIFECYCLE_NEW_DAYS * DAY_MS);
  const activeCutoff = new Date(Date.now() - LIFECYCLE_ACTIVE_DAYS * DAY_MS);
  const atRiskCutoff = new Date(Date.now() - LIFECYCLE_AT_RISK_DAYS * DAY_MS);

  // "new" wins outright in computeLifecycle — it returns before looking at any
  // activity — so every other stage excludes it. Written as a direct comparison
  // rather than NOT(new) because firstSeenAt is non-null and this stays
  // two-valued.
  const notNew = { firstSeenAt: { lt: newCutoff } };

  switch (stage) {
    case "new":
      return { firstSeenAt: { gte: newCutoff } };
    case "active":
      return { AND: [notNew, activeSince(activeCutoff)] };
    case "at_risk":
      return { AND: [notNew, nullSafeInactive(activeCutoff), activeSince(atRiskCutoff)] };
    case "churned":
      // Everything quieter than the at-risk window, including the no-signal
      // case: computeLifecycle calls a contact with no usable timestamp churned
      // rather than inventing a more flattering stage, and a row of three nulls
      // satisfies every branch of nullSafeInactive.
      return { AND: [notNew, nullSafeInactive(atRiskCutoff)] };
    default:
      return null;
  }
}

// Compile the whole tree into one Prisma where. `allSafe` is false if any leaf
// failed to translate — evaluateDynamic treats that as an error rather than
// falling back to filtering in memory. See the header.
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
// Evaluate a single rule against a {contact} row. `lifecycle` is optional —
// supplied by callers that already computed one, derived here otherwise.
function evalRuleJs(rule, ctx) {
  const field = FIELD_BY_ID[rule.field];
  if (!field) return true;
  if (!field.supported) return true; // unsupported fields are no-ops

  // No `stats`. Every field this matcher reads is a column on the contact row
  // now, so callers no longer have to aggregate anything before asking. Extra
  // keys on ctx are ignored rather than rejected, so old callers still work.
  const { contact, lifecycle } = ctx;

  // Helpers
  const num = (v) => (v == null ? 0 : Number(v));
  // "between" carries two values; every other numeric op carries one.
  const betweenOrNum = (r) =>
    r.op === "between"
      ? (Array.isArray(r.value) ? r.value.map(Number) : [Number(r.value) || 0, Number(r.value2) || 0])
      : Number(r.value) || 0;
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
    case "whatsappStatus": {
      const v = contact.whatsappStatus;
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
    // Purchase.
    case "totalSpent":  return cmp(num(contact.totalSpent), rule.op, betweenOrNum(rule));
    case "orderCount":  return cmp(num(contact.orderCount), rule.op, betweenOrNum(rule));
    case "aov": {
      // Recomputed from its inputs rather than read from contact.aov, so a
      // single-contact match is correct even for a caller holding a row that
      // predates the column or selects only part of it. Same definition as the
      // stored value — see averageOrderValue() in lib/orders.
      const count = num(contact.orderCount);
      const aov = count ? num(contact.totalSpent) / count : 0;
      return cmp(aov, rule.op, betweenOrNum(rule));
    }
    case "lastOrderAt": {
      const raw = contact.lastOrderAt;
      if (rule.op === "empty") return !raw;
      if (!raw) return false;
      const ts = new Date(raw).getTime();
      if (rule.op === "in_last")   return ts >= dateThreshold(rule.value, rule.unit).getTime();
      if (rule.op === "more_than") return ts <  dateThreshold(rule.value, rule.unit).getTime();
      if (rule.op === "before")    return ts <  new Date(rule.value).getTime();
      if (rule.op === "after")     return ts >  new Date(rule.value).getTime();
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
      // Computed here when the caller didn't supply one. Lifecycle used to
      // require an aggregate fetch, so it was passed in; every input is a column
      // now, which means a ctx without it is no longer a reason to be wrong.
      // Callers that do pass one still win, so nothing recomputes needlessly.
      const stage = lifecycle ?? computeLifecycle(contact);
      if (rule.op === "is") return stage === rule.value;
      if (rule.op === "is_not") return stage !== rule.value;
      if (rule.op === "is_one_of") return (Array.isArray(rule.value) ? rule.value : [rule.value]).includes(stage);
      return true;
    }
    // Cart. Columns on Contact now, maintained by lib/contacts/carts.server.js,
    // so these read the contact row rather than a recomputed stats object —
    // one source of truth with the SQL translation above.
    case "cartAbandonCount": return cmp(num(contact.cartAbandonCount), rule.op, betweenOrNum(rule));
    case "lastCartValue":    return cmp(num(contact.lastCartValue),    rule.op, betweenOrNum(rule));
    case "hasActiveCart": {
      const recent = contact.lastCartAt
        ? Date.now() - new Date(contact.lastCartAt).getTime() < ACTIVE_CART_MS
        : false;
      return rule.op === "is_true" ? recent : !recent;
    }
    case "lastCartAt": {
      const ts = contact.lastCartAt ? new Date(contact.lastCartAt).getTime() : null;
      if (rule.op === "empty") return !ts;
      if (ts == null) return false;
      if (rule.op === "in_last")   return ts >= dateThreshold(rule.value, rule.unit).getTime();
      if (rule.op === "more_than") return ts <  dateThreshold(rule.value, rule.unit).getTime();
      if (rule.op === "before")    return ts <  new Date(rule.value).getTime();
      if (rule.op === "after")     return ts >  new Date(rule.value).getTime();
      return true;
    }
    // Email engagement. Columns on Contact now, maintained by
    // lib/contacts/engagement.server.js, so these read the contact row for the
    // same reason totalSpent does — the stats object is derived from the same
    // numbers, and one source beats two that can disagree.
    case "emailsSent":    return cmp(num(contact.emailsSent),    rule.op, betweenOrNum(rule));
    case "emailsOpened":  return cmp(num(contact.emailsOpened),  rule.op, betweenOrNum(rule));
    case "emailsClicked": return cmp(num(contact.emailsClicked), rule.op, betweenOrNum(rule));
    case "openRate":
    case "clickRate": {
      // A contact with an empty denominator has no rate at all, and zero is not
      // a stand-in for one. Treating "never emailed" as 0% would make "open rate
      // is less than 20%" match every contact who has never received anything —
      // and because flow entry filters run this same tree, that rule would mail
      // precisely the people the merchant wrote it to exclude.
      const denominator = num(contact[rule.field === "clickRate" ? "emailsClickTracked" : "emailsSent"]);
      if (!denominator) return false;
      return cmp(num(contact[rule.field]), rule.op, betweenOrNum(rule));
    }
    case "lastEmailOpenedAt": {
      const raw = contact.lastEmailOpenedAt;
      if (rule.op === "empty") return !raw;
      // The one date field where a null is not simply "no match".
      //
      // "Hasn't opened anything in 90 days" is the re-engagement and
      // list-hygiene segment this field exists to build, and someone who has
      // never opened has, by any reading a merchant would recognise, not opened
      // in 90 days. Excluding them would leave exactly the most disengaged part
      // of the list out of the segment aimed at it. `is empty` still isolates
      // never-openers on their own when that is what is wanted.
      if (!raw) return rule.op === "more_than" || rule.op === "before";
      const ts = new Date(raw).getTime();
      if (rule.op === "in_last")   return ts >= dateThreshold(rule.value, rule.unit).getTime();
      if (rule.op === "more_than") return ts <  dateThreshold(rule.value, rule.unit).getTime();
      if (rule.op === "before")    return ts <  new Date(rule.value).getTime();
      if (rule.op === "after")     return ts >  new Date(rule.value).getTime();
      return true;
    }
    case "pushEnabled": {
      const on = Boolean(contact.pushEnabled);
      return rule.op === "is_true" ? on : !on;
    }
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

// Public single-contact eval — used by `listSegmentsForContact` to check
// dynamic segment membership without scanning the whole shop.
export function evalTreeForContact(tree, ctx) {
  if (!tree) return true;
  return evalTreeJs(tree, ctx);
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
 *   segment.kind === "dynamic" → filterTree compiles to one Prisma WHERE.
 *
 * Options:
 *   - sampleSize: how many contact rows to return in `sample` (default 5).
 *   - returnIds:  when true, also returns `matchedIds` — matching Contact.id
 *                 values, up to MAX_MATCHED_IDS. Used by the enrollment worker
 *                 to diff entered/left sets.
 *
 * Returns: { count, sample, lifecycleMix, matchedIds? }.
 *
 * There is no `capped` any more. It used to mean two different things — "the
 * count is a sample" on the scan path and, wrongly, "the count exceeds 5,000"
 * on the SQL path, where the count was exact. Nothing truncates a count now, so
 * the honest answer is to stop returning a flag about it.
 */
export async function evaluateSegment(shop, segment, { sampleSize = 5, returnIds = false } = {}) {
  if (!segment || segment.kind === "static") {
    return evaluateStatic(shop, segment, sampleSize, returnIds);
  }
  return evaluateDynamic(shop, segment.filterTree, sampleSize, returnIds);
}

async function evaluateStatic(shop, segment, sampleSize, returnIds = false) {
  if (!segment?.id) return emptyResult(returnIds);
  const memberships = await prisma.segmentMembership.findMany({
    where: { segmentId: segment.id },
    select: { contactId: true },
    orderBy: { addedAt: "desc" },
  });
  if (memberships.length === 0) return emptyResult(returnIds);

  const where = { id: { in: memberships.map((m) => m.contactId) }, shop, deletedAt: null };
  const [count, contacts] = await Promise.all([
    prisma.contact.count({ where }),
    // Only what the mix and the sample need. This used to load every member row
    // with its tags in order to count them.
    prisma.contact.findMany({ where, select: LIFECYCLE_SELECT, orderBy: { lastSeenAt: "desc" } }),
  ]);

  return {
    count,
    sample: buildSample(contacts.slice(0, sampleSize)),
    lifecycleMix: mixFromContacts(contacts),
    ...(returnIds ? { matchedIds: contacts.slice(0, MAX_MATCHED_IDS).map((c) => c.id) } : {}),
  };
}

/**
 * The whole tree as one WHERE, so the cost is a COUNT rather than a scan.
 *
 * An empty tree means "everyone in the shop", which is just an empty WHERE —
 * the same code path rather than a special case, so the two cannot disagree.
 */
async function evaluateDynamic(shop, tree, sampleSize, returnIds = false) {
  const { where: treeWhere, allSafe } = hasRules(tree)
    ? treeToPrisma(tree)
    : { where: null, allSafe: true };

  // Every field in the catalog translates, so this is unreachable today. It is
  // an assertion rather than a fallback on purpose: the alternative — quietly
  // filtering in memory over a capped page — is the exact silent-wrong-answer
  // failure this evaluator was rebuilt to remove. Better a visible error on the
  // segment than a plausible number nobody can tell is wrong.
  if (!allSafe) {
    throw new Error("Segment contains a rule that cannot be evaluated in the database");
  }

  const where = { shop, deletedAt: null, ...(treeWhere || {}) };
  const [count, contacts] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      select: LIFECYCLE_SELECT,
      orderBy: { lastSeenAt: "desc" },
      // The mix is drawn from this page rather than the whole audience; the
      // count beside it is exact.
      take: returnIds ? MAX_MATCHED_IDS : Math.max(sampleSize, MIX_SAMPLE),
    }),
  ]);

  return {
    count,
    sample: buildSample(contacts.slice(0, sampleSize)),
    lifecycleMix: mixFromContacts(contacts),
    ...(returnIds ? { matchedIds: contacts.map((c) => c.id) } : {}),
  };
}

/** Does this node carry any rules at all? */
function hasRules(tree) {
  return Boolean(tree) && isGroup(tree) && (tree.children || []).length > 0;
}

// Lifecycle needs these four columns and nothing else. lastCartAt joining the
// set is what removed the batched stats fetch that used to accompany every
// sample and every mix.
const LIFECYCLE_SELECT = {
  id: true,
  email: true,
  name: true,
  firstSeenAt: true,
  lastSeenAt: true,
  lastOrderAt: true,
  lastCartAt: true,
};

// How many rows the lifecycle mix is drawn from when no id list is requested.
const MIX_SAMPLE = 500;

// ── Lifecycle mix helpers ───────────────────────────────────────────────

function emptyMix() {
  return { new: 0, active: 0, at_risk: 0, churned: 0 };
}

function emptyResult(returnIds) {
  return {
    count: 0,
    sample: [],
    lifecycleMix: emptyMix(),
    ...(returnIds ? { matchedIds: [] } : {}),
  };
}

function mixFromContacts(contacts) {
  const mix = emptyMix();
  for (const c of contacts) {
    const stage = computeLifecycle(c);
    if (mix[stage] != null) mix[stage] += 1;
  }
  return mix;
}

/** Sample rows for the preview pane. No extra query — the columns are here. */
function buildSample(contacts) {
  return contacts.map((c) => ({
    id: c.id,
    email: c.email,
    name: c.name,
    lifecycle: computeLifecycle(c),
  }));
}
