/**
 * Broadcast audience resolution, per channel.
 *
 * Run: npm test   (or: node --test app/lib/journey/broadcast-audience.db.test.js)
 *
 * ── Why this needs a database ──────────────────────────────────────────────
 * The audience is assembled from four tables that disagree with each other on
 * purpose — Contact, WhatsappSubscription, WhatsappSuppression and ShopSettings
 * — and the whole contract is which of them wins. A mocked prisma would only
 * assert the shape of the code that was written, not that a suppressed number
 * actually drops out of a real query.
 *
 * ── What is actually at stake ──────────────────────────────────────────────
 * Two failures, in opposite directions, and neither throws:
 *
 *   1. Too loose. A WhatsApp opt-out that still receives a broadcast is not a
 *      miscount — it is messaging someone who told Meta to stop, which is the
 *      thing that gets a number restricted.
 *   2. Too tight, or simply different from the worker. The count shown before
 *      sending is a promise; if it does not match what the worker will do, the
 *      merchant reads "4,000 contacts" and a fraction of them arrive.
 *
 * So these tests pin the rule to processWhatsappJob's own recipient
 * resolution, case by case, rather than to anything this module invented.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { resolveAudience, countUnreachableWhatsappSubscribers } from "./broadcast.server.js";

const SHOP = "__test__broadcast-audience.myshopify.com";

async function wipe() {
  await prisma.whatsappSubscription.deleteMany({ where: { shop: SHOP } });
  await prisma.whatsappSuppression.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.shopSettings.deleteMany({ where: { shop: SHOP } });
}

/** @param {{requireOptIn?: boolean}} opts */
async function settings({ requireOptIn = true } = {}) {
  await prisma.shopSettings.upsert({
    where: { shop: SHOP },
    create: { shop: SHOP, whatsappRequireOptIn: requireOptIn },
    update: { whatsappRequireOptIn: requireOptIn },
  });
}

async function contact(email, extra = {}) {
  return prisma.contact.create({
    data: { shop: SHOP, email, subscriptionStatus: "subscribed", ...extra },
  });
}

async function optIn(email, phoneNumber, { confirmed = true, status = "subscribed" } = {}) {
  return prisma.whatsappSubscription.create({
    data: {
      shop: SHOP,
      phoneNumber,
      contactEmail: email,
      status,
      confirmedAt: confirmed ? new Date() : null,
    },
  });
}

const emailsOf = async (channel) =>
  (await resolveAudience(SHOP, null, channel)).map((c) => c.email).sort();

test.before(wipe);
test.after(wipe);

test("a confirmed opt-in is reachable; an unconfirmed one is not", async () => {
  await wipe();
  await settings({ requireOptIn: true });
  await contact("confirmed@example.com");
  await contact("pending@example.com");
  await optIn("confirmed@example.com", "447700900001");
  // The worker reads confirmedAt, not status — a subscribed row without it is
  // not sendable, and counting it would overstate the audience.
  await optIn("pending@example.com", "447700900002", { confirmed: false });

  assert.deepEqual(await emailsOf("whatsapp"), ["confirmed@example.com"]);
});

test("an email unsubscribe does not remove a WhatsApp opt-in", async () => {
  await wipe();
  await settings({ requireOptIn: true });
  // The case that makes the two channels genuinely separate. Filtering the
  // WhatsApp audience on subscriptionStatus would silently drop exactly the
  // people who chose WhatsApp *instead of* email.
  await contact("nomail@example.com", { subscriptionStatus: "unsubscribed" });
  await optIn("nomail@example.com", "447700900003");

  assert.deepEqual(await emailsOf("whatsapp"), ["nomail@example.com"]);
  assert.deepEqual(await emailsOf("email"), []);
});

test("a suppressed number is excluded even with a valid opt-in", async () => {
  await wipe();
  await settings({ requireOptIn: true });
  await contact("stopped@example.com");
  await optIn("stopped@example.com", "447700900004");
  await prisma.whatsappSuppression.create({
    data: { shop: SHOP, phoneNumber: "447700900004", reason: "opt_out" },
  });

  assert.deepEqual(await emailsOf("whatsapp"), []);
});

test("a number that is not valid E.164 is excluded rather than sent and suppressed", async () => {
  await wipe();
  await settings({ requireOptIn: true });
  await contact("national@example.com");
  // Stored before toE164 was enforced at the opt-in path. Sending it would earn
  // a permanent-failure code and suppress the subscriber for good.
  await optIn("national@example.com", "07700900123");

  assert.deepEqual(await emailsOf("whatsapp"), []);
});

test("with require-opt-in off, a contact's own phone counts — mirroring the worker", async () => {
  await wipe();
  await settings({ requireOptIn: false });
  await contact("hasphone@example.com", { phone: "447700900005" });
  await contact("nophone@example.com");
  // Explicitly opted out or invalid is never messaged, on any setting.
  await contact("optedout@example.com", { phone: "447700900006", whatsappStatus: "unsubscribed" });
  await contact("bad@example.com", { phone: "447700900007", whatsappStatus: "invalid" });

  assert.deepEqual(await emailsOf("whatsapp"), ["hasphone@example.com"]);
});

test("with require-opt-in on, a bare phone is not enough", async () => {
  await wipe();
  await settings({ requireOptIn: true });
  await contact("hasphone@example.com", { phone: "447700900005" });

  assert.deepEqual(await emailsOf("whatsapp"), []);
});

test("the email audience is unchanged by any of this", async () => {
  await wipe();
  await settings({ requireOptIn: true });
  await contact("a@example.com");
  await contact("b@example.com", { subscriptionStatus: "unsubscribed" });
  await optIn("a@example.com", "447700900008");

  assert.deepEqual(await emailsOf("email"), ["a@example.com"]);
});

test("subscribers with no reachable contact record are counted, not hidden", async () => {
  await wipe();
  await settings({ requireOptIn: true });
  await contact("known@example.com");
  await optIn("known@example.com", "447700900009");
  // Enrollment is keyed on a contact email, so neither of these can be reached
  // by a campaign however valid their consent is.
  await prisma.whatsappSubscription.create({
    data: { shop: SHOP, phoneNumber: "447700900010", contactEmail: null, confirmedAt: new Date() },
  });
  await optIn("ghost@example.com", "447700900011");

  assert.equal(await countUnreachableWhatsappSubscribers(SHOP), 2);
  assert.deepEqual(await emailsOf("whatsapp"), ["known@example.com"]);
});
