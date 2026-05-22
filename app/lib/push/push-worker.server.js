import prisma from "../../db.server.js";
import { sendPushNotification } from "./web-push.server.js";

function isInQuietHours(quietStart, quietEnd, timezone) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone });
    const hour = parseInt(formatter.format(now), 10);
    if (quietStart < quietEnd) return hour >= quietStart && hour < quietEnd;
    return hour >= quietStart || hour < quietEnd;
  } catch {
    return false;
  }
}

async function claimDuePushJobs(limit = 20) {
  const now = new Date();
  const candidates = await prisma.pushJob.findMany({
    where: { status: "pending", scheduledFor: { lte: now }, attempts: { lt: 3 } },
    take: limit,
    orderBy: { scheduledFor: "asc" },
  });
  if (!candidates.length) return [];

  const claimed = [];
  for (const job of candidates) {
    const result = await prisma.pushJob.updateMany({
      where: { id: job.id, status: "pending" },
      data: { status: "processing", attempts: { increment: 1 }, updatedAt: new Date() },
    });
    if (result.count > 0) claimed.push(job);
  }
  return claimed;
}

export async function runPushWorker() {
  const jobs = await claimDuePushJobs(20);
  if (!jobs.length) return;

  for (const job of jobs) {
    try {
      await processPushJob(job);
    } catch (err) {
      console.error(`[push-worker] job ${job.id} threw:`, err);
      await markPushJobFailed(job.id, err.message);
    }
  }
}

async function processPushJob(job) {
  const [enrollment, step, settings] = await Promise.all([
    prisma.journeyEnrollment.findUnique({ where: { id: job.enrollmentId } }),
    prisma.journeyStep.findUnique({ where: { id: job.stepId } }),
    prisma.shopSettings.findUnique({ where: { shop: job.shop } }),
  ]);

  if (!enrollment || !step || !settings) {
    await markPushJobDone(job.id);
    return;
  }

  // Skip if enrollment exited
  if (enrollment.exitReason) {
    await markPushJobDone(job.id);
    return;
  }

  // Quiet hours — reschedule 1h forward
  if (isInQuietHours(settings.quietHoursStart, settings.quietHoursEnd, settings.storeTimezone)) {
    await prisma.pushJob.update({
      where: { id: job.id },
      data: { status: "pending", scheduledFor: new Date(Date.now() + 60 * 60 * 1000) },
    });
    return;
  }

  // Find active push subscriptions for this contact
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { shop: job.shop, contactEmail: enrollment.contactEmail, isActive: true },
  });

  if (!subscriptions.length) {
    console.warn(
      `[push-worker] job=${job.id} no active subscriptions for contactEmail=${enrollment.contactEmail} on shop=${job.shop} — skipping`,
    );
    await markPushJobDone(job.id);
    return;
  }

  // Resolve click URL — use step's pushClickUrl, fall back to cart recovery link
  let payload = {};
  try { payload = JSON.parse(enrollment.payload); } catch { /* empty */ }
  const clickUrl = step.pushClickUrl || payload.recoveryUrl || "/";

  const pushPayload = {
    title: step.pushTitle || "New message",
    body: step.pushBody || "",
    icon: step.pushIconUrl || undefined,
    url: clickUrl,
  };

  let anySuccess = false;
  let anyFailure = false;
  let lastError = "";

  for (const sub of subscriptions) {
    let host = "?";
    try { host = new URL(sub.endpoint).host; } catch (_) {}
    const result = await sendPushNotification(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      pushPayload,
    );
    if (result.ok) {
      anySuccess = true;
      console.log(`[push-worker] job=${job.id} sub=${sub.id} host=${host} OK`);
    } else {
      anyFailure = true;
      lastError = result.error || "unknown";
      console.warn(
        `[push-worker] job=${job.id} sub=${sub.id} host=${host} FAIL gone=${!!result.gone} error=${lastError}`,
      );
      if (result.gone) {
        // Subscription expired — deactivate it
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { isActive: false, unsubscribedAt: new Date() },
        });
      }
    }
  }

  console.log(
    `[push-worker] job=${job.id} summary subs=${subscriptions.length} ok=${anySuccess} fail=${anyFailure}`,
  );

  if (anySuccess) {
    await markPushJobDone(job.id, { sentAt: new Date() });
  } else {
    await markPushJobFailed(job.id, lastError || "all subscriptions failed");
  }
}

async function markPushJobDone(jobId, extras = {}) {
  await prisma.pushJob.update({
    where: { id: jobId },
    data: { status: "done", ...extras },
  });
}

async function markPushJobFailed(jobId, error) {
  const job = await prisma.pushJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const newStatus = job.attempts >= 3 ? "failed" : "pending";
  const backoffMs = Math.pow(2, job.attempts) * 5 * 60 * 1000;
  const scheduledFor = newStatus === "pending" ? new Date(Date.now() + backoffMs) : job.scheduledFor;
  await prisma.pushJob.update({
    where: { id: jobId },
    data: { status: newStatus, lastError: String(error).slice(0, 500), scheduledFor },
  });
}
