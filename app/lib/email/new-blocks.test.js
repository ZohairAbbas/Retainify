/**
 * The newer email blocks: they render, they drop when empty, and they never
 * emit a dangerous link.
 *
 * Run: npm test   (or: node --test app/lib/email/new-blocks.test.js)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { renderVisualEmail } from "./visual-renderer.server.js";

const ctx = { store_name: "Acme", store_url: "https://acme.test", first_name: "Sam", unsubscribeUrl: "https://u.test/x" };
const render = (blocks) => renderVisualEmail({ blocks, brand: {}, ctx, stepId: "t" });

test("each new block renders its content", async () => {
  const html = await render([
    { id: "1", type: "quote", text: "Loved it, {first_name}", author: "Jo", stars: 4 },
    { id: "2", type: "list", items: "One\nTwo\n\nThree", style: "number" },
    { id: "3", type: "callout", label: "Today", html: "Free shipping" },
    { id: "4", type: "social", links: [{ network: "instagram", url: "https://instagram.com/acme" }] },
    { id: "5", type: "video", src: "https://img.test/t.jpg", url: "https://youtu.be/x", caption: "Watch" },
    { id: "6", type: "columns", src: "https://img.test/a.jpg", heading: "Story", html: "Body", linkText: "More", url: "https://acme.test/s" },
    { id: "7", type: "coupon", code: "SAVE10", label: "Code", note: "At checkout" },
  ]);
  for (const s of ["Loved it, Sam", "★★★★☆", "3.", "Three", "Free shipping", "Instagram", "https://instagram.com/acme",
    "https://youtu.be/x", "Story", "https://acme.test/s", "SAVE10"]) {
    assert.ok(html.includes(s), `missing ${s}`);
  }
});

test("empty blocks are skipped, not rendered as empty boxes", async () => {
  const html = await render([
    { id: "1", type: "quote", text: "" },
    { id: "2", type: "list", items: "\n \n" },
    { id: "3", type: "callout", html: "" },
    { id: "4", type: "social", links: [{ network: "instagram", url: "" }] },
    { id: "5", type: "video", src: "" },
    { id: "6", type: "coupon", code: "  " },
  ]);
  assert.ok(!html.includes("&ldquo;"));
  assert.ok(!html.includes("border:2px dashed"));
  assert.ok(!html.includes("999px"));
});

test("links are never javascript: or data:", async () => {
  const html = await render([
    { id: "1", type: "video", src: "https://img.test/t.jpg", url: "javascript:alert(1)" },
    { id: "2", type: "columns", heading: "x", linkText: "Go", url: "data:text/html,hi" },
    { id: "3", type: "social", links: [{ network: "x", url: "javascript:alert(1)" }] },
  ]);
  assert.ok(!/javascript:/i.test(html));
  assert.ok(!/href="data:/i.test(html));
});

test("text fields are escaped", async () => {
  const html = await render([
    { id: "1", type: "quote", text: "<img src=x onerror=alert(1)>", author: "<b>x</b>" },
    { id: "2", type: "coupon", code: "<script>", label: "a" },
  ]);
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<script>"));
});
