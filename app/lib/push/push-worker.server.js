import prisma from "../../db.server.js";
import { sendPushNotification } from "./web-push.server.js";
import { isInQuietHours, quietHoursRetryDelay } from "../journey/quiet-hours.server.js";
import { incrementUsage } from "../billing/entitlements.server.js";
import { partitionByShopHealth, cancelReasonFor } from "../shopify/shop-health.server.js";
import { settleEnrollmentIfFinished } from "../journey/journey-queue.server.js";
import { checkStepSequence, CANCEL, WAIT, SEQUENCE_RECHECK_MS } from "../journey/sequence-gate.server.js";
import { decideFailureOutcome, MAX_ATTEMPTS, isStale } from "../journey/failure-policy.server.js";
import { stopShopSending, releaseClaimedJob, cancelStaleJob } from "../journey/shop-work.server.js";

async function claimDuePushJobs(limit = 20) {
  const now = new Date();
  const candidates = await prisma.pushJob.findMany({
    where: { status: "pending", scheduledFor: { lte: now }, attempts: { lt: MAX_ATTEMPTS } },
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

  // Too old to be worth sending. A queue that stalls — a suspended provider
  // key, a worker down for a weekend — resumes eventually, and without this the
  // whole backlog goes out at once: welcome mail for signups from months ago.
  const fresh = [];
  for (const job of jobs) {
    if (isStale(job.scheduledFor)) {
      await cancelStaleJob("pushJob", job);
      console.warn(`[push-worker] job ${job.id} cancelled — past the staleness cutoff`);
    } else {
      fresh.push(job);
    }
  }

  for (const job of fresh) {
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

  // A failed EMAIL step ahead of this one means the sequence it belongs to
  // never reached the recipient, so this send is cancelled too. Push and
  // WhatsApp failures do not gate anything themselves — no subscription or no
  // opt-in is benign and must not kill the rest of the flow.
  const sequence = await checkStepSequence(job.enrollmentId, step.stepNumber);
  if (sequence.verdict === CANCEL) {
    await prisma.pushJob.update({
      where: { id: job.id },
      data: { status: "cancelled", lastError: `sequence broken — ${sequence.reason}` },
    });
    await settleEnrollmentIfFinished(job.enrollmentId, { failed: true });
    console.warn(`[push-worker] job ${job.id} cancelled — ${sequence.reason}`);
    return;
  }
  if (sequence.verdict === WAIT) {
    await releaseClaimedJob("pushJob", job.id, SEQUENCE_RECHECK_MS);
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
    // Hand the attempt back: a quiet-hours deferral is not a send attempt.
    // Charging one meant a job hitting the window on three consecutive nights
    // reached the attempt ceiling without ever being sent, and then sat pending
    // and unclaimable forever — 1,264 jobs were lost this way before anyone
    // noticed, because a stranded row looks perfectly healthy.
    await releaseClaimedJob("pushJob", job.id, quietHoursRetryDelay());
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

async function markPushJobFailed(jobId, error, errorClass) {
  const job = await prisma.pushJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const now = new Date();
  const firstFailedAt = job.firstFailedAt || now;
  const outcome = decideFailureOutcome({
    errorClass,
    attempts: job.attempts,
    firstFailedAt: job.firstFailedAt,
    now,
  });
  await prisma.pushJob.update({
    where: { id: jobId },
    data: {
      status: outcome.status,
      lastError: String(error).slice(0, 500),
      firstFailedAt,
      ...(outcome.consumesAttempt ? {} : { attempts: Math.max(0, job.attempts - 1) }),
      scheduledFor:
        outcome.status === "pending" ? new Date(now.getTime() + outcome.retryInMs) : job.scheduledFor,
    },
  });
  console.warn(
    `[push-worker] job ${jobId} ${outcome.status} (${errorClass || "unclassified"}) — ${outcome.note}`,
  );
  if (outcome.status === "failed") {
    await settleEnrollmentIfFinished(job.enrollmentId, { failed: true });
  }
}
