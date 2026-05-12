import prisma from "../../db.server.js";

/**
 * Enroll a contact in a journey — creates one JourneyJob per enabled step.
 * Idempotent: skips if an active enrollment already exists for this contact+journey.
 */
export async function enrollContact(journeyId, contactEmail, contactName, payloadObj) {
  const existing = await prisma.journeyEnrollment.findFirst({
    where: { journeyId, contactEmail, exitReason: "" },
  });
  if (existing) return existing;

  const steps = await prisma.journeyStep.findMany({
    where: { journeyId, isEnabled: true },
    orderBy: { stepNumber: "asc" },
  });
  if (!steps.length) return null;

  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  if (!journey) return null;

  const enrollment = await prisma.journeyEnrollment.create({
    data: {
      shop: journey.shop,
      journeyId,
      contactEmail,
      contactName: contactName || "",
      payload: JSON.stringify(payloadObj || {}),
    },
  });

  const now = new Date();
  await prisma.journeyJob.createMany({
    data: steps.map((step) => ({
      shop: journey.shop,
      enrollmentId: enrollment.id,
      stepId: step.id,
      scheduledFor: new Date(now.getTime() + step.delayHours * 60 * 60 * 1000),
      status: "pending",
    })),
  });

  return enrollment;
}

/**
 * Mark an enrollment exited and cancel all pending jobs.
 */
export async function exitEnrollment(enrollmentId, reason) {
  await prisma.$transaction([
    prisma.journeyEnrollment.update({
      where: { id: enrollmentId },
      data: { exitReason: reason, completedAt: new Date() },
    }),
    prisma.journeyJob.updateMany({
      where: { enrollmentId, status: "pending" },
      data: { status: "cancelled" },
    }),
  ]);
}

/**
 * Claim due JourneyJob rows atomically.
 */
export async function claimDueJourneyJobs(limit = 20) {
  const now = new Date();

  const candidates = await prisma.journeyJob.findMany({
    where: {
      status: "pending",
      scheduledFor: { lte: now },
      attempts: { lt: 3 },
    },
    take: limit,
    orderBy: { scheduledFor: "asc" },
    include: {
      enrollment: true,
      step: { include: { journey: true } },
    },
  });

  if (!candidates.length) return [];

  const claimed = [];
  for (const job of candidates) {
    const result = await prisma.journeyJob.updateMany({
      where: { id: job.id, status: "pending" },
      data: { status: "processing", attempts: { increment: 1 }, updatedAt: new Date() },
    });
    if (result.count > 0) claimed.push(job);
  }

  return claimed;
}

export async function markJourneyJobDone(jobId, extras = {}) {
  await prisma.journeyJob.update({
    where: { id: jobId },
    data: { status: "done", ...extras },
  });
}

export async function markJourneyJobFailed(jobId, error) {
  const job = await prisma.journeyJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const newStatus = job.attempts >= 3 ? "failed" : "pending";
  const backoffMs = Math.pow(2, job.attempts) * 5 * 60 * 1000;
  const scheduledFor = newStatus === "pending" ? new Date(Date.now() + backoffMs) : job.scheduledFor;
  await prisma.journeyJob.update({
    where: { id: jobId },
    data: { status: newStatus, lastError: String(error).slice(0, 500), scheduledFor },
  });
}
