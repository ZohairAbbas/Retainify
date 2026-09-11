/**
 * Shared-secret authentication for the internal event API (/internal/event).
 *
 * These routes sit OUTSIDE authenticate.admin deliberately. The Shopify auth
 * path exists to prove a merchant is who they say they are on their own store;
 * bending it to also admit a server-to-server caller with no store and no
 * session would weaken the thing it is for. This is a separate, much smaller
 * door: one secret per calling app, checked in constant time, nothing else.
 *
 * Secrets live in env as INTERNAL_APP_SECRET_<APP> — e.g. a caller identifying
 * as "courierify" is checked against INTERNAL_APP_SECRET_COURIERIFY. Rotation
 * is a redeploy, which is proportionate while the caller list is a handful of
 * our own services; moving them to a table later changes nothing about the
 * request contract.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { validateExternalKey } from "../triggerConfig.js";
import { hit } from "../security/rate-limit.server.js";

/** Requests per app per window. Generous — these are trusted internal callers. */
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60 * 1000;

/** Minimum secret length we will accept from config, to catch a placeholder. */
const MIN_SECRET_LENGTH = 24;

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * Both sides are hashed first so the buffers are always 32 bytes: timingSafeEqual
 * throws on a length mismatch, and catching that throw would itself be a length
 * oracle. Hashing makes every comparison the same shape regardless of input.
 */
function secretsMatch(a, b) {
  const ha = createHash("sha256").update(String(a), "utf8").digest();
  const hb = createHash("sha256").update(String(b), "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** The env var holding a given app's secret. */
export function secretEnvName(app) {
  return `INTERNAL_APP_SECRET_${String(app).toUpperCase()}`;
}

/**
 * Pull the presented secret out of the request.
 *
 * Header only, never the body or the query string: a query string lands in
 * access logs and browser history, and a body is the part most likely to be
 * dumped wholesale into a log line when someone debugs a failing call.
 */
function presentedSecret(request) {
  const header = request.headers.get("authorization") || "";
  if (header.slice(0, 7).toLowerCase() === "bearer ") return header.slice(7).trim();
  return "";
}

/**
 * Authenticate a call to the internal API.
 *
 * Returns a discriminated result rather than throwing, so callers can shape
 * their own response and log the reason. The `error` text is safe to return to
 * the caller — it never says whether the app exists, only that the pair failed.
 *
 * @param {Request} request
 * @param {string} app the app name from the request body
 * @returns {{ ok: true, app: string } | { ok: false, status: number, error: string }}
 */
export function authenticateInternalCaller(request, app) {
  const shape = validateExternalKey(app, "app");
  if (!shape.ok) {
    return { ok: false, status: 400, error: shape.error };
  }
  const appName = shape.key;

  // Limit before the secret check, keyed on the claimed app name. An attacker
  // controls that name, so this is not a defence against a determined one — it
  // is a brake on a looping caller and on trivial secret guessing.
  const gate = hit(`internal-api:${appName}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!gate.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Rate limit exceeded. Retry in ${Math.ceil(gate.retryAfterMs / 1000)}s.`,
    };
  }

  const expected = process.env[secretEnvName(appName)] || "";
  const presented = presentedSecret(request);

  // An unconfigured app and a wrong secret get the same answer, so the API
  // cannot be used to enumerate which Growzar apps are wired up. The log line
  // is where the two are told apart, because that is for us.
  if (!expected || expected.length < MIN_SECRET_LENGTH) {
    console.warn(
      `[internal-api] rejected "${appName}" — ${secretEnvName(appName)} is unset or too short`,
    );
    return { ok: false, status: 401, error: "Unknown app or invalid secret." };
  }
  if (!presented || !secretsMatch(presented, expected)) {
    console.warn(`[internal-api] rejected "${appName}" — bad or missing bearer secret`);
    return { ok: false, status: 401, error: "Unknown app or invalid secret." };
  }

  return { ok: true, app: appName };
}
