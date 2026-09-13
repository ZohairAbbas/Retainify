/**
 * The signed link that carries a shop through Meta's connect flow.
 *
 * Run: npm test  (or: node --test app/lib/whatsapp/connect-link.test.js)
 *
 * This token is a credential on an unauthenticated route: the tab that runs
 * Embedded Signup is outside the Shopify admin and carries no session, so the
 * token alone decides which shop a WhatsApp account gets attached to. Forging
 * one would let a stranger connect their own WhatsApp number to somebody
 * else's store, and every message that store sent afterwards would come from a
 * business it does not own. Hence the signature, the expiry, and these tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.SHOPIFY_API_SECRET ||= "test-signing-secret";

const { mintConnectToken, verifyConnectToken, buildConnectDialogUrl, connectCallbackUrl } =
  await import("./connect-link.server.js");

const SHOP = "acme.myshopify.com";

test("a freshly minted token names the shop it was minted for", () => {
  assert.deepEqual(verifyConnectToken(mintConnectToken(SHOP)), { ok: true, shop: SHOP });
});

test("a tampered payload or signature is refused", () => {
  const token = mintConnectToken(SHOP);
  const [payload, sig] = token.split(".");

  // Re-point the token at another shop, keeping the original signature.
  const forged = Buffer.from(JSON.stringify({ shop: "victim.myshopify.com", exp: Date.now() + 60000 }))
    .toString("base64url");
  assert.equal(verifyConnectToken(`${forged}.${sig}`).ok, false);

  assert.equal(verifyConnectToken(`${payload}.${"a".repeat(sig.length)}`).ok, false);
  assert.equal(verifyConnectToken(payload).ok, false);
  assert.equal(verifyConnectToken("").ok, false);
  assert.equal(verifyConnectToken("not.a.token").ok, false);
});

test("a token signed with a different secret is refused", () => {
  const real = process.env.SHOPIFY_API_SECRET;
  process.env.SHOPIFY_API_SECRET = "someone-elses-secret";
  const foreign = mintConnectToken(SHOP);
  process.env.SHOPIFY_API_SECRET = real;

  assert.equal(verifyConnectToken(foreign).ok, false);
});

test("an expired token is refused, and says so", () => {
  // Sign a payload whose expiry is already in the past.
  const expired = Buffer.from(JSON.stringify({ shop: SHOP, exp: Date.now() - 1000 })).toString("base64url");
  const sig = createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(expired).digest("base64url");

  const result = verifyConnectToken(`${expired}.${sig}`);
  assert.equal(result.ok, false);
  assert.match(result.error, /expired/i);
});

test("the dialog URL asks for a code, not a token", () => {
  // The configuration's own default response type is a token, which cannot be
  // exchanged for the long-lived system-user token the app stores — so the
  // override is what makes the whole flow work.
  const env = {
    META_APP_ID: "111",
    META_ES_CONFIG_ID: "222",
    SHOPIFY_APP_URL: "https://app.example.com",
  };
  const { ok, url } = buildConnectDialogUrl("state-token", env);
  assert.equal(ok, true);

  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("client_id"), "111");
  assert.equal(parsed.searchParams.get("config_id"), "222");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("override_default_response_type"), "true");
  assert.equal(parsed.searchParams.get("state"), "state-token");
  assert.equal(parsed.searchParams.get("redirect_uri"), "https://app.example.com/whatsapp/connected");
});

test("a server missing its Meta config refuses to build a dialog URL", () => {
  assert.equal(buildConnectDialogUrl("s", { SHOPIFY_APP_URL: "https://app.example.com" }).ok, false);
  assert.equal(buildConnectDialogUrl("s", { META_APP_ID: "1", META_ES_CONFIG_ID: "2" }).ok, false);
  assert.equal(connectCallbackUrl({}), "");
});

test("the code exchange repeats the dialog's redirect_uri exactly", async () => {
  // Meta rejects the exchange otherwise: "Error validating verification code.
  // Please make sure your redirect_uri is identical to the one you used in the
  // OAuth dialog request" — after the merchant has finished every step.
  const env = { META_APP_ID: "111", META_ES_CONFIG_ID: "222", SHOPIFY_APP_URL: "https://app.example.com" };
  const dialogRedirect = new URL(buildConnectDialogUrl("s", env).url).searchParams.get("redirect_uri");

  process.env.META_APP_ID ||= "111";
  process.env.META_APP_SECRET ||= "secret";
  const { exchangeCodeForToken } = await import("./embedded-signup.server.js");

  let requested;
  const realFetch = globalThis.fetch; // eslint-disable-line no-undef
  globalThis.fetch = async (url) => { // eslint-disable-line no-undef
    requested = new URL(String(url));
    return { ok: true, status: 200, json: async () => ({ access_token: "t" }) };
  };
  try {
    await exchangeCodeForToken("code", { redirectUri: connectCallbackUrl(env) });
  } finally {
    globalThis.fetch = realFetch; // eslint-disable-line no-undef
  }
  assert.equal(requested.searchParams.get("redirect_uri"), dialogRedirect);
});
