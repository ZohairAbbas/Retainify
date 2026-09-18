/**
 * The dashboard's per-email table: revenue per email, and where each row leads.
 *
 * Run: node --test app/lib/analytics/email-breakdown.db.test.js  (scratch DB)
 */
import test from "node:test";
import assert from "node:assert/strict";

const { default: prisma } = await import("../../db.server.js");
const { getEmailBreakdown } = await import("./stats.server.js");

const SHOP = "__test__email-breakdown";
const H = 60 * 60 * 1000;

async function clear() {
  const js = await prisma.journey.findMany({ where: { shop: SHOP }, select: { id: true } });
  const ids = js.map((j) => j.id);
  await prisma.journeyJob.deleteMany({ where: { shop: SHOP } });
  await prisma.journeyEnrollment.deleteMany({ where: { shop: SHOP } });
  await prisma.journeyStep.deleteMany({ where: { journeyId: { in: ids } } });
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.order.deleteMany({ where: { shop: SHOP } });
}
test.before(clear);
test.after(async () => { await clear(); await prisma.$disconnect(); });

async function emailStep(journey, n) {
  return prisma.journeyStep.create({
    data: { journeyId: journey.id, nodeType: "email", stepNumber: n, positionY: n, subject: `Email ${n}`, isEnabled: true },
  });
}

test("each email carries the revenue it earned and a link target", async () => {
  const flow = await prisma.journey.create({ data: { shop: SHOP, name: "Welcome", trigger: "customer_created", status: "published" } });
  const campaign = await prisma.journey.create({ data: { shop: SHOP, name: "September sale", trigger: "broadcast", status: "published" } });
  const s1 = await emailStep(flow, 1);
  const s2 = await emailStep(flow, 2);
  const c1 = await emailStep(campaign, 1);

  const now = Date.now();
  const send = async (step, journey, email, clicked) => {
    const e = await prisma.journeyEnrollment.create({ data: { shop: SHOP, journeyId: journey.id, contactEmail: email } });
    await prisma.journeyJob.create({
      data: {
        shop: SHOP, enrollmentId: e.id, stepId: step.id, scheduledFor: new Date(now - 5 * H), status: "done",
        sentAt: new Date(now - 5 * H), clickTracked: true,
        ...(clicked ? { openedAt: new Date(now - 4 * H), clickedAt: new Date(now - 4 * H) } : {}),
      },
    });
  };
  await send(s1, flow, "a@x.com", true);
  await send(s2, flow, "b@x.com", false);
  await send(c1, campaign, "c@x.com", true);
  // a@x.com clicked email 1 then bought; c@x.com clicked the campaign then bought twice.
  const order = (email, total, id) =>
    prisma.order.create({ data: { shop: SHOP, shopifyOrderId: id, email, totalPrice: total, currency: "PKR", financialStatus: "paid", processedAt: new Date(now - 2 * H) } });
  await order("a@x.com", 1500, "1");
  await order("c@x.com", 700, "2");
  await order("c@x.com", 300, "3");

  const rows = await getEmailBreakdown(SHOP, 30);
  const by = Object.fromEntries(rows.map((r) => [r.stepId, r]));

  assert.equal(by[s1.id].revenue, 1500);
  assert.equal(by[s1.id].orders, 1);
  assert.equal(by[s1.id].currency, "PKR");
  assert.equal(by[s2.id].revenue, 0, "measured and earned nothing — 0, not a dash");
  assert.equal(by[c1.id].revenue, 1000);
  assert.equal(by[c1.id].orders, 2);

  assert.equal(by[s1.id].isCampaign, false);
  assert.equal(by[s1.id].journeyId, flow.id);
  assert.equal(by[c1.id].isCampaign, true);
});

test("sends without click tracking report revenue as unmeasurable (null), not zero", async () => {
  await clear();
  const flow = await prisma.journey.create({ data: { shop: SHOP, name: "Untracked", trigger: "customer_created", status: "published" } });
  const s = await emailStep(flow, 1);
  const e = await prisma.journeyEnrollment.create({ data: { shop: SHOP, journeyId: flow.id, contactEmail: "z@x.com" } });
  await prisma.journeyJob.create({
    data: { shop: SHOP, enrollmentId: e.id, stepId: s.id, scheduledFor: new Date(), status: "done", sentAt: new Date(), clickTracked: false },
  });
  const [row] = await getEmailBreakdown(SHOP, 30);
  assert.equal(row.revenue, null);
  assert.equal(row.orders, null);
});
