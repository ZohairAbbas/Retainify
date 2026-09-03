/**
 * Worker leases — "only one process runs this worker at a time".
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Every queue was driven by a 60s setInterval in the web server's entry module,
 * which pinned the app to a single instance: a second web process ran every
 * worker a second time.
 *
 * The send workers were already built for this and are left alone. Email, push,
 * WhatsApp, broadcast dispatch and the enrollment advance each claim their work
 * with a conditional update — `status: "pending"` in the WHERE, `dispatchedAt:
 * null`, taking `nextRunAt` — so a second instance updates zero rows and does
 * nothing. Leasing them would only serialize them, and two instances would
 * drain the queues no faster than one.
 *
 * The periodic workers have no such claim. They read a timestamp
 * (`lastSegmentSnapshotAt`, `lastEngagementRollupAt`) or a round-robin cursor
 * (`Journey.lastEnrollmentAt`), conclude they are due, and act — and two
 * processes reach that conclusion simultaneously. This is the claim they were
 * missing, taken per worker rather than per row.
 *
 * ── Why a lease rather than a flag ─────────────────────────────────────────
 * A holder can die: a deploy, an OOM kill, a crash mid-tick. With a boolean
 * "running" flag that leaves the worker switched off permanently, and silently
 * — the same shape as the stranded jobs stuck-jobs.server.js exists to sweep
 * up. With an expiry the worst case is one skipped interval.
 *
 * ── The TTL is a correctness parameter, not a tuning knob ──────────────────
 * A lease that expires while its holder is still working is not a lease: a
 * second process takes it and the two run concurrently, which is the exact
 * situation this module exists to prevent. So a TTL must exceed the worker's
 * worst case, not its typical case, by a wide margin. Overrunning is cheap —
 * the lease is released on completion, so a long TTL never delays the next run.
 */
import os from "node:os";
import crypto from "node:crypto";

import prisma from "../../db.server.js";

/**
 * Who this process is, for the `holder` column.
 *
 * The nonce matters as much as the pid: pids are recycled, and under a process
 * manager a restarted worker can come back with the pid of the one that just
 * died. Without it, a new process could release the lease its dead predecessor
 * had — which the holder check exists to prevent.
 */
export const HOLDER_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;

/** Default lease lifetime. Generous on purpose — see the TTL note above. */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Take the lease for `name` if it is free or expired.
 *
 * Two statements, in this order, and the order is the point:
 *
 *   1. UPDATE ... WHERE name = ? AND expiresAt < now. Postgres evaluates the
 *      predicate under a row lock, so exactly one of any number of racing
 *      processes gets count = 1.
 *   2. Only if that matched nothing, INSERT — for the first ever run, when
 *      there is no row to update. A unique-violation here means another process
 *      inserted first, which is a clean loss, not an error.
 *
 * Doing it the other way round (insert, fall back to update) would work too,
 * but would make the common path throw and catch on every single tick.
 *
 * @returns {Promise<boolean>} true if this process now holds the lease
 */
export async function acquireLease(name, ttlMs = DEFAULT_TTL_MS) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const taken = await prisma.workerLease.updateMany({
    where: { name, expiresAt: { lt: now } },
    data: { holder: HOLDER_ID, acquiredAt: now, expiresAt },
  });
  if (taken.count > 0) return true;

  try {
    await prisma.workerLease.create({
      data: { name, holder: HOLDER_ID, acquiredAt: now, expiresAt },
    });
    return true;
  } catch {
    // The row already exists and is held by someone whose lease has not
    // expired. Not ours; nothing to report.
    return false;
  }
}

/**
 * Give the lease back, so the next tick can take it immediately rather than
 * waiting out the TTL.
 *
 * Guarded on `holder`. A process that overran its TTL no longer owns the lease
 * even though it is still running, and releasing it then would hand a second
 * copy of the worker a lease the first copy is still using — turning a slow
 * tick into a concurrent one, which is worse than the delay.
 */
export async function releaseLease(name) {
  const { count } = await prisma.workerLease.updateMany({
    where: { name, holder: HOLDER_ID },
    data: { expiresAt: new Date() },
  });
  return count > 0;
}

/**
 * Run `fn` if this process can take the lease for `name`, and always give it
 * back afterwards — including when `fn` throws, which is the case a lease held
 * to its full TTL would silently stall the worker for.
 *
 * Errors are rethrown: the caller decides what a failing worker means. Every
 * current caller logs and moves on, matching the existing tick.
 *
 * @returns {Promise<{ran: boolean, result?: any}>} ran:false means another
 *   process holds the lease — the expected outcome on every instance but one,
 *   so it is not logged and is not an error.
 */
export async function withLease(name, fn, { ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!(await acquireLease(name, ttlMs))) return { ran: false };
  try {
    return { ran: true, result: await fn() };
  } finally {
    await releaseLease(name).catch((err) =>
      // Worth knowing about but not worth failing the tick over: the lease
      // expires on its own, so this costs at most one interval.
      console.error(`[lease] releasing ${name} failed:`, err.message),
    );
  }
}
