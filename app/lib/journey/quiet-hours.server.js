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
