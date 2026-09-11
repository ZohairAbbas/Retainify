/* global globalThis */
/**
 * Account-level send failures: classification, recording, and clearing.
 *
 * Run: npm test   (or: node --test app/lib/whatsapp/send-outcome.db.test.js)
 *
 * ── What this pins ─────────────────────────────────────────────────────────
 * A WhatsApp error that blocks the whole account — an expired token, an
 * unregistered number, a WhatsApp-provided +1 555 number whose display name is
 * unapproved (131037) — used to fail silently in two ways:
 *
 *   1. It was classified TRANSIENT, so a queued campaign retried for 24h and
 *      then failed every job for good. A display-name review that takes two
 *      days discarded the whole campaign. It must be OPS: held, not failed.
 *   2. Only the worker recorded it, and the WhatsApp page showed it only for a
 *      DISCONNECTED account. A merchant pressing "Send test" saw a toast and
 *      then a healthy-looking channel.
 *
 * Meta's HTTP is stubbed; the account row and the seam are real, because the
 * recording and the clearing are database writes keyed on a prefix, and the
 * prefix is what keeps an unrelated connect-time note from being wiped.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// The seam decrypts the stored token; give the test a key if the environment
// has none, before anything imports the crypto module.
process.env.WHATSAPP_TOKEN_KEY ||= randomBytes(32).toString("base64");

const { default: prisma } = await import("../../db.server.js");
const { encryptSecret } = await import("../crypto/secrets.server.js");
const { sendWhatsapp, sendBlockedReason, SEND_BLOCKED_PREFIX } = await import("./index.server.js");
const { decideFailureOutcome, OPS, PERMANENT, TRANSIENT } = await import(
  "../journey/failure-policy.server.js"
);

const SHOP = "__test__wa-send-outcome.myshopify.com";
const realFetch = globalThis.fetch;

/** Make the next Graph call answer with this status and body. */
function meta(status, body) {
  globalThis.fetch = async () => ({ ok: status < 400, status, json: async () => body });
}
const metaError = (code, message = "x") => meta(400, { error: { code, message } });
const metaOk = () => meta(200, { messages: [{ id: "wamid.TEST" }] });

async function account(extra = {}) {
  await prisma.whatsappAccount.deleteMany({ where: { shop: SHOP } });
  return prisma.whatsappAccount.create({
    data: {
      shop: SHOP,
      wabaId: "waba",
      phoneNumberId: "pnid",
      accessTokenEnc: encryptSecret("token"),
      status: "connected",
      registeredAt: new Date(),
      ...extra,
    },
  });
}
const send = () => sendWhatsapp({ to: "447700900001", templateName: "t", language: "en_US" }, { shop: SHOP });
const lastError = async () =>
  (await prisma.whatsappAccount.findUnique({ where: { shop: SHOP } })).lastError;

test.after(async () => {
  globalThis.fetch = realFetch;
  await prisma.whatsappAccount.deleteMany({ where: { shop: SHOP } });
});

test("131037 is an account error, classified OPS, with a message naming the fix", async () => {
  await account();
  metaError(131037, "(#131037) WhatsApp provided number needs display name approval");
  const result = await send();

  assert.equal(result.ok, false);
  assert.equal(result.accountError, true);
  assert.equal(result.errorClass, OPS);
  assert.match(result.error, /display name/i);
  assert.match(result.error, /WhatsApp Manager/);
});

test("an account error is recorded on the account, from any send path", async () => {
  await account();
  metaError(131037);
  await send();

  const row = await prisma.whatsappAccount.findUnique({ where: { shop: SHOP } });
  assert.ok(row.lastError.startsWith(SEND_BLOCKED_PREFIX));
  assert.match(sendBlockedReason(row), /display name/i);
});

test("a successful send clears the block", async () => {
  await account();
  metaError(190, "token expired");
  await send();
  assert.ok((await lastError()).startsWith(SEND_BLOCKED_PREFIX));

  metaOk();
  const result = await send();
  assert.equal(result.ok, true);
  assert.equal(await lastError(), "");
});

test("a success never clears an unrelated connect-time note", async () => {
  // lastError also carries e.g. a failed webhook subscription. That has its own
  // panel and its own retry, and a send succeeding says nothing about it.
  const note = "Connected, but we couldn't subscribe to WhatsApp events: boom";
  await account({ lastError: note });
  metaOk();
  await send();
  assert.equal(await lastError(), note);
});

test("a bad recipient is PERMANENT and does not mark the account", async () => {
  await account();
  metaError(131026);
  const result = await send();
  assert.equal(result.invalid, true);
  assert.equal(result.accountError, false);
  assert.equal(result.errorClass, PERMANENT);
  assert.equal(await lastError(), "");
});

test("an unrecognised failure stays TRANSIENT", async () => {
  await account();
  meta(500, { error: { code: 1, message: "An unknown error occurred" } });
  const result = await send();
  assert.equal(result.errorClass, TRANSIENT);
  assert.equal(result.accountError, false);
});

test("OPS holds a job without spending its budget — the reason for the class", () => {
  // Past the transient horizon a TRANSIENT failure is final; an OPS one is not.
  const firstFailedAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const ops = decideFailureOutcome({ errorClass: OPS, attempts: 11, firstFailedAt });
  const transient = decideFailureOutcome({ errorClass: TRANSIENT, attempts: 11, firstFailedAt });

  assert.equal(ops.status, "pending");
  assert.equal(ops.consumesAttempt, false);
  assert.equal(transient.status, "failed");
});
