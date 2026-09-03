/**
 * resolveCallUrl — the onboarding call step's scheduling link.
 *
 * The step shipped as a disabled "Scheduling link coming soon" button because
 * the loaders fell back to the string "#", which is truthy and looks like a URL
 * to every check, so the panel needed its own special-case for it. The resolver
 * exists so there is exactly one falsy value ("") to handle, and so a garbage
 * env var cannot become an href.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveCallUrl, DEFAULT_ONBOARDING_CALL_URL } from "./tasks.js";

test("falls back to the built-in link when the env var is unset", () => {
  assert.equal(resolveCallUrl(undefined), DEFAULT_ONBOARDING_CALL_URL);
  assert.equal(resolveCallUrl(""), DEFAULT_ONBOARDING_CALL_URL);
  assert.equal(resolveCallUrl("   "), DEFAULT_ONBOARDING_CALL_URL);
  assert.match(DEFAULT_ONBOARDING_CALL_URL, /^https:\/\//);
});

test("the env var overrides, so a deploy can point at another calendar", () => {
  assert.equal(
    resolveCallUrl("https://cal.com/retainify/staging"),
    "https://cal.com/retainify/staging",
  );
});

test("anything that is not an http(s) URL resolves to empty, never to an href", () => {
  // "#" is the old sentinel — the whole reason the panel had a dead branch.
  assert.equal(resolveCallUrl("#"), "");
  assert.equal(resolveCallUrl("calendly.com/preventify"), "");
  assert.equal(resolveCallUrl("javascript:alert(1)"), "");
});
