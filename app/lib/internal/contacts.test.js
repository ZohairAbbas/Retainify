/**
 * Input validation for the internal API.
 *
 * Run: npm test   (or: node --test app/lib/internal/contacts.test.js)
 *
 * These reject rather than repair, which is the property being pinned. A
 * lifecycle API that quietly rewrites what a caller sent leaves the caller
 * posting one string and us acting on another, and nothing anywhere says so.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { validateInternalEmail } from "./contacts.server.js";
import { validateExternalKey } from "../triggerConfig.js";

test("a normal address is accepted and lowercased", () => {
  const r = validateInternalEmail("  Merchant@Example.COM ");
  assert.equal(r.ok, true);
  assert.equal(r.email, "merchant@example.com");
});

test("a bare mailbox with no domain is refused", () => {
  assert.equal(validateInternalEmail("merchant").ok, false);
});

test("an empty address is refused", () => {
  assert.equal(validateInternalEmail("").ok, false);
  assert.equal(validateInternalEmail(undefined).ok, false);
});

test("a .internal placeholder address is refused", () => {
  // The exact mistake the original phone-primary design would have made:
  // {phone}@growzar.internal is undeliverable, and the email worker checks
  // suppression rather than consent, so every one of these would have
  // hard-bounced against our own sending domain.
  const r = validateInternalEmail("923001234567@growzar.internal");
  assert.equal(r.ok, false);
  assert.match(r.error, /real, deliverable/);
});

test("an external key accepts the documented grammar", () => {
  const r = validateExternalKey("setup_completed", "event");
  assert.equal(r.ok, true);
  assert.equal(r.key, "setup_completed");
});

test("an external key is not silently slugified", () => {
  // Repairing this would leave the calling app posting "Setup Completed"
  // forever, matching no flow, with no error to go on.
  const r = validateExternalKey("Setup Completed", "event");
  assert.equal(r.ok, false);
  assert.match(r.error, /lowercase/);
});

test("an external key rejects punctuation that would not survive a round trip", () => {
  for (const bad of ["a-b", "a.b", "a/b", "a b", "Ab"]) {
    assert.equal(validateExternalKey(bad).ok, false, `${bad} should be refused`);
  }
});

test("an over-long external key is refused", () => {
  assert.equal(validateExternalKey("a".repeat(65)).ok, false);
  assert.equal(validateExternalKey("a".repeat(64)).ok, true);
});
