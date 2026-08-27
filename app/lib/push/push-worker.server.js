import prisma from "../../db.server.js";
import { sendPushNotification } from "./web-push.server.js";
import { isInQuietHours, quietHoursRetryDelay } from "../journey/quiet-hours.server.js";
import { incrementUsage } from "../billing/entitlements.server.js";
import { partitionByShopHealth, cancelReasonFor } from "../shopify/shop-health.server.js";
import { settleEnrollmentIfFinished } from "../journey/journey-queue.server.js";
import { stopShopSending, releaseClaimedJob } from "../journey/shop-work.server.js";

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
  const claimed = await claimDuePushJobs(20);
  if (!claimed.length) return;

  // Never send on behalf of a shop that has uninstalled or closed.
  const { live: jobs, dead, holding } = await partitionByShopHealth(claimed);

  const condemned = new Map();
  for (const { job, status } of dead) condemned.set(job.shop, status);
  for (const [shop, status] of condemned) {
    const reason = cancelReasonFor(status);
    const { jobs: cancelled } = await stopShopSending(shop, reason);
    console.warn(`[push-worker] ${shop} — ${reason}; cancelled ${cancelled.total} queued jobs`);
  }

  for (const job of holding) {
    await releaseClaimedJob("pushJob", job.id);
  }

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

  // Channel switched off. The Push page renders its status straight from this
  // flag, so without this check it displayed "Disabled" while notifications
  // carried on going out — the toggle only ever governed the storefront
  // permission prompt. Mirrors the WhatsApp worker's whatsappEnabled gate.
  if (!settings.pushEnabled) {
    console.warn(`[push-worker] job=${job.id} shop=${job.shop} push channel disabled — skipping`);
    await markPushJobDone(job.id);
    return;
  }

  // Skip if enrollment exited
  if (enrollment.exitReason) {
    await markPushJobDone(job.id);
    return;
  }

  // Honour the email suppression list. Push has no opt-out channel of its own
  // beyond the browser permission, so an unsubscribe — the only "stop
  // contacting me" signal a shopper can give us — has to bind every channel we
  // send on, not just the one they happened to click it in.
  const suppressed = await prisma.emailSuppression.findFirst({
    where: { shop: job.shop, email: enrollment.contactEmail },
  });
  if (suppressed) {
    console.warn(
      `[push-worker] job=${job.id} recipient suppressed (${suppressed.reason}) — skipping`,
    );
    await markPushJobDone(job.id);
    return;
  }

  // Inside quiet hours — defer, with jitter so the overnight backlog doesn't
  // all become due in the same tick.
  if (isInQuietHours(settings.quietHoursStart, settings.quietHoursEnd, settings.storeTimezone)) {
    await prisma.pushJob.update({
      where: { id: job.id },
      data: { status: "pending", scheduledFor: new Date(Date.now() + quietHoursRetryDelay()) },
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

  // eslint-disable-next-line no-undef
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/+$/, "");

  const pushPayload = {
    title: step.pushTitle || "New message",
    body: step.pushBody || "",
    // The inspector's help text promises "defaults to store favicon if empty".
    // It previously sent undefined, so that was simply untrue.
    icon: step.pushIconUrl || `https://${job.shop}/favicon.ico`,
    url: clickUrl,
    // Lets the service worker attribute a click back to this exact send.
    jobId: job.id,
    trackUrl: appUrl ? `${appUrl}/track/push-click` : "",
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
    // Counted for visibility only — push is free on every tier (self-hosted
    // VAPID costs us nothing), so there is no quota gate here.
    await incrementUsage(job.shop, "push", 1);
    await markPushJobDone(job.id, { sentAt: new Date() });
  } else {
    await markPushJobFailed(job.id, lastError || "all subscriptions failed");
  }
}

async function markPushJobDone(jobId, extras = {}) {
  const job = await prisma.pushJob.update({
    where: { id: jobId },
    data: { status: "done", ...extras },
  });
  await settleEnrollmentIfFinished(job.enrollmentId, { at: extras.sentAt || new Date() });
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
  if (newStatus === "failed") {
    await settleEnrollmentIfFinished(job.enrollmentId, { failed: true });
  }
}
