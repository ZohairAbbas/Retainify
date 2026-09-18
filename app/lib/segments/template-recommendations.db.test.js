/**
 * Segment template counts and recommendations, against a real database.
 *
 * Run: npm test   (or: node --test app/lib/segments/template-recommendations.db.test.js)
 *
 * Every template must compile to SQL (a template that throws would lose its
 * count silently in the gallery), and "Recommended" must never point at a
 * template that matches nobody or one the merchant has already saved.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { TEMPLATES } from "./fields.server.js";
import { countSegmentTree } from "./evaluator.server.js";
import { segmentTemplatesWithCounts } from "./templateRecommendations.server.js";

const SHOP = "__test__segment-templates.myshopify.com";
const DAY = 24 * 60 * 60 * 1000;

async function reset() {
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
}

test.before(async () => {
  await reset();
  const now = Date.now();
  await prisma.contact.createMany({
    data: [
      { shop: SHOP, email: "repeat@example.com", orderCount: 3, totalSpent: 400, lastOrderAt: new Date(now - 2 * DAY) },
      { shop: SHOP, email: "cart@example.com", lastCartAt: new Date(now - DAY) },
      { shop: SHOP, email: "quiet@example.com" },
    ],
  });
});
test.after(async () => {
  await reset();
  await prisma.$disconnect();
});

test("every template compiles to a count", async () => {
  for (const t of TEMPLATES) {
    const n = await countSegmentTree(SHOP, t.rules);
    assert.equal(typeof n, "number", t.id);
  }
});

test("recommended templates match someone and aren't already saved", async () => {
  const list = await segmentTemplatesWithCounts(SHOP, { isShopify: true, savedNames: ["Big spenders"] });
  const rec = list.filter((t) => t.recommended);
  assert.ok(rec.length > 0 && rec.length <= 3);
  for (const t of rec) {
    assert.ok(t.count > 0, `${t.id} matches nobody`);
    assert.equal(t.alreadySaved, false, t.id);
  }
  assert.equal(list.find((t) => t.id === "tpl_bigspend")?.recommended, false);
  assert.equal(list.find((t) => t.id === "tpl_bigspend")?.alreadySaved, true);
  // Recommended cards lead the list.
  assert.deepEqual(list.slice(0, rec.length).map((t) => t.id), rec.map((t) => t.id));
});

test("an empty workspace gets counts of zero and no recommendations", async () => {
  const list = await segmentTemplatesWithCounts("__test__nobody.myshopify.com", { isShopify: true });
  assert.ok(list.length > 0);
  assert.ok(list.every((t) => t.count === 0 && !t.recommended));
});
