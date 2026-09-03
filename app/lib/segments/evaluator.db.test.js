/**
 * SQL-vs-JS parity for the segment evaluator.
 *
 * Run: npm test   (or: node --test app/lib/segments/evaluator.db.test.js)
 *
 * ── Why this needs a database ──────────────────────────────────────────────
 * The evaluator has two matchers that must agree. evaluateSegment compiles a
 * rule tree into a Prisma WHERE and counts in SQL; evalTreeForContact answers
 * the same question for one contact in JS, and is what flow entry filters and
 * segment-membership lookups use. If they disagree, a contact can be counted
 * into a segment and then refused entry to the flow that segment triggers, or
 * the reverse — with no error on either side.
 *
 * Only the database can settle that, because the disagreements that matter are
 * not in the JavaScript. They are in SQL's three-valued logic:
 *
 *   NOT (lastSeenAt >= x OR lastOrderAt >= x OR lastCartAt >= x)
 *
 * is NULL, not TRUE, for a contact who has never ordered and never abandoned a
 * cart. Every such contact silently dropped out of the at-risk and churned
 * segments — and "never ordered, long dormant" is precisely the population
 * those segments exist to find. On one real shop that reported 614 at-risk
 * contacts where there were 2,428. A pure unit test cannot see this: the JS
 * matcher was right the whole time.
 *
 * ── The fixtures ───────────────────────────────────────────────────────────
 * Contacts are built under a reserved shop key and deleted afterwards. They are
 * chosen to sit on the edges rather than in the middle: null order and cart
 * dates, activity exactly at a stage boundary, no signals at all, a cart
 * abandoned either side of the 24-hour active window.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { evaluateSegment, evalTreeForContact } from "./evaluator.server.js";

const SHOP = "__test__evaluator-parity.myshopify.com";
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);
const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000);

// Each fixture names the trap it covers.
const FIXTURES = [
  // Lifecycle: "new" wins outright, however dormant the other signals look.
  { key: "new-recent",        firstSeenAt: ago(3),   lastSeenAt: ago(3) },
  { key: "new-but-dormant",   firstSeenAt: ago(2),   lastSeenAt: ago(400) },

  // Lifecycle: null lastOrderAt AND null lastCartAt — the three-valued-logic
  // case. These are the rows a bare NOT silently dropped.
  { key: "active-nulls",      firstSeenAt: ago(200), lastSeenAt: ago(5) },
  { key: "atrisk-nulls",      firstSeenAt: ago(200), lastSeenAt: ago(60) },
  { key: "churned-nulls",     firstSeenAt: ago(400), lastSeenAt: ago(300) },

  // Lifecycle: the newest signal wins, including when it is not lastSeenAt.
  { key: "active-via-order",  firstSeenAt: ago(400), lastSeenAt: ago(300), lastOrderAt: ago(5) },
  { key: "active-via-cart",   firstSeenAt: ago(400), lastSeenAt: ago(300), lastCartAt: ago(2) },
  { key: "atrisk-via-order",  firstSeenAt: ago(400), lastSeenAt: ago(300), lastOrderAt: ago(60) },
  { key: "churned-all-old",   firstSeenAt: ago(400), lastSeenAt: ago(200), lastOrderAt: ago(300), lastCartAt: ago(250) },

  // Cart: either side of the 24-hour "active cart" window.
  { key: "cart-active",       firstSeenAt: ago(200), lastSeenAt: ago(1),  lastCartAt: hoursAgo(2),  cartAbandonCount: 1, lastCartValue: 250 },
  { key: "cart-stale",        firstSeenAt: ago(200), lastSeenAt: ago(40), lastCartAt: hoursAgo(48), cartAbandonCount: 3, lastCartValue: 75 },
  { key: "cart-none",         firstSeenAt: ago(200), lastSeenAt: ago(40) },

  // AOV and engagement, including the zero-denominator guards.
  { key: "aov-high",          firstSeenAt: ago(200), lastSeenAt: ago(10), orderCount: 2, totalSpent: 400, aov: 200 },
  { key: "aov-low",           firstSeenAt: ago(200), lastSeenAt: ago(10), orderCount: 4, totalSpent: 40,  aov: 10 },
  { key: "aov-none",          firstSeenAt: ago(200), lastSeenAt: ago(10) },
  { key: "never-emailed",     firstSeenAt: ago(200), lastSeenAt: ago(10) },
  { key: "opened-nothing",    firstSeenAt: ago(200), lastSeenAt: ago(10), emailsSent: 10, openRate: 0 },
  { key: "opened-long-ago",   firstSeenAt: ago(200), lastSeenAt: ago(10), emailsSent: 10, emailsOpened: 2, openRate: 20, lastEmailOpenedAt: ago(150) },
];

const R = (field, op, value, extra = {}) => ({ type: "rule", field, op, value, ...extra });
const all = (...children) => ({ type: "group", match: "all", children });
const any = (...children) => ({ type: "group", match: "any", children });

// Every rule shape whose SQL and JS forms could plausibly diverge.
const CASES = {
  "lifecycle new":            all(R("lifecycleStage", "is", "new")),
  "lifecycle active":         all(R("lifecycleStage", "is", "active")),
  "lifecycle at_risk":        all(R("lifecycleStage", "is", "at_risk")),
  "lifecycle churned":        all(R("lifecycleStage", "is", "churned")),
  "lifecycle is_not active":  all(R("lifecycleStage", "is_not", "active")),
  "lifecycle is_not new":     all(R("lifecycleStage", "is_not", "new")),
  "lifecycle one_of":         all(R("lifecycleStage", "is_one_of", ["at_risk", "churned"])),
  "hasActiveCart true":       all(R("hasActiveCart", "is_true", true)),
  "hasActiveCart false":      all(R("hasActiveCart", "is_false", false)),
  "cartAbandonCount > 0":     all(R("cartAbandonCount", "gt", 0)),
  "cartAbandonCount between": all(R("cartAbandonCount", "between", [1, 2])),
  "lastCartValue > 100":      all(R("lastCartValue", "gt", 100)),
  "lastCartAt in_last 7d":    all(R("lastCartAt", "in_last", 7, { unit: "days" })),
  "lastCartAt empty":         all(R("lastCartAt", "empty", null)),
  "aov > 50":                 all(R("aov", "gt", 50)),
  "aov between":              all(R("aov", "between", [5, 100])),
  "openRate < 20":            all(R("openRate", "lt", 20)),
  "lapsed template":          all(R("emailsSent", "gt", 0), R("lastEmailOpenedAt", "more_than", 90, { unit: "days" })),
  "AND across families":      all(R("lifecycleStage", "is", "at_risk"), R("cartAbandonCount", "gt", 0)),
  "OR across families":       any(R("lifecycleStage", "is", "new"), R("aov", "gt", 50)),
  "nested":                   all(R("lifecycleStage", "is_not", "new"), any(R("hasActiveCart", "is_true", true), R("aov", "gt", 100))),
};

test("SQL and JS matchers agree on every rule shape", async (t) => {
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.createMany({
    data: FIXTURES.map((f) => ({
      shop: SHOP,
      email: `${f.key}@parity.test`,
      firstSeenAt: f.firstSeenAt,
      lastSeenAt: f.lastSeenAt,
      lastOrderAt: f.lastOrderAt ?? null,
      lastCartAt: f.lastCartAt ?? null,
      cartAbandonCount: f.cartAbandonCount ?? 0,
      lastCartValue: f.lastCartValue ?? 0,
      orderCount: f.orderCount ?? 0,
      totalSpent: f.totalSpent ?? 0,
      aov: f.aov ?? 0,
      emailsSent: f.emailsSent ?? 0,
      emailsOpened: f.emailsOpened ?? 0,
      openRate: f.openRate ?? 0,
      lastEmailOpenedAt: f.lastEmailOpenedAt ?? null,
    })),
  });

  t.after(async () => {
    await prisma.contact.deleteMany({ where: { shop: SHOP } });
    await prisma.$disconnect();
  });

  const contacts = await prisma.contact.findMany({
    where: { shop: SHOP, deletedAt: null },
    include: { tags: { select: { tagId: true } } },
  });
  assert.equal(contacts.length, FIXTURES.length, "fixtures did not all insert");

  for (const [name, tree] of Object.entries(CASES)) {
    const sql = await evaluateSegment(SHOP, { kind: "dynamic", filterTree: tree }, { sampleSize: 0 });
    const js = contacts.filter((c) =>
      evalTreeForContact(tree, { contact: c, stats: {}, lifecycle: null }),
    ).length;
    assert.equal(sql.count, js, `${name}: SQL counted ${sql.count}, JS counted ${js}`);
  }
});

test("the four lifecycle stages partition the audience exactly", async (t) => {
  // Not implied by the parity test above: SQL and JS could agree and both be
  // wrong, double-counting a contact or losing one between stages. This asserts
  // the stages sum to the whole, which is what catches a boundary written as
  // `<` where it should be `<=`.
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.createMany({
    data: FIXTURES.map((f) => ({
      shop: SHOP,
      email: `${f.key}@parity.test`,
      firstSeenAt: f.firstSeenAt,
      lastSeenAt: f.lastSeenAt,
      lastOrderAt: f.lastOrderAt ?? null,
      lastCartAt: f.lastCartAt ?? null,
    })),
  });
  t.after(async () => {
    await prisma.contact.deleteMany({ where: { shop: SHOP } });
    await prisma.$disconnect();
  });

  const counts = {};
  for (const stage of ["new", "active", "at_risk", "churned"]) {
    const r = await evaluateSegment(
      SHOP,
      { kind: "dynamic", filterTree: all(R("lifecycleStage", "is", stage)) },
      { sampleSize: 0 },
    );
    counts[stage] = r.count;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, FIXTURES.length, `stages summed to ${total}, expected ${FIXTURES.length}: ${JSON.stringify(counts)}`);
});

test("a contact with no order or cart history still reaches at_risk and churned", async (t) => {
  // The regression this file exists for. Both fixtures have NULL lastOrderAt and
  // NULL lastCartAt, which is the ordinary shape for an email subscriber who has
  // never bought — the bulk of most lists. Under a bare NOT they matched nothing.
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.createMany({
    data: [
      { shop: SHOP, email: "atrisk@parity.test",  firstSeenAt: ago(200), lastSeenAt: ago(60) },
      { shop: SHOP, email: "churned@parity.test", firstSeenAt: ago(400), lastSeenAt: ago(300) },
    ],
  });
  t.after(async () => {
    await prisma.contact.deleteMany({ where: { shop: SHOP } });
    await prisma.$disconnect();
  });

  const countOf = async (stage) =>
    (await evaluateSegment(SHOP, { kind: "dynamic", filterTree: all(R("lifecycleStage", "is", stage)) }, { sampleSize: 0 })).count;

  assert.equal(await countOf("at_risk"), 1);
  assert.equal(await countOf("churned"), 1);
  assert.equal(await countOf("active"), 0);
});
