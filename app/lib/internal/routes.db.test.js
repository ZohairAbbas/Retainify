/**
 * End-to-end behaviour of POST /internal/event.
 *
 * Run: npm test   (or: node --test app/lib/internal/routes.db.test.js)
 *
 * ── Why this needs a database ──────────────────────────────────────────────
 * The whole point of the route is what it leaves behind: a Contact, an
 * enrollment, a queued send, and later an exit. Asserting on the response body
 * alone would pass just as happily if nothing were written.
 *
 * The route action is called directly rather than over HTTP — it is a plain
 * function of a Request, so a server would add a port and a build step without
 * adding coverage.
 *
 * These tests write under the real internal tenant key, because the route
 * resolves it from app/lib/internal/tenant.js and a test tenant would exercise a
 * path production never takes. Every flow is created for one of the two test
 * apps below and every person on a test address, and all of it is removed
 * afterwards. Point DATABASE_URL at a scratch schema to keep it off production.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { action as eventAction, loader as eventLoader } from "../../routes/internal.event.js";
import { advanceEnrollment } from "../journey/advance.server.js";
import { secretEnvName } from "./auth.server.js";
import { __resetRateLimits } from "../security/rate-limit.server.js";
import { INTERNAL_SHOP } from "./tenant.js";

const APP = "testapp";
const OTHER_APP = "testother";
const SECRET = "t".repeat(40);
const OTHER_SECRET = "o".repeat(40);
const EMAIL = "internal.routes.test@example.com";
const PHONE = "923001234567";

function post(body, { secret = SECRET } = {}) {
  return new Request("https://example.test/internal/event", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function send(body, opts) {
  const res = await eventAction({ request: post(body, opts) });
  return { status: res.status, body: await res.json() };
}

/** Shorthand for the calling app's event about the test person. */
const event = (name, extra = {}) =>
  send({ app: APP, event: name, email: EMAIL, ...extra });

/** A published App event flow with one enabled email step. */
async function makeFlow({
  app = APP,
  on = "installed",
  exitCriteria = [],
  entryFrequency = "no_reentry",
  name = `Test ${app} ${on}`,
} = {}) {
  const journey = await prisma.journey.create({
    data: {
      shop: INTERNAL_SHOP,
      name,
      trigger: "api_event",
      triggerApp: app,
      triggerEvent: on,
      status: "published",
      entryFrequency,
      exitCriteria: JSON.stringify(exitCriteria),
    },
  });
  await prisma.journeyStep.create({
    data: {
      journeyId: journey.id,
      nodeType: "email",
      stepNumber: 1,
      positionY: 1,
      subject: "Hello {data.store_name|there}",
      isEnabled: true,
    },
  });
  return journey;
}

async function activeIn(journey) {
  return prisma.journeyEnrollment.findFirst({
    where: { journeyId: journey.id, contactEmail: EMAIL, exitReason: "" },
  });
}

async function clear() {
  const journeys = await prisma.journey.findMany({
    where: { shop: INTERNAL_SHOP, triggerApp: { in: [APP, OTHER_APP] } },
    select: { id: true },
  });
  const ids = journeys.map((j) => j.id);
  if (ids.length) {
    const eids = (
      await prisma.journeyEnrollment.findMany({
        where: { journeyId: { in: ids } },
        select: { id: true },
      })
    ).map((e) => e.id);
    if (eids.length) {
      await prisma.journeyJob.deleteMany({ where: { enrollmentId: { in: eids } } });
      await prisma.whatsappJob.deleteMany({ where: { enrollmentId: { in: eids } } });
      await prisma.pushJob.deleteMany({ where: { enrollmentId: { in: eids } } });
      await prisma.journeyPathEvent.deleteMany({ where: { enrollmentId: { in: eids } } });
      await prisma.journeyEnrollment.deleteMany({ where: { id: { in: eids } } });
    }
    await prisma.journeyStep.deleteMany({ where: { journeyId: { in: ids } } });
    await prisma.journeyEdge.deleteMany({ where: { journeyId: { in: ids } } });
    await prisma.journey.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.whatsappSuppression.deleteMany({ where: { shop: INTERNAL_SHOP, phoneNumber: PHONE } });
  await prisma.whatsappSubscription.deleteMany({ where: { shop: INTERNAL_SHOP, phoneNumber: PHONE } });
  await prisma.contact.deleteMany({ where: { shop: INTERNAL_SHOP, email: EMAIL } });
}

test.before(async () => {
  process.env[secretEnvName(APP)] = SECRET;
  process.env[secretEnvName(OTHER_APP)] = OTHER_SECRET;
  await clear();
});

test.beforeEach(__resetRateLimits);

test.after(async () => {
  delete process.env[secretEnvName(APP)];
  delete process.env[secretEnvName(OTHER_APP)];
  await clear();
  await prisma.$disconnect();
});

// ── Starting flows ─────────────────────────────────────────────────────────

test("an event starts the flows subscribed to it and queues the first send", async (t) => {
  t.after(clear);
  const flow = await makeFlow({ on: "installed" });

  const res = await event("installed", { name: "Ayesha", data: { store_name: "Acme" } });
  assert.equal(res.status, 200);
  assert.equal(res.body.enrolled.length, 1);
  assert.equal(res.body.enrolled[0].flow, flow.name);

  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop: INTERNAL_SHOP, email: EMAIL } },
  });
  assert.equal(contact.source, "internal_api");
  assert.equal(contact.subscriptionStatus, "subscribed");

  // The event's data travels with the enrollment — it is what {data.*} reads.
  const enrollment = await prisma.journeyEnrollment.findUnique({
    where: { id: res.body.enrolled[0].enrollmentId },
  });
  const payload = JSON.parse(enrollment.payload);
  assert.deepEqual(payload.data, { store_name: "Acme" });
  assert.equal(payload.app, APP);
  assert.equal(payload.event, "installed");

  // Enrollment parks a cursor; the advance worker turns it into a send. Both
  // halves, because an enrollment with no queued work looks healthy forever.
  assert.ok(enrollment.currentStepId && enrollment.nextRunAt);
  await advanceEnrollment(enrollment.id);
  assert.equal(await prisma.journeyJob.count({ where: { enrollmentId: enrollment.id } }), 1);
});

test("an event nobody subscribes to changes nothing, and says so", async (t) => {
  t.after(clear);
  await makeFlow({ on: "installed" });
  const res = await event("something_else");
  assert.equal(res.status, 200);
  assert.deepEqual(
    { exited: res.body.exited, enrolled: res.body.enrolled, declined: res.body.declined },
    { exited: 0, enrolled: [], declined: [] },
  );
});

test("a repeat under no_reentry is reported as declined, not as a second drip", async (t) => {
  t.after(clear);
  await makeFlow({ on: "installed", entryFrequency: "no_reentry" });

  const first = await event("installed");
  const second = await event("installed");

  assert.equal(first.body.enrolled.length, 1);
  assert.equal(second.body.enrolled.length, 0);
  assert.equal(second.body.declined.length, 1);
  assert.match(second.body.declined[0].reason, /re-entry/);
  assert.equal(
    await prisma.journeyEnrollment.count({ where: { shop: INTERNAL_SHOP, contactEmail: EMAIL } }),
    1,
  );
});

test("a draft or paused flow is not started", async (t) => {
  t.after(clear);
  const flow = await makeFlow({ on: "installed" });
  await prisma.journey.update({ where: { id: flow.id }, data: { status: "paused" } });
  const res = await event("installed");
  assert.equal(res.body.enrolled.length, 0);
});

// ── Ending flows ───────────────────────────────────────────────────────────

test("one event can end one flow and start the next", async (t) => {
  t.after(clear);
  const onboarding = await makeFlow({ on: "installed", exitCriteria: ["setup_completed"] });
  const tips = await makeFlow({ on: "setup_completed" });

  await event("installed");
  const res = await event("setup_completed");

  assert.equal(res.body.exited, 1);
  assert.equal(res.body.enrolled.length, 1);
  assert.equal(await activeIn(onboarding), null);
  assert.ok(await activeIn(tips));
});

// ── Scoping between apps ───────────────────────────────────────────────────

test("an app's event does not start another app's flows", async (t) => {
  t.after(clear);
  const other = await makeFlow({ app: OTHER_APP, on: "installed" });
  const res = await event("installed");
  assert.equal(res.body.enrolled.length, 0);
  assert.equal(await activeIn(other), null);
});

test("an app's event does not end another app's flows", async (t) => {
  t.after(clear);
  // The same merchant using both apps with one address — the case scoping is for.
  const otherFlow = await makeFlow({ app: OTHER_APP, on: "installed", exitCriteria: ["setup_completed"] });
  await send({ app: OTHER_APP, event: "installed", email: EMAIL }, { secret: OTHER_SECRET });
  assert.ok(await activeIn(otherFlow));

  const res = await event("setup_completed");
  assert.equal(res.body.exited, 0);
  assert.ok(await activeIn(otherFlow), "the other app's onboarding must still be running");
});

// ── Uninstall ──────────────────────────────────────────────────────────────

test("uninstalled ends every one of the app's flows, listed or not", async (t) => {
  t.after(clear);
  // Neither flow lists "uninstalled" — the point is that they don't have to.
  const a = await makeFlow({ on: "installed" });
  const b = await makeFlow({ on: "setup_completed" });
  await event("installed");
  await event("setup_completed");

  const res = await event("uninstalled");
  assert.equal(res.body.exited, 2);
  assert.equal(await activeIn(a), null);
  assert.equal(await activeIn(b), null);

  const exitedRow = await prisma.journeyEnrollment.findFirst({ where: { journeyId: a.id } });
  assert.equal(exitedRow.exitReason, `app_uninstalled:${APP}`);
});

test("uninstalled leaves the same person's flows in another app alone", async (t) => {
  t.after(clear);
  const otherFlow = await makeFlow({ app: OTHER_APP, on: "installed" });
  await send({ app: OTHER_APP, event: "installed", email: EMAIL }, { secret: OTHER_SECRET });

  await event("uninstalled");
  assert.ok(await activeIn(otherFlow));
});

test("uninstalled can still start a win-back flow after ending the rest", async (t) => {
  t.after(clear);
  await makeFlow({ on: "installed" });
  const winback = await makeFlow({ on: "uninstalled" });
  await event("installed");

  const res = await event("uninstalled");
  assert.equal(res.body.exited, 1);
  assert.equal(res.body.enrolled.length, 1);
  // Exits run first, so the win-back flow is not swept up by its own trigger.
  assert.ok(await activeIn(winback));
});

// ── WhatsApp staging ───────────────────────────────────────────────────────

test("a phone is stored as a confirmed WhatsApp opt-in", async (t) => {
  t.after(clear);
  await event("installed", { phone: PHONE });
  const sub = await prisma.whatsappSubscription.findFirst({
    where: { shop: INTERNAL_SHOP, contactEmail: EMAIL, status: "subscribed" },
  });
  assert.ok(sub?.confirmedAt, "expected a confirmed opt-in");
});

test("a later event does not undo a WhatsApp STOP", async (t) => {
  t.after(clear);
  await event("installed", { phone: PHONE });

  // What an inbound STOP leaves behind (see recordOptOut).
  await prisma.whatsappSubscription.updateMany({
    where: { shop: INTERNAL_SHOP, phoneNumber: PHONE },
    data: { status: "unsubscribed", optOutAt: new Date() },
  });
  await prisma.whatsappSuppression.create({
    data: { shop: INTERNAL_SHOP, phoneNumber: PHONE, reason: "opt_out" },
  });

  // Apps repeat numbers on every event — this is the one that used to re-subscribe.
  await event("inactive", { phone: PHONE });

  const sub = await prisma.whatsappSubscription.findUnique({
    where: { shop_phoneNumber: { shop: INTERNAL_SHOP, phoneNumber: PHONE } },
  });
  assert.equal(sub.status, "unsubscribed");
  const suppressed = await prisma.whatsappSuppression.findUnique({
    where: { shop_phoneNumber: { shop: INTERNAL_SHOP, phoneNumber: PHONE } },
  });
  assert.ok(suppressed, "the STOP suppression must survive");
});

test("an unusable phone does not stop the event from being handled", async (t) => {
  t.after(clear);
  await makeFlow({ on: "installed" });
  const res = await event("installed", { phone: "07700900123" });
  assert.equal(res.body.enrolled.length, 1);
});

// ── Refusals ───────────────────────────────────────────────────────────────

test("a bad secret touches nothing", async (t) => {
  t.after(clear);
  await makeFlow({ on: "installed" });
  const res = await send(
    { app: APP, event: "installed", email: EMAIL },
    { secret: "wrong".repeat(10) },
  );
  assert.equal(res.status, 401);
  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop: INTERNAL_SHOP, email: EMAIL } },
  });
  assert.equal(contact, null);
});

test("malformed input is refused with a 400 naming the problem", async () => {
  const cases = [
    [{ app: APP, event: "Installed", email: EMAIL }, /event/],
    [{ app: APP, event: "installed", email: "123@growzar.internal" }, /deliverable/],
    [{ app: APP, event: "installed", email: EMAIL, data: [1, 2] }, /object/],
    [{ app: APP, event: "installed", email: EMAIL, data: { nested: { a: 1 } } }, /string, number or boolean/],
    [{ app: APP, event: "installed", email: EMAIL, data: { "Bad Key": "x" } }, /lowercase/],
  ];
  for (const [body, pattern] of cases) {
    __resetRateLimits();
    const res = await send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, pattern);
  }
});

test("oversized data is refused rather than trimmed", async () => {
  const res = await event("installed", { data: { blob: "x".repeat(9000) } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /KB/);
});

test("a non-JSON body is refused before anything is written", async () => {
  const res = await send("not json");
  assert.equal(res.status, 400);
});

test("a GET is answered with 405 rather than looking like a missing route", () => {
  assert.equal(eventLoader().status, 405);
});
