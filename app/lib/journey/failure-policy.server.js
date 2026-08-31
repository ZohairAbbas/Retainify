/**
 * What to do about a send that failed.
 *
 * ── The problem this replaces ──────────────────────────────────────────────
 * Every failure used to be treated identically: three attempts, 10 and 20
 * minutes apart, then dead forever. The error string was stored and never read.
 *
 * That gave a job a 30-minute window to survive. A daily sending quota resets
 * up to 24 hours later, so a job that hit the cap burned all three attempts
 * inside the same exhausted quota period and could not possibly recover. Not
 * unlucky — structurally impossible.
 *
 * The evidence, from this database: every one of the 20,578 permanently failed
 * jobs had attempts = 3, i.e. not one ever failed for any reason other than
 * running out of retries. 20,564 of them (99.93%) carried "You have reached
 * your daily email sending quota" — a condition that fixes itself. Seven jobs,
 * 0.03%, were genuine permanent failures that deserved to stop.
 *
 * ── The three classes ──────────────────────────────────────────────────────
 * PERMANENT  the recipient or the request is wrong and always will be. Retrying
 *            cannot help, and under the old scheme merely delayed the verdict
 *            by 30 minutes. Fail on the first attempt.
 *
 * TRANSIENT  capacity, not correctness: quota, rate limits, provider 5xx,
 *            network. Retry across a full day so a daily window can roll over.
 *
 * OPS        our configuration is broken, not the send: a suspended or invalid
 *            API key, an unverified domain, an IAM denial. Nothing the job does
 *            will fix it and it is not the recipient's fault, so the work waits
 *            for a human WITHOUT spending its retry budget. When the key is
 *            restored the queue is still intact.
 */

export const PERMANENT = "permanent";
export const TRANSIENT = "transient";
export const OPS = "ops";

/** How long a transient failure may keep trying before we call it dead. */
export const TRANSIENT_HORIZON_MS = 24 * 60 * 60 * 1000;

/**
 * Backoff for a transient failure.
 *
 * Starts at an hour rather than ten minutes: the dominant transient failure is
 * a daily quota, and retrying a known-exhausted quota every few minutes is
 * pure noise against the provider. Grows from there, capped so the deadline is
 * still approached in reasonable steps rather than one long sleep.
 */
export function transientBackoffMs(attempts) {
  const hour = 60 * 60 * 1000;
  return Math.min(hour * Math.pow(2, Math.max(0, attempts - 1)), 6 * hour);
}

/**
 * Decide a failed job's fate.
 *
 * @param {object} params
 * @param {string} params.errorClass one of PERMANENT | TRANSIENT | OPS
 * @param {number} params.attempts   attempts already consumed (claim increments)
 * @param {Date|null} params.firstFailedAt when this job first failed, if before now
 * @param {Date} [params.now]
 * @returns {{ status: "failed"|"pending", retryInMs: number, consumesAttempt: boolean, note: string }}
 */
export function decideFailureOutcome({ errorClass, attempts, firstFailedAt, now = new Date() }) {
  if (errorClass === PERMANENT) {
    return {
      status: "failed",
      retryInMs: 0,
      consumesAttempt: true,
      note: "permanent failure — not retryable",
    };
  }

  if (errorClass === OPS) {
    // Deliberately never fails and never spends an attempt. The risk is a job
    // waiting forever on a config nobody fixes; that is a monitoring problem,
    // and a silent hold beats discarding the send.
    return {
      status: "pending",
      retryInMs: 30 * 60 * 1000,
      consumesAttempt: false,
      note: "configuration failure — holding for operator fix, retry budget untouched",
    };
  }

  // TRANSIENT, and anything unrecognised. Unknown errors are retried rather
  // than discarded: losing sends is the failure mode this whole module exists
  // to prevent, and the horizon bounds the damage either way.
  const startedFailing = firstFailedAt ? firstFailedAt.getTime() : now.getTime();
  const elapsed = now.getTime() - startedFailing;
  if (elapsed >= TRANSIENT_HORIZON_MS) {
    return {
      status: "failed",
      retryInMs: 0,
      consumesAttempt: true,
      note: `transient failure still unresolved after ${Math.round(elapsed / 3600000)}h — giving up`,
    };
  }

  return {
    status: "pending",
    retryInMs: transientBackoffMs(attempts),
    consumesAttempt: true,
    note: "transient failure — will retry",
  };
}

/**
 * Hard ceiling on attempts, as a runaway guard only.
 *
 * The real limit for a transient failure is TRANSIENT_HORIZON_MS; this exists
 * so a bug that somehow keeps rescheduling cannot loop forever. It must stay
 * comfortably above the number of retries the backoff curve fits into the
 * horizon (1h + 2h + 4h + 6h + 6h + 6h ≈ 25h, so about seven), otherwise the
 * count would silently become the binding constraint again — which is exactly
 * the bug this module was written to remove.
 */
export const MAX_ATTEMPTS = 12;

/**
 * How overdue a job may be before sending it does more harm than good.
 *
 * A queue that stalls — a suspended provider key, a stranded backlog, a worker
 * down over a weekend — eventually resumes, and without this guard everything
 * it accumulated goes out at once. That is not a hypothetical: 1,264 jobs sat
 * frozen on one shop for up to three months, and the moment the attempt ceiling
 * was raised they would all have become due together, sending cart-recovery
 * mail for carts abandoned in May.
 *
 * Measured against scheduledFor, which quiet-hours deferrals move forward, so a
 * legitimately postponed job never looks stale.
 */
export const STALE_AFTER_MS = 72 * 60 * 60 * 1000;

/** @returns {boolean} true when a job is too far past its due time to send. */
export function isStale(scheduledFor, now = new Date()) {
  if (!scheduledFor) return false;
  return now.getTime() - new Date(scheduledFor).getTime() > STALE_AFTER_MS;
}
