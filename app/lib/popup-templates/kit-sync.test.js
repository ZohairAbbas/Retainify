/**
 * The storefront script carries a copy of the popup kit (it is a standalone
 * IIFE and cannot import a module). This fails when the copy goes stale —
 * otherwise the admin preview and the live popup drift apart silently, which
 * is exactly what the kit exists to prevent. Fix with: npm run popup:kit
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { KIT_PATH, STOREFRONT_PATH, withKit } from "../../../scripts/sync-popup-kit.mjs";

test("the storefront script's copy of the kit is up to date", () => {
  const storefront = fs.readFileSync(STOREFRONT_PATH, "utf8");
  const expected = withKit(storefront, fs.readFileSync(KIT_PATH, "utf8"));
  assert.equal(storefront, expected, "run: npm run popup:kit");
});

test("every kit template is wired into the storefront script", async () => {
  const { rtPopupKit } = await import("./kit.js");
  const kit = rtPopupKit({ esc: String, rich: String, wa: () => "", preview: false });
  const storefront = fs.readFileSync(STOREFRONT_PATH, "utf8");
  for (const id of Object.keys(kit.templates)) {
    assert.ok(storefront.includes(`T.${id} =`), `${id} missing from the storefront copy`);
  }
  // Mount kinds the storefront knows how to mount.
  for (const [id, t] of Object.entries(kit.templates)) {
    assert.ok(["modal", "corner", "bar"].includes(t.mount), `${id} has mount ${t.mount}`);
    assert.equal(typeof t.render({}), "string", id);
    assert.ok(t.css.length > 0, id);
  }
});
