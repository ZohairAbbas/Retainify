/**
 * Every consent writer produces exactly one ConsentEvent per channel it
 * changes, carrying its reason and source (G-RTN5-6, acceptance 4).
 *
 * The WhatsApp worker's "invalid" path is covered in
 * whatsapp/repairable-suppression.db.test.js, which already drives the worker
 * end to end. Made-up addresses and numbers only.
 */
import "../../test-support/db-guard.js";
import test from "node:test";
import assert from "node:assert/strict";

const { default: prisma } = await import("../../db.server.js");
const contacts = await import("../contacts/contacts.server.js");
const { importContactRows } = await import("../contacts/import.server.js");
const { runContactsBackfillIfNeeded } = await import("../contacts/backfill.server.js");
const { recalcContactPushEnabled } = await import("../contacts/engagement.server.js");
const { recordOptIn, recordOptOut } = await import("../whatsapp/optin.server.js");
const { upsertInternalContact } = await import("../internal/contacts.server.js");
const { INTERNAL_SHOP } = await import("../internal/tenant.js");
const { withConsentContext } = await import("./context.server.js");

// Not a myshopify domain on purpose: nothing here may try to ask Shopify for
// the shop's country.
const SHOP = "__test__g5-consent";
const INTERNAL_EMAIL = "g5.consent.internal@example.test";

async function cleanup() {
  await prisma.consentEvent.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.emailSuppression.deleteMany({ where: { shop: SHOP } });
  await prisma.whatsappSuppression.deleteMany({ where: { shop: SHOP } });
  await prisma.whatsappSubscription.deleteMany({ where: { shop: SHOP } });
  await prisma.pushSubscription.deleteMany({ where: { shop: SHOP } });
  await prisma.popupSignup.deleteMany({ where: { shop: SHOP } });
  await prisma.shopSettings.deleteMany({ where: { shop: SHOP } });
  const internal = await prisma.contact.findMany({ where: { shop: INTERNAL_SHOP, email: INTERNAL_EMAIL }, select: { id: true } });
  await prisma.consentEvent.deleteMany({ where: { contactId: { in: internal.map((c) => c.id) } } });
  await prisma.contact.deleteMany({ where: { shop: INTERNAL_SHOP, email: INTERNAL_EMAIL } });
}

/** [channel, from, to, reason, source] for one contact, oldest first. */
async function eventsFor(email, shop = SHOP) {
  const c = await prisma.contact.findUnique({ where: { shop_email: { shop, email } }, select: { id: true } });
  assert.ok(c, `contact ${email} exists`);
  const rows = await prisma.consentEvent.findMany({
    where: { contactId: c.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((e) => [e.channel, e.from, e.to, e.reason, e.source]);
}

/** A contact already in a given state, with its creation events cleared. */
async function existing(email, data = {}) {
  const c = await prisma.contact.create({ data: { shop: SHOP, email, ...data } });
  await prisma.consentEvent.deleteMany({ where: { contactId: c.id } });
  return c;
}

test.beforeEach(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("upsertContact: a popup signup that creates a subscribed contact is an opt-in from the popup", async () => {
  await contacts.upsertContact({ shop: SHOP, email: "a@example.test", source: "popup", subscriptionStatus: "subscribed" });
  assert.deepEqual(await eventsFor("a@example.test"), [["email", "never_opted_in", "subscribed", "opt_in", "popup"]]);
});

test("upsertContact: the Shopify customer sync is recorded as shopify_sync", async () => {
  await existing("b@example.test");
  await contacts.upsertContact({ shop: SHOP, email: "b@example.test", source: "shopify_customer", subscriptionStatus: "subscribed" });
  assert.deepEqual(await eventsFor("b@example.test"), [["email", "never_opted_in", "subscribed", "shopify_sync", "shopify_customer"]]);
});

test("upsertContact: a write that changes nothing writes nothing", async () => {
  await existing("c@example.test", { subscriptionStatus: "subscribed" });
  await contacts.upsertContact({ shop: SHOP, email: "c@example.test", source: "popup", subscriptionStatus: "subscribed" });
  await contacts.upsertContact({ shop: SHOP, email: "c@example.test", source: "cart_abandoned", phone: "+923001234567" });
  assert.deepEqual(await eventsFor("c@example.test"), []);
});

test("createManualContact: a merchant adding someone is an opt-in by the merchant", async () => {
  await contacts.createManualContact(SHOP, { email: "d@example.test", name: "D" });
  assert.deepEqual(await eventsFor("d@example.test"), [["email", "never_opted_in", "subscribed", "opt_in", "merchant"]]);
});

test("unsubscribeContact: the unsubscribe link, and a provider bounce, each say so", async () => {
  await existing("e@example.test", { subscriptionStatus: "subscribed" });
  await contacts.unsubscribeContact(SHOP, "e@example.test", "unsubscribe", "buyer_link");
  assert.deepEqual(await eventsFor("e@example.test"), [["email", "subscribed", "unsubscribed", "unsubscribe", "buyer_link"]]);

  await existing("f@example.test", { subscriptionStatus: "subscribed" });
  await contacts.unsubscribeContact(SHOP, "f@example.test", "bounce", "provider_webhook");
  assert.deepEqual(await eventsFor("f@example.test"), [["email", "subscribed", "bounced", "bounce", "provider_webhook"]]);
});

test("resubscribeContact: an undo is an opt-in", async () => {
  await existing("g@example.test", { subscriptionStatus: "unsubscribed" });
  await contacts.resubscribeContact(SHOP, "g@example.test", "buyer_link");
  assert.deepEqual(await eventsFor("g@example.test"), [["email", "unsubscribed", "subscribed", "opt_in", "buyer_link"]]);
});

test("bulkUnsubscribe: one event per contact it changes", async () => {
  await existing("h1@example.test", { subscriptionStatus: "subscribed" });
  await existing("h2@example.test", { subscriptionStatus: "subscribed" });
  await contacts.bulkUnsubscribe(SHOP, ["h1@example.test", "h2@example.test"], "merchant");
  for (const e of ["h1@example.test", "h2@example.test"]) {
    assert.deepEqual(await eventsFor(e), [["email", "subscribed", "unsubscribed", "unsubscribe", "merchant"]]);
  }
});

test("importContactRows: new and existing contacts both record an import", async () => {
  await existing("i2@example.test");
  await importContactRows(SHOP, [{ email: "i1@example.test", phone: "+447911123456" }, { email: "i2@example.test" }], { consent: true });
  assert.deepEqual(await eventsFor("i1@example.test"), [["email", "never_opted_in", "subscribed", "import", "csv_import"]]);
  assert.deepEqual(await eventsFor("i2@example.test"), [["email", "never_opted_in", "subscribed", "import", "csv_import"]]);
  const i1 = await prisma.contact.findUnique({ where: { shop_email: { shop: SHOP, email: "i1@example.test" } } });
  assert.equal(i1.phoneE164, "+447911123456", "an international number needs no shop country");
});

test("contacts backfill: a confirmed popup signup, and a suppression overlay, record the backfill", async () => {
  await prisma.popupSignup.create({ data: { shop: SHOP, email: "j1@example.test", confirmedAt: new Date() } });
  await existing("j2@example.test", { subscriptionStatus: "subscribed" });
  await prisma.emailSuppression.create({ data: { shop: SHOP, email: "j2@example.test", reason: "complaint" } });
  await runContactsBackfillIfNeeded(SHOP);
  assert.deepEqual(await eventsFor("j1@example.test"), [["email", "never_opted_in", "subscribed", "opt_in", "contacts_backfill"]]);
  assert.deepEqual(await eventsFor("j2@example.test"), [["email", "subscribed", "complained", "complaint", "contacts_backfill"]]);
});

test("WhatsApp recordOptIn and recordOptOut: opt-in by method, a block as blocked", async () => {
  await existing("k@example.test");
  await recordOptIn({ shop: SHOP, phoneNumber: "+923001234567", contactEmail: "k@example.test", optInMethod: "popup", confirmed: true });
  await recordOptOut({ shop: SHOP, phoneNumber: "923001234567", reason: "blocked", source: "whatsapp_webhook" });
  assert.deepEqual(await eventsFor("k@example.test"), [
    ["whatsapp", "never_opted_in", "subscribed", "opt_in", "whatsapp_popup"],
    ["whatsapp", "subscribed", "unsubscribed", "blocked", "whatsapp_webhook"],
  ]);
});

test("push: subscribe, unsubscribe, and coming back are told apart", async () => {
  await existing("l@example.test");
  const sub = await prisma.pushSubscription.create({
    data: { shop: SHOP, endpoint: "https://push.example.test/1", p256dh: "x", auth: "y", contactEmail: "l@example.test" },
  });
  await recalcContactPushEnabled(SHOP, "l@example.test", { reason: "opt_in", source: "push_subscribe" });
  await prisma.pushSubscription.update({ where: { id: sub.id }, data: { isActive: false } });
  await recalcContactPushEnabled(SHOP, "l@example.test", { reason: "unsubscribe", source: "push_unsubscribe" });
  await prisma.pushSubscription.update({ where: { id: sub.id }, data: { isActive: true } });
  await recalcContactPushEnabled(SHOP, "l@example.test", { reason: "opt_in", source: "push_subscribe" });
  assert.deepEqual(await eventsFor("l@example.test"), [
    ["push", "never_opted_in", "subscribed", "opt_in", "push_subscribe"],
    ["push", "subscribed", "unsubscribed", "unsubscribe", "push_unsubscribe"],
    ["push", "unsubscribed", "subscribed", "opt_in", "push_subscribe"],
  ]);
});

test("internal contacts: an app user reported over /internal/event is an opt-in from internal_api", async () => {
  await upsertInternalContact({ email: INTERNAL_EMAIL, app: "testapp" });
  assert.deepEqual(await eventsFor(INTERNAL_EMAIL, INTERNAL_SHOP), [["email", "never_opted_in", "subscribed", "opt_in", "internal_api"]]);
});

test("a writer without context is still recorded, as unattributed", async () => {
  await existing("m@example.test");
  await prisma.contact.updateMany({ where: { shop: SHOP, email: "m@example.test" }, data: { whatsappStatus: "invalid" } });
  assert.deepEqual(await eventsFor("m@example.test"), [["whatsapp", "never_opted_in", "invalid", "invalid", "unattributed"]]);
});

test("context is transaction-local: it does not leak to the next write on the connection", async () => {
  await existing("n@example.test");
  await withConsentContext({ reason: "gdpr", source: "leak_check" }, (tx) => tx.$queryRaw`SELECT 1`);
  await prisma.contact.updateMany({ where: { shop: SHOP, email: "n@example.test" }, data: { subscriptionStatus: "subscribed" } });
  assert.deepEqual(await eventsFor("n@example.test"), [["email", "never_opted_in", "subscribed", "opt_in", "unattributed"]]);
});

test("an unknown reason is refused before anything is written", async () => {
  await assert.rejects(() => withConsentContext({ reason: "because", source: "x" }, async () => {}), /Unknown consent reason/);
});
