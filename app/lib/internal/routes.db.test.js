/**
 * End-to-end behaviour of POST /internal/enroll and POST /internal/event.
 *
 * Run: npm test   (or: node --test app/lib/internal/routes.db.test.js)
 *
 * ── Why this needs a database ──────────────────────────────────────────────
 * The whole point of these routes is what they leave behind: a Contact, an
 * enrollment, a queued job, and later an exit. Asserting on the response body
 * alone would pass just as happily if nothing were written.
 *
 * The route actions are called directly rather than over HTTP — they are plain
 * functions of a Request, so a server would add a port and a build step without
 * adding coverage.
 *
 * These tests write under the real internal tenant key, because the routes
 * resolve it from app/lib/internal/tenant.js and a test tenant would exercise a
 * path production never takes. Everything created is removed afterwards, keyed
 * on the test addresses below.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { action as enrollAction } from "../../routes/internal.enroll.js";
import { action as eventAction } from "../../routes/internal.event.js";
import { advanceEnrollment } from "../journey/advance.server.js";
import { secretEnvName } from "./auth.server.js";
import { __resetRateLimits } from "../security/rate-limit.server.js";
import { INTERNAL_SHOP } from "./tenant.js";

const APP = "testapp";
const SECRET = "t".repeat(40);
const EMAIL = "internal.routes.test@example.com";
const KEY = "test_onboarding";

function post(route, body, { secret = SECRET } = {}) {
  const request = new Request(`https://example.test/internal/${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return request;
}

async function callEnroll(body, opts) {
  const res = await enrollAction({ request: post("enroll", body, opts) });
  return { status: res.status, body: await res.json() };
}

async function callEvent(body, opts) {
  const res = await eventAction({ request: post("event", body, opts) });
  return { status: res.status, body: await res.json() };
}

/** A published api_event flow with one enabled email step. */
async function makeFlow({ exitCriteria = [], entryFrequency = "no_reentry" } = {}) {
  const journey = await prisma.journey.create({
    data: {
      shop: INTERNAL_SHOP,
      name: "Test internal flow",
      trigger: "api_event",
      journeyKey: KEY,
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
      subject: "Finish setting up",
      isEnabled: true,
    },
  });
  return journey;
}

async function clear() {
  const journeys = await prisma.journey.findMany({
    where: { shop: INTERNAL_SHOP, journeyKey: { startsWith: "test_" } },
    select: { id: true },
  });
  const ids = journeys.map((j) => j.id);
  if (ids.length) {
    const enrollments = await prisma.journeyEnrollment.findMany({
      where: { journeyId: { in: ids } },
      select: { id: true },
    });
    const eids = enrollments.map((e) => e.id);
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
  await prisma.whatsappSubscription.deleteMany({
    where: { shop: INTERNAL_SHOP, contactEmail: EMAIL },
  });
  await prisma.contact.deleteMany({ where: { shop: INTERNAL_SHOP, email: EMAIL } });
}

test.before(async () => {
  process.env[secretEnvName(APP)] = SECRET;
  await clear();
});

test.beforeEach(__resetRateLimits);

test.after(async () => {
  delete process.env[secretEnvName(APP)];
  await clear();
  await prisma.$disconnect();
});

test("a valid call enrolls the user and queues their first send", async (t) => {
  t.after(clear);
  await makeFlow();

  const res = await callEnroll({ app: APP, email: EMAIL, name: "Ayesha", journeyKey: KEY });
  assert.equal(res.status, 200);
  assert.equal(res.body.enrolled, true);

  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop: INTERNAL_SHOP, email: EMAIL } },
  });
  assert.equal(contact.source, "internal_api");
  assert.equal(contact.subscriptionStatus, "subscribed");

  // Enrollment parks a cursor on the first step and a wake time; the advance
  // worker turns that into a send. Both halves are asserted, because an
  // enrollment with no cursor is a row that looks healthy and never moves.
  const enrollment = await prisma.journeyEnrollment.findUnique({
    where: { id: res.body.enrollmentId },
  });
  assert.ok(enrollment.currentStepId, "expected a cursor on the first step");
  assert.ok(enrollment.nextRunAt, "expected the enrollment to be due");

  await advanceEnrollment(enrollment.id);

  const jobs = await prisma.journeyJob.count({
    where: { enrollmentId: res.body.enrollmentId },
  });
  assert.equal(jobs, 1, "expected the advance worker to queue the first email");
});

test("a phone number is stored as a confirmed WhatsApp opt-in", async (t) => {
  t.after(clear);
  await makeFlow();

  await callEnroll({
    app: APP, email: EMAIL, journeyKey: KEY, phone: "923001234567",
  });

  // Exactly what the WhatsApp worker resolves on, so the second channel needs
  // no backfill when it lands.
  const sub = await prisma.whatsappSubscription.findFirst({
    where: { shop: INTERNAL_SHOP, contactEmail: EMAIL, status: "subscribed" },
  });
  assert.ok(sub, "expected a subscription row");
  assert.ok(sub.confirmedAt, "expected the opt-in to be confirmed");
});

test("an unusable phone does not fail the email enrollment", async (t) => {
  t.after(clear);
  await makeFlow();

  // National format — Meta rejects these permanently, but the caller asked for
  // an email enrollment and that must still happen.
  const res = await callEnroll({
    app: APP, email: EMAIL, journeyKey: KEY, phone: "07700900123",
  });
  assert.equal(res.body.enrolled, true);
});

test("an unknown journeyKey is a 404, not a silent success", async (t) => {
  t.after(clear);
  await makeFlow();
  const res = await callEnroll({ app: APP, email: EMAIL, journeyKey: "test_nope" });
  assert.equal(res.status, 404);
  assert.equal(res.body.ok, false);
});

test("an unpublished flow is a 409 naming its status", async (t) => {
  t.after(clear);
  const journey = await makeFlow();
  await prisma.journey.update({ where: { id: journey.id }, data: { status: "paused" } });

  const res = await callEnroll({ app: APP, email: EMAIL, journeyKey: KEY });
  assert.equal(res.status, 409);
  assert.equal(res.body.status, "paused");
});

test("a repeat call under no_reentry reports enrolled:false rather than a second drip", async (t) => {
  t.after(clear);
  await makeFlow({ entryFrequency: "no_reentry" });

  const first = await callEnroll({ app: APP, email: EMAIL, journeyKey: KEY });
  const second = await callEnroll({ app: APP, email: EMAIL, journeyKey: KEY });

  assert.equal(first.body.enrolled, true);
  // enrollContact hands back the EXISTING enrollment here. Reporting that as a
  // success would tell a caller retrying a failed job that it had just started
  // a second drip.
  assert.equal(second.body.enrolled, false);
  assert.equal(second.body.enrollmentId, first.body.enrollmentId);

  const count = await prisma.journeyEnrollment.count({
    where: { shop: INTERNAL_SHOP, contactEmail: EMAIL },
  });
  assert.equal(count, 1);
});

test("a bad secret enrolls nobody", async (t) => {
  t.after(clear);
  await makeFlow();
  const res = await callEnroll(
    { app: APP, email: EMAIL, journeyKey: KEY },
    { secret: "wrong".repeat(10) },
  );
  assert.equal(res.status, 401);

  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop: INTERNAL_SHOP, email: EMAIL } },
  });
  assert.equal(contact, null);
});

test("a placeholder .internal address is refused", async (t) => {
  t.after(clear);
  await makeFlow();
  const res = await callEnroll({
    app: APP, email: "923001234567@growzar.internal", journeyKey: KEY,
  });
  assert.equal(res.status, 400);
});

test("an event exits the enrollment and stops its queued send", async (t) => {
  t.after(clear);
  await makeFlow({ exitCriteria: ["setup_completed"] });

  const enrolled = await callEnroll({ app: APP, email: EMAIL, journeyKey: KEY });
  assert.equal(enrolled.body.enrolled, true);

  const res = await callEvent({ app: APP, email: EMAIL, event: "setup_completed" });
  assert.equal(res.status, 200);
  assert.equal(res.body.exited, 1);

  const enrollment = await prisma.journeyEnrollment.findUnique({
    where: { id: enrolled.body.enrollmentId },
  });
  assert.equal(enrollment.exitReason, "exit_criteria:setup_completed");
  assert.equal(enrollment.nextRunAt, null);
});

test("an event nobody is waiting on reports exited:0", async (t) => {
  t.after(clear);
  await makeFlow({ exitCriteria: ["setup_completed"] });
  await callEnroll({ app: APP, email: EMAIL, journeyKey: KEY });

  const res = await callEvent({ app: APP, email: EMAIL, event: "something_else" });
  assert.equal(res.status, 200);
  assert.equal(res.body.exited, 0);
});

test("a GET is answered with 405 rather than looking like a missing route", async () => {
  const { loader } = await import("../../routes/internal.enroll.js");
  const res = loader();
  assert.equal(res.status, 405);
});

test("a non-JSON body is refused before anything is written", async (t) => {
  t.after(clear);
  const request = new Request("https://example.test/internal/enroll", {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
    body: "not json",
  });
  const res = await enrollAction({ request });
  assert.equal(res.status, 400);
});
