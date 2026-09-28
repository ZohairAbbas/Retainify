import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { sign, signingPayload, signedHeaders, verifySignature, SIGNATURE_SKEW_MS } from "./signing.js";
import { authenticateGrowzarRequest } from "./platform-auth.js";
import { canonicalShop } from "./config.js";
import { mintClaimToken, claimUrl, CLAIM_TOKEN_TTL_SECONDS } from "./claim-token.js";
import { RETRY_DELAYS_MS, MAX_ATTEMPTS, nextRetryAt, classifyResponse, buildEnvelope } from "./events.js";
import { identifyStaffMember } from "./staff-identity.server.js";

const KEY = "pk_test_0123456789abcdefghijklmnop";
const SECRET = "whsec_test_0123456789abcdefghijklmnop";
const ENV = { GROWZAR_PLATFORM_KEY: KEY, GROWZAR_SIGNING_SECRET: SECRET, GROWZAR_URL: "https://growzar.test/" };
const SHOP = "acme.myshopify.com";
const PATH = `/api/v1/growzar/status?shop=${encodeURIComponent(SHOP)}`;

/** A request exactly as Growzar's outboundHeaders() builds it. */
function growzarRequest({ key = KEY, secret = SECRET, ts = Date.now(), path = PATH, shop = SHOP, signed = true } = {}) {
  const headers = new Headers({ Authorization: `Bearer ${key}`, "X-Growzar-Shop": shop, Accept: "application/json" });
  if (signed) {
    headers.set("X-Growzar-Timestamp", String(ts));
    headers.set("X-Growzar-Signature", sign(secret, signingPayload({ timestamp: ts, method: "GET", pathWithQuery: path, body: "" })));
  }
  return new Request(`https://retainify.growzar.com${path}`, { method: "GET", headers });
}

async function errorOf(result) {
  assert.equal(result.ok, false);
  return { status: result.response.status, body: await result.response.json() };
}

// ── Signing ────────────────────────────────────────────────────────────────

test("signing payload matches Growzar's construction byte for byte", () => {
  assert.equal(
    signingPayload({ timestamp: 1700000000000, method: "get", pathWithQuery: "/a?b=c", body: "" }),
    "1700000000000.GET /a?b=c.",
  );
  const expected = "sha256=" + createHmac("sha256", "s").update("1.POST /x.{}").digest("hex");
  assert.equal(sign("s", "1.POST /x.{}"), expected);
});

test("signedHeaders verifies with verifySignature", () => {
  const now = Date.now();
  const h = signedHeaders({ secret: SECRET, method: "POST", pathWithQuery: "/api/v1/events", body: '{"a":1}', now });
  const r = verifySignature({
    secret: SECRET, signature: h["X-Growzar-Signature"], timestamp: h["X-Growzar-Timestamp"],
    method: "POST", pathWithQuery: "/api/v1/events", body: '{"a":1}', now,
  });
  assert.deepEqual(r, { ok: true });
});

// ── Status endpoint authentication ─────────────────────────────────────────

test("a signed platform request is accepted and yields the shop", () => {
  const r = authenticateGrowzarRequest(growzarRequest(), { env: ENV });
  assert.deepEqual(r, { ok: true, shop: SHOP });
});

test("a valid bearer key without a signature is 401", async () => {
  const { status, body } = await errorOf(authenticateGrowzarRequest(growzarRequest({ signed: false }), { env: ENV }));
  assert.equal(status, 401);
  assert.equal(body.errorType, "unauthorized");
  assert.equal(typeof body.error, "string");
});

test("a wrong bearer key is 401 even with a good signature", async () => {
  const { status } = await errorOf(authenticateGrowzarRequest(growzarRequest({ key: "pk_wrong_0123456789abcdefghijkl" }), { env: ENV }));
  assert.equal(status, 401);
});

test("a signature made with the wrong secret is 401", async () => {
  const { status } = await errorOf(authenticateGrowzarRequest(growzarRequest({ secret: "not-the-secret-0123456789abcd" }), { env: ENV }));
  assert.equal(status, 401);
});

test("a stale or far-future timestamp is 401", async () => {
  for (const ts of [Date.now() - SIGNATURE_SKEW_MS - 1000, Date.now() + SIGNATURE_SKEW_MS + 1000]) {
    const r = authenticateGrowzarRequest(growzarRequest({ ts }), { env: ENV });
    assert.equal(r.reason, "timestamp_out_of_range");
    assert.equal((await errorOf(r)).status, 401);
  }
});

test("a signature over a different query string is rejected", async () => {
  const req = growzarRequest();
  const tampered = new Request(req.url.replace("acme", "other"), { headers: req.headers });
  const r = authenticateGrowzarRequest(tampered, { env: ENV });
  assert.equal(r.ok, false);
});

test("X-Growzar-Shop and ?shop must agree", async () => {
  const path = `/api/v1/growzar/status?shop=other.myshopify.com`;
  const r = authenticateGrowzarRequest(growzarRequest({ path }), { env: ENV });
  assert.equal(r.reason, "shop_mismatch");
  assert.equal((await errorOf(r)).status, 400);
});

test("unconfigured means closed, not open", async () => {
  const r = authenticateGrowzarRequest(growzarRequest(), { env: {} });
  assert.equal(r.reason, "not_configured");
  assert.equal((await errorOf(r)).status, 503);
  // A short placeholder secret counts as unconfigured.
  const weak = authenticateGrowzarRequest(growzarRequest(), { env: { ...ENV, GROWZAR_SIGNING_SECRET: "x" } });
  assert.equal(weak.reason, "not_configured");
});

test("canonicalShop accepts only lowercase myshopify domains", () => {
  assert.equal(canonicalShop(" ACME.myshopify.com "), SHOP);
  assert.equal(canonicalShop("acme.com"), null);
  assert.equal(canonicalShop("ab12-uuid"), null);
});

// ── Claim token ────────────────────────────────────────────────────────────

function decode(token) {
  const [h, p, s] = token.split(".");
  return { header: JSON.parse(Buffer.from(h, "base64url")), payload: JSON.parse(Buffer.from(p, "base64url")), sig: s, signingInput: `${h}.${p}` };
}

test("claim token carries the contract's claims and a 5-minute expiry", () => {
  const now = 1_760_000_000_000;
  const { token, jti, expiresAt } = mintClaimToken({
    secret: SECRET, shop: SHOP, shopifyUserId: "gid://shopify/StaffMember/42",
    email: "owner@acme.pk", isStoreOwner: true, locale: "en", now,
  });
  const { header, payload, sig, signingInput } = decode(token);
  assert.deepEqual(header, { alg: "HS256", typ: "JWT" });
  assert.equal(payload.iss, "retainify");
  assert.equal(payload.aud, "growzar");
  assert.equal(payload.shop, SHOP);
  assert.equal(payload.shopifyUserId, "gid://shopify/StaffMember/42");
  assert.equal(payload.email, "owner@acme.pk");
  assert.equal(payload.isStoreOwner, true);
  assert.equal(payload.locale, "en");
  assert.equal(payload.jti, jti);
  assert.equal(payload.iat, now / 1000);
  assert.equal(payload.exp - payload.iat, CLAIM_TOKEN_TTL_SECONDS);
  assert.equal(CLAIM_TOKEN_TTL_SECONDS, 300);
  assert.equal(expiresAt.getTime(), (payload.exp) * 1000);
  assert.equal(sig, createHmac("sha256", SECRET).update(signingInput).digest("base64url"));
});

test("each claim token has its own jti", () => {
  const a = mintClaimToken({ secret: SECRET, shop: SHOP, shopifyUserId: "x", email: "e@x", isStoreOwner: false });
  const b = mintClaimToken({ secret: SECRET, shop: SHOP, shopifyUserId: "x", email: "e@x", isStoreOwner: false });
  assert.notEqual(a.jti, b.jti);
});

test("isStoreOwner is only ever a strict true", () => {
  const { token } = mintClaimToken({ secret: SECRET, shop: SHOP, shopifyUserId: "x", email: "e@x", isStoreOwner: "true" });
  assert.equal(decode(token).payload.isStoreOwner, false);
});

test("minting without a secret throws rather than signing with nothing", () => {
  assert.throws(() => mintClaimToken({ secret: "", shop: SHOP, shopifyUserId: "x", email: "e@x", isStoreOwner: true }));
});

test("the claim URL carries the token in the fragment, never the query", () => {
  const url = new URL(claimUrl("https://growzar.test", "a.b.c"));
  assert.equal(url.pathname, "/claim");
  assert.equal(url.search, "");
  assert.equal(url.hash, "#token=a.b.c");
});

// ── Staff identity via token exchange ──────────────────────────────────────

function fakeShopify(associated_user, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ access_token: "shpua_secret", associated_user }), { status });
  };
  return { fetchImpl, calls };
}

test("staff identity comes from Shopify's online token exchange", async () => {
  const { fetchImpl, calls } = fakeShopify({ id: 42, email: "Owner@Acme.pk", email_verified: true, account_owner: true, collaborator: false, locale: "en" });
  const r = await identifyStaffMember({ shop: SHOP, idToken: "idtok", expectedUserId: "42", fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual(r.user, { shopifyUserId: "gid://shopify/StaffMember/42", email: "owner@acme.pk", emailVerified: true, isStoreOwner: true, locale: "en" });
  assert.equal(calls[0].url, `https://${SHOP}/admin/oauth/access_token`);
  assert.equal(calls[0].body.subject_token, "idtok");
  assert.equal(calls[0].body.requested_token_type, "urn:shopify:params:oauth:token-type:online-access-token");
  assert.equal("access_token" in r.user, false);
});

test("a user id that does not match the session token's sub mints nothing", async () => {
  const { fetchImpl } = fakeShopify({ id: 43, email: "a@b.c", account_owner: true });
  const r = await identifyStaffMember({ shop: SHOP, idToken: "idtok", expectedUserId: "42", fetchImpl });
  assert.deepEqual(r, { ok: false, reason: "user_mismatch" });
});

test("a collaborator is never the store owner", async () => {
  const { fetchImpl } = fakeShopify({ id: 42, email: "a@b.c", account_owner: true, collaborator: true });
  const r = await identifyStaffMember({ shop: SHOP, idToken: "idtok", expectedUserId: "42", fetchImpl });
  assert.equal(r.user.isStoreOwner, false);
});

test("a Shopify error mints nothing", async () => {
  const { fetchImpl } = fakeShopify(null, 400);
  const r = await identifyStaffMember({ shop: SHOP, idToken: "idtok", expectedUserId: "42", fetchImpl });
  assert.deepEqual(r, { ok: false, reason: "shopify_400" });
});

// ── Event retry schedule ───────────────────────────────────────────────────

test("retry schedule is 1m, 5m, 30m, 2h, 6h, 12h, then failed", () => {
  const now = 0;
  const minutes = [1, 2, 3, 4, 5, 6].map((n) => nextRetryAt(n, now).getTime() / 60000);
  assert.deepEqual(minutes, [1, 5, 30, 120, 360, 720]);
  assert.equal(nextRetryAt(7, now), null);
  assert.equal(MAX_ATTEMPTS, 7);
  assert.equal(RETRY_DELAYS_MS.length, 6);
});

test("responses are classified as delivered / retry / failed", () => {
  assert.equal(classifyResponse(202), "delivered");
  assert.equal(classifyResponse(200), "delivered");
  for (const s of [500, 502, 503, 408, 429, 401, null]) assert.equal(classifyResponse(s), "retry", String(s));
  for (const s of [400, 403, 404, 422]) assert.equal(classifyResponse(s), "failed", String(s));
});

test("envelope has the §7 shape with a UTC Z timestamp", () => {
  const e = buildEnvelope({ topic: "app.uninstalled", shop: SHOP, occurredAt: "2026-09-24T10:00:00.123Z", actor: { type: "shopify" } });
  assert.deepEqual(Object.keys(e), ["eventId", "topic", "occurredAt", "shop", "actor", "data"]);
  assert.equal(e.occurredAt, "2026-09-24T10:00:00Z");
  assert.deepEqual(e.data, {});
  assert.ok(e.eventId.length > 10);
  assert.notEqual(buildEnvelope({ topic: "t", shop: SHOP }).eventId, buildEnvelope({ topic: "t", shop: SHOP }).eventId);
  assert.match(buildEnvelope({ topic: "t", shop: SHOP, occurredAt: "garbage" }).occurredAt, /Z$/);
});
