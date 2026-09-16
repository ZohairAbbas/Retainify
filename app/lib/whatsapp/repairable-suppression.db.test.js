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

/**
 * One shop per test, not one per file.
 *
 * runWhatsappWorker() claims every due job in the queue, not just this test's.
 * With a shared shop the second test's job was already pending when the first
 * test ran the worker, so both were processed in one pass and the genuine
 * suppression appeared while the first test was asserting it had not. Scoping
 * by shop keeps the two cases from seeing each other's rows.
 */
const SHOPS = {
  repairable: "__test__wa-repairable-a",
  genuine: "__test__wa-repairable-b",
};
const ALL_SHOPS = Object.values(SHOPS);
const EMAIL = "buyer@example.test";

/**
 * Stored with the trunk zero — 13 digits, the shape the old toE164 let through.
 *
 * Every phone fixture in the suite has to be unique in its REPAIRED form, not
 * just as written: node --test runs files concurrently against one database, and
 * WhatsappSubscription is unique on [shop, phoneNumber]. 9203001234567 repairs
 * to 923001234567, which is exactly the number internal/routes.db.test.js opts
 * in — so that file's recordOptIn rewrote this fixture mid-send and the guard
 * saw a well-formed number. 9207… is used by nothing else, in either form.
 */
const BROKEN = "9207001234567";
/** What it should have been all along, and what the worker actually dials. */
const REPAIRED = "927001234567";

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
async function seed(shop, { storedPhone }) {
  await cleanupShop(shop);

  await prisma.account.create({
    data: { key: shop, kind: "direct", name: "repairable test" },
  });
  await prisma.shopSettings.create({
    data: { shop, whatsappEnabled: true, whatsappRequireOptIn: true },
  });
  await prisma.whatsappAccount.create({
    data: {
      shop,
      wabaId: "waba",
      phoneNumberId: "pnid",
      accessTokenEnc: encryptSecret("token"),
      status: "connected",
      registeredAt: new Date(),
    },
  });

  await prisma.contact.create({
    data: { shop, email: EMAIL, phone: storedPhone, whatsappStatus: "subscribed" },
  });
  const sub = await prisma.whatsappSubscription.create({
    data: {
      shop,
      phoneNumber: storedPhone,
      contactEmail: EMAIL,
      status: "subscribed",
      confirmedAt: new Date(),
    },
  });

  const journey = await prisma.journey.create({
    data: { shop, name: "wa test", trigger: "order_placed", status: "published" },
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
    data: { shop, journeyId: journey.id, contactEmail: EMAIL },
  });
  const job = await prisma.whatsappJob.create({
    data: {
      shop,
      enrollmentId: enrollment.id,
      stepId: step.id,
      scheduledFor: new Date(Date.now() - 1000),
      status: "pending",
    },
  });
  return { job, sub };
}

async function cleanupShop(shop) {
  await prisma.whatsappJob.deleteMany({ where: { shop } });
  await prisma.journeyEnrollment.deleteMany({ where: { shop } });
  await prisma.journeyStep.deleteMany({ where: { journey: { shop } } });
  await prisma.journey.deleteMany({ where: { shop } });
  await prisma.whatsappSuppression.deleteMany({ where: { shop } });
  await prisma.whatsappSubscription.deleteMany({ where: { shop } });
  await prisma.whatsappAccount.deleteMany({ where: { shop } });
  await prisma.contact.deleteMany({ where: { shop } });
  await prisma.shopSettings.deleteMany({ where: { shop } });
  await prisma.account.deleteMany({ where: { key: shop } });
}

const cleanup = () => Promise.all(ALL_SHOPS.map(cleanupShop));

test.beforeEach(() => {
  __resetShopHealthCache?.();
});

test.after(async () => {
  globalThis.fetch = realFetch;
  await cleanup();
});

test("a rejection on a repairable number suppresses nothing and keeps the subscriber", async () => {
  const shop = SHOPS.repairable;
  const { job, sub } = await seed(shop, { storedPhone: BROKEN });
  metaRejects();

  await runWhatsappWorker();

  // The harm this whole item exists to prevent: an unrecoverable suppression.
  const suppression = await prisma.whatsappSuppression.findUnique({
    where: { shop_phoneNumber: { shop, phoneNumber: REPAIRED } },
  });
  assert.equal(suppression, null, "no suppression may be written for a repairable number");
  assert.equal(
    await prisma.whatsappSuppression.count({ where: { shop } }),
    0,
    "no suppression under any spelling of the number",
  );

  // Consent survives intact, so the data repair can still recover this buyer.
  const after = await prisma.whatsappSubscription.findUnique({ where: { id: sub.id } });
  assert.equal(after.status, "subscribed", "subscription must not be flipped to invalid");

  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop, email: EMAIL } },
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
  const shop = SHOPS.genuine;
  const { job, sub } = await seed(shop, { storedPhone: REPAIRED });
  metaRejects();

  await runWhatsappWorker();

  const suppression = await prisma.whatsappSuppression.findUnique({
    where: { shop_phoneNumber: { shop, phoneNumber: REPAIRED } },
  });
  assert.ok(suppression, "a genuine permanent failure must still suppress");
  assert.equal(suppression.reason, "invalid");

  const after = await prisma.whatsappSubscription.findUnique({ where: { id: sub.id } });
  assert.equal(after.status, "invalid");

  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop, email: EMAIL } },
  });
  assert.equal(contact.whatsappStatus, "invalid");

  const doneJob = await prisma.whatsappJob.findUnique({ where: { id: job.id } });
  assert.equal(doneJob.status, "done", "the existing suppression path marks the job done");
});
