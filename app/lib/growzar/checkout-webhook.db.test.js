/**
 * checkouts/create and checkouts/update (G-RTN5-4, acceptance 5): variant and
 * product ids are stored, a missing currency is null rather than "USD", and a
 * checkout with only a phone is stored for the feed and nothing else.
 *
 * Driven through the real route with a correctly signed Shopify webhook.
 * Made-up shop, addresses and numbers.
 */
import "../../test-support/db-guard.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.SHOPIFY_API_SECRET ||= "test_secret_checkouts_webhook";
process.env.SHOPIFY_API_KEY ||= "test_key";
process.env.SHOPIFY_APP_URL ||= "https://example.test";
process.env.SCOPES ||= "read_orders";

const { default: prisma } = await import("../../db.server.js");
const { action, shopifyNumericId, checkoutCurrency } = await import("../../routes/webhooks.checkouts.js");
const { __resetShopCountryMemo } = await import("./shop-facts.server.js");

const SHOP = "retainify-test-g5checkouts.myshopify.com";

function webhook(topic, payload) {
  const body = JSON.stringify(payload);
  const hmac = createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(body, "utf8").digest("base64");
  return new Request("https://example.test/webhooks/checkouts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-topic": topic,
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-shop-domain": SHOP,
      "x-shopify-api-version": "2025-10",
      "x-shopify-webhook-id": `test-${topic}-${Math.random()}`,
    },
    body,
  });
}

const checkout = (extra = {}) => ({
  id: 7001,
  token: "tok_g5_hook",
  cart_token: "",
  email: "g5.hook@example.test",
  total_price: "2400.00",
  currency: "PKR",
  abandoned_checkout_url: "https://example.test/recover",
  billing_address: { phone: "0300 1234567" },
  line_items: [
    { title: "Kettle", variant_title: "Red", quantity: 2, price: "1200.00", variant_id: 4001, product_id: 3001 },
    { title: "Custom engraving", quantity: 1, price: "0.00", variant_id: null, product_id: null },
  ],
  ...extra,
});

async function cleanup() {
  await prisma.abandonedCart.deleteMany({ where: { shop: SHOP } });
  await prisma.consentEvent.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.journeyEnrollment.deleteMany({ where: { shop: SHOP } });
  await prisma.shopSettings.deleteMany({ where: { shop: SHOP } });
}

const stored = () => prisma.abandonedCart.findUnique({ where: { shop_checkoutToken: { shop: SHOP, checkoutToken: "tok_g5_hook" } } });

test.beforeEach(async () => {
  await cleanup();
  __resetShopCountryMemo();
  // isActive false: no flow enrollment is attempted. Fresh facts: no Shopify call.
  await prisma.shopSettings.create({ data: { shop: SHOP, shopifyCountry: "PK", shopifyCurrency: "PKR", shopifyTimezone: "Asia/Karachi", shopifyFactsAt: new Date() } });
});
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("line items keep numeric variant and product ids; a custom line has none", async () => {
  const res = await action({ request: webhook("checkouts/create", checkout()) });
  assert.equal(res.status, 200);
  const lines = JSON.parse((await stored()).lineItemsJson);
  assert.equal(lines[0].variantId, "4001");
  assert.equal(lines[0].productId, "3001");
  assert.equal(lines[1].variantId, null);
});

test("a checkout without a currency stores null, never USD; a later update does not erase a known one", async () => {
  await action({ request: webhook("checkouts/create", checkout({ currency: undefined })) });
  assert.equal((await stored()).currency, null);

  await action({ request: webhook("checkouts/update", checkout({ currency: "PKR" })) });
  assert.equal((await stored()).currency, "PKR");
  await action({ request: webhook("checkouts/update", checkout({ currency: undefined })) });
  assert.equal((await stored()).currency, "PKR");
});

test("the checkout's phone is stored on the cart, raw and in E.164 for the shop's country", async () => {
  await action({ request: webhook("checkouts/create", checkout()) });
  const cart = await stored();
  assert.equal(cart.phone, "0300 1234567");
  assert.equal(cart.phoneE164, "+923001234567");
  const contact = await prisma.contact.findFirst({ where: { shop: SHOP } });
  assert.equal(contact.phoneE164, "+923001234567");
});

test("a phone-only checkout is stored for the feed and nothing else", async () => {
  await action({ request: webhook("checkouts/create", checkout({ email: null })) });
  await action({ request: webhook("checkouts/update", checkout({ email: null })) });
  const cart = await stored();
  assert.equal(cart.customerEmail, "");
  assert.equal(cart.phoneE164, "+923001234567");
  assert.equal(await prisma.contact.count({ where: { shop: SHOP } }), 0);
  assert.equal(await prisma.journeyEnrollment.count({ where: { shop: SHOP } }), 0);

  // The buyer adds an email later: the cart gains it.
  await action({ request: webhook("checkouts/update", checkout()) });
  assert.equal((await stored()).customerEmail, "g5.hook@example.test");
});

test("a checkout with neither email nor phone is ignored", async () => {
  await action({ request: webhook("checkouts/create", checkout({ email: null, billing_address: {} })) });
  assert.equal(await stored(), null);
});

test("helpers: numeric ids from numbers or GIDs; currency only when it looks like one", () => {
  assert.equal(shopifyNumericId(123), "123");
  assert.equal(shopifyNumericId("gid://shopify/ProductVariant/456"), "456");
  assert.equal(shopifyNumericId(null), null);
  assert.equal(checkoutCurrency({ currency: "PKR", presentment_currency: "AED" }), "PKR");
  assert.equal(checkoutCurrency({ presentment_currency: "AED" }), "AED");
  assert.equal(checkoutCurrency({ currency: "" }), null);
  assert.equal(checkoutCurrency({}), null);
});
