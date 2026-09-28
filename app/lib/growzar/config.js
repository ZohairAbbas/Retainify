/**
 * Growzar platform configuration (API-CONTRACT §2.3).
 *
 *   GROWZAR_URL             where Growzar lives, e.g. https://growzar.com
 *   GROWZAR_PLATFORM_KEY    the bearer key Growzar presents to us
 *   GROWZAR_SIGNING_SECRET  the HMAC secret for both directions, and the
 *                           HS256 key for the claim token (§10)
 *
 * One of each per environment, and never shared with another peer: this is
 * deliberately not INTERNAL_APP_SECRET_*, which authenticates a different
 * surface.
 *
 * Read at call time, not module load, so a test (or a rotated value after
 * `pm2 delete` + `start`) is picked up without an import-order dance.
 */

/** Refuse obviously placeholder secrets rather than run with them. */
export const MIN_SECRET_LENGTH = 24;

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ url: string|null, platformKey: string|null, signingSecret: string|null }}
 */
export function growzarConfig(env = process.env) {
  const url = (env.GROWZAR_URL || "").trim().replace(/\/+$/, "") || null;
  const platformKey = usable(env.GROWZAR_PLATFORM_KEY);
  const signingSecret = usable(env.GROWZAR_SIGNING_SECRET);
  return { url, platformKey, signingSecret };
}

function usable(raw) {
  const v = (raw || "").trim();
  return v.length >= MIN_SECRET_LENGTH ? v : null;
}

/** A Shopify shop domain in canonical form (§3), or null. */
export function canonicalShop(raw) {
  const shop = String(raw || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ? shop : null;
}
