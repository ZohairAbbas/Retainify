/**
 * Which websites may load a popup.
 *
 * Run: npm test   (or: node --test app/lib/popup/embed.test.js)
 *
 * The site key in the script tag is public — it sits in the page source of
 * every page the popup runs on — so the domain list is the real control. A
 * mistake here either locks a merchant out of their own site or lets any site
 * mint signups against their workspace.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeDomain, parseDomains, hostAllowed, newSiteKey } from "./embed.server.js";

test("a domain is reduced to its host", () => {
  for (const [input, want] of [
    ["https://www.Example.com/shop?x=1", "www.example.com"],
    ["example.com.", "example.com"],
    ["example.com:8443", "example.com"],
    ["*.example.com", "example.com"],
    ["  Example.CO.UK  ", "example.co.uk"],
    ["localhost", "localhost"],
  ]) assert.equal(normalizeDomain(input), want, input);
});

test("things that aren't website domains are refused", () => {
  for (const bad of ["", "not a domain", "example", "1.2.3.4", "http://1.2.3.4", "-bad.com", "javascript:alert(1)"]) {
    assert.equal(normalizeDomain(bad), "", bad);
  }
});

test("a listed domain covers its subdomains, and www covers the bare domain", () => {
  const domains = ["example.com"];
  for (const host of ["example.com", "www.example.com", "shop.example.com"]) {
    assert.equal(hostAllowed(host, domains), true, host);
  }
  for (const host of ["example.com.evil.net", "notexample.com", "evil.com", ""]) {
    assert.equal(hostAllowed(host, domains), false, host);
  }
  assert.equal(hostAllowed("example.com", ["www.example.com"]), true);
});

test("an empty domain list allows nothing", () => {
  assert.equal(hostAllowed("example.com", []), false);
  assert.equal(hostAllowed("example.com", undefined), false);
});

test("a domain list is cleaned, de-duplicated and capped", () => {
  const { domains, invalid } = parseDomains("example.com, https://example.com/x\nwww.other.com  nonsense");
  assert.deepEqual(domains, ["example.com", "www.other.com"]);
  assert.deepEqual(invalid, ["nonsense"]);
  const many = parseDomains(Array.from({ length: 15 }, (_, i) => `d${i}.com`).join("\n"));
  assert.equal(many.domains.length, 10);
  assert.equal(many.truncated, true);
});

test("site keys are unguessable and distinct", () => {
  const a = newSiteKey();
  assert.match(a, /^site_[A-Za-z0-9_-]{12,}$/);
  assert.notEqual(a, newSiteKey());
});
