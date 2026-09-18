/**
 * Segment starter templates: every rule resolves, and each workspace is only
 * offered templates whose fields it actually has.
 *
 * Run: npm test   (or: node --test app/lib/segments/templates.test.js)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { TEMPLATES, templatesFor, fieldsFor } from "./fields.server.js";
import { validateFilterTree } from "./evaluator.server.js";

const M360_DEFS = [
  { key: "courierify_plan", type: "select", options: ["free", "starter", "pro", "growzar"] },
  { key: "courierify_status", type: "select", options: ["active", "uninstalled"] },
  { key: "courierify_usage_pct", type: "number" },
  { key: "courierify_first_booking_at", type: "date" },
  { key: "courierify_last_booking_at", type: "date" },
  { key: "courierify_courier_connected", type: "boolean" },
];
const fieldsOf = (node) => (node.type === "group" ? (node.children || []).flatMap(fieldsOf) : [node.field]);

test("template ids are unique and every rule tree validates", () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of TEMPLATES) assert.doesNotThrow(() => validateFilterTree(t.rules), t.id);
});

test("each workspace is only offered templates built on its own fields", () => {
  for (const [isShopify, defs] of [[true, []], [false, []], [false, M360_DEFS]]) {
    const allowed = new Set(fieldsFor(isShopify, defs).map((f) => f.id));
    for (const t of templatesFor(isShopify, defs)) {
      for (const f of fieldsOf(t.rules)) assert.ok(allowed.has(f), `${t.id} uses ${f}`);
    }
  }
});

test("a direct workspace gets no commerce or push templates", () => {
  const ids = templatesFor(false).map((t) => t.id);
  assert.ok(ids.length >= 5);
  for (const id of ["tpl_bigspend", "tpl_cart", "tpl_push", "tpl_repeat"]) assert.ok(!ids.includes(id), id);
});

test("Merchant360 templates appear only once their properties are synced", () => {
  assert.ok(!templatesFor(false).some((t) => t.id.startsWith("tpl_m360_")));
  const withProps = templatesFor(false, M360_DEFS).filter((t) => t.id.startsWith("tpl_m360_"));
  assert.equal(withProps.length, TEMPLATES.filter((t) => t.id.startsWith("tpl_m360_")).length);
});
