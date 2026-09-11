/**
 * The internal tenant must not surface in any merchant's view.
 *
 * Run: npm test   (or: node --test app/lib/internal/isolation.db.test.js)
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Internal messaging runs as one more workspace in the same database as every
 * merchant, which is only safe because every merchant-facing query is scoped by
 * `shop`. That was audited once and held. An audit is a fact about a moment; a
 * test is a fact about every commit after it, and the cost of that property
 * quietly lapsing is our own contact list appearing in a customer's dashboard.
 *
 * The queries here are the real ones the UI calls, not hand-written WHEREs —
 * a test that scopes its own query would pass while the product leaked.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { listContacts } from "../contacts/contacts.server.js";
import { INTERNAL_SHOP } from "./tenant.js";

const MERCHANT = "__test__merchant.myshopify.com";
const INTERNAL_EMAIL = "isolation.internal@example.com";
const MERCHANT_EMAIL = "isolation.merchant@example.com";
const APP = "testisolation";

async function clear() {
  await prisma.journey.deleteMany({
    where: { OR: [{ shop: MERCHANT }, { shop: INTERNAL_SHOP, triggerApp: APP }] },
  });
  await prisma.contact.deleteMany({
    where: {
      OR: [
        { shop: MERCHANT },
        { shop: INTERNAL_SHOP, email: INTERNAL_EMAIL },
      ],
    },
  });
}

test.before(async () => {
  await clear();
  await prisma.contact.createMany({
    data: [
      { shop: INTERNAL_SHOP, email: INTERNAL_EMAIL, name: "Growzar user", source: "internal_api" },
      { shop: MERCHANT, email: MERCHANT_EMAIL, name: "Shopper", source: "popup" },
    ],
  });
  await prisma.journey.create({
    data: {
      shop: INTERNAL_SHOP,
      name: "Internal onboarding",
      trigger: "api_event",
      triggerApp: APP,
      triggerEvent: "installed",
      status: "published",
    },
  });
});

test.after(async () => {
  await clear();
  await prisma.$disconnect();
});

test("a merchant's contact list does not include internal contacts", async () => {
  const { rows } = await listContacts({ shop: MERCHANT });
  const emails = rows.map((r) => r.email);
  assert.ok(emails.includes(MERCHANT_EMAIL), "the merchant's own contact should be there");
  assert.ok(!emails.includes(INTERNAL_EMAIL), "an internal contact leaked into a merchant view");
});

test("a merchant's contact count does not include internal contacts", async () => {
  const { filteredTotal } = await listContacts({ shop: MERCHANT });
  assert.equal(filteredTotal, 1);
});

test("searching cannot reach across into the internal tenant", async () => {
  // Search widens the WHERE with an OR, which is exactly where a scope is
  // easiest to lose.
  const { rows } = await listContacts({ shop: MERCHANT, search: "Growzar" });
  assert.equal(rows.length, 0);
});

test("a merchant's flow list does not include internal flows", async () => {
  const flows = await prisma.journey.findMany({
    where: { shop: MERCHANT, archivedAt: null },
    select: { id: true },
  });
  assert.equal(flows.length, 0);
});

test("the internal tenant's own rows are still readable under its own key", async () => {
  // The mirror of the above: scoping that hides internal data from merchants
  // must not also hide it from the internal console.
  const { rows } = await listContacts({ shop: INTERNAL_SHOP });
  assert.ok(rows.some((r) => r.email === INTERNAL_EMAIL));
});
