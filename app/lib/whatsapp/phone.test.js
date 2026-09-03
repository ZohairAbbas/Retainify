/**
 * E.164 validation for WhatsApp recipients.
 *
 * The stakes are why this is tested rather than eyeballed: Meta answers a
 * national-format number with a permanent-failure code, and the worker reacts
 * to a permanent failure by adding the number to WhatsappSuppression — so one
 * bad format does not fail a send, it costs the shop that subscriber for good.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toE164, normalizePhone } from "../contacts/contacts.server.js";

test("accepts full international numbers, stripping punctuation", () => {
  assert.deepEqual(toE164("+44 7700 900123"), { ok: true, phone: "447700900123" });
  assert.deepEqual(toE164("447700900123"), { ok: true, phone: "447700900123" });
  assert.deepEqual(toE164("+1 (555) 123-4567"), { ok: true, phone: "15551234567" });
});

test("accepts the 00 international dialling prefix", () => {
  // Already a correct international number, just written the long way — this
  // must not be treated as a national trunk zero.
  assert.deepEqual(toE164("00447700900123"), { ok: true, phone: "447700900123" });
});

test("rejects a national trunk zero rather than guessing a country", () => {
  const res = toE164("07700900123");
  assert.equal(res.ok, false);
  assert.match(res.error, /country code/i);
});

test("rejects numbers that are too short or too long for E.164", () => {
  assert.equal(toE164("12345").ok, false);
  assert.equal(toE164("1234567890123456").ok, false);
});

test("rejects empty input", () => {
  assert.equal(toE164("").ok, false);
  assert.equal(toE164(null).ok, false);
  assert.equal(toE164(undefined).ok, false);
});

test("normalizePhone stays permissive — it backs Contact.phone, not sending", () => {
  // A number captured at checkout is worth storing even when WhatsApp can't
  // use it, so the two functions are deliberately not the same rule.
  assert.equal(normalizePhone("07700 900123"), "07700900123");
  assert.equal(toE164("07700 900123").ok, false);
});
