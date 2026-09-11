/**
 * Which apps can send events, and which workspaces are offered the trigger.
 *
 * Run: npm test   (or: node --test app/lib/internal/apps.test.js)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { configuredApps, isConfiguredApp } from "./apps.server.js";
import { triggersFor } from "../triggerConfig.js";

test("apps are read from secret variable names, lowercased and sorted", () => {
  const env = {
    INTERNAL_APP_SECRET_FINANCIFY: "x".repeat(40),
    INTERNAL_APP_SECRET_COURIERIFY: "y".repeat(40),
    UNRELATED: "z",
  };
  assert.deepEqual(configuredApps(env), ["courierify", "financify"]);
});

test("an empty secret does not make an app available", () => {
  assert.deepEqual(configuredApps({ INTERNAL_APP_SECRET_FINANCIFY: "" }), []);
});

test("a name the event API could never accept is skipped, not repaired", () => {
  assert.deepEqual(configuredApps({ "INTERNAL_APP_SECRET_MY-APP": "x".repeat(40) }), []);
});

test("isConfiguredApp matches the same variables", () => {
  const env = { INTERNAL_APP_SECRET_FINANCIFY: "x".repeat(40) };
  assert.equal(isConfiguredApp("financify", env), true);
  assert.equal(isConfiguredApp("courierify", env), false);
  assert.equal(isConfiguredApp("", env), false);
});

test("the App event trigger is offered to the internal tenant", () => {
  assert.ok("api_event" in triggersFor(false, { isInternal: true }));
});

test("the App event trigger is not offered to a customer's direct workspace", () => {
  // The event API only ever acts on the internal tenant, so anywhere else this
  // would be a flow that publishes and never fires.
  assert.ok(!("api_event" in triggersFor(false)));
});

test("nor to a Shopify store", () => {
  assert.ok(!("api_event" in triggersFor(true)));
});

test("the internal tenant still loses the commerce triggers", () => {
  const t = triggersFor(false, { isInternal: true });
  assert.ok(!("order_placed" in t));
  assert.ok("customer_created" in t);
});
