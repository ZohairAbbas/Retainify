/**
 * Quiet-hours check shared by the channel workers (email/push/whatsapp).
 *
 * Returns true when `now` falls inside the shop's quiet window, expressed as
 * start/end hours (0-23) in the store's timezone. Handles windows that wrap
 * midnight (e.g. 22 → 8). On any error (bad timezone), returns false so a send
 * is never silently blocked by a config issue.
 */
export function isInQuietHours(quietStart, quietEnd, timezone) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    });
    const hour = parseInt(formatter.format(now), 10);
    if (quietStart < quietEnd) return hour >= quietStart && hour < quietEnd;
    return hour >= quietStart || hour < quietEnd;
  } catch {
    return false;
  }
}

/**
 * How long to defer a job that landed inside quiet hours.
 *
 * Jittered rather than a flat hour. Without it every message deferred overnight
 * becomes due within the same worker tick at the top of the wake hour, so a
 * shop's whole backlog leaves in one burst — which is exactly the pattern
 * mailbox providers throttle, and it lands every customer's email at the same
 * minute.
 *
 * 45–90 minutes: still re-checks promptly once the window closes, but spreads
 * the backlog across several ticks.
 */
export function quietHoursRetryDelay() {
  const base = 45 * 60 * 1000;
  const spread = 45 * 60 * 1000;
  return base + Math.floor(Math.random() * spread);
}
