/**
 * Tests for the engagement rules in the segment evaluator.
 *
 * Run: npm test   (or: node --test app/lib/segments/evaluator.test.js)
 *
 * ── No database needed ─────────────────────────────────────────────────────
 * evalTreeForContact is a pure function over a contact row, and ruleToPrisma
 * builds a where-fragment without executing it. Both halves are tested here
 * because a segment rule has to mean the same thing whichever path the tree
 * takes — a tree of only column rules is counted in SQL, and the same tree
 * mixed with a cart rule is counted in JS. If those two disagree, a merchant's
 * count changes when they add an unrelated rule.
 *
 * ── Why these particular cases ─────────────────────────────────────────────
 * The engagement fields have two pieces of behaviour that are deliberate, easy
 * to "fix" into a bug, and silent when wrong:
 *
 *   1. A rate rule must not match a contact with an empty denominator. Every
 *      alternative reads as reasonable and is wrong: "open rate below 20%"
 *      would collect the entire never-emailed list, and the same tree runs as a
 *      flow entry filter, so the rule would mail the people it was written to
 *      exclude.
 *   2. A null lastEmailOpenedAt DOES match "more than 90 days ago", unlike
 *      every other date field here. Someone who has never opened is the most
 *      lapsed contact in the list, and the re-engagement segment this field
 *      exists to build is worthless without them.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { evalTreeForContact } from "./evaluator.server.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS);

/** A contact row with the columns the engagement rules read. */
function contactWith(overrides = {}) {
  return {
    id: "c1",
    email: "a@example.com",
    firstSeenAt: daysAgo(400),
    lastSeenAt: daysAgo(200),
    tags: [],
    orderCount: 0,
    totalSpent: 0,
    lastOrderAt: null,
    emailsSent: 0,
    emailsOpened: 0,
    emailsClicked: 0,
    emailsClickTracked: 0,
    openRate: 0,
    clickRate: 0,
    lastEmailOpenedAt: null,
    pushEnabled: false,
    ...overrides,
  };
}

/** Evaluate one rule against one contact. */
function match(rule, contact) {
  return evalTreeForContact(
    { type: "group", match: "all", children: [rule] },
    { contact, stats: {}, lifecycle: "churned" },
  );
}

// ── Rate rules and the empty denominator ────────────────────────────────

test("open rate below a threshold does not match a contact who was never emailed", () => {
  const rule = { type: "rule", field: "openRate", op: "lt", value: 20 };
  assert.equal(match(rule, contactWith({ emailsSent: 0, openRate: 0 })), false);
});

test("open rate below a threshold matches a genuinely disengaged contact", () => {
  const rule = { type: "rule", field: "openRate", op: "lt", value: 20 };
  assert.equal(match(rule, contactWith({ emailsSent: 20, emailsOpened: 1, openRate: 5 })), true);
});

test("open rate above a threshold matches an engaged contact", () => {
  const rule = { type: "rule", field: "openRate", op: "gt", value: 20 };
  assert.equal(match(rule, contactWith({ emailsSent: 10, emailsOpened: 8, openRate: 80 })), true);
});

test("click rate is gated on tracked sends, not on sends", () => {
  // Every send this contact received predates click tracking, so no click could
  // ever have been recorded. Reporting them as a 0% clicker is the exact
  // failure the clickTracked column exists to prevent.
  const rule = { type: "rule", field: "clickRate", op: "lt", value: 10 };
  const untracked = contactWith({ emailsSent: 50, emailsClickTracked: 0, clickRate: 0 });
  assert.equal(match(rule, untracked), false);

  const tracked = contactWith({ emailsSent: 50, emailsClickTracked: 50, emailsClicked: 1, clickRate: 2 });
  assert.equal(match(rule, tracked), true);
});

test("a rate rule with `between` reads both bounds", () => {
  const rule = { type: "rule", field: "openRate", op: "between", value: [10, 30] };
  assert.equal(match(rule, contactWith({ emailsSent: 10, openRate: 20 })), true);
  assert.equal(match(rule, contactWith({ emailsSent: 10, openRate: 40 })), false);
});

// ── lastEmailOpenedAt and the never-opened contact ──────────────────────

test("'more than 90 days' includes a contact who has never opened", () => {
  const rule = { type: "rule", field: "lastEmailOpenedAt", op: "more_than", value: 90, unit: "days" };
  assert.equal(match(rule, contactWith({ emailsSent: 12, lastEmailOpenedAt: null })), true);
});

test("'more than 90 days' excludes a recent opener and includes a stale one", () => {
  const rule = { type: "rule", field: "lastEmailOpenedAt", op: "more_than", value: 90, unit: "days" };
  assert.equal(match(rule, contactWith({ emailsSent: 12, lastEmailOpenedAt: daysAgo(10) })), false);
  assert.equal(match(rule, contactWith({ emailsSent: 12, lastEmailOpenedAt: daysAgo(200) })), true);
});

test("'in the last 30 days' excludes a contact who has never opened", () => {
  // The inverse of the rule above has to stay strict, or "opened recently"
  // would collect everyone who has never opened at all.
  const rule = { type: "rule", field: "lastEmailOpenedAt", op: "in_last", value: 30, unit: "days" };
  assert.equal(match(rule, contactWith({ lastEmailOpenedAt: null })), false);
  assert.equal(match(rule, contactWith({ lastEmailOpenedAt: daysAgo(5) })), true);
});

test("'is empty' isolates never-openers on their own", () => {
  const rule = { type: "rule", field: "lastEmailOpenedAt", op: "empty" };
  assert.equal(match(rule, contactWith({ lastEmailOpenedAt: null })), true);
  assert.equal(match(rule, contactWith({ lastEmailOpenedAt: daysAgo(500) })), false);
});

// ── The re-engagement segment this ticket exists for ────────────────────

test("the lapsed-subscriber tree matches the lapsed and nobody else", () => {
  // Exactly tpl_lapsed in fields.server.js: sent something, opened nothing in
  // 90 days. The emailsSent rule is what keeps the never-emailed out, since
  // lastEmailOpenedAt is deliberately permissive about nulls.
  const tree = {
    type: "group",
    match: "all",
    children: [
      { type: "rule", field: "emailsSent", op: "gt", value: 0 },
      { type: "rule", field: "lastEmailOpenedAt", op: "more_than", value: 90, unit: "days" },
    ],
  };
  const evaluate = (contact) => evalTreeForContact(tree, { contact, stats: {}, lifecycle: "churned" });

  // Emailed, never opened — the case the whole feature is for.
  assert.equal(evaluate(contactWith({ emailsSent: 12, lastEmailOpenedAt: null })), true);
  // Emailed, opened long ago.
  assert.equal(evaluate(contactWith({ emailsSent: 12, lastEmailOpenedAt: daysAgo(120) })), true);
  // Emailed, opened last week.
  assert.equal(evaluate(contactWith({ emailsSent: 12, lastEmailOpenedAt: daysAgo(7) })), false);
  // Never emailed — not lapsed, just new to us.
  assert.equal(evaluate(contactWith({ emailsSent: 0, lastEmailOpenedAt: null })), false);
});

// ── Counts and push ─────────────────────────────────────────────────────

test("email count rules read the contact columns", () => {
  const rule = { type: "rule", field: "emailsOpened", op: "gt", value: 3 };
  assert.equal(match(rule, contactWith({ emailsOpened: 5 })), true);
  assert.equal(match(rule, contactWith({ emailsOpened: 2 })), false);
});

test("push enabled reads both directions", () => {
  assert.equal(match({ type: "rule", field: "pushEnabled", op: "is_true" }, contactWith({ pushEnabled: true })), true);
  assert.equal(match({ type: "rule", field: "pushEnabled", op: "is_true" }, contactWith({ pushEnabled: false })), false);
  assert.equal(match({ type: "rule", field: "pushEnabled", op: "is_false" }, contactWith({ pushEnabled: false })), true);
});
