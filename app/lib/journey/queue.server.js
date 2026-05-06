/**
 * DB-backed email job queue.
 * Jobs are rows in the EmailJob table. A polling worker picks them up.
 */
import prisma from "../../db.server.js";

/**
 * Schedule all three cart rescue emails for an abandoned cart.
 * Skips emails disabled in JourneySettings. Idempotent — won't double-schedule.
 */
export async function scheduleCartRescueJobs(shop, abandonedCartId) {
  const [journey, existing] = await Promise.all([
    prisma.journeySettings.findUnique({ where: { shop } }),
    prisma.emailJob.findMany({ where: { shop, abandonedCartId } }),
  ]);

  if (!journey) return;

  const existingNums = new Set(existing.map((j) => j.emailNumber));
  const now = new Date();

  const toCreate = [];

  if (journey.email1Enabled && !existingNums.has(1)) {
    const scheduledFor = new Date(now.getTime() + journey.email1DelayHours * 60 * 60 * 1000);
    toCreate.push({ shop, abandonedCartId, emailNumber: 1, scheduledFor, status: "pending" });
  }
  if (journey.email2Enabled && !existingNums.has(2)) {
    const scheduledFor = new Date(now.getTime() + journey.email2DelayHours * 60 * 60 * 1000);
    toCreate.push({ shop, abandonedCartId, emailNumber: 2, scheduledFor, status: "pending" });
  }
  if (journey.email3Enabled && !existingNums.has(3)) {
    const scheduledFor = new Date(now.getTime() + journey.email3DelayHours * 60 * 60 * 1000);
    toCreate.push({ shop, abandonedCartId, emailNumber: 3, scheduledFor, status: "pending" });
  }

  if (toCreate.length > 0) {
    await prisma.emailJob.createMany({ data: toCreate });
  }
}

/**
 * Cancel all pending jobs for a cart (called when order is placed).
 */
export async function cancelCartJobs(shop, abandonedCartId) {
  await prisma.emailJob.updateMany({
    where: { shop, abandonedCartId, status: "pending" },
    data: { status: "cancelled" },
  });
}

/**
 * Fetch jobs that are due and still pending. Claim them atomically by setting status=processing.
 * Returns claimed jobs with their abandonedCart relation.
 */
export async function claimDueJobs(limit = 20) {
  const now = new Date();

  // Fetch candidates first
  const candidates = await prisma.emailJob.findMany({
    where: {
      status: "pending",
      scheduledFor: { lte: now },
      attempts: { lt: 3 },
    },
    take: limit,
    orderBy: { scheduledFor: "asc" },
    include: { abandonedCart: true },
  });

  if (!candidates.length) return [];

  // Claim each — updateMany doesn't return rows in SQLite, so we do individual updates
  const claimed = [];
  for (const job of candidates) {
    const result = await prisma.emailJob.updateMany({
      where: { id: job.id, status: "pending" },
      data: { status: "processing", attempts: { increment: 1 }, updatedAt: new Date() },
    });
    if (result.count > 0) claimed.push(job);
  }

  return claimed;
}

export async function markJobDone(jobId) {
  await prisma.emailJob.update({ where: { id: jobId }, data: { status: "done" } });
}

export async function markJobFailed(jobId, error) {
  const job = await prisma.emailJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  // After 3 attempts give up permanently, otherwise put back to pending with backoff
  const newStatus = job.attempts >= 3 ? "failed" : "pending";
  const backoffMs = Math.pow(2, job.attempts) * 5 * 60 * 1000; // 5min, 10min, 20min
  const scheduledFor = newStatus === "pending" ? new Date(Date.now() + backoffMs) : job.scheduledFor;
  await prisma.emailJob.update({
    where: { id: jobId },
    data: { status: newStatus, lastError: String(error).slice(0, 500), scheduledFor },
  });
}
