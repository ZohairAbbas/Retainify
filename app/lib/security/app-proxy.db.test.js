/**
 * Storefront endpoints require a real Shopify app-proxy signature.
 *
 * Run: npm test   (or: node --test app/lib/security/app-proxy.db.test.js)
 *
 * ── What this pins ─────────────────────────────────────────────────────────
 * These routes took `shop` from the request body or query string and served any
 * origin, with no proof the caller was a storefront at all. Anyone could create
 * push subscriptions for any shop, attach them to any email address, and flip
 * Contact.pushEnabled for a customer they had never met.
 *
 * Shopify was signing these requests the whole time — the theme extension calls
 * through /apps/retainify/*, and the proxy appends a signed shop, signature and
 * timestamp to everything it forwards. The server never looked.
 *
 * Signatures here are computed the way Shopify computes them, so these exercise
 * the real validator rather than a stub of it. Two properties matter: an
 * unsigned request is refused, and a signed one acts on the shop in the
 * signature rather than the one in the body.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.SHOPIFY_API_SECRET ||= "test_secret_app_proxy";
process.env.SHOPIFY_API_KEY ||= "test_key";
process.env.SHOPIFY_APP_URL ||= "https://example.test";
process.env.SCOPES ||= "read_orders";

const { default: prisma } = await import("../../db.server.js");
const { verifyAppProxy } = await import("./app-proxy.server.js");
const { action: pushSubscribe } = await import("../../routes/push-subscribe.js");

const SHOP = "retainify-test-proxy.myshopify.com";
const OTHER_SHOP = "victim-store.myshopify.com";

/**
 * Sign query params the way Shopify's app proxy does: sorted key=value pairs
 * concatenated with no separator, HMAC-SHA256 with the app secret, hex digest.
 */
function sign(params) {
  const payload = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("");
  return createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(payload).digest("hex");
}

/** A request as the app proxy would forward it. */
function proxied(path, { shop = SHOP, body = null, tamper = null } = {}) {
  const params = { shop, timestamp: String(Math.floor(Date.now() / 1000)) };
  params.signature = sign(params);
  // Applied after signing, to model a caller editing a legitimately signed URL.
  if (tamper) Object.assign(params, tamper);

  const url = `https://example.test${path}?${new URLSearchParams(params)}`;
  return new Request(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** The same request with no signature at all — a direct call to the origin. */
function unsigned(path, { shop = SHOP, body = null } = {}) {
  const url = `https://example.test${path}?shop=${encodeURIComponent(shop)}`;
  return new Request(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function seed() {
  await cleanup();
  for (const shop of [SHOP, OTHER_SHOP]) {
    await prisma.shopSettings.create({ data: { shop } });
    await prisma.session.create({
      data: {
        id: `offline_${shop}`,
        shop,
        state: "test",
        isOnline: false,
        accessToken: "test-token",
        scope: "read_orders",
      },
    });
  }
}

async function cleanup() {
  for (const shop of [SHOP, OTHER_SHOP]) {
    await prisma.pushSubscription.deleteMany({ where: { shop } });
    await prisma.contact.deleteMany({ where: { shop } });
    await prisma.shopSettings.deleteMany({ where: { shop } });
    await prisma.session.deleteMany({ where: { shop } });
  }
}

test.beforeEach(seed);
test.after(cleanup);

test("a correctly signed request is accepted and yields the signed shop", async () => {
  const result = await verifyAppProxy(proxied("/popup-config"));
  assert.equal(result.ok, true);
  assert.equal(result.shop, SHOP);
});

test("an unsigned request is refused", async () => {
  // The direct-to-origin call that used to work.
  const result = await verifyAppProxy(unsigned("/popup-config"));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 401);
});

test("a tampered shop invalidates the signature", async () => {
  // The actual attack: take a signature legitimately issued for one shop and
  // point it at another. The signature covers `shop`, so it stops being valid.
  const result = await verifyAppProxy(
    proxied("/popup-config", { tamper: { shop: OTHER_SHOP } }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 401);
});

test("a forged signature is refused", async () => {
  const result = await verifyAppProxy(
    proxied("/popup-config", { tamper: { signature: "f".repeat(64) } }),
  );
  assert.equal(result.ok, false);
});

test("push-subscribe binds the subscription to the signed shop, not the body", async () => {
  // The body names a different shop. It must be ignored entirely.
  const req = proxied("/push-subscribe", {
    shop: SHOP,
    body: {
      shop: OTHER_SHOP,
      endpoint: "https://push.example/abc",
      p256dh: "key",
      auth: "auth",
    },
  });

  const res = await pushSubscribe({ request: req });
  assert.equal(res.status, 200);

  assert.equal(
    await prisma.pushSubscription.count({ where: { shop: OTHER_SHOP } }),
    0,
    "a subscription must never land on the shop named in the body",
  );
  assert.equal(await prisma.pushSubscription.count({ where: { shop: SHOP } }), 1);
});

test("push-subscribe refuses an unsigned request", async () => {
  const res = await pushSubscribe({
    request: unsigned("/push-subscribe", {
      body: { endpoint: "https://push.example/x", p256dh: "k", auth: "a" },
    }),
  });

  assert.equal(res.status, 401);
  assert.equal(await prisma.pushSubscription.count({ where: { shop: SHOP } }), 0);
});

test("an unverified email claim does not link the subscription or create a contact", async () => {
  // The second half of the hole: naming any address attached a push endpoint to
  // it AND called upsertContact, bringing a contact into existence with
  // pushEnabled set. The signature proves the shop, never who is browsing.
  const res = await pushSubscribe({
    request: proxied("/push-subscribe", {
      body: {
        endpoint: "https://push.example/def",
        p256dh: "key",
        auth: "auth",
        contactEmail: "stranger@example.test",
      },
    }),
  });
  assert.equal(res.status, 200);

  const sub = await prisma.pushSubscription.findFirst({ where: { shop: SHOP } });
  assert.equal(sub.contactEmail, null, "an unproven address must not be linked");

  assert.equal(
    await prisma.contact.count({ where: { shop: SHOP, email: "stranger@example.test" } }),
    0,
    "and must not conjure a contact",
  );
});

test("a confirmed contact IS linked — the signal the app already has proof for", async () => {
  await prisma.contact.create({
    data: {
      shop: SHOP,
      email: "known@example.test",
      subscriptionStatus: "subscribed",
      marketingConsentAt: new Date(),
    },
  });

  await pushSubscribe({
    request: proxied("/push-subscribe", {
      body: {
        endpoint: "https://push.example/ghi",
        p256dh: "key",
        auth: "auth",
        contactEmail: "known@example.test",
      },
    }),
  });

  const sub = await prisma.pushSubscription.findFirst({ where: { shop: SHOP } });
  assert.equal(sub.contactEmail, "known@example.test");
});

test("a merely observed contact is not proof of identity", async () => {
  // never_opted_in is an address we have seen — a checkout, an import — with no
  // act of consent behind it. Not evidence about who is holding the browser.
  await prisma.contact.create({
    data: { shop: SHOP, email: "seen@example.test", subscriptionStatus: "never_opted_in" },
  });

  await pushSubscribe({
    request: proxied("/push-subscribe", {
      body: {
        endpoint: "https://push.example/jkl",
        p256dh: "key",
        auth: "auth",
        contactEmail: "seen@example.test",
      },
    }),
  });

  const sub = await prisma.pushSubscription.findFirst({ where: { shop: SHOP } });
  assert.equal(sub.contactEmail, null);
});
