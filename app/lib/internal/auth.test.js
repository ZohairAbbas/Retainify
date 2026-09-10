/**
 * Secret authentication for the internal API.
 *
 * Run: npm test   (or: node --test app/lib/internal/auth.test.js)
 *
 * No database: this is env, headers and a constant-time compare. The properties
 * worth pinning are the ones that are easy to regress into a hole — an empty or
 * placeholder secret matching, one app's secret opening another app's door, and
 * the response telling an attacker which apps exist.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { authenticateInternalCaller, secretEnvName } from "./auth.server.js";
import { __resetRateLimits } from "../security/rate-limit.server.js";

const SECRET = "s".repeat(40);
const OTHER_SECRET = "o".repeat(40);

function req(bearer) {
  return new Request("https://example.test/internal/enroll", {
    method: "POST",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

test.beforeEach(() => {
  __resetRateLimits();
  process.env[secretEnvName("courierify")] = SECRET;
  process.env[secretEnvName("financify")] = OTHER_SECRET;
  delete process.env[secretEnvName("unconfigured")];
});

test.after(() => {
  delete process.env[secretEnvName("courierify")];
  delete process.env[secretEnvName("financify")];
});

test("the right secret authenticates the app that owns it", () => {
  const result = authenticateInternalCaller(req(SECRET), "courierify");
  assert.equal(result.ok, true);
  assert.equal(result.app, "courierify");
});

test("one app's secret does not open another app's door", () => {
  const result = authenticateInternalCaller(req(OTHER_SECRET), "courierify");
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("a missing Authorization header is refused", () => {
  const result = authenticateInternalCaller(req(null), "courierify");
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("an unconfigured app is refused even with an empty presented secret", () => {
  // The bug this guards: `expected` unset and `presented` unset compare equal
  // under a naive ===, which would make every app nobody configured a valid one.
  const result = authenticateInternalCaller(req(""), "unconfigured");
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("a too-short secret in config is treated as unconfigured", () => {
  process.env[secretEnvName("weak")] = "changeme";
  const result = authenticateInternalCaller(req("changeme"), "weak");
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  delete process.env[secretEnvName("weak")];
});

test("an unconfigured app and a wrong secret are indistinguishable to the caller", () => {
  // Otherwise the endpoint enumerates which Growzar apps are wired up.
  const unknown = authenticateInternalCaller(req(SECRET), "unconfigured");
  const wrong = authenticateInternalCaller(req("nope".repeat(10)), "courierify");
  assert.equal(unknown.status, wrong.status);
  assert.equal(unknown.error, wrong.error);
});

test("a malformed app name is a 400, not a 401", () => {
  // The caller can fix this one, and saying so saves them guessing at secrets.
  const result = authenticateInternalCaller(req(SECRET), "Courierify Prod");
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test("a missing app name is refused", () => {
  const result = authenticateInternalCaller(req(SECRET), undefined);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test("sustained calls from one app are rate limited", () => {
  let last;
  for (let i = 0; i < 200; i++) {
    last = authenticateInternalCaller(req(SECRET), "courierify");
  }
  assert.equal(last.ok, false);
  assert.equal(last.status, 429);
});

test("one app hitting its rate limit does not lock out another", () => {
  for (let i = 0; i < 200; i++) authenticateInternalCaller(req(SECRET), "courierify");
  const other = authenticateInternalCaller(req(OTHER_SECRET), "financify");
  assert.equal(other.ok, true);
});
