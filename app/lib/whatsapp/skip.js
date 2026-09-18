/**
 * Prefix on the lastError of a WhatsApp job that was deliberately not sent
 * (channel off, no opt-in, opted out, unusable number). Such a job is "done" —
 * it must not hold up or fail the flow — but it has no sentAt and no failedAt,
 * so without a note it was indistinguishable from nothing having happened.
 * Written by the WhatsApp worker; read by reporting to count skips.
 */
export const WA_SKIP_PREFIX = "skipped: ";
