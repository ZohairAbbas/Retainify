/* global globalThis */
/**
 * Getting WhatsApp events INTO Retainify.
 *
 * Run: npm test   (or: node --test app/lib/whatsapp/webhook-routing.test.js)
 *
 * Two independent failures kept every webhook out, and neither threw:
 *
 *   1. Signature. Events reach this endpoint from more than one Meta app, each
 *      signed with its own secret, and only Retainify's was accepted — so every
 *      delivery from the sibling app was a 401. 44 of 44, ever.
 *   2. Routing. Retainify's app-wide callback is set for another product, so its
 *      own events went there. A per-account callback override is the only way
 *      to bring them here without moving that product's traffic.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { webhookSecrets, verifyWebhookSignature } from "./webhook-signature.server.js";
import { subscribeAppToWaba, webhookCallbackUrl } from "./embedded-signup.server.js";

const OURS = "a".repeat(32);
const SIBLING = "b".repeat(32);
const sign = (body, secret) => "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
const BODY = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "123" }] });

// ── Signature ───────────────────────────────────────────────────────────────

test("an event signed by the sibling app is accepted once its secret is listed", () => {
  const secrets = webhookSecrets({ META_APP_SECRET: OURS, WHATSAPP_WEBHOOK_EXTRA_SECRETS: SIBLING });
  assert.equal(verifyWebhookSignature(BODY, sign(BODY, SIBLING), secrets), true);
  assert.equal(verifyWebhookSignature(BODY, sign(BODY, OURS), secrets), true);
});

test("without the sibling's secret, its events are rejected — the original bug", () => {
  const secrets = webhookSecrets({ META_APP_SECRET: OURS });
  assert.equal(verifyWebhookSignature(BODY, sign(BODY, SIBLING), secrets), false);
});

test("a wrong secret, a tampered body and a malformed header are all rejected", () => {
  const secrets = webhookSecrets({ META_APP_SECRET: OURS, WHATSAPP_WEBHOOK_EXTRA_SECRETS: SIBLING });
  assert.equal(verifyWebhookSignature(BODY, sign(BODY, "c".repeat(32)), secrets), false);
  assert.equal(verifyWebhookSignature(BODY + " ", sign(BODY, OURS), secrets), false);
  assert.equal(verifyWebhookSignature(BODY, sign(BODY, OURS).replace("sha256=", "sha1="), secrets), false);
  assert.equal(verifyWebhookSignature(BODY, "sha256=zz", secrets), false);
  assert.equal(verifyWebhookSignature(BODY, "", secrets), false);
});

test("the secret list tolerates spacing and empty entries, and never holds a blank", () => {
  assert.deepEqual(
    webhookSecrets({ META_APP_SECRET: ` ${OURS} `, WHATSAPP_WEBHOOK_EXTRA_SECRETS: ` ${SIBLING} ,, ` }),
    [OURS, SIBLING],
  );
  assert.deepEqual(webhookSecrets({}), []);
});

// ── Routing ─────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };
const ROUTING_ENV = ["SHOPIFY_APP_URL", "APP_PUBLIC_URL", "WHATSAPP_WEBHOOK_VERIFY_TOKEN"];
test.afterEach(() => {
  globalThis.fetch = realFetch;
  // Delete rather than assign: `process.env.X = undefined` stores the string
  // "undefined", which would read as a configured URL in the next test.
  for (const key of ROUTING_ENV) {
    if (realEnv[key] === undefined) delete process.env[key];
    else process.env[key] = realEnv[key];
  }
});

/** Record calls; answer the POST ok and the GET with `subscribed`. */
function stubMeta(subscribed) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body });
    const json = init.method === "POST" ? { success: true } : { data: subscribed };
    return { ok: true, status: 200, json: async () => json };
  };
  return calls;
}

test("the subscription names Retainify's endpoint, and is confirmed before trusting it", async () => {
  process.env.SHOPIFY_APP_URL = "https://retainify.example.com/";
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "vt";
  const callback = "https://retainify.example.com/webhooks/whatsapp";
  const calls = stubMeta([{ override_callback_uri: callback }]);

  const result = await subscribeAppToWaba("token", "999");

  assert.equal(result.ok, true);
  const post = calls.find((c) => c.method === "POST");
  assert.deepEqual(JSON.parse(post.body), { override_callback_uri: callback, verify_token: "vt" });
  assert.ok(calls.some((c) => c.method === "GET"), "the recorded state must be read back");
});

test("a POST that succeeds without recording the override is reported as a failure", async () => {
  process.env.SHOPIFY_APP_URL = "https://retainify.example.com";
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "vt";
  stubMeta([{ override_callback_uri: "https://another-product.example.com/hook" }]);

  const result = await subscribeAppToWaba("token", "999");
  assert.equal(result.ok, false);
  assert.match(result.error, /isn't routing/);
});

test("with no public URL it refuses rather than subscribing without an override", async () => {
  // Both names count as a public URL, so both have to be absent.
  delete process.env.SHOPIFY_APP_URL;
  delete process.env.APP_PUBLIC_URL;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "vt";
  const calls = stubMeta([]);

  const result = await subscribeAppToWaba("token", "999");
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0, "a plain subscription would silently route events elsewhere");
});

test("the callback URL is built from the app URL, trailing slashes and all", () => {
  assert.equal(webhookCallbackUrl({ SHOPIFY_APP_URL: "https://a.example.com//" }), "https://a.example.com/webhooks/whatsapp");
  assert.equal(webhookCallbackUrl({}), "");
});
