/**
 * In-memory sliding-window rate limiter for the public storefront endpoints.
 *
 * These endpoints are called from storefront JS, so they cannot require an admin
 * session. They now require a Shopify app-proxy signature instead (see
 * app-proxy.server.js), which means the caller has to be a real storefront — but
 * that is not a volume control. Every accepted popup signup still sends a
 * confirmation email from the SHARED sending domain, so an unthrottled flood
 * through a legitimate storefront still costs every shop on it their
 * deliverability.
 *
 * ── The limits are per-process, and production runs more than one ───────────
 * These buckets live in this process's memory. Production runs PM2 in cluster
 * mode with 2 instances, so each one keeps its own buckets and the EFFECTIVE
 * limit is roughly double whatever a caller reads here: an 8-per-10-minutes
 * per-IP cap admits about 16, and a 500-per-hour per-shop cap about 1000.
 *
 * That is a known, accepted gap rather than an oversight — the caps are ceilings
 * on catastrophe rather than traffic shapers, and 2x a generous ceiling is still
 * a ceiling. Anyone tightening these numbers to a value that has to be exact,
 * though, is relying on something this cannot provide: the fix is shared storage
 * (Postgres or Redis), not a smaller constant here.
 *
 * Memory is bounded by pruning expired buckets on write, and by a hard cap on
 * distinct keys so a spray of unique IPs can't itself become the attack.
 */

const MAX_TRACKED_KEYS = 20_000;

/** @type {Map<string, number[]>} key → sorted timestamps within the window */
const buckets = new Map();

/**
 * Record a hit and report whether it is over the limit.
 *
 * @param {string} key      identity to limit on (e.g. "signup:ip:1.2.3.4")
 * @param {number} limit    max hits allowed within the window
 * @param {number} windowMs window length in milliseconds
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
 */
export function hit(key, limit, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;

  let times = buckets.get(key);
  if (!times) {
    if (buckets.size >= MAX_TRACKED_KEYS) pruneExpired(now);
    // Still full after pruning: shed the oldest key rather than growing without
    // bound. Worst case an attacker evicts a legitimate bucket, which only ever
    // makes us more permissive — never less.
    if (buckets.size >= MAX_TRACKED_KEYS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    times = [];
    buckets.set(key, times);
  }

  // Drop timestamps that have aged out of the window.
  let i = 0;
  while (i < times.length && times[i] <= cutoff) i++;
  if (i > 0) times.splice(0, i);

  if (times.length >= limit) {
    const retryAfterMs = Math.max(0, times[0] + windowMs - now);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  times.push(now);
  return { allowed: true, remaining: limit - times.length, retryAfterMs: 0 };
}

/** Drop buckets whose newest entry is older than an hour. */
function pruneExpired(now) {
  const staleBefore = now - 60 * 60 * 1000;
  for (const [key, times] of buckets) {
    if (!times.length || times[times.length - 1] < staleBefore) buckets.delete(key);
  }
}

/**
 * Best-effort client IP behind a proxy.
 *
 * X-Forwarded-For is client-controlled, so this is a speed bump rather than
 * identity — it is paired with limits on the shop and the target address, which
 * an attacker cannot forge away.
 */
export function clientIp(request) {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0]?.trim();
  return (
    first ||
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Test seam — clears all state. */
export function __resetRateLimits() {
  buckets.clear();
}
