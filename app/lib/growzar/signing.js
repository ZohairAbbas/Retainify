/**
 * Growzar request signing, API-CONTRACT §2.1 and §2.2.
 *
 *   X-Growzar-Signature: sha256=HMAC(secret, "<timestamp>.<method> <path+query>.<raw body>")
 *   X-Growzar-Timestamp: ms epoch, 5-minute skew limit, compared timing-safe
 *
 * One construction for both directions: verifying Growzar's calls to us
 * (/api/v1/growzar/*) and signing the events we post to Growzar. It mirrors
 * Growzar's own app/lib/apps/signing.server.ts byte for byte — any difference
 * in the string being hashed is a failed request, so this file is the one place
 * that string is built.
 *
 * Plain JS with no imports beyond node:crypto, so the R2 read API reuses it
 * as-is and the tests run under `node --test` without a database.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_SKEW_MS = 5 * 60 * 1000;

/** The exact bytes both sides hash. */
export function signingPayload({ timestamp, method, pathWithQuery, body }) {
  return `${timestamp}.${String(method).toUpperCase()} ${pathWithQuery}.${body}`;
}

export function sign(secret, payload) {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

/**
 * Headers for a signed call to Growzar (§2.2). `body` must be the exact string
 * that goes on the wire.
 */
export function signedHeaders({ secret, method, pathWithQuery, body = "", now = Date.now() }) {
  return {
    "Content-Type": "application/json",
    "X-Growzar-Timestamp": String(now),
    "X-Growzar-Signature": sign(secret, signingPayload({ timestamp: now, method, pathWithQuery, body })),
  };
}

/**
 * Verify an inbound signature.
 *
 * The timestamp is checked before the HMAC, and in both directions: a
 * far-future timestamp is as wrong as an old one.
 *
 * @returns {{ ok: true } | { ok: false, reason: "missing_signature"|"missing_timestamp"|"timestamp_out_of_range"|"bad_signature" }}
 */
export function verifySignature({ secret, signature, timestamp, method, pathWithQuery, body, now = Date.now() }) {
  if (!signature) return { ok: false, reason: "missing_signature" };
  if (!timestamp) return { ok: false, reason: "missing_timestamp" };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: "timestamp_out_of_range" };
  if (Math.abs(now - sentAt) > SIGNATURE_SKEW_MS) return { ok: false, reason: "timestamp_out_of_range" };

  const expected = sign(secret, signingPayload({ timestamp: sentAt, method, pathWithQuery, body }));
  return secretsMatch(expected, signature) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

/**
 * Constant-time string comparison. Both sides are hashed first so the buffers
 * are always 32 bytes — timingSafeEqual throws on a length mismatch, and that
 * throw would itself be a length oracle. Same approach as lib/internal/auth.
 */
export function secretsMatch(a, b) {
  const ha = createHash("sha256").update(String(a), "utf8").digest();
  const hb = createHash("sha256").update(String(b), "utf8").digest();
  return timingSafeEqual(ha, hb);
}
