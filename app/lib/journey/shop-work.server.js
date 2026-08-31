/**
 * Bulk operations over a shop's queued work, shared by the workers and the
 * app/uninstalled webhook so all three queues are always treated together.
 *
 * A shop that has gone away (uninstalled or closed) must stop sending on every
 * channel at once. Cancelling only the queue whose worker happened to notice
 * leaves the other two draining, which is how a "stopped" shop keeps messaging.
 */
import prisma from "../../db.server.js";
import { settleEnrollmentIfFinished } from "./journey-queue.server.js";

const QUEUES = [
  ["journeyJob", "email"],
  ["pushJob", "push"],
  ["whatsappJob", "whatsapp"],
];

/**
 * Cancel every pending/processing job a shop has, across all three queues.
 *
 * @param {string} shop
 * @param {string} reason stored in lastError so the cause is visible later
 * @returns {Promise<{ total: number, byQueue: Record<string, number> }>}
 */
export async function cancelShopQueuedJobs(shop, reason) {
  const where = { shop, status: { in: ["pending", "processing"] } };
  const data = { status: "cancelled", lastError: String(reason).slice(0, 500) };

  const byQueue = {};
  let total = 0;
  for (const [model, label] of QUEUES) {
    try {
      const { count } = await prisma[model].updateMany({ where, data });
      byQueue[label] = count;
      total += count;
    } catch (err) {
      console.error(`[shop-work] could not cancel ${label} jobs for ${shop}:`, err.message);
      byQueue[label] = 0;
    }
  }
  return { total, byQueue };
}

/**
 * Pause every published journey a shop has.
 *
 * Cancelling queued jobs stops the work already scheduled; this stops new work
 * being created. Without it a reinstall resumes live triggers against a contact
 * list that has been dormant for however long the shop was gone, and starts
 * emailing people whose relationship with the store lapsed weeks ago.
 * Republishing is a few seconds of merchant effort; an unwanted send to the
 * whole list cannot be taken back.
 *
 * Broadcasts get their scheduledFor cleared as well. A broadcast is due when
 * `scheduledFor <= now`, so one paused with a past send time would fire to the
 * entire audience the instant it was republished. Clearing it forces the
 * merchant to choose a new moment deliberately.
 *
 * @param {string} shop
 * @param {string} reason for the log line only — Journey has no field for it
 * @returns {Promise<{ broadcasts: number, automations: number }>}
 */
export async function pauseShopJourneys(shop, reason) {
  const result = { broadcasts: 0, automations: 0 };
  try {
    const broadcasts = await prisma.journey.updateMany({
      where: { shop, status: "published", trigger: "broadcast" },
      data: { status: "paused", scheduledFor: null },
    });
    result.broadcasts = broadcasts.count;

    const automations = await prisma.journey.updateMany({
      where: { shop, status: "published", trigger: { not: "broadcast" } },
      data: { status: "paused" },
    });
    result.automations = automations.count;
  } catch (err) {
    console.error(`[shop-work] could not pause journeys for ${shop}:`, err.message);
    return result;
  }

  if (result.broadcasts || result.automations) {
    console.warn(
      `[shop-work] ${shop} — ${reason}; paused ${result.automations} automation(s) ` +
        `and ${result.broadcasts} broadcast(s). These need republishing by the merchant.`,
    );
  }
  return result;
}

/**
 * Everything that must happen when a shop stops being a shop we send for:
 * cancel what is queued, and stop anything new being queued.
 *
 * Both halves are needed. Cancelling alone leaves live triggers creating fresh
 * jobs; pausing alone leaves the existing backlog draining.
 *
 * @param {string} shop
 * @param {string} reason
 */
export async function stopShopSending(shop, reason) {
  const jobs = await cancelShopQueuedJobs(shop, reason);
  const journeys = await pauseShopJourneys(shop, reason);
  return { jobs, journeys };
}

/**
 * Hand a claimed job back to the queue without consuming one of its three
 * attempts.
 *
 * Claiming increments `attempts` up front, so a shop that is merely
 * unreachable — Shopify 5xx, throttling, a network blip — would otherwise burn
 * the job's whole retry budget in three ticks and mark it permanently failed
 * without ever having tried to send it. That is precisely how the closed-store
 * backlog lost 20,540 jobs to a transient provider limit.
 *
 * @param {"journeyJob"|"pushJob"|"whatsappJob"} model
 * @param {string} jobId
 * @param {number} [retryDelayMs] hold-off before the job is due again
 */
export async function releaseClaimedJob(model, jobId, retryDelayMs = 60 * 1000) {
  try {
    await prisma[model].update({
      where: { id: jobId },
      data: {
        status: "pending",
        attempts: { decrement: 1 },
        scheduledFor: new Date(Date.now() + retryDelayMs),
      },
    });
  } catch (err) {
    console.error(`[shop-work] could not release ${model} ${jobId}:`, err.message);
  }
}

/**
 * Drop a job that is too far past its due time to be worth sending.
 *
 * Cancelled rather than left pending: a stale row that stays claimable is the
 * stranding bug all over again, invisible until something un-freezes it. The
 * enrollment is settled in the same breath so the accounting does not drift.
 *
 * @param {"journeyJob"|"pushJob"|"whatsappJob"} model
 * @param {{ id: string, enrollmentId: string, scheduledFor: Date }} job
 */
export async function cancelStaleJob(model, job) {
  try {
    await prisma[model].update({
      where: { id: job.id },
      data: {
        status: "cancelled",
        lastError: `cancelled — ${Math.round((Date.now() - new Date(job.scheduledFor).getTime()) / 3600000)}h past its send time`,
      },
    });
    await settleEnrollmentIfFinished(job.enrollmentId, { failed: true });
  } catch (err) {
    console.error(`[shop-work] could not cancel stale ${model} ${job.id}:`, err.message);
  }
}
