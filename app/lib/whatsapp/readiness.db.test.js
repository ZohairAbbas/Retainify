/**
 * WhatsApp readiness, what publish refuses, and what a skipped send records.
 *
 * Run: node --test app/lib/whatsapp/readiness.db.test.js  (DATABASE_URL → scratch DB)
 *
 * The failure these guard against is silence: a flow built and published with
 * a WhatsApp step whose channel could not send, every step "done", nothing
 * sent, and nowhere that said why.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { default: prisma } = await import("../../db.server.js");
const { whatsappReadiness, flowsUsingWhatsapp } = await import("./readiness.server.js");
const { validateFlowForPublish } = await import("../journey/flow-validation.server.js");
const { runWhatsappWorker } = await import("./whatsapp-worker.server.js");
const { WA_SKIP_PREFIX } = await import("./skip.js");
const { triggersFor, defaultTriggerFor } = await import("../triggerConfig.js");
const { SEND_BLOCKED_PREFIX } = await import("./index.server.js");

const SHOP = "__test__wa-readiness";
const EMAIL = "wa.readiness@example.com";

async function clear() {
  const js = await prisma.journey.findMany({ where: { shop: SHOP }, select: { id: true } });
  const ids = js.map((j) => j.id);
  await prisma.whatsappJob.deleteMany({ where: { shop: SHOP } });
  await prisma.journeyEnrollment.deleteMany({ where: { shop: SHOP } });
  await prisma.journeyStep.deleteMany({ where: { journeyId: { in: ids } } });
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.whatsappTemplate.deleteMany({ where: { shop: SHOP } });
  await prisma.whatsappSubscription.deleteMany({ where: { shop: SHOP } });
  await prisma.whatsappAccount.deleteMany({ where: { shop: SHOP } });
  await prisma.shopSettings.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.account.deleteMany({ where: { key: SHOP } });
}

/** Clean slate: a direct workspace with WhatsApp off and nothing connected. */
async function reset() {
  await clear();
  await prisma.account.create({ data: { key: SHOP, kind: "direct", name: "readiness test" } });
  await prisma.shopSettings.create({ data: { shop: SHOP } });
}

test.before(reset);
test.afterEach(reset);
test.after(async () => { await clear(); await prisma.$disconnect(); });

async function waFlow({ status = "draft", trigger = "segment_entered", withPush = false } = {}) {
  const j = await prisma.journey.create({
    data: { shop: SHOP, name: `WA ${Date.now()}`, trigger, triggerSegmentKey: "seg", status },
  });
  const step = await prisma.journeyStep.create({
    data: { journeyId: j.id, nodeType: "whatsapp", stepNumber: 1, positionY: 1, isEnabled: true, waTemplateName: "welcome", waLanguage: "en_US" },
  });
  if (withPush) {
    await prisma.journeyStep.create({
      data: { journeyId: j.id, nodeType: "push", stepNumber: 2, positionY: 2, isEnabled: true, pushTitle: "t", pushBody: "b" },
    });
  }
  return { journey: j, step };
}

test("readiness names the FIRST thing to fix, in order", async (t) => {
  t.after(async () => {
    await prisma.whatsappAccount.deleteMany({ where: { shop: SHOP } });
    await prisma.whatsappTemplate.deleteMany({ where: { shop: SHOP } });
    await prisma.shopSettings.update({ where: { shop: SHOP }, data: { whatsappEnabled: false } });
  });
  assert.equal((await whatsappReadiness(SHOP)).problem, "not_connected");

  await prisma.whatsappAccount.create({ data: { shop: SHOP, status: "connected", lastError: `${SEND_BLOCKED_PREFIX}token expired` } });
  const blocked = await whatsappReadiness(SHOP);
  assert.equal(blocked.problem, "blocked");
  assert.equal(blocked.blockedReason, "token expired");

  await prisma.whatsappAccount.update({ where: { shop: SHOP }, data: { lastError: "" } });
  assert.equal((await whatsappReadiness(SHOP)).problem, "disabled");

  await prisma.shopSettings.update({ where: { shop: SHOP }, data: { whatsappEnabled: true } });
  await prisma.whatsappTemplate.create({ data: { shop: SHOP, name: "welcome", language: "en_US", category: "UTILITY", status: "PENDING" } });
  const noTpl = await whatsappReadiness(SHOP);
  assert.equal(noTpl.problem, "no_templates");
  assert.equal(noTpl.pendingTemplates, 1);

  await prisma.whatsappTemplate.updateMany({ where: { shop: SHOP }, data: { status: "APPROVED" } });
  const ok = await whatsappReadiness(SHOP);
  assert.equal(ok.ready, true);
  assert.equal(ok.problem, null);
});

test("publish refuses an unconnected WhatsApp channel and says it is fixable", async (t) => {
  const { journey } = await waFlow();
  const v = await validateFlowForPublish(journey.id);
  assert.equal(v.ok, false);
  const e = v.errors.find((x) => /no WhatsApp Business account is connected/.test(x.message));
  assert.ok(e);
  assert.equal(e.fix, "whatsapp");
});

test("publish refuses a Shopify-only trigger and push steps in a direct workspace", async (t) => {
  const { journey } = await waFlow({ trigger: "customer_created", withPush: true });
  const msgs = (await validateFlowForPublish(journey.id)).errors.map((e) => e.message).join("\n");
  assert.match(msgs, /only fires for a connected Shopify store/);
  assert.match(msgs, /Push notifications need a storefront/);

  // The same flow in a Shopify workspace: neither complaint.
  await prisma.account.update({ where: { key: SHOP }, data: { kind: "shopify" } });
  const shopifyMsgs = (await validateFlowForPublish(journey.id)).errors.map((e) => e.message).join("\n");
  assert.doesNotMatch(shopifyMsgs, /only fires for a connected Shopify store/);
  assert.doesNotMatch(shopifyMsgs, /Push notifications need a storefront/);
});

test("a skipped WhatsApp send records why, and the flow list can find the affected flows", async (t) => {
  t.after(async () => {
    await prisma.whatsappJob.deleteMany({ where: { shop: SHOP } });
    await prisma.journeyEnrollment.deleteMany({ where: { shop: SHOP } });
    await prisma.whatsappAccount.deleteMany({ where: { shop: SHOP } });
    await prisma.shopSettings.update({ where: { shop: SHOP }, data: { whatsappEnabled: false } });
  });
  const { journey, step } = await waFlow({ status: "published" });
  assert.deepEqual((await flowsUsingWhatsapp(SHOP)).map((f) => f.id), [journey.id]);

  const job = async () => {
    const e = await prisma.journeyEnrollment.create({ data: { shop: SHOP, journeyId: journey.id, contactEmail: EMAIL } });
    return prisma.whatsappJob.create({ data: { shop: SHOP, enrollmentId: e.id, stepId: step.id, scheduledFor: new Date(Date.now() - 1000) } });
  };

  // 1. Channel not connected.
  const j1 = await job();
  await runWhatsappWorker();
  const r1 = await prisma.whatsappJob.findUnique({ where: { id: j1.id } });
  assert.equal(r1.status, "done");
  assert.equal(r1.sentAt, null);
  assert.equal(r1.lastError, `${WA_SKIP_PREFIX}WhatsApp is not connected`);

  // 2. Connected and on, but this contact never opted in.
  await prisma.whatsappAccount.create({ data: { shop: SHOP, status: "connected" } });
  await prisma.shopSettings.update({ where: { shop: SHOP }, data: { whatsappEnabled: true } });
  const j2 = await job();
  await runWhatsappWorker();
  const r2 = await prisma.whatsappJob.findUnique({ where: { id: j2.id } });
  assert.equal(r2.lastError, `${WA_SKIP_PREFIX}no confirmed WhatsApp opt-in`);
  assert.equal(r2.failedAt, null);
});

test("blank flows start on a trigger this workspace can fire", () => {
  assert.equal(defaultTriggerFor(true), "customer_created");
  assert.equal(defaultTriggerFor(false), "segment_entered");
  assert.equal(defaultTriggerFor(false, { isInternal: true }), "api_event");
  for (const [isShopify, isInternal] of [[true, false], [false, false], [false, true]]) {
    assert.ok(triggersFor(isShopify, { isInternal })[defaultTriggerFor(isShopify, { isInternal })]);
  }
  assert.equal(triggersFor(false).customer_created, undefined, "Shopify-only trigger hidden in direct workspaces");
});
