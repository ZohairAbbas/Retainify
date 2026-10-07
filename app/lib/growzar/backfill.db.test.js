/**
 * The Phase 5 one-off fills (acceptance 3): a local and an international
 * spelling of one made-up number land on the same E.164, a number that does not
 * parse stays null, and a second run writes nothing.
 */
import "../../test-support/db-guard.js";
import test from "node:test";
import assert from "node:assert/strict";

const { default: prisma } = await import("../../db.server.js");
const { backfillPhones, backfillConsentBaseline, shopifyShops } = await import("./backfill.server.js");

const SHOP = "retainify-test-g5backfill.myshopify.com";

async function cleanup() {
  await prisma.consentEvent.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.pushSubscription.deleteMany({ where: { shop: SHOP } });
  await prisma.account.deleteMany({ where: { key: SHOP } });
}

test.beforeEach(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("03xx and +923xx for the same buyer get the same phone; the second run writes 0", async () => {
  // As the rows sit in production today: digits only, phoneE164 null.
  await prisma.contact.createMany({
    data: [
      { shop: SHOP, email: "p1@example.test", phone: "03001234567" },
      { shop: SHOP, email: "p2@example.test", phone: "923001234567" },
      { shop: SHOP, email: "p3@example.test", phone: "12345" },
      { shop: SHOP, email: "p4@example.test" },
    ],
  });
  const dry = await backfillPhones(SHOP, { apply: false, country: "PK" });
  assert.deepEqual(
    { candidates: dry.candidates, normalized: dry.normalized, unparseable: dry.unparseable, written: dry.written },
    { candidates: 3, normalized: 2, unparseable: 1, written: 0 },
  );
  assert.equal(await prisma.contact.count({ where: { shop: SHOP, phoneE164: { not: null } } }), 0, "dry run writes nothing");

  const first = await backfillPhones(SHOP, { apply: true, country: "PK" });
  assert.equal(first.written, 2);
  const rows = await prisma.contact.findMany({ where: { shop: SHOP, phone: { in: ["03001234567", "923001234567"] } } });
  assert.deepEqual([...new Set(rows.map((r) => r.phoneE164))], ["+923001234567"]);

  const second = await backfillPhones(SHOP, { apply: true, country: "PK" });
  assert.equal(second.written, 0);
  assert.equal(second.unparseable, 1, "the bad number is counted again, and still not guessed");
});

test("the consent baseline is one row per contact and channel, holding today's state, once", async () => {
  const a = await prisma.contact.create({ data: { shop: SHOP, email: "b1@example.test", subscriptionStatus: "subscribed", pushEnabled: true } });
  const b = await prisma.contact.create({ data: { shop: SHOP, email: "b2@example.test" } });
  await prisma.pushSubscription.create({
    data: { shop: SHOP, endpoint: "https://push.example.test/b2", p256dh: "x", auth: "y", contactEmail: "b2@example.test", isActive: false },
  });

  assert.deepEqual(await backfillConsentBaseline(SHOP, { apply: false }), { shop: SHOP, email: 2, whatsapp: 2, push: 2 });
  assert.deepEqual(await backfillConsentBaseline(SHOP, { apply: true }), { shop: SHOP, email: 2, whatsapp: 2, push: 2 });
  assert.deepEqual(await backfillConsentBaseline(SHOP, { apply: true }), { shop: SHOP, email: 0, whatsapp: 0, push: 0 });

  const base = async (id) =>
    Object.fromEntries(
      (await prisma.consentEvent.findMany({ where: { contactId: id, source: "baseline" } })).map((e) => [e.channel, [e.from, e.to, e.reason]]),
    );
  assert.deepEqual(await base(a.id), {
    email: ["subscribed", "subscribed", null],
    whatsapp: ["never_opted_in", "never_opted_in", null],
    push: ["subscribed", "subscribed", null],
  });
  assert.deepEqual((await base(b.id)).push, ["unsubscribed", "unsubscribed", null]);
});

test("shops are every myshopify shop with contacts, with or without an Account row, never a direct one", async () => {
  await prisma.contact.create({ data: { shop: SHOP, email: "s@example.test" } });
  assert.deepEqual(await shopifyShops(SHOP), [SHOP], "no Account row, as five live installs have");
  await prisma.account.create({ data: { key: SHOP, name: "T", kind: "shopify" } });
  assert.deepEqual(await shopifyShops(SHOP), [SHOP]);
  await prisma.account.update({ where: { key: SHOP }, data: { kind: "direct" } });
  assert.deepEqual(await shopifyShops(SHOP), []);
});
