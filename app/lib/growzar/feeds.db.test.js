/**
 * Growzar read feeds (Phase 5), end to end through the route loaders.
 *
 * Made-up shop, addresses and numbers only (pack rule 5). The shop must pass
 * the myshopify check, so it cannot carry the usual "__test__" prefix; every
 * row is scoped to it and removed afterwards.
 */
import "../../test-support/db-guard.js";
import test from "node:test";
import assert from "node:assert/strict";

const KEY = "pk_test_g5_0123456789abcdefghijkl";
const SECRET = "whsec_test_g5_0123456789abcdefghijkl";
process.env.GROWZAR_PLATFORM_KEY = KEY;
process.env.GROWZAR_SIGNING_SECRET = SECRET;

const { default: prisma } = await import("../../db.server.js");
const { sign, signingPayload } = await import("./signing.js");
const { decodeCursor, money, parseFeedQuery } = await import("./feed.server.js");
const { recordCustomerTombstones } = await import("./tombstones.server.js");
const { GROWZAR_CAPABILITIES } = await import("./capabilities.js");
const { redactCustomer } = await import("../privacy/gdpr.server.js");
const routes = {
  messages: (await import("../../routes/api.v1.growzar.messages.js")).loader,
  journeys: (await import("../../routes/api.v1.growzar.journeys.js")).loader,
  enrollments: (await import("../../routes/api.v1.growzar.enrollments.js")).loader,
  checkouts: (await import("../../routes/api.v1.growzar.checkouts.js")).loader,
  consent: (await import("../../routes/api.v1.growzar.consent.js")).loader,
  "consent-events": (await import("../../routes/api.v1.growzar.consent-events.js")).loader,
};

const SHOP = "retainify-test-g5feeds.myshopify.com";
const DIRECT = "retainify-test-g5direct.myshopify.com";
const EMAIL = "g5.buyer@example.test";

function request(feed, query = "", { shop = SHOP, signed = true } = {}) {
  const path = `/api/v1/growzar/${feed}${query ? `?${query}` : ""}`;
  const headers = new Headers({ Authorization: `Bearer ${KEY}`, "X-Growzar-Shop": shop });
  if (signed) {
    const ts = Date.now();
    headers.set("X-Growzar-Timestamp", String(ts));
    headers.set("X-Growzar-Signature", sign(SECRET, signingPayload({ timestamp: ts, method: "GET", pathWithQuery: path, body: "" })));
  }
  return new Request(`https://retainify.test${path}`, { method: "GET", headers });
}

async function get(feed, query, opts) {
  const res = await routes[feed]({ request: request(feed, query, opts) });
  return { status: res.status, body: await res.json() };
}

async function cleanup() {
  for (const shop of [SHOP, DIRECT]) {
    await prisma.journey.deleteMany({ where: { shop } });
    await prisma.abandonedCart.deleteMany({ where: { shop } });
    await prisma.consentEvent.deleteMany({ where: { shop } });
    await prisma.contact.deleteMany({ where: { shop } });
    await prisma.growzarTombstone.deleteMany({ where: { shop } });
    await prisma.whatsappSuppression.deleteMany({ where: { shop } });
    await prisma.emailSuppression.deleteMany({ where: { shop } });
    await prisma.session.deleteMany({ where: { shop } });
    await prisma.account.deleteMany({ where: { key: shop } });
    await prisma.shopSettings.deleteMany({ where: { shop } });
  }
}

async function seedShop(shop = SHOP, kind = "shopify") {
  await prisma.account.create({ data: { key: shop, name: "Test", kind } });
  await prisma.session.create({
    data: { id: `offline_${shop}`, shop, state: "test", isOnline: false, accessToken: "test-token" },
  });
  // Fresh facts, so no feed call tries to reach Shopify.
  await prisma.shopSettings.create({
    data: { shop, shopifyCountry: "PK", shopifyCurrency: "PKR", shopifyTimezone: "Asia/Karachi", shopifyFactsAt: new Date() },
  });
}

/** One journey and enrollment with `email` jobs and `push` jobs on it. */
async function seedMessages({ email = 0, push = 0, whatsapp = 0 } = {}) {
  const journey = await prisma.journey.create({ data: { shop: SHOP, name: "Cart flow", trigger: "cart_abandoned", status: "published" } });
  const step = await prisma.journeyStep.create({ data: { journeyId: journey.id, stepNumber: 1 } });
  const enrollment = await prisma.journeyEnrollment.create({
    data: { shop: SHOP, journeyId: journey.id, contactEmail: EMAIL, payload: JSON.stringify({ checkoutToken: "tok_g5_1" }) },
  });
  const base = { shop: SHOP, enrollmentId: enrollment.id, stepId: step.id, scheduledFor: new Date() };
  for (let i = 0; i < email; i++) await prisma.journeyJob.create({ data: { ...base, status: "done", sentAt: new Date() } });
  for (let i = 0; i < push; i++) await prisma.pushJob.create({ data: { ...base, status: "done", sentAt: new Date() } });
  for (let i = 0; i < whatsapp; i++) await prisma.whatsappJob.create({ data: { ...base, status: "done", templateName: "cart_reminder" } });
  return { journey, enrollment };
}

test.beforeEach(async () => {
  await cleanup();
  await seedShop();
});
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("a signed request gets the envelope with the shop's own country, currency and timezone", async () => {
  for (const feed of ["messages", "journeys", "enrollments", "checkouts", "consent", "consent-events"]) {
    const { status, body } = await get(feed);
    assert.equal(status, 200, feed);
    assert.equal(body.shop, SHOP);
    assert.equal(body.shopCountry, "PK");
    assert.equal(body.shopCurrency, "PKR");
    assert.equal(body.shopTimezone, "Asia/Karachi");
    assert.deepEqual(body.data, []);
    assert.deepEqual(body.pagination, { limit: 200, count: 0, hasMore: false, nextCursor: null });
  }
});

test("unsigned is 401 on every feed", async () => {
  for (const feed of ["messages", "journeys", "enrollments", "checkouts", "consent", "consent-events"]) {
    const { status, body } = await get(feed, "", { signed: false });
    assert.equal(status, 401, feed);
    assert.equal(body.errorType, "unauthorized");
  }
});

test("a direct-workspace account answers shop_not_connected, as does a shop with no install", async () => {
  await seedShop(DIRECT, "direct");
  const direct = await get("checkouts", "", { shop: DIRECT });
  assert.equal(direct.status, 410);
  assert.equal(direct.body.errorType, "shop_not_connected");

  await prisma.session.deleteMany({ where: { shop: SHOP } });
  const gone = await get("consent");
  assert.equal(gone.status, 410);
});

test("status lists every feed as a capability", async () => {
  // The status route itself is .jsx, which node --test cannot import; it
  // returns this list as-is.
  assert.deepEqual([...GROWZAR_CAPABILITIES], ["messages:read", "journeys:read", "enrollments:read", "checkouts:read", "consent:read"]);
});

test("paging /messages with limit=2 across a cluster sharing one updatedAt, spanning channels, returns every row once", async () => {
  await seedMessages({ email: 3, push: 2, whatsapp: 1 });
  const same = new Date("2026-10-01T10:00:00.123Z");
  // Raw SQL, so @updatedAt does not overwrite the shared timestamp.
  for (const table of ["JourneyJob", "PushJob", "WhatsappJob"]) {
    await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "updatedAt" = $1::timestamptz AT TIME ZONE 'UTC' WHERE shop = $2`, same.toISOString(), SHOP);
  }

  const seen = [];
  let cursor = "";
  for (let guard = 0; guard < 10; guard++) {
    const { body } = await get("messages", `limit=2${cursor ? `&cursor=${cursor}` : ""}`);
    seen.push(...body.data.map((r) => r.id));
    for (const r of body.data) assert.equal(r.updatedAt, same.toISOString());
    if (!body.pagination.hasMore) break;
    cursor = body.pagination.nextCursor;
  }
  assert.equal(seen.length, 6, "every row");
  assert.equal(new Set(seen).size, 6, "no row twice");
  assert.deepEqual(new Set(seen.map((id) => id.split(":")[0])), new Set(["email", "push", "whatsapp"]));
  assert.deepEqual(seen, [...seen].sort(), "ordered by prefixed id inside the cluster");
});

test("a message row carries channel-specific nulls, the buyer and the checkout token", async () => {
  await prisma.contact.create({ data: { shop: SHOP, email: EMAIL, phone: "923001234567", phoneE164: "+923001234567" } });
  await seedMessages({ email: 1, whatsapp: 1 });
  const { body } = await get("messages");
  const email = body.data.find((r) => r.channel === "email");
  const wa = body.data.find((r) => r.channel === "whatsapp");
  assert.equal(email.readAt, null);
  assert.equal(email.templateName, null);
  assert.equal(wa.templateName, "cart_reminder");
  assert.equal(wa.openedAt, null);
  assert.deepEqual(email.buyer, { email: EMAIL, phone: "+923001234567", phoneRaw: "923001234567" });
  assert.equal(email.checkoutToken, "tok_g5_1");
  assert.ok(!("subject" in email) && !("lastError" in email));
});

test("deleting the contact strips the buyer from messages and enrollments and moves their updatedAt", async () => {
  await prisma.contact.create({ data: { shop: SHOP, email: EMAIL, phone: "923001234567" } });
  await seedMessages({ email: 1 });
  const before = (await get("enrollments")).body.data[0];
  assert.ok(before.buyer);

  await new Promise((r) => setTimeout(r, 5));
  await prisma.contact.updateMany({ where: { shop: SHOP, email: EMAIL }, data: { deletedAt: new Date() } });

  const after = await get("enrollments", `updatedSince=${encodeURIComponent(before.updatedAt)}`);
  assert.equal(after.body.data.length, 1, "refetched because updatedAt moved");
  assert.equal(after.body.data[0].buyer, null);
  assert.ok(after.body.data[0].updatedAt > before.updatedAt);
  const msg = (await get("messages")).body.data[0];
  assert.equal(msg.buyer, null);

  const consent = await get("consent");
  assert.deepEqual(consent.body.data, []);
  assert.equal(consent.body.deletedContactIds.length, 1);
});

test("GDPR redaction leaves tombstones in every feed it empties", async () => {
  const contact = await prisma.contact.create({ data: { shop: SHOP, email: EMAIL } });
  const { enrollment } = await seedMessages({ email: 1, push: 1 });
  await prisma.abandonedCart.create({
    data: { shop: SHOP, checkoutToken: "tok_g5_gdpr", checkoutId: "1001", customerEmail: EMAIL, totalPrice: 10, currency: "PKR", lineItemsJson: "[]", recoveryUrl: "" },
  });
  await redactCustomer(SHOP, EMAIL);

  const enr = await get("enrollments");
  assert.deepEqual(enr.body.deletedEnrollmentIds, [enrollment.id]);
  assert.equal(enr.body.deletedEnrollmentIdsTruncated, false);
  const msgs = await get("messages");
  assert.equal(msgs.body.deletedMessageIds.length, 2);
  assert.ok(msgs.body.deletedMessageIds.every((id) => /^(email|push):/.test(id)));
  assert.deepEqual((await get("checkouts")).body.deletedCheckoutTokens, ["tok_g5_gdpr"]);
  assert.deepEqual((await get("consent")).body.deletedContactIds, [contact.id]);
  assert.equal(await prisma.consentEvent.count({ where: { contactId: contact.id } }), 0);
});

test("a capped tombstone list says so", async () => {
  await prisma.growzarTombstone.createMany({
    data: Array.from({ length: 1001 }, (_, i) => ({ shop: SHOP, feed: "enrollments", rowId: `gone_${i}` })),
  });
  const { body } = await get("enrollments");
  assert.equal(body.deletedEnrollmentIds.length, 1000);
  assert.equal(body.deletedEnrollmentIdsTruncated, true);
  assert.equal(typeof recordCustomerTombstones, "function");
});

test("journeys: a broadcast is a campaign, everything else a flow", async () => {
  await prisma.journey.create({ data: { shop: SHOP, name: "Sale", trigger: "broadcast", scheduledFor: new Date("2026-10-02T09:00:00Z"), recipientCount: 40 } });
  await prisma.journey.create({ data: { shop: SHOP, name: "Welcome", trigger: "api_event", triggerApp: "financify", triggerEvent: "installed" } });
  const { body } = await get("journeys");
  const sale = body.data.find((j) => j.name === "Sale");
  const welcome = body.data.find((j) => j.name === "Welcome");
  assert.equal(sale.kind, "campaign");
  assert.equal(sale.scheduledFor, "2026-10-02T09:00:00.000Z");
  assert.equal(sale.recipientCount, 40);
  assert.equal(welcome.kind, "flow");
  assert.equal(welcome.triggerApp, "financify");
  assert.equal(welcome.recipientCount, null);
  assert.deepEqual(body.deletedJourneyIds, []);
});

test("checkouts: money in the cart's currency, null when unknown, never USD by default", async () => {
  await prisma.abandonedCart.create({
    data: {
      shop: SHOP, checkoutToken: "tok_pkr", checkoutId: "2001", customerEmail: "", phone: "0300 1234567", phoneE164: "+923001234567",
      totalPrice: 1250.005, currency: "PKR", recoveryUrl: "",
      lineItemsJson: JSON.stringify([{ title: "Kettle", quantity: 1, price: "1250.00", variantId: "4001", productId: "3001" }]),
    },
  });
  await prisma.abandonedCart.create({
    data: { shop: SHOP, checkoutToken: "tok_none", checkoutId: "2002", customerEmail: EMAIL, totalPrice: 5, currency: null, recoveryUrl: "", lineItemsJson: "[]" },
  });
  const { body } = await get("checkouts");
  const pkr = body.data.find((c) => c.checkoutToken === "tok_pkr");
  const none = body.data.find((c) => c.checkoutToken === "tok_none");
  assert.deepEqual(pkr.total, { amount: "1250.01", currency: "PKR" });
  assert.deepEqual(pkr.lines[0], { variantId: "4001", productId: "3001", title: "Kettle", variantTitle: null, quantity: 1, price: { amount: "1250.00", currency: "PKR" } });
  assert.deepEqual(pkr.buyer, { email: null, phone: "+923001234567", phoneRaw: "0300 1234567" }, "phone-only cart joins by phone");
  assert.equal(pkr.checkoutId, "2001");
  assert.equal(none.total, null);
  assert.equal(none.retainifyRecoveredRevenue, null);
});

test("consent: state per channel, WhatsApp suppression matched across digit and E.164 forms", async () => {
  const c = await prisma.contact.create({
    data: { shop: SHOP, email: EMAIL, phone: "03001234567", phoneE164: "+923001234567", subscriptionStatus: "subscribed", whatsappStatus: "subscribed" },
  });
  const before = (await get("consent")).body.data[0];
  assert.equal(before.whatsapp.suppressed, false);
  assert.equal(before.push.state, "never_opted_in");

  await new Promise((r) => setTimeout(r, 5));
  // Stored in WhatsApp's digits form, which is not the contact's raw phone.
  await prisma.whatsappSuppression.create({ data: { shop: SHOP, phoneNumber: "923001234567", reason: "opt_out" } });
  const { body } = await get("consent", `updatedSince=${encodeURIComponent(before.updatedAt)}`);
  assert.equal(body.data.length, 1, "the suppression moved the contact's updatedAt");
  assert.equal(body.data[0].contactId, c.id);
  assert.equal(body.data[0].whatsapp.suppressed, true);
  assert.equal(body.data[0].whatsapp.suppressionReason, "opt_out");
  assert.deepEqual(body.data[0].buyer, { email: EMAIL, phone: "+923001234567", phoneRaw: "03001234567" });
});

test("consent-events are append-only rows in (createdAt, id) order", async () => {
  await prisma.contact.create({ data: { shop: SHOP, email: EMAIL, subscriptionStatus: "subscribed" } });
  await prisma.contact.updateMany({ where: { shop: SHOP, email: EMAIL }, data: { subscriptionStatus: "unsubscribed" } });
  const { body } = await get("consent-events");
  assert.deepEqual(body.data.map((e) => [e.channel, e.from, e.to]), [
    ["email", "never_opted_in", "subscribed"],
    ["email", "subscribed", "unsubscribed"],
  ]);
  for (const e of body.data) assert.equal(e.updatedAt, e.createdAt);
});

test("query parsing refuses what it cannot honour", async () => {
  assert.equal(parseFeedQuery(new URLSearchParams("limit=0")).ok, false);
  assert.equal(parseFeedQuery(new URLSearchParams("limit=abc")).ok, false);
  assert.equal(parseFeedQuery(new URLSearchParams("limit=9999")).value.limit, 500);
  assert.equal(parseFeedQuery(new URLSearchParams("updatedSince=yesterday")).ok, false);
  assert.equal(parseFeedQuery(new URLSearchParams("cursor=nonsense")).ok, false);
  assert.equal(decodeCursor("nonsense"), null);
  const bad = await get("messages", "limit=0");
  assert.equal(bad.status, 400);
});

test("money rounds to the currency's minor units at the edge", () => {
  assert.deepEqual(money(1250, "PKR"), { amount: "1250.00", currency: "PKR" });
  assert.deepEqual(money(0.1 + 0.2, "USD"), { amount: "0.30", currency: "USD" });
  assert.deepEqual(money(1500.4, "JPY"), { amount: "1500", currency: "JPY" });
  assert.deepEqual(money(1.2345, "KWD"), { amount: "1.235", currency: "KWD" });
  assert.equal(money(10, null), null);
  assert.equal(money(null, "PKR"), null);
});
