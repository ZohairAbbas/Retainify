import prisma from "../../db.server.js";

/**
 * Enroll a contact in a journey — creates one JourneyJob per sendable step.
 * Honors Journey.status (only "published") and Journey.entryFrequency:
 *   - "no_reentry"        → skip if any prior enrollment exists for this contact
 *   - "delayed_<hours>"   → skip if an enrollment exists within the window
 *   - "immediate"         → always create a new enrollment
 */
export async function enrollContact(journeyId, contactEmail, contactName, payloadObj) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  if (!journey) {
    console.warn(`[enroll] journey ${journeyId} not found — skipping ${contactEmail}`);
    return null;
  }
  if (journey.status !== "published") {
    console.warn(`[enroll] journey ${journeyId} status="${journey.status}" (not published) — skipping ${contactEmail}`);
    return null;
  }

  const frequency = journey.entryFrequency || "no_reentry";

  if (frequency === "no_reentry") {
    const any = await prisma.journeyEnrollment.findFirst({
      where: { journeyId, contactEmail },
    });
    if (any) {
      console.warn(`[enroll] ${contactEmail} already enrolled in ${journeyId} (no_reentry) — skipping`);
      return any;
    }
  } else if (frequency.startsWith("delayed_")) {
    const hours = Number(frequency.slice("delayed_".length)) || 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recent = await prisma.journeyEnrollment.findFirst({
      where: { journeyId, contactEmail, enrolledAt: { gt: since } },
    });
    if (recent) {
      console.warn(`[enroll] ${contactEmail} enrolled in ${journeyId} within ${hours}h window — skipping`);
      return recent;
    }
  } else {
    // immediate — dedupe only against the double-webhook (orders/create + orders/paid)
    // by checking for a *very recent* enrollment, not any open one. An enrollment with
    // exitReason "" is NOT a reliable in-flight signal: a journey ending in delay+exit
    // never sets exitReason until every job completes, so the old check blocked
    // re-entry permanently.
    //
    // Window is 30s: Shopify's orders/create + orders/paid double-fire is observed
    // within ~3-10s in practice. A longer window blocks legitimate repeat orders
    // (e.g. customer placing two orders 2-3 minutes apart).
    const since = new Date(Date.now() - 30 * 1000);
    const recent = await prisma.journeyEnrollment.findFirst({
      where: { journeyId, contactEmail, enrolledAt: { gt: since } },
    });
    if (recent) {
      console.warn(`[enroll] ${contactEmail} enrolled in ${journeyId} <30s ago — skipping duplicate webhook`);
      return recent;
    }
  }

  const steps = await prisma.journeyStep.findMany({
    where: { journeyId, isArchived: false, isEnabled: true, nodeType: { in: ["email", "push", "whatsapp"] } },
    orderBy: { stepNumber: "asc" },
  });
  if (!steps.length) {
    console.warn(`[enroll] journey ${journeyId} has no enabled sendable steps — skipping ${contactEmail}`);
    return null;
  }

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
  const emailSteps = steps.filter((s) => s.nodeType === "email");
  const pushSteps = steps.filter((s) => s.nodeType === "push");
  const whatsappSteps = steps.filter((s) => s.nodeType === "whatsapp");

  if (emailSteps.length) {
    await prisma.journeyJob.createMany({
      data: emailSteps.map((step) => ({
        shop: journey.shop,
        enrollmentId: enrollment.id,
        stepId: step.id,
        scheduledFor: new Date(now.getTime() + step.delayHours * 60 * 60 * 1000),
        status: "pending",
      })),
    });
  }

  if (pushSteps.length) {
    await prisma.pushJob.createMany({
      data: pushSteps.map((step) => ({
        shop: journey.shop,
        enrollmentId: enrollment.id,
        stepId: step.id,
        scheduledFor: new Date(now.getTime() + step.delayHours * 60 * 60 * 1000),
        status: "pending",
      })),
    });
  }

  if (whatsappSteps.length) {
    await prisma.whatsappJob.createMany({
      data: whatsappSteps.map((step) => ({
        shop: journey.shop,
        enrollmentId: enrollment.id,
        stepId: step.id,
        scheduledFor: new Date(now.getTime() + step.delayHours * 60 * 60 * 1000),
        status: "pending",
      })),
    });
  }

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
    prisma.whatsappJob.updateMany({
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
