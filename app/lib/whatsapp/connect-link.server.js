/**
 * Short-lived signed links that carry a shop through Meta's connect flow.
 *
 * ── Why the flow leaves the Shopify admin at all ───────────────────────────
 * Embedded Signup used to run in-place with Meta's JavaScript SDK, and it
 * worked until the SDK began defaulting to the browser's FedCM flow. FedCM
 * called from a cross-origin iframe requires `allow="identity-credentials-get"`
 * on every parent frame, and for an embedded Shopify app that attribute belongs
 * to Shopify's admin, not to us. The request is refused within milliseconds:
 * no window, nothing logged, and a callback carrying no code. The SDK's opt-out
 * option was ignored by the served build.
 *
 * So the connect flow runs in a top-level tab instead, and without the SDK at
 * all — a plain OAuth redirect, which has no popup to block, no FedCM to
 * refuse, and no third-party cookie to lose.
 *
 * ── Why a signed token rather than a session ───────────────────────────────
 * That tab is outside the Shopify admin, so it carries no app session, and
 * making it authenticate would send the merchant back into the embedded admin
 * — the very frame we are trying to leave. The token names the shop instead,
 * signed so it cannot be pointed at anyone else's, and short-lived so a link
 * copied out of a browser history is worthless.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a connect link stays usable. Long enough to finish Meta's flow. */
const TTL_MS = 30 * 60 * 1000;

function secret() {
  return process.env.SHOPIFY_API_SECRET || "";
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/**
 * Mint a link token for one shop.
 * @param {string} shop
 * @returns {string} "" when the server has no signing secret.
 */
export function mintConnectToken(shop) {
  if (!shop || !secret()) return "";
  const payload = b64url(JSON.stringify({ shop, exp: Date.now() + TTL_MS }));
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * Verify a link token and recover the shop it names.
 *
 * The signature is checked before the payload is parsed, and compared in
 * constant time — this value arrives in a URL from an unauthenticated request,
 * and it is the only thing standing between a stranger and connecting a
 * WhatsApp account to someone else's shop.
 *
 * @param {string} token
 * @returns {{ ok: true, shop: string } | { ok: false, error: string }}
 */
export function verifyConnectToken(token) {
  if (!secret()) return { ok: false, error: "server is not configured to sign connect links" };
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return { ok: false, error: "This link is not valid." };

  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "This link is not valid." };
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "This link is not valid." };
  }
  if (!data?.shop) return { ok: false, error: "This link is not valid." };
  if (!(Number(data.exp) > Date.now())) {
    return { ok: false, error: "This link has expired. Start again from the WhatsApp page." };
  }
  return { ok: true, shop: String(data.shop) };
}

/** Public base URL of this deployment, without a trailing slash. */
export function appBaseUrl(env = process.env) {
  return String(env.SHOPIFY_APP_URL || env.APP_PUBLIC_URL || "").trim().replace(/\/+$/, "");
}

/** Where Meta sends the merchant back after they approve. */
export function connectCallbackUrl(env = process.env) {
  const base = appBaseUrl(env);
  return base ? `${base}/whatsapp/connected` : "";
}

/**
 * The Meta dialog URL that starts Embedded Signup.
 *
 * `config_id` is what makes this Embedded Signup rather than ordinary Facebook
 * login, and `override_default_response_type` is what makes Meta return an
 * authorization code — the configuration's own default is a token, which
 * cannot be exchanged for the long-lived system-user token the app stores.
 *
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function buildConnectDialogUrl(state, env = process.env) {
  const appId = String(env.META_APP_ID || "").trim();
  const configId = String(env.META_ES_CONFIG_ID || "").trim();
  const redirectUri = connectCallbackUrl(env);
  const version = env.WHATSAPP_GRAPH_VERSION || "v21.0";

  if (!appId || !configId) {
    return { ok: false, error: "WhatsApp is not configured on this server (META_APP_ID / META_ES_CONFIG_ID)." };
  }
  if (!redirectUri) {
    return { ok: false, error: "This server has no public URL configured (SHOPIFY_APP_URL)." };
  }

  const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("config_id", configId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("override_default_response_type", "true");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return { ok: true, url: url.toString() };
}
