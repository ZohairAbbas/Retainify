/**
 * The worker schedule — every background job this app runs, and how often.
 *
 * ── Why it is here rather than in entry.server.jsx ─────────────────────────
 * It used to be a setInterval in the web server's entry module, which had two
 * consequences. Sending competed with request handling inside the same process,
 * and a second web instance ran every worker a second time — so the app was
 * pinned to one instance for availability and for load.
 *
 * Extracting the schedule is what makes a dedicated worker process possible
 * (workers/main.js), while leaving the web process able to run the same tick
 * when nothing else will — a single-container deploy, and `shopify app dev`,
 * where a merchant testing a flow still has to see the email arrive.
 *
 * ── Two different safety mechanisms, deliberately ──────────────────────────
 * Leases (lease.server.js) go only on the workers that lacked a claim. The send
 * workers already claim per row and are left unleased on purpose: leasing them
 * would serialize them, and two instances would drain the queues no faster than
 * one. Which worker is which is recorded next to each call below.
 *
 * The in-process overlap guard is a separate concern from either. setInterval
 * does not wait for the previous callback to settle, so a tick that runs longer
 * than its interval stacks on itself within a single process, where no
 * database-level claim is involved at all.
 */
import { runJourneyWorker } from "../journey/journey-worker.server.js";
import { runBroadcastWorker } from "../journey/broadcast.server.js";
import { runPushWorker } from "../push/push-worker.server.js";
import { runWhatsappWorker } from "../whatsapp/whatsapp-worker.server.js";
import { runSegmentEnrollmentWorker } from "../segments/segmentEnrollmentWorker.server.js";
import { runSegmentSnapshotWorker } from "../segments/segmentSnapshotWorker.server.js";
import { runEngagementRollupWorker } from "../segments/engagementRollupWorker.server.js";
import { pruneExpiredSessions } from "../auth/session.server.js";
import { runStuckJobReaper, runEnrollmentStallReaper } from "../journey/stuck-jobs.server.js";
import { runEnrollmentAdvanceWorker } from "../journey/advance.server.js";
import { withLease } from "./lease.server.js";

export const FAST_TICK_MS = 60_000;
export const SLOW_TICK_MS = 5 * 60_000;
export const HOURLY_TICK_MS = 60 * 60_000;

const MINUTE = 60_000;

/**
 * Ticks already in flight, by name.
 *
 * setInterval fires on a timer, not on completion: a 90-second tick on a
 * 60-second interval overlaps itself, and each overlap makes the next one more
 * likely. The database claims prevent two *processes* colliding; this prevents
 * one process colliding with itself, which no claim would catch because both
 * copies are the same holder.
 */
const inFlight = new Set();

async function guarded(name, fn) {
  if (inFlight.has(name)) {
    console.warn(`[tick] ${name} still running from the previous tick — skipped`);
    return;
  }
  inFlight.add(name);
  try {
    await fn();
  } catch (err) {
    // One worker's failure must not take the rest of the tick with it.
    console.error(`[${name}] poll error:`, err);
  } finally {
    inFlight.delete(name);
  }
}

/** Run `fn` only on the instance that holds this worker's lease. */
function leased(name, fn, ttlMs) {
  return () => withLease(name, fn, { ttlMs });
}

/**
 * The per-minute pass: everything that moves a contact through a flow or gets a
 * message out. Sequenced, not parallel, so a heavy send does not run alongside
 * a segment evaluation in the same process.
 */
export async function runFastTick() {
  // Walks lazy enrollments to their next node. Runs BEFORE the send workers so
  // a job created this tick is picked up in the same one rather than waiting
  // another minute — over a six-step flow that is five minutes of pure latency
  // saved for nothing.
  //
  // Unleased: taking nextRunAt is itself the claim (advance.server.js).
  await guarded("advance", runEnrollmentAdvanceWorker);
  // Unleased: claimDueJourneyJobs flips pending → processing conditionally.
  await guarded("journey-worker", runJourneyWorker);
  // Dispatches scheduled broadcasts. Enrolment only — the journey worker above
  // does the actual sending on the next tick.
  //
  // Unleased: dispatchBroadcast claims on `dispatchedAt: null`, which its own
  // header calls the exactly-once guarantee against a second app instance.
  await guarded("broadcast", runBroadcastWorker);
  // Unleased: both claim pending → processing per job.
  await guarded("push-worker", runPushWorker);
  await guarded("whatsapp-worker", runWhatsappWorker);
  // Leased. Picks the BUDGET_PER_TICK stalest flows by lastEnrollmentAt with no
  // per-row claim, so two instances pick the *same* flows and both enroll.
  // Ten minutes: a budgeted tick is three flows, but one of those can be a
  // whole-audience evaluation on a large shop.
  await guarded("segment-enrollment", leased("segment-enrollment", runSegmentEnrollmentWorker, 10 * MINUTE));
  // Leased. isDue(lastSegmentSnapshotAt) then write, with nothing between the
  // two — concurrent instances produce duplicate snapshot rows for the same
  // segment on the same day, which is a silent corruption of the trend chart.
  // Fifteen minutes: this walks every segment of every shop.
  await guarded("segment-snapshot", leased("segment-snapshot", runSegmentSnapshotWorker, 15 * MINUTE));
  // Repairs engagement columns the send path and webhooks failed to roll up.
  // Self-throttling: no-ops for a shop swept within the last 15 minutes.
  //
  // Leased. A recompute is idempotent, so a collision here wastes work rather
  // than corrupting anything — but it also races the cursor, and a cursor that
  // jumps skips the rows between.
  await guarded("engagement-rollup", leased("engagement-rollup", runEngagementRollupWorker, 10 * MINUTE));
  // Recovers work abandoned mid-flight when the process died — every deploy is
  // a chance to strand whatever was being sent at that moment, and a row stuck
  // in "processing" is invisible to every claim query.
  //
  // Leased: it hands attempts back, and two instances would hand back two.
  await guarded("stuck-jobs", leased("stuck-jobs", runStuckJobReaper, 10 * MINUTE));
}

/**
 * Enrollments that lost their wake-up. Five-minutely rather than per-minute: a
 * stall is a standing condition, not an event, and this reads across every open
 * enrollment rather than a claim window. It only reports — and logs its own
 * findings at error level with a sample — see runEnrollmentStallReaper for why
 * it must not quietly re-wake anything.
 *
 * Leased so that N instances produce one report rather than N identical ones.
 */
export async function runSlowTick() {
  await guarded("stall-reaper", leased("stall-reaper", runEnrollmentStallReaper, 10 * MINUTE));
}

/**
 * Housekeeping for the standalone auth tables. Hourly, not per-minute: an
 * expired session is already rejected on read, so deleting the row is purely
 * about not growing the table forever.
 *
 * Leased: the delete is idempotent, but there is no reason for every instance
 * to issue the same wide DELETE at the same moment.
 */
export async function runHourlyTick() {
  await guarded("session-prune", leased("session-prune", pruneExpiredSessions, 30 * MINUTE));
}

/**
 * Start every timer. Returns a function that stops them again — the standalone
 * worker uses it to drain on SIGTERM, and tests use it to not leak intervals.
 *
 * @param {{label?: string}} opts label distinguishes the web process's tick
 *   from the dedicated worker's in the logs.
 */
export function startWorkers({ label = "workers" } = {}) {
  const timers = [
    setInterval(() => void runFastTick(), FAST_TICK_MS),
    setInterval(() => void runSlowTick(), SLOW_TICK_MS),
    setInterval(() => void runHourlyTick(), HOURLY_TICK_MS),
  ];
  console.log(`[${label}] started — fast ${FAST_TICK_MS / 1000}s, slow ${SLOW_TICK_MS / 1000}s, hourly`);
  return function stopWorkers() {
    for (const t of timers) clearInterval(t);
  };
}
