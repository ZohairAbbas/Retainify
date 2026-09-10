/**
 * Which email blocks a workspace is offered.
 *
 * Run: npm test   (or: node --test app/components/email-blocks.test.js)
 *
 * ── What this guards ───────────────────────────────────────────────────────
 * A discount block makes the email worker call createDiscountCode(shop) against
 * the Shopify Admin API before it will send. A workspace with no store cannot
 * answer that, and the worker deliberately refuses to send the email at all
 * rather than deliver a subject line promising an offer the body cannot carry —
 * so the job fails permanently, and the merchant sees a flow that is published,
 * enrolled, and silently sending nothing.
 *
 * The internal Growzar tenant is exactly such a workspace, which is how this
 * surfaced; every direct workspace has the same exposure.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { blocksFor } from "./email-blocks.js";

const typesIn = (groups) => groups.flatMap((g) => g.items.map((i) => i.type));

test("a Shopify workspace keeps the commerce blocks", () => {
  const types = typesIn(blocksFor(true));
  assert.ok(types.includes("discount"));
  assert.ok(types.includes("product"));
});

test("a workspace with no store is not offered blocks that can only fail", () => {
  const types = typesIn(blocksFor(false));
  assert.ok(!types.includes("discount"), "discount block must be hidden");
  assert.ok(!types.includes("product"), "product grid must be hidden");
});

test("hiding commerce leaves every other block available", () => {
  const withStore = typesIn(blocksFor(true));
  const without = typesIn(blocksFor(false));
  for (const t of ["heading", "paragraph", "button", "image", "logo", "spacer", "divider", "footer"]) {
    assert.ok(without.includes(t), `${t} should still be offered`);
  }
  // Nothing but the commerce pair differs.
  assert.deepEqual(
    withStore.filter((t) => !without.includes(t)).sort(),
    ["discount", "product"],
  );
});
