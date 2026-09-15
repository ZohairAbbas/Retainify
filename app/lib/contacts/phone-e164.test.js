/**
 * toE164 — international format, and the Pakistan trunk-zero repair.
 *
 * Run: npm test   (or: node --test app/lib/contacts/phone-e164.test.js)
 *
 * No database: this is pure string handling. What makes it worth pinning is the
 * blast radius of getting it wrong in either direction. Too lax and a
 * mis-formatted number is accepted, sent, rejected by Meta, and the buyer is
 * permanently suppressed over a formatting slip. Too eager and a number that was
 * already correct gets rewritten into one that belongs to somebody else.
 *
 * The repair is deliberately narrow — one country, one unambiguous shape — so
 * these tests guard the boundary on both sides of it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { toE164, isRepairableFormat, normalizePhone } from "./contacts.server.js";

test("a correct PK number passes through untouched", () => {
  for (const input of ["923001234567", "+923001234567", "+92 300 1234567", "+92-300-1234567"]) {
    assert.deepEqual(toE164(input), { ok: true, phone: "923001234567" }, `input: ${input}`);
  }
});

test("a trunk zero after the country code is repaired, not accepted as-is", () => {
  // The bug: the leading-zero check only looked at position 0, so these were
  // accepted verbatim as 13-digit numbers that Meta rejects permanently.
  for (const input of ["+9203001234567", "9203001234567", "0092 03001234567", "+92 0300 1234567"]) {
    assert.deepEqual(toE164(input), { ok: true, phone: "923001234567" }, `input: ${input}`);
  }
});

test("a national-format number is still rejected — the country code is genuinely missing", () => {
  // Unlike the trunk-zero case there is no country to infer, so repairing it
  // would be a guess. Rejecting while the shopper is still on the page is the
  // only place this can be corrected.
  const result = toE164("03001234567");
  assert.equal(result.ok, false);
  assert.match(result.error, /country code/i);
});

test("a non-PK number is never touched by the repair", () => {
  // 920 is a legitimate prefix elsewhere in the digit string; the repair must
  // not fire on length or prefix coincidence alone.
  assert.deepEqual(toE164("447700900123"), { ok: true, phone: "447700900123" });
  assert.deepEqual(toE164("+1 415 555 0132"), { ok: true, phone: "14155550132" });
  // Saudi Arabia is +966 — a "920" appearing mid-number must not be rewritten.
  assert.deepEqual(toE164("966920123456"), { ok: true, phone: "966920123456" });
});

test("920 with the wrong digit count is left alone", () => {
  // The repair claims only the one unambiguous shape: 920 + exactly 10 digits.
  // A 12-digit 920… number is a valid E.164 number in its own right and must
  // survive untouched, or the repair would corrupt good data.
  assert.deepEqual(toE164("920123456789"), { ok: true, phone: "920123456789" });
});

test("the 00 international prefix is stripped before the repair runs", () => {
  assert.deepEqual(toE164("00447700900123"), { ok: true, phone: "447700900123" });
  assert.deepEqual(toE164("00923001234567"), { ok: true, phone: "923001234567" });
});

test("length bounds still hold", () => {
  assert.equal(toE164("1234567").ok, false, "7 digits is too short");
  assert.equal(toE164("1234567890123456").ok, false, "16 digits exceeds E.164");
  assert.equal(toE164("").ok, false);
  assert.equal(toE164(null).ok, false);
});

test("isRepairableFormat identifies exactly what the repair rewrites", () => {
  // This predicate decides whether a Meta rejection is trustworthy, so it must
  // agree with toE164 rather than drift from it.
  for (const repairable of ["9203001234567", "+9203001234567", "0092 03001234567"]) {
    assert.equal(isRepairableFormat(repairable), true, `repairable: ${repairable}`);
    // The defining property: the stored digits differ from what we'd send.
    assert.notEqual(normalizePhone(repairable), toE164(repairable).phone);
  }

  for (const clean of ["923001234567", "447700900123", "03001234567", "920123456789", ""]) {
    assert.equal(isRepairableFormat(clean), false, `not repairable: ${clean}`);
  }
});
