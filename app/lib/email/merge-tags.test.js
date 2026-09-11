/**
 * Merge tags: event data ({data.*}) and subject lines.
 *
 * Run: npm test   (or: node --test app/lib/email/merge-tags.test.js)
 *
 * The properties worth pinning are the ones whose failure lands in a customer's
 * inbox: markup from another app's data reaching the HTML, a missing field
 * leaving a raw "{data.plan}" in the email, and subjects shipping tags literally
 * — which is what every subject did before this.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { applyMergeTagsToHtml, mergeSubject } from "./visual-renderer.server.js";

const ctx = {
  first_name: "Ayesha",
  store_name: "Growzar Internal",
  data: { store_name: "Acme & Co", plan: "pro", steps_done: 2 },
};

test("a data field is substituted", () => {
  assert.equal(applyMergeTagsToHtml("Plan: {data.plan}", ctx), "Plan: pro");
});

test("numbers are rendered, not dropped", () => {
  assert.equal(applyMergeTagsToHtml("{data.steps_done} of 4", ctx), "2 of 4");
});

test("a missing field renders empty rather than as a raw tag", () => {
  assert.equal(applyMergeTagsToHtml("[{data.nope}]", ctx), "[]");
});

test("a fallback is used when the field is missing", () => {
  assert.equal(applyMergeTagsToHtml("Hi {data.owner|there}", ctx), "Hi there");
});

test("a fallback is ignored when the field is present", () => {
  assert.equal(applyMergeTagsToHtml("{data.plan|free}", ctx), "pro");
});

test("an empty string counts as missing", () => {
  const c = { data: { plan: "" } };
  assert.equal(applyMergeTagsToHtml("{data.plan|free}", c), "free");
});

test("data values are HTML-escaped", () => {
  // Store names are typed by people; one of them will contain markup.
  const c = { data: { store_name: '<img src=x onerror="alert(1)">' } };
  const out = applyMergeTagsToHtml("<p>{data.store_name}</p>", c);
  assert.ok(!out.includes("<img"), out);
  assert.match(out, /&lt;img/);
});

test("ampersands in data are escaped", () => {
  assert.equal(applyMergeTagsToHtml("{data.store_name}", ctx), "Acme &amp; Co");
});

test("a data value containing a tag is not substituted a second time", () => {
  const c = { first_name: "Ayesha", data: { note: "{first_name}" } };
  assert.equal(applyMergeTagsToHtml("{data.note}", c), "{first_name}");
});

test("the standard tags still work alongside data tags", () => {
  assert.equal(applyMergeTagsToHtml("{first_name} at {data.store_name}", ctx), "Ayesha at Acme &amp; Co");
});

test("data tags render empty for enrollments with no event behind them", () => {
  assert.equal(applyMergeTagsToHtml("x{data.plan}x", { first_name: "A" }), "xx");
});

test("a test send shows where each field lands", () => {
  assert.equal(
    applyMergeTagsToHtml("{data.plan|free}", { previewData: true }),
    "[data.plan]",
  );
});

test("subjects are merged — they used to ship tags literally", () => {
  assert.equal(mergeSubject("Welcome, {first_name}", ctx), "Welcome, Ayesha");
});

test("subjects take data tags and fallbacks", () => {
  assert.equal(mergeSubject("{data.store_name}: finish setup", ctx), "Acme & Co: finish setup");
  assert.equal(mergeSubject("Hi {data.owner|there}", ctx), "Hi there");
});

test("subjects are not HTML-escaped — they are plain text", () => {
  assert.equal(mergeSubject("{data.store_name}", ctx), "Acme & Co");
});

test("a line break in data cannot break out of the subject header", () => {
  const c = { data: { store_name: "Acme\r\nBcc: someone@example.com" } };
  const subject = mergeSubject("Hi {data.store_name}", c);
  assert.ok(!/[\r\n]/.test(subject), JSON.stringify(subject));
});

test("a subject with no tags is unchanged", () => {
  assert.equal(mergeSubject("Plain subject", ctx), "Plain subject");
});
