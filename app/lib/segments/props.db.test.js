/**
 * SQL-vs-JS parity for custom property rules ("prop:<key>").
 *
 * Run: npm test   (or: node --test app/lib/segments/props.db.test.js)
 *
 * Same reason evaluator.db.test.js exists: the two matchers must agree, and
 * the disagreements that matter live in SQL. Here the trap is a missing key —
 * Postgres answers any comparison against it with NULL, so a bare NOT drops
 * every contact without the property from "is not" and "is false" rules. The
 * fixtures deliberately include a contact with no properties at all, one with
 * an empty bag, and one with an explicit JSON null.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { evaluateSegment, evalTreeForContact, validateFilterTree } from "./evaluator.server.js";
import { fieldsFor, propertyFields } from "./fields.server.js";

const SHOP = "__test__props-parity.myshopify.com";
const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();

const FIXTURES = [
  { key: "pro-heavy",  props: { plan: "pro",  usage: 95, active: true,  last: iso(2),   note: "Big Store" } },
  { key: "free-light", props: { plan: "free", usage: 10, active: false, last: iso(40),  note: "small" } },
  { key: "starter",    props: { plan: "starter", usage: 80, last: iso(10) } },
  { key: "empty-bag",  props: {} },
  { key: "no-bag",     props: undefined },
  { key: "json-null",  props: { plan: null } },
];

const RULES = [
  ["plan is pro",              { field: "prop:plan", op: "is", value: "pro" }],
  ["plan is not pro",          { field: "prop:plan", op: "is_not", value: "pro" }],
  ["plan is one of",           { field: "prop:plan", op: "is_one_of", value: ["pro", "starter"] }],
  ["plan is empty",            { field: "prop:plan", op: "empty" }],
  ["note contains (any case)", { field: "prop:note", op: "contains", value: "STORE" }],
  ["usage > 79",               { field: "prop:usage", op: "gt", value: 79 }],
  ["usage < 50",               { field: "prop:usage", op: "lt", value: 50 }],
  ["usage = 80",               { field: "prop:usage", op: "eq", value: 80 }],
  ["usage between",            { field: "prop:usage", op: "between", value: [50, 90] }],
  ["active is true",           { field: "prop:active", op: "is_true" }],
  ["active is false",          { field: "prop:active", op: "is_false" }],
  ["last in last 14 days",     { field: "prop:last", op: "in_last", value: 14, unit: "days" }],
  ["last more than 30 days",   { field: "prop:last", op: "more_than", value: 30, unit: "days" }],
  ["last after a date",        { field: "prop:last", op: "after", value: iso(20).slice(0, 10) }],
  ["last before a date",       { field: "prop:last", op: "before", value: iso(20).slice(0, 10) }],
  ["deleted def: unknown key", { field: "prop:gone", op: "is", value: "x" }],
];

const EXPECTED = {
  "plan is pro": ["pro-heavy"],
  "plan is not pro": ["free-light", "starter", "empty-bag", "no-bag", "json-null"],
  "plan is one of": ["pro-heavy", "starter"],
  "plan is empty": ["empty-bag", "no-bag", "json-null"],
  "note contains (any case)": ["pro-heavy"],
  "usage > 79": ["pro-heavy", "starter"],
  "usage < 50": ["free-light"],
  "usage = 80": ["starter"],
  "usage between": ["starter"],
  "active is true": ["pro-heavy"],
  "active is false": ["free-light", "starter", "empty-bag", "no-bag", "json-null"],
  "last in last 14 days": ["pro-heavy", "starter"],
  "last more than 30 days": ["free-light"],
  "last after a date": ["pro-heavy", "starter"],
  "last before a date": ["free-light"],
  "deleted def: unknown key": [],
};

const emailOf = (key) => `${key}@props.test`;
const keyOf = (email) => email.split("@")[0];

test.before(async () => {
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  for (const f of FIXTURES) {
    await prisma.contact.create({
      data: { shop: SHOP, email: emailOf(f.key), ...(f.props === undefined ? {} : { customProps: f.props }) },
    });
  }
});

test.after(async () => {
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.$disconnect();
});

for (const [name, rule] of RULES) {
  test(`prop rule parity: ${name}`, async () => {
    const tree = { type: "group", match: "all", children: [{ type: "rule", ...rule }] };
    validateFilterTree(tree);

    const { matchedIds } = await evaluateSegment(SHOP, { kind: "dynamic", filterTree: tree }, { returnIds: true });
    const rows = await prisma.contact.findMany({ where: { id: { in: matchedIds } }, select: { email: true } });
    const sql = rows.map((r) => keyOf(r.email)).sort();

    const all = await prisma.contact.findMany({ where: { shop: SHOP } });
    const js = all.filter((c) => evalTreeForContact(tree, { contact: c })).map((c) => keyOf(c.email)).sort();

    assert.deepEqual(sql, [...EXPECTED[name]].sort(), `SQL disagrees with expectation for "${name}"`);
    assert.deepEqual(js, sql, `JS and SQL disagree for "${name}"`);
  });
}

test("property definitions become builder fields with the right types", () => {
  const fields = propertyFields([
    { key: "plan", label: "Plan", type: "select", options: ["free", "pro"] },
    { key: "usage", label: "Usage", type: "number" },
    { key: "note", label: "Note", type: "text" },
    { key: "Bad Key", label: "x", type: "text" },
  ]);
  assert.deepEqual(fields.map((f) => [f.id, f.type]), [["prop:plan", "enum"], ["prop:usage", "number"], ["prop:note", "string"]]);
  assert.deepEqual(fields[0].options, [{ id: "free", label: "free" }, { id: "pro", label: "pro" }]);
  assert.ok(fieldsFor(false, [{ key: "plan", label: "Plan", type: "text" }]).some((f) => f.id === "prop:plan"));
});

test("a malformed prop field is still an unknown field", () => {
  assert.throws(() => validateFilterTree({ type: "group", match: "all", children: [{ type: "rule", field: "prop:Bad Key", op: "is", value: "x" }] }));
});
