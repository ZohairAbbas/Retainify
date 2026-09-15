/* global globalThis */
/**
 * A Meta rejection of a mis-formatted number must not suppress the buyer.
 *
 * Run: npm test   (or: node --test app/lib/whatsapp/repairable-suppression.db.test.js)
 *
 * ── What this pins ─────────────────────────────────────────────────────────
 * toE164 used to accept a Pakistani trunk zero sitting after the country code
 * (+92 0300 1234567), because the leading-zero rejection only looked at position
 * 0. That number was stored as a subscriber, sent, and rejected by Meta with a
 * permanent-failure code — at which point the worker wrote a WhatsappSuppression,
 * flipped the subscription to "invalid", and set Contact.whatsappStatus to
 * "invalid". The buyer became unreachable on WhatsApp forever because of a
 * formatting error, and no amount of fixing the number afterwards undid it.
 *
 * Two things now stand between that number and a permanent suppression: the
 * repair in toE164, and this branch, which refuses to trust Meta's verdict for a
 * number whose STORED digits differ from what we dialled. The second matters on
 * its own because rows written before the repair existed are still in the
 * database — the repair fixes new opt-ins, this keeps the old ones recoverable.
 *
 * Meta's HTTP is stubbed. Everything else is real: the suppression, the
 * subscription status and the contact flag are all database writes, and "did not
 * write" is exactly the property under test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.WHATSAPP_TOKEN_KEY ||= randomBytes(32).toString("base64");

const { default: prisma } = await import("../../db.server.js");
const { encryptSecret } = await import("../crypto/secrets.server.js");
const { runWhatsappWorker } = await import("./whatsapp-worker.server.js");
const { __resetShopHealthCache } = await import("../shopify/shop-health.server.js").catch(() => ({}));

const SHOP = "__test__wa-repairable";
const EMAIL = "buyer@example.test";

/** Stored with the trunk zero — 13 digits, the shape the old toE164 let through. */
const BROKEN = "9203001234567";
/** What it should have been all along, and what the worker actually dials. */
const REPAIRED = "923001234567";

const realFetch = globalThis.fetch;

/** 131026 — "message undeliverable", one of the codes that means permanent. */
function metaRejects() {
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { code: 131026, message: "Message undeliverable" } }),
  });
}

/**
 * A whole journey standing behind one due WhatsApp job.
 *
 * The workspace is kind "direct" on purpose: checkShopHealth short-circuits to
 * SHOP_LIVE for a storeless workspace, so the worker never probes Shopify and
 * the test needs no session fixture and no network.
 */
async function seed({ storedPhone }) {
  await cleanup();

  await prisma.account.create({
    data: { key: SHOP, kind: "direct", name: "repairable test" },
  });
  await prisma.shopSettings.create({
    data: { shop: SHOP, whatsappEnabled: true, whatsappRequireOptIn: true },
  });
  await prisma.whatsappAccount.create({
    data: {
      shop: SHOP,
      wabaId: "waba",
      phoneNumberId: "pnid",
      accessTokenEnc: encryptSecret("token"),
      status: "connected",
      registeredAt: new Date(),
    },
  });

  await prisma.contact.create({
    data: { shop: SHOP, email: EMAIL, phone: storedPhone, whatsappStatus: "subscribed" },
  });
  const sub = await prisma.whatsappSubscription.create({
    data: {
      shop: SHOP,
      phoneNumber: storedPhone,
      contactEmail: EMAIL,
      status: "subscribed",
      confirmedAt: new Date(),
    },
  });

  const journey = await prisma.journey.create({
    data: { shop: SHOP, name: "wa test", trigger: "order_placed", status: "published" },
  });
  const step = await prisma.journeyStep.create({
    data: {
      journeyId: journey.id,
      stepNumber: 1,
      nodeType: "whatsapp",
      waTemplateName: "tpl",
      waLanguage: "en_US",
    },
  });
  const enrollment = await prisma.journeyEnrollment.create({
    data: { shop: SHOP, journeyId: journey.id, contactEmail: EMAIL },
  });
  const job = await prisma.whatsappJob.create({
    data: {
      shop: SHOP,
      enrollmentId: enrollment.id,
      stepId: step.id,
      scheduledFor: new Date(Date.now() - 1000),
      status: "pending",
    },
  });
  return { job, sub };
}

async function cleanup() {
  await prisma.whatsappJob.deleteMany({ where: { shop: SHOP } });
  await prisma.journeyEnrollment.deleteMany({ where: { shop: SHOP } });
  await prisma.journeyStep.deleteMany({ where: { journey: { shop: SHOP } } });
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.whatsappSuppression.deleteMany({ where: { shop: SHOP } });
  await prisma.whatsappSubscription.deleteMany({ where: { shop: SHOP } });
  await prisma.whatsappAccount.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.shopSettings.deleteMany({ where: { shop: SHOP } });
  await prisma.account.deleteMany({ where: { key: SHOP } });
}

test.beforeEach(() => {
  __resetShopHealthCache?.();
});

test.after(async () => {
  globalThis.fetch = realFetch;
  await cleanup();
});

test("a rejection on a repairable number suppresses nothing and keeps the subscriber", async () => {
  const { job, sub } = await seed({ storedPhone: BROKEN });
  metaRejects();

  await runWhatsappWorker();

  // The harm this whole item exists to prevent: an unrecoverable suppression.
  const suppression = await prisma.whatsappSuppression.findUnique({
    where: { shop_phoneNumber: { shop: SHOP, phoneNumber: REPAIRED } },
  });
  assert.equal(suppression, null, "no suppression may be written for a repairable number");
  assert.equal(
    await prisma.whatsappSuppression.count({ where: { shop: SHOP } }),
    0,
    "no suppression under any spelling of the number",
  );

  // Consent survives intact, so the data repair can still recover this buyer.
  const after = await prisma.whatsappSubscription.findUnique({ where: { id: sub.id } });
  assert.equal(after.status, "subscribed", "subscription must not be flipped to invalid");

  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop: SHOP, email: EMAIL } },
  });
  assert.equal(contact.whatsappStatus, "subscribed", "contact must not be flagged invalid");

  // The job itself is finished — retrying identical wrong digits helps nobody —
  // and says why, so the failure is legible without guessing.
  const doneJob = await prisma.whatsappJob.findUnique({ where: { id: job.id } });
  assert.equal(doneJob.status, "failed");
  assert.match(doneJob.lastError, /repairable/i);
});

test("a rejection on a correctly-stored number still suppresses, as it must", async () => {
  // The guard is narrow by design. A genuine dead recipient — nothing wrong with
  // the digits — must still be suppressed, or the shop keeps paying Meta to
  // message a number that does not exist.
  const { job, sub } = await seed({ storedPhone: REPAIRED });
  metaRejects();

  await runWhatsappWorker();

  const suppression = await prisma.whatsappSuppression.findUnique({
    where: { shop_phoneNumber: { shop: SHOP, phoneNumber: REPAIRED } },
  });
  assert.ok(suppression, "a genuine permanent failure must still suppress");
  assert.equal(suppression.reason, "invalid");

  const after = await prisma.whatsappSubscription.findUnique({ where: { id: sub.id } });
  assert.equal(after.status, "invalid");

  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop: SHOP, email: EMAIL } },
  });
  assert.equal(contact.whatsappStatus, "invalid");

  const doneJob = await prisma.whatsappJob.findUnique({ where: { id: job.id } });
  assert.equal(doneJob.status, "done", "the existing suppression path marks the job done");
});
