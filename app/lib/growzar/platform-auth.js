/**
 * Authenticating Growzar's calls to us (API-CONTRACT §2.1).
 *
 * Every /api/v1/growzar/* route — the status endpoint now, the R2 read API
 * later — goes through `authenticateGrowzarRequest`, so there is one scheme and
 * one place to change it. Both the bearer key and the signature are required;
 * the bearer key alone is never sufficient.
 *
 * Deliberately outside authenticate.admin, for the same reason as
 * lib/internal/auth.server.js: this is a server-to-server door, and bending the
 * merchant path to admit it would weaken the merchant path.
 */
import { growzarConfig, canonicalShop } from "./config.js";
import { secretsMatch, verifySignature } from "./signing.js";
import { hit } from "../security/rate-limit.server.js";

/** §2.1: a bucket of its own, starting at 600 requests/minute. */
export const PLATFORM_RATE_LIMIT = 600;
const RATE_WINDOW_MS = 60 * 1000;

/** §9 error body. */
export function growzarError(status, errorType, error, headers = {}) {
  return new Response(JSON.stringify({ error, errorType }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function bearer(request) {
  const header = request.headers.get("authorization") || "";
  return header.slice(0, 7).toLowerCase() === "bearer " ? header.slice(7).trim() : "";
}

/**
 * @param {Request} request
 * @param {{ body?: string, env?: Record<string, string|undefined>, now?: number }} [opts]
 *   `body` is the raw request body (empty for a GET).
 * @returns {{ ok: true, shop: string } | { ok: false, response: Response, reason: string }}
 */
export function authenticateGrowzarRequest(request, { body = "", env = process.env, now = Date.now() } = {}) {
  const { platformKey, signingSecret } = growzarConfig(env);

  // Unconfigured is closed, never open.
  if (!platformKey || !signingSecret) {
    return fail(503, "internal_error", "The Growzar integration is not configured on this app.", "not_configured");
  }

  const presented = bearer(request);
  if (!presented || !secretsMatch(presented, platformKey)) {
    return fail(401, "unauthorized", "Invalid or missing platform credential.", "bad_bearer");
  }

  const url = new URL(request.url);
  const pathWithQuery = `${url.pathname}${url.search}`;

  const verified = verifySignature({
    secret: signingSecret,
    signature: request.headers.get("x-growzar-signature"),
    timestamp: request.headers.get("x-growzar-timestamp"),
    method: request.method,
    pathWithQuery,
    body,
    now,
  });
  if (!verified.ok) {
    return fail(401, "unauthorized", "Request signature is missing or invalid.", verified.reason);
  }

  // Rate limited only once authenticated, so an unauthenticated spray cannot
  // spend Growzar's bucket. In memory, so per web instance — see
  // rate-limit.server.js for why that is an accepted ceiling, not a shaper.
  const limited = hit("growzar:platform", PLATFORM_RATE_LIMIT, RATE_WINDOW_MS);
  if (!limited.allowed) {
    return fail(429, "rate_limited", "Too many requests.", "rate_limited", {
      "Retry-After": String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))),
    });
  }

  // X-Growzar-Shop is the tenant (§2.1). Growzar also sends ?shop=; if both are
  // present they must agree, or one of them is lying about the tenant.
  const shop = canonicalShop(request.headers.get("x-growzar-shop"));
  if (!shop) {
    return fail(400, "bad_request", "X-Growzar-Shop must be a *.myshopify.com domain.", "bad_shop");
  }
  const queryShop = url.searchParams.get("shop");
  if (queryShop !== null && canonicalShop(queryShop) !== shop) {
    return fail(400, "bad_request", "X-Growzar-Shop and ?shop disagree.", "shop_mismatch");
  }

  return { ok: true, shop };
}

function fail(status, errorType, message, reason, headers) {
  return { ok: false, reason, response: growzarError(status, errorType, message, headers) };
}
