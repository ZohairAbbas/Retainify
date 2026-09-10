/**
 * Shop-health verdicts for workspaces that are not Shopify installs.
 *
 * Run: npm test   (or: node --test app/lib/shopify/shop-health.db.test.js)
 *
 * ── Why this needs a database ──────────────────────────────────────────────
 * The behaviour under test is a branch on Account.kind, read through prisma.
 * Mocking that away would leave the test asserting what the mock was told to
 * return — which is exactly the assumption that was wrong before this branch
 * existed.
 *
 * ── What was wrong before ──────────────────────────────────────────────────
 * checkShopHealth() read "no offline session" as SHOP_UNINSTALLED. That is
 * right for a Shopify shop and wrong for a direct workspace, which never had a
 * session to lose. The workers act on the verdict by calling stopShopSending(),
 * so every direct workspace had its whole queue cancelled and every published
 * flow paused on the first tick after it queued anything.
 *
 * Every case here stops before rawProbe(): a shop with no offline session is
 * settled locally, so none of these tests reach the network.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import {
  checkShopHealth,
  forgetShopHealth,
  SHOP_LIVE,
  SHOP_UNINSTALLED,
} from "./shop-health.server.js";

const DIRECT = "__test__direct_workspace";
const SHOPIFY = "__test__shop.myshopify.com";
const UNKNOWN_KEY = "__test__no_account_row";

async function clear() {
  await prisma.account.deleteMany({ where: { key: { startsWith: "__test__" } } });
  for (const key of [DIRECT, SHOPIFY, UNKNOWN_KEY]) forgetShopHealth(key);
}

test.before(async () => {
  await clear();
  await prisma.account.createMany({
    data: [
      { key: DIRECT, name: "Test direct workspace", kind: "direct" },
      { key: SHOPIFY, name: "Test shopify shop", kind: "shopify" },
    ],
  });
});

test.after(async () => {
  await clear();
  await prisma.$disconnect();
});

test("a direct workspace is live despite having no offline session", async () => {
  forgetShopHealth(DIRECT);
  assert.equal(await checkShopHealth(DIRECT), SHOP_LIVE);
});

test("a shopify shop with no offline session is still condemned", async () => {
  // The safety property the module exists for. If this ever returns SHOP_LIVE,
  // an uninstalled merchant's queue drains to their customers.
  forgetShopHealth(SHOPIFY);
  assert.equal(await checkShopHealth(SHOPIFY), SHOP_UNINSTALLED);
});

test("an unrecognised key takes the probe path rather than being assumed live", async () => {
  // A Shopify shop not seen since ensureShopifyAccount() shipped has no Account
  // row yet. Guessing "healthy" for a key we cannot identify is the one error
  // this module must never make, so an absent row must not short-circuit.
  forgetShopHealth(UNKNOWN_KEY);
  assert.equal(await checkShopHealth(UNKNOWN_KEY), SHOP_UNINSTALLED);
});

test("the non-shopify verdict is cached rather than re-read per call", async () => {
  forgetShopHealth(DIRECT);
  assert.equal(await checkShopHealth(DIRECT), SHOP_LIVE);

  // Delete the row the verdict was derived from. A cached answer survives it;
  // a per-call lookup would fall through to the probe path and condemn the
  // workspace, which is what the worker's per-job call pattern would hit.
  await prisma.account.deleteMany({ where: { key: DIRECT } });
  assert.equal(await checkShopHealth(DIRECT), SHOP_LIVE);

  await prisma.account.create({
    data: { key: DIRECT, name: "Test direct workspace", kind: "direct" },
  });
});
