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
        // will never reach a terminal handler.
        await settleEnrollmentIfFinished(job.enrollmentId, { failed: true });
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
