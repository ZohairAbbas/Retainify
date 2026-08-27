/**
 * In-memory sliding-window rate limiter for the public storefront endpoints.
 *
 * These endpoints are reachable by anyone — they are called from storefront JS,
 * so they cannot require an admin session and CORS is necessarily open. Without
 * a limit, a single script can drive unbounded confirmation emails out of the
 * shared sending domain, which costs every shop on it their deliverability.
 *
 * Deliberately in-process rather than Redis-backed: the app runs as a single
 * PM2 fork (see ecosystem.config.cjs, instances: 1), so one process sees every
 * request. If that ever becomes a cluster this must move to shared storage —
 * per-process buckets would multiply the effective limit by the instance count.
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
