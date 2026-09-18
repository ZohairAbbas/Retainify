/**
 * Merchant360 reporting endpoints and managed segments.
 *
 * Run: node --test app/lib/internal/reporting.db.test.js  (DATABASE_URL → scratch DB)
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { loader as flowsLoader } from "../../routes/internal.flows.js";
import { loader as enrollmentsLoader } from "../../routes/internal.flow-enrollments.js";
import { loader as activityLoader } from "../../routes/internal.contact-activity.js";
import { action as segmentsAction } from "../../routes/internal.segments.js";
import { brokerAppsEnvName, brokerSecretEnvName, secretEnvName } from "./auth.server.js";
import { evaluateSegment } from "../segments/evaluator.server.js";
import { __resetRateLimits } from "../security/rate-limit.server.js";
import { INTERNAL_SHOP } from "./tenant.js";

const BROKER = "testreporter";
const SECRET = "r".repeat(40);
const EMAIL = "reporting.test@example.com";
const OTHER_SHOP = "__test__reporting-other.myshopify.com";

const req = (path, { method = "GET", body, broker = true, secret = SECRET } = {}) =>
  new Request(`https://example.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
      ...(broker ? { "x-internal-caller": BROKER } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const json = async (res) => ({ status: res.status, body: await res.json() });

let flow;
let otherFlow;

async function clear() {
  for (const shop of [INTERNAL_SHOP, OTHER_SHOP]) {
    const js = await prisma.journey.findMany({ where: { shop, name: { startsWith: "Reporting test" } }, select: { id: true } });
    const ids = js.map((j) => j.id);
    const eids = (await prisma.journeyEnrollment.findMany({ where: { journeyId: { in: ids } }, select: { id: true } })).map((e) => e.id);
    await prisma.journeyJob.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.whatsappJob.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.journeyEnrollment.deleteMany({ where: { id: { in: eids } } });
    await prisma.journeyStep.deleteMany({ where: { journeyId: { in: ids } } });
    await prisma.journey.deleteMany({ where: { id: { in: ids } } });
  }
  const segs = await prisma.segment.findMany({ where: { shop: INTERNAL_SHOP, name: { startsWith: "M360 · Reporting" } }, select: { id: true } });
  await prisma.segment.deleteMany({ where: { id: { in: segs.map((s) => s.id) } } });
  await prisma.contact.deleteMany({ where: { shop: INTERNAL_SHOP, email: EMAIL } });
  await prisma.tag.deleteMany({ where: { shop: INTERNAL_SHOP, nameKey: { startsWith: "m360:seg:rep-" } } });
}

test.before(async () => {
  process.env[brokerSecretEnvName(BROKER)] = SECRET;
  process.env[brokerAppsEnvName(BROKER)] = "courierify";
  await clear();
  flow = await prisma.journey.create({ data: { shop: INTERNAL_SHOP, name: "Reporting test flow", trigger: "api_event", triggerApp: "courierify", triggerEvent: "installed", status: "published" } });
  const step = await prisma.journeyStep.create({ data: { journeyId: flow.id, nodeType: "email", stepNumber: 1, positionY: 1, subject: "Hi", isEnabled: true } });
  const wa = await prisma.journeyStep.create({ data: { journeyId: flow.id, nodeType: "whatsapp", stepNumber: 2, positionY: 2, isEnabled: true } });
  const e = await prisma.journeyEnrollment.create({ data: { shop: INTERNAL_SHOP, journeyId: flow.id, contactEmail: EMAIL, payload: JSON.stringify({ data: { shop_domain: "store-a.myshopify.com" } }) } });
  const t = new Date();
  await prisma.journeyJob.create({ data: { shop: INTERNAL_SHOP, enrollmentId: e.id, stepId: step.id, scheduledFor: t, status: "done", sentAt: t, openedAt: t, clickedAt: t } });
  await prisma.whatsappJob.create({ data: { shop: INTERNAL_SHOP, enrollmentId: e.id, stepId: wa.id, scheduledFor: t, status: "done", sentAt: t, deliveredAt: t, readAt: t } });
  // Another tenant's flow must never appear.
  otherFlow = await prisma.journey.create({ data: { shop: OTHER_SHOP, name: "Reporting test other", trigger: "api_event", status: "published" } });
});
test.beforeEach(__resetRateLimits);
test.after(async () => {
  delete process.env[brokerSecretEnvName(BROKER)];
  delete process.env[brokerAppsEnvName(BROKER)];
  await clear();
  await prisma.$disconnect();
});

test("flows lists internal flows only, with counts and channels", async () => {
  const { status, body } = await json(await flowsLoader({ request: req("/internal/flows") }));
  assert.equal(status, 200);
  const f = body.flows.find((x) => x.id === flow.id);
  assert.equal(f.enrollments, 1);
  assert.deepEqual(f.channels.sort(), ["email", "whatsapp"]);
  assert.ok(!body.flows.some((x) => x.id === otherFlow.id));
});

test("reporting is broker-only", async () => {
  process.env[secretEnvName("courierify")] = SECRET;
  try {
    assert.equal((await flowsLoader({ request: req("/internal/flows", { broker: false }) })).status, 401);
  } finally {
    delete process.env[secretEnvName("courierify")];
  }
  assert.equal((await flowsLoader({ request: req("/internal/flows", { secret: "x".repeat(40) }) })).status, 401);
});

test("flow enrollments carry per-channel engagement and the event's store", async () => {
  const { body } = await json(await enrollmentsLoader({ request: req(`/internal/flow-enrollments?flowId=${flow.id}`) }));
  assert.equal(body.enrollments.length, 1);
  const e = body.enrollments[0];
  assert.equal(e.email, EMAIL);
  assert.equal(e.shopDomain, "store-a.myshopify.com");
  assert.equal(e.state, "active");
  assert.deepEqual([e.emailStats.sent, e.emailStats.opened, e.emailStats.clicked], [1, 1, 1]);
  assert.deepEqual([e.whatsappStats.sent, e.whatsappStats.delivered, e.whatsappStats.read], [1, 1, 1]);
  const other = await enrollmentsLoader({ request: req(`/internal/flow-enrollments?flowId=${otherFlow.id}`) });
  assert.equal(other.status, 404);
});

test("contact activity lists the person's flows", async () => {
  const { body } = await json(await activityLoader({ request: req(`/internal/contact-activity?email=${EMAIL}`) }));
  assert.equal(body.enrollments[0].flowName, "Reporting test flow");
  assert.equal(body.enrollments[0].trigger, "courierify/installed");
});

test("managed segments are created, renamed, matched by tag, and pruned", async () => {
  const post = (body) => segmentsAction({ request: req("/internal/segments", { method: "POST", body }) }).then(json);
  const first = await post({ segments: [{ key: "rep-a", name: "Reporting A" }, { key: "rep-b", name: "Reporting B" }] });
  assert.deepEqual(first.body.segments.map((s) => s.status), ["created", "created"]);
  const again = await post({ segments: [{ key: "rep-a", name: "Reporting A2" }, { key: "rep-b", name: "Reporting B" }] });
  assert.deepEqual(again.body.segments.map((s) => s.status), ["exists", "exists"]);
  const segA = await prisma.segment.findUnique({ where: { id: again.body.segments[0].segmentId } });
  assert.equal(segA.name, "M360 · Reporting A2");

  // Membership is exactly the tagged contacts.
  const c = await prisma.contact.create({ data: { shop: INTERNAL_SHOP, email: EMAIL } });
  const tag = await prisma.tag.findUnique({ where: { shop_nameKey: { shop: INTERNAL_SHOP, nameKey: "m360:seg:rep-a" } } });
  await prisma.contactTag.create({ data: { contactId: c.id, tagId: tag.id, appliedByStepKey: "api:merchant360" } });
  assert.equal((await evaluateSegment(INTERNAL_SHOP, segA)).count, 1);

  // A hand-built segment is never pruned.
  const mine = await prisma.segment.create({ data: { shop: INTERNAL_SHOP, name: "M360 · Reporting hand-made", kind: "dynamic", filterTree: { type: "group", match: "all", children: [] } } });
  const pruned = await post({ segments: [{ key: "rep-a", name: "Reporting A2" }], prune: true });
  assert.equal(pruned.body.removed, 1);
  assert.equal((await prisma.segment.findUnique({ where: { id: mine.id } })).deletedAt, null);
  assert.equal((await post({ segments: [{ key: "Bad Key", name: "x" }] })).status, 400);

  // Narrowed by a person in Retainify: still recognised, not duplicated, their rule kept.
  const narrowed = { type: "group", match: "all", children: [segA.filterTree.children[0], { type: "rule", field: "emailsOpened", op: "gt", value: 0 }] };
  await prisma.segment.update({ where: { id: segA.id }, data: { filterTree: narrowed } });
  const after = await post({ segments: [{ key: "rep-a", name: "Reporting A2" }] });
  assert.equal(after.body.segments[0].status, "exists");
  assert.equal(after.body.segments[0].segmentId, segA.id);
  assert.equal((await prisma.segment.findUnique({ where: { id: segA.id } })).filterTree.children.length, 2);
  assert.equal(await prisma.segment.count({ where: { shop: INTERNAL_SHOP, name: "M360 · Reporting A2", deletedAt: null } }), 1);
});
