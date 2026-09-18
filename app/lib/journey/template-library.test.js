/**
 * The flow template library: what each kind of workspace is offered, and what
 * gets recommended.
 *
 * Run: npm test   (or: node --test app/lib/journey/template-library.test.js)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  FLOW_TEMPLATES,
  TEMPLATE_CATEGORIES,
  templateAvailable,
  templateChannels,
  recommendTemplates,
} from "./template-library.js";

const SHOPIFY = { isShopify: true, isInternal: false };
const DIRECT = { isShopify: false, isInternal: false };
const INTERNAL = { isShopify: false, isInternal: true };
const COMMERCE = new Set(["cart_abandoned", "order_placed", "win_back", "customer_created"]);
const STEP_TYPES = new Set(["email", "delay", "whatsapp", "push", "exit"]);
const offered = (ws) => FLOW_TEMPLATES.filter((t) => templateAvailable(t, ws));
const base = { existing: [], whatsappReady: false, pushSubscribers: 0, orders: 0, carts: 0, contacts: 0 };

test("every template is well formed", () => {
  const keys = new Set();
  const categories = new Set(TEMPLATE_CATEGORIES.map((c) => c.id));
  for (const t of FLOW_TEMPLATES) {
    assert.ok(!keys.has(t.key), `duplicate key ${t.key}`);
    keys.add(t.key);
    assert.ok(t.name && t.description, `${t.key} needs a name and description`);
    assert.ok(categories.has(t.category), `${t.key} has unknown category ${t.category}`);
    const steps = t.definition?.steps || [];
    assert.ok(steps.some((s) => ["email", "whatsapp", "push"].includes(s.nodeType)), `${t.key} sends nothing`);
    for (const s of steps) assert.ok(STEP_TYPES.has(s.nodeType), `${t.key} has step ${s.nodeType}`);
    if (t.trigger === "api_event") assert.ok(t.triggerApp && t.triggerEvent, `${t.key} api_event needs app+event`);
    if (templateChannels(t).includes("push")) assert.ok((t.requires || []).includes("push"), `${t.key} sends push but doesn't require it`);
    if (templateChannels(t).includes("whatsapp")) assert.ok((t.requires || []).includes("whatsapp"), `${t.key} sends WhatsApp but doesn't require it`);
  }
});

test("a direct workspace is never offered a commerce trigger or push", () => {
  const list = offered(DIRECT);
  assert.ok(list.length > 0, "direct workspaces get templates");
  for (const t of list) {
    assert.ok(!COMMERCE.has(t.trigger), `${t.key} uses ${t.trigger}`);
    assert.ok(!templateChannels(t).includes("push"), `${t.key} sends push`);
    assert.notEqual(t.trigger, "api_event", `${t.key} is internal-only`);
  }
});

test("app-lifecycle templates are only for Growzar Internal", () => {
  for (const t of FLOW_TEMPLATES.filter((x) => x.trigger === "api_event")) {
    assert.equal(templateAvailable(t, SHOPIFY), false, t.key);
    assert.equal(templateAvailable(t, DIRECT), false, t.key);
    assert.equal(templateAvailable(t, INTERNAL), true, t.key);
  }
  for (const t of offered(INTERNAL)) assert.ok(!COMMERCE.has(t.trigger), `${t.key} uses ${t.trigger}`);
});

test("every kind of workspace has something in each of its categories", () => {
  for (const [ws, n] of [[SHOPIFY, 10], [DIRECT, 4], [INTERNAL, 8]]) {
    assert.ok(offered(ws).length >= n, `expected at least ${n}, got ${offered(ws).length}`);
  }
});

test("recommendations skip triggers that already have a flow", () => {
  const list = offered(SHOPIFY);
  const recs = recommendTemplates(list, { ...base, existing: [{ trigger: "cart_abandoned" }], carts: 5 });
  const byKey = Object.fromEntries(list.map((t) => [t.key, t]));
  for (const r of recs) assert.notEqual(byKey[r.key].trigger, "cart_abandoned");
});

test("at most one recommendation per trigger, and never more than the limit", () => {
  const list = offered(SHOPIFY);
  const recs = recommendTemplates(list, { ...base, whatsappReady: true, pushSubscribers: 3 }, 10);
  const byKey = Object.fromEntries(list.map((t) => [t.key, t]));
  const cover = recs.map((r) => {
    const t = byKey[r.key];
    return `${t.trigger}|${t.triggerSegmentKey || ""}|${t.triggerEvent || ""}`;
  });
  assert.equal(new Set(cover).size, cover.length);
  assert.equal(recommendTemplates(list, base).length <= 3, true);
});

test("segment flows on different segments don't cover each other", () => {
  const list = offered(SHOPIFY);
  const byKey = Object.fromEntries(list.map((t) => [t.key, t]));
  const recs = recommendTemplates(
    list,
    { ...base, existing: [{ trigger: "segment_entered", triggerSegmentKey: "sys_atrisk" }] },
    20,
  );
  const segs = recs.map((r) => byKey[r.key]).filter((t) => t.trigger === "segment_entered").map((t) => t.triggerSegmentKey);
  assert.ok(!segs.includes("sys_atrisk"), "at-risk is covered");
  assert.ok(segs.includes("sys_churned"), "churned is still suggested");
});

test("WhatsApp and push templates are recommended only when they can send", () => {
  const list = offered(SHOPIFY);
  const byKey = Object.fromEntries(list.map((t) => [t.key, t]));
  const uses = (recs, ch) => recs.some((r) => templateChannels(byKey[r.key]).includes(ch));
  assert.equal(uses(recommendTemplates(list, base, 20), "whatsapp"), false);
  assert.equal(uses(recommendTemplates(list, base, 20), "push"), false);
  const everything = recommendTemplates(list, { ...base, whatsappReady: true, pushSubscribers: 1 }, 50);
  assert.ok(everything.every((r) => typeof r.reason === "string" && r.reason.length > 0));
});

test("internal recommendations follow app events and ignore other apps' flows", () => {
  const list = offered(INTERNAL);
  const recs = recommendTemplates(list, { ...base, existing: [{ trigger: "api_event", triggerApp: "courierify", triggerEvent: "installed" }] }, 20);
  const byKey = Object.fromEntries(list.map((t) => [t.key, t]));
  assert.ok(!recs.some((r) => byKey[r.key].triggerEvent === "installed"));
  const other = recommendTemplates(list, { ...base, existing: [{ trigger: "api_event", triggerApp: "financify", triggerEvent: "installed" }] }, 20);
  assert.ok(other.some((r) => byKey[r.key].triggerEvent === "installed"));
});
