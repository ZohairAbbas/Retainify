/**
 * The broker path end to end: events reported on an app's behalf, the event
 * log and its idempotency, and the bulk contact sync.
 *
 * Run: npm test   (or: node --test app/lib/internal/broker.db.test.js)
 *
 * Writes under the real internal tenant key for the same reason
 * routes.db.test.js does. Everything is created for the test apps, test
 * addresses and test property keys below, and removed afterwards. Point
 * DATABASE_URL at a scratch database to keep it off production.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { action as eventAction } from "../../routes/internal.event.js";
import { action as contactsAction } from "../../routes/internal.contacts.js";
import { brokerAppsEnvName, brokerSecretEnvName } from "./auth.server.js";
import { tagOwnerKey } from "./sync.server.js";
import { __resetRateLimits } from "../security/rate-limit.server.js";
import { INTERNAL_SHOP } from "./tenant.js";

const BROKER = "testbroker";
const BROKER_SECRET = "k".repeat(40);
const APP = "testbrokered";
const EMAIL = "broker.test@example.com";
const EMAIL2 = "broker.test2@example.com";
const PHONE = "923001112233";
const PROP = "t_plan";
const PROP_NUM = "t_usage";
const TAG_PREFIX = "tbroker:";

function post(url, body, { secret = BROKER_SECRET, caller = BROKER } = {}) {
  return new Request(`https://example.test${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      ...(caller ? { "x-internal-caller": caller } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function sendEvent(body, opts) {
  const res = await eventAction({ request: post("/internal/event", body, opts) });
  return { status: res.status, body: await res.json() };
}

async function sync(body, opts) {
  const res = await contactsAction({ request: post("/internal/contacts", body, opts) });
  return { status: res.status, body: await res.json() };
}

async function makeFlow({ on = "installed", entryFrequency = "no_reentry" } = {}) {
  const journey = await prisma.journey.create({
    data: {
      shop: INTERNAL_SHOP,
      name: `Broker test ${on}`,
      trigger: "api_event",
      triggerApp: APP,
      triggerEvent: on,
      status: "published",
      entryFrequency,
    },
  });
  await prisma.journeyStep.create({
    data: { journeyId: journey.id, nodeType: "email", stepNumber: 1, positionY: 1, subject: "Hi", isEnabled: true },
  });
  return journey;
}

async function contactOf(email) {
  return prisma.contact.findUnique({
    where: { shop_email: { shop: INTERNAL_SHOP, email } },
    include: { tags: { include: { tag: true } } },
  });
}

async function clear() {
  const journeys = await prisma.journey.findMany({
    where: { shop: INTERNAL_SHOP, triggerApp: APP },
    select: { id: true },
  });
  const ids = journeys.map((j) => j.id);
  if (ids.length) {
    const eids = (await prisma.journeyEnrollment.findMany({ where: { journeyId: { in: ids } }, select: { id: true } })).map((e) => e.id);
    await prisma.journeyJob.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.journeyEnrollment.deleteMany({ where: { id: { in: eids } } });
    await prisma.journeyStep.deleteMany({ where: { journeyId: { in: ids } } });
    await prisma.journey.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.internalEvent.deleteMany({ where: { caller: BROKER } });
  await prisma.whatsappSuppression.deleteMany({ where: { shop: INTERNAL_SHOP, phoneNumber: { in: [PHONE, `+${PHONE}`] } } });
  await prisma.whatsappSubscription.deleteMany({ where: { shop: INTERNAL_SHOP, phoneNumber: { in: [PHONE, `+${PHONE}`] } } });
  await prisma.contact.deleteMany({ where: { shop: INTERNAL_SHOP, email: { in: [EMAIL, EMAIL2] } } });
  await prisma.tag.deleteMany({ where: { shop: INTERNAL_SHOP, nameKey: { startsWith: TAG_PREFIX } } });
  await prisma.contactPropertyDef.deleteMany({ where: { shop: INTERNAL_SHOP, key: { in: [PROP, PROP_NUM] } } });
}

test.before(async () => {
  process.env[brokerSecretEnvName(BROKER)] = BROKER_SECRET;
  process.env[brokerAppsEnvName(BROKER)] = APP;
  await clear();
});
test.beforeEach(__resetRateLimits);
test.after(async () => {
  delete process.env[brokerSecretEnvName(BROKER)];
  delete process.env[brokerAppsEnvName(BROKER)];
  await clear();
  await prisma.$disconnect();
});

// ── Events via a broker ──────────────────────────────────────────────────

test("a broker's event starts the app's flows and is logged with both names", async (t) => {
  t.after(clear);
  await makeFlow();
  const res = await sendEvent({ app: APP, event: "installed", email: EMAIL, eventId: "e-1" });
  assert.equal(res.status, 200);
  assert.equal(res.body.enrolled.length, 1);
  assert.equal(res.body.duplicate, false);

  const row = await prisma.internalEvent.findUnique({ where: { caller_eventId: { caller: BROKER, eventId: "e-1" } } });
  assert.equal(row.app, APP);
  assert.equal(row.status, "done");
  assert.equal(row.enrolled.length, 1);
});

test("a broker event without an app is refused", async () => {
  const res = await sendEvent({ event: "installed", email: EMAIL });
  assert.equal(res.status, 400);
});

test("a repeated eventId returns the original outcome and runs nothing — even for an immediate re-entry flow", async (t) => {
  t.after(clear);
  // The case re-entry rules cannot catch: this flow happily enrolls twice.
  await makeFlow({ entryFrequency: "immediate" });
  const first = await sendEvent({ app: APP, event: "installed", email: EMAIL, eventId: "e-2" });
  const again = await sendEvent({ app: APP, event: "installed", email: EMAIL, eventId: "e-2" });
  assert.equal(first.body.enrolled.length, 1);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.deepEqual(again.body.enrolled, first.body.enrolled);
  assert.equal(await prisma.journeyEnrollment.count({ where: { shop: INTERNAL_SHOP, contactEmail: EMAIL } }), 1);
});

test("an eventId still being processed gets a 409; a stale one is retried", async (t) => {
  t.after(clear);
  await makeFlow();
  await prisma.internalEvent.create({
    data: { caller: BROKER, app: APP, event: "installed", email: EMAIL, eventId: "e-3" },
  });
  const busy = await sendEvent({ app: APP, event: "installed", email: EMAIL, eventId: "e-3" });
  assert.equal(busy.status, 409);

  await prisma.internalEvent.updateMany({
    where: { caller: BROKER, eventId: "e-3" },
    data: { receivedAt: new Date(Date.now() - 10 * 60 * 1000) },
  });
  const retried = await sendEvent({ app: APP, event: "installed", email: EMAIL, eventId: "e-3" });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.enrolled.length, 1);
});

test("events without an eventId are logged but not deduplicated", async (t) => {
  t.after(clear);
  await sendEvent({ app: APP, event: "nothing_listens", email: EMAIL });
  await sendEvent({ app: APP, event: "nothing_listens", email: EMAIL });
  assert.equal(await prisma.internalEvent.count({ where: { caller: BROKER, event: "nothing_listens" } }), 2);
});

test("a malformed eventId is refused", async () => {
  const res = await sendEvent({ app: APP, event: "installed", email: EMAIL, eventId: "has spaces" });
  assert.equal(res.status, 400);
});

// ── Contact sync ─────────────────────────────────────────────────────────

const DEFS = [
  { key: PROP, label: "Test plan", type: "select", options: ["free", "pro"] },
  { key: PROP_NUM, label: "Test usage", type: "number" },
];

test("sync creates contacts, declares properties, and stores coerced values", async (t) => {
  t.after(clear);
  const res = await sync({
    properties: DEFS,
    contacts: [
      { email: EMAIL, name: "Ayesha", properties: { [PROP]: "pro", [PROP_NUM]: "82" }, tags: [`${TAG_PREFIX}a`] },
      { email: "not-an-email", properties: {} },
      { email: EMAIL2, properties: { nope: 1 } },
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results.map((r) => r.status), ["created", "error", "error"]);
  assert.match(res.body.results[2].error, /Unknown property/);

  const c = await contactOf(EMAIL);
  assert.deepEqual(c.customProps, { [PROP]: "pro", [PROP_NUM]: 82 });
  assert.equal(c.subscriptionStatus, "subscribed");
  assert.deepEqual(c.tags.map((x) => x.tag.name), [`${TAG_PREFIX}a`]);
  assert.equal(c.tags[0].appliedByStepKey, tagOwnerKey(BROKER));
});

test("select options are merged and a type change is refused", async (t) => {
  t.after(clear);
  await sync({ properties: DEFS, contacts: [{ email: EMAIL }] });
  await sync({ properties: [{ key: PROP, type: "select", options: ["growzar"] }], contacts: [{ email: EMAIL }] });
  const def = await prisma.contactPropertyDef.findUnique({ where: { shop_key: { shop: INTERNAL_SHOP, key: PROP } } });
  assert.deepEqual(def.options, ["free", "pro", "growzar"]);

  const res = await sync({ properties: [{ key: PROP, type: "number" }], contacts: [{ email: EMAIL }] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /cannot be redeclared/);
});

test("null clears a property and other properties are left alone", async (t) => {
  t.after(clear);
  await sync({ properties: DEFS, contacts: [{ email: EMAIL, properties: { [PROP]: "pro", [PROP_NUM]: 5 } }] });
  await sync({ contacts: [{ email: EMAIL, properties: { [PROP]: null } }] });
  assert.deepEqual((await contactOf(EMAIL)).customProps, { [PROP_NUM]: 5 });
});

test("sync owns only the tags it applied: removes its own, never a person's", async (t) => {
  t.after(clear);
  await sync({ contacts: [{ email: EMAIL, tags: [`${TAG_PREFIX}a`, `${TAG_PREFIX}b`] }] });
  const c = await contactOf(EMAIL);

  // A person applies a tag of their own by hand.
  const manual = await prisma.tag.create({ data: { shop: INTERNAL_SHOP, name: `${TAG_PREFIX}manual`, nameKey: `${TAG_PREFIX}manual` } });
  await prisma.contactTag.create({ data: { contactId: c.id, tagId: manual.id } });

  // Next sync lists only b, plus the manual tag's name.
  await sync({ contacts: [{ email: EMAIL, tags: [`${TAG_PREFIX}b`, `${TAG_PREFIX}manual`] }] });
  let names = (await contactOf(EMAIL)).tags.map((x) => x.tag.name).sort();
  assert.deepEqual(names, [`${TAG_PREFIX}b`, `${TAG_PREFIX}manual`]);

  // An empty list removes the sync's tags but leaves the hand-applied one,
  // even though the sync once listed its name.
  await sync({ contacts: [{ email: EMAIL, tags: [] }] });
  names = (await contactOf(EMAIL)).tags.map((x) => x.tag.name);
  assert.deepEqual(names, [`${TAG_PREFIX}manual`]);

  // Omitting tags leaves them alone entirely.
  await sync({ contacts: [{ email: EMAIL }] });
  assert.equal((await contactOf(EMAIL)).tags.length, 1);
});

test("sync never revives a deleted contact, never un-unsubscribes, and never bumps lastSeenAt", async (t) => {
  t.after(clear);
  await sync({ contacts: [{ email: EMAIL }, { email: EMAIL2 }] });
  const old = new Date("2020-01-01T00:00:00Z");
  await prisma.contact.update({
    where: { shop_email: { shop: INTERNAL_SHOP, email: EMAIL } },
    data: { subscriptionStatus: "unsubscribed", lastSeenAt: old },
  });
  await prisma.contact.update({
    where: { shop_email: { shop: INTERNAL_SHOP, email: EMAIL2 } },
    data: { deletedAt: new Date() },
  });

  const res = await sync({ contacts: [{ email: EMAIL }, { email: EMAIL2 }] });
  assert.deepEqual(res.body.results.map((r) => r.status), ["updated", "skipped"]);
  const c = await contactOf(EMAIL);
  assert.equal(c.subscriptionStatus, "unsubscribed");
  assert.equal(c.lastSeenAt.toISOString(), old.toISOString());
  assert.ok((await contactOf(EMAIL2)).deletedAt);
});

test("sync never re-subscribes a WhatsApp number that sent STOP", async (t) => {
  t.after(clear);
  const first = await sync({ contacts: [{ email: EMAIL, phone: PHONE }] });
  assert.equal(first.body.results[0].whatsappOptIn, true);
  await prisma.whatsappSubscription.updateMany({
    where: { shop: INTERNAL_SHOP, contactEmail: EMAIL },
    data: { status: "unsubscribed" },
  });
  const again = await sync({ contacts: [{ email: EMAIL, phone: PHONE }] });
  assert.equal(again.body.results[0].whatsappOptIn, false);
  const sub = await prisma.whatsappSubscription.findFirst({ where: { shop: INTERNAL_SHOP, contactEmail: EMAIL } });
  assert.equal(sub.status, "unsubscribed");
});

test("the sync refuses a batch that is too big or malformed as a whole", async () => {
  const tooMany = Array.from({ length: 201 }, (_, i) => ({ email: `x${i}@example.com` }));
  assert.equal((await sync({ contacts: tooMany })).status, 400);
  assert.equal((await sync({ contacts: [] })).status, 400);
  assert.equal((await sync({ properties: [{ key: "Bad Key" }], contacts: [{ email: EMAIL }] })).status, 400);
  assert.equal((await sync({ contacts: [{ email: EMAIL }] }, { secret: "w".repeat(40) })).status, 401);
});
