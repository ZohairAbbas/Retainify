/**
 * The pure half of posting events to Growzar (API-CONTRACT §7): the envelope,
 * the retry schedule, and what each response means. No database here, so it is
 * tested without one; events.server.js does the storing and sending.
 */
import { randomUUID } from "node:crypto";

export const EVENTS_PATH = "/api/v1/events";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * §7: retried on 5xx with backoff 1m, 5m, 30m, 2h, 6h, 12h. The first attempt
 * is immediate; RETRY_DELAYS_MS[n] is the wait after failed attempt n+1, so an
 * event gets 1 + 6 = 7 attempts over roughly 20h40m before it is marked failed.
 */
export const RETRY_DELAYS_MS = [1 * MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR, 6 * HOUR, 12 * HOUR];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/**
 * When to try again after `attempts` failed attempts, or null if that was the
 * last one.
 */
export function nextRetryAt(attempts, now = Date.now()) {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  return delay === undefined ? null : new Date(now + delay);
}

/**
 * What a response means for the row.
 *
 *   2xx                 delivered (202 normally; 202 duplicate:true too)
 *   5xx, 408, 429,
 *   network error       retry — the contract's case, plus the two 4xx that
 *                       mean "later", not "never"
 *   401                 retry. Growzar answers 401 when it has no secret for
 *                       us yet or the secrets are mid-rotation — a config lag
 *                       on the far side that fixes itself, not a bad event.
 *                       Losing an uninstall to a deploy-order mistake is worse
 *                       than six extra requests.
 *   other 4xx           failed, no retry: the envelope itself is wrong and
 *                       sending it again changes nothing.
 *
 * @param {number|null} status null for a network error or timeout
 * @returns {"delivered"|"retry"|"failed"}
 */
export function classifyResponse(status) {
  if (status === null) return "retry";
  if (status >= 200 && status < 300) return "delivered";
  if (status >= 500 || status === 408 || status === 429 || status === 401) return "retry";
  return "failed";
}

/**
 * Build a §7 envelope. `eventId` is ours, unique, never reused — Growzar
 * dedupes on it.
 */
export function buildEnvelope({ topic, shop, occurredAt = new Date(), actor = null, data = {}, eventId = randomUUID() }) {
  // An unparseable source timestamp must not cost the event: fall back to now.
  let when = new Date(occurredAt);
  if (Number.isNaN(when.getTime())) when = new Date();
  return {
    eventId,
    topic,
    occurredAt: when.toISOString().replace(/\.\d{3}Z$/, "Z"),
    shop,
    actor,
    data,
  };
}
