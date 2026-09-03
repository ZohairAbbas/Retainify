/**
 * Recovery for jobs orphaned in "processing".
 *
 * ── The hole this closes ───────────────────────────────────────────────────
 * Claiming a job flips it to "processing" before the send runs. If the process
 * dies in between — a deploy, a restart, an OOM kill — the row stays
 * "processing" forever, because every claim query looks only at "pending".
 * Nothing else ever reads it again.
 *
 * A stranded row looks perfectly healthy, which is why this went unnoticed: ten
 * jobs on one shop sat frozen for three days and were only found by hand. With
 * a service that restarts on every deploy, each deploy is another chance to
 * strand whatever was mid-flight.
 *
 * ── Why email is recovered but push and WhatsApp are not ───────────────────
 * The gap between "provider accepted the message" and "we wrote status=done" is
 * milliseconds, but a crash inside it means the message went out while the row
 * still says processing. Re-running such a job would send it twice.
 *
 * Email is safe: the journey worker passes idempotencyKey = job.id, so Resend
 * collapses a duplicate send into the original. Push (web-push) and WhatsApp
 * have no equivalent — Meta bills per conversation and a repeat notification is
 * plainly visible to the shopper — so their orphans are cancelled rather than
 * retried. Losing one notification beats sending two, and the cancellation is
 * recorded rather than silent.
 *
 * The SES adapter also has no idempotency key. Every shop currently sends via
 * Resend, so this is not live today, but a shop switched to SES would be
 * exposed to a duplicate on reap — worth an idempotency story before SES is
 * used in anger.
 */
import prisma from "../../db.server.js";
import { settleEnrollmentIfFinished } from "./journey-queue.server.js";

/**
 * How long a job may legitimately sit in "processing".
 *
 * Workers tick every 60s and a send completes in seconds, so anything at this
 * age is not in flight — it belongs to a process that is gone.
 */
export const STUCK_AFTER_MS = 15 * 60 * 1000;

/**
 * Recover jobs abandoned mid-flight.
 *
 * Cheap when idle: one indexed-ish count per queue that normally matches
 * nothing. Safe to call on every tick.
 *
 * @returns {Promise<{ recovered: number, cancelled: number }>}
 */
export async function runStuckJobReaper() {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const stuck = { status: "processing", updatedAt: { lt: cutoff } };
  let recovered = 0;
  let cancelled = 0;

  // ── Email: safe to run again, thanks to the per-job idempotency key ───────
  try {
    const orphans = await prisma.journeyJob.findMany({
      where: stuck,
      select: { id: true, shop: true, attempts: true, updatedAt: true },
      take: 200,
    });
    for (const job of orphans) {
      // The attempt is handed back: the process died before the send could be
      // judged, so charging the job for it would spend its retry budget on our
      // crash rather than on anything the send did.
      await prisma.journeyJob.update({
        where: { id: job.id },
        data: {
          status: "pending",
          attempts: Math.max(0, job.attempts - 1),
          scheduledFor: new Date(),
          lastError: "recovered after being orphaned in processing",
        },
      });
      recovered++;
      console.warn(
        `[stuck-jobs] journeyJob ${job.id} (${job.shop}) recovered — orphaned since ${job.updatedAt.toISOString()}`,
      );
    }
  } catch (err) {
    console.error("[stuck-jobs] email sweep failed:", err.message);
  }

  // ── Push and WhatsApp: cancel, because a repeat send is not deduplicated ──
  for (const model of ["pushJob", "whatsappJob"]) {
    try {
      const orphans = await prisma[model].findMany({
        where: stuck,
        select: { id: true, shop: true, enrollmentId: true, updatedAt: true },
        take: 200,
      });
      for (const job of orphans) {
        await prisma[model].update({
          where: { id: job.id },
          data: {
            status: "cancelled",
            lastError: "orphaned in processing — cancelled rather than risk a duplicate send",
          },
        });
        // Settle here too, or the enrollment is left open forever by a job that
        // will never reach a terminal handler. Both queues in this loop are the
        // benign ones — a lost push or WhatsApp must not end the email sequence
        // it was travelling alongside.
        await settleEnrollmentIfFinished(job.enrollmentId, {
          failed: true,
          channel: model === "pushJob" ? "push" : "whatsapp",
        });
        cancelled++;
        console.warn(
          `[stuck-jobs] ${model} ${job.id} (${job.shop}) cancelled — orphaned since ${job.updatedAt.toISOString()}`,
        );
      }
    } catch (err) {
      console.error(`[stuck-jobs] ${model} sweep failed:`, err.message);
    }
  }

  return { recovered, cancelled };
}

/**
 * How long an enrollment may sit with nothing scheduled and nothing queued.
 *
 * Generous on purpose. The legitimate version of this state lasts one worker
 * tick: a job settles, settleEnrollmentIfFinished sets nextRunAt, the next tick
 * advances it. Anything still in it after fifteen minutes has lost its wake-up.
 */
export const STALL_AFTER_MS = 15 * 60 * 1000;

/**
 * Find enrollments that nobody will ever wake.
 *
 * ── Why this exists at all ─────────────────────────────────────────────────
 * An enrollment is only ever in one of two healthy states: parked on a
 * nextRunAt, or waiting on a live job. A stall is neither — no wake time, no
 * job, not exited — and it is completely silent. No job fails, nothing appears
 * in any report, no error is logged. The contact simply stops hearing from the
 * merchant partway through a flow, and the only evidence is an absence.
 *
 * This codebase has been bitten twice by exactly that shape: 1,264 jobs
 * stranded by quiet-hours deferrals eating the retry budget, and 129
 * enrollments left open by terminal paths that never closed them. Both were
 * found by hand, long after the fact. The whole point of shipping this
 * alongside the lazy scheduler rather than after it is that the scheduler
 * introduces a third, larger way to produce the same silence.
 *
 * ── Reports, does not repair ───────────────────────────────────────────────
 * Deliberately read-only. Automatically re-waking a stalled enrollment would
 * paper over whatever caused the stall — and if the cause is a bug in the walk
 * itself, re-waking sends the contact round it again. The count belongs on a
 * dashboard with an alarm on it; a human decides what to do.
 *
 * This also subsumes the cutover's drain gauge. That counted enrollments still
 * on the pre-branching scheduler; now that the scheduler is gone, one created
 * by mistake would hold no wake time and no jobs — which is precisely what
 * this reports. One alarm rather than two.
 *
 * @returns {Promise<{ stalled: number, sample: string[] }>}
 */
export async function runEnrollmentStallReaper() {
  const cutoff = new Date(Date.now() - STALL_AFTER_MS);

  const candidates = await prisma.journeyEnrollment.findMany({
    where: {
      exitReason: "",
      nextRunAt: null,
      // Not the enrollment created seconds ago and not yet walked.
      enrolledAt: { lt: cutoff },
    },
    select: { id: true, shop: true, journeyId: true, currentStepId: true },
    take: 500,
  });

  if (!candidates.length) return { stalled: 0, sample: [] };

  // No wake time is only a stall if there is also no job owed an outcome —
  // otherwise this is the ordinary "waiting for a send to settle" state.
  const ids = candidates.map((e) => e.id);
  const live = { enrollmentId: { in: ids }, status: { in: ["pending", "processing"] } };
  const [emails, pushes, whatsapps] = await Promise.all([
    prisma.journeyJob.findMany({ where: live, select: { enrollmentId: true }, distinct: ["enrollmentId"] }),
    prisma.pushJob.findMany({ where: live, select: { enrollmentId: true }, distinct: ["enrollmentId"] }),
    prisma.whatsappJob.findMany({ where: live, select: { enrollmentId: true }, distinct: ["enrollmentId"] }),
  ]);
  const busy = new Set([...emails, ...pushes, ...whatsapps].map((j) => j.enrollmentId));

  const stalled = candidates.filter((e) => !busy.has(e.id));
  if (stalled.length) {
    console.error(
      `[stall-reaper] ${stalled.length} lazy enrollment(s) have no wake time and no queued work — ` +
        `these contacts have silently stopped mid-flow. ` +
        `Sample: ${stalled.slice(0, 5).map((e) => `${e.id}@${e.shop}(step ${e.currentStepId || "none"})`).join(", ")}`,
    );
  }

  return { stalled: stalled.length, sample: stalled.slice(0, 20).map((e) => e.id) };
}
