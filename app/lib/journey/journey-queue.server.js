import prisma from "../../db.server.js";
import { decideFailureOutcome, MAX_ATTEMPTS } from "./failure-policy.server.js";
import { passesEntryFilters } from "./entry-filters.server.js";
import { loadGraph, rootId } from "./graph.server.js";
import { createLazyEnrollment } from "./advance.server.js";

/**
 * Enroll a contact in a journey — creates one JourneyJob per sendable step.
 * Honors Journey.status (only "published"), Journey.entryFilters, and
 * Journey.entryFrequency:
 *   - "no_reentry"        → skip if any prior enrollment exists for this contact
 *   - "delayed_<hours>"   → skip if an enrollment exists within the window
 *   - "immediate"         → always create a new enrollment
 *
 * Every trigger path in the app funnels through here — order and checkout
 * webhooks, the segment enrollment worker, the broadcast dispatcher — so this
 * is the one place entry conditions need to be checked.
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

  // Entry conditions. Checked after the frequency rules above because those
  // cost one indexed lookup while this costs a contact read plus its stats —
  // no reason to compute them for someone we were going to skip anyway.
  //
  // Broadcasts are exempt by design: their audience is already chosen
  // explicitly when the send is set up, and a second filtering mechanism on
  // top of it would leave the merchant guessing which one decided a given
  // recipient. The guard is on the trigger rather than the UI alone, so a flow
  // switched to broadcast can't carry stale filters from its previous trigger.
  if (journey.trigger !== "broadcast") {
    const { pass, reason } = await passesEntryFilters(
      journey.shop,
      journey.entryFilters,
      contactEmail,
    );
    if (!pass) {
      console.warn(`[enroll] ${contactEmail} not enrolled in ${journeyId} — ${reason}`);
      return null;
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

  // ── Lazy from here on ────────────────────────────────────────────────────
  // Every new enrollment is walked one node at a time by advance.server.js.
  // Nothing is scheduled now beyond the first wake-up: a flow that branches
  // cannot have its jobs created up front, because the path is not known until
  // the contact is standing on the split.
  //
  // Enrollments created BEFORE this shipped keep schedulingMode "eager" and
  // finish exactly as they would have, on the jobs they already hold. The two
  // modes run side by side until that backlog drains — see the drain gauge in
  // stuck-jobs.server.js.
  const graph = await loadGraph(journeyId);
  const root = rootId(graph);
  if (!root) {
    console.warn(
      `[enroll] journey ${journeyId} has no single starting step (${graph.rootIds.length} candidates) — skipping ${contactEmail}`,
    );
    return null;
  }

  return createLazyEnrollment({
    journey,
    contactEmail,
    contactName,
    payloadObj,
    rootStepId: root,
    rootStepKey: graph.steps.get(root)?.stepKey,
  });
}

/**
 * Create every job for a flow up front — the pre-branching scheduler.
 *
 * No longer reachable: enrollContact now creates lazy enrollments. Kept because
 * enrollments made before the cutover are still in flight and still finishing
 * on the jobs this produced, and reading it is the only way to understand what
 * schedulingMode "eager" means on those rows.
 *
 * Delete this once the drain gauge reports zero eager enrollments and has done
 * for longer than the longest configured flow delay.
 *
 * @deprecated superseded by advance.server.js
 */
export async function enrollContactEager(journey, contactEmail, contactName, payloadObj, steps) {
  const journeyId = journey.id;
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
      data: {
        exitReason: reason,
        completedAt: new Date(),
        // Clearing the cursor and the wake time is what stops a lazy
        // enrollment. Without it the advance worker keeps picking this contact
        // up and walking them on to the next step of a flow they have just
        // left — the exact "unsubscribed but still receiving mail" bug this
        // function exists to prevent.
        nextRunAt: null,
        currentStepId: null,
        currentStepKey: null,
      },
    }),
    prisma.journeyJob.updateMany({
      where: { enrollmentId, status: "pending" },
      data: { status: "cancelled" },
    }),
    // PushJob was missing here. The push worker does re-check exitReason before
    // sending, so nothing was delivered after an exit — but the rows stayed
    // "pending", so every worker tick kept claiming them and the exit accounting
    // never matched the other two queues.
    prisma.pushJob.updateMany({
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
      attempts: { lt: MAX_ATTEMPTS },
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

/** A job that still owes the enrollment an outcome. */
const LIVE_JOB = { status: { in: ["pending", "processing"] } };

/**
 * Close an enrollment once nothing is left to do for it.
 *
 * This used to live inline on the successful-send path in journey-worker, which
 * meant an enrollment whose LAST job ended any other way was never closed at
 * all: a permanently failed send, a suppressed recipient, a missing settings
 * row. Those enrollments sat with completedAt null and exitReason "" forever,
 * counting as in-flight in every report. 129 of them had accumulated.
 *
 * Living inside the mark*() helpers instead means every terminal transition
 * settles the enrollment, including ones added later.
 *
 * Counts across all three queues, not just email. A journey mixing email and
 * push is not finished while a push step is still queued, and closing it early
 * would make the push worker skip the remaining sends outright — its first
 * check is `if (enrollment.exitReason)`.
 *
 * @param {string} enrollmentId
 * @param {{ at?: Date, failed?: boolean, channel?: "email"|"push"|"whatsapp" }} [options]
 *        `failed` marks the closing job as a permanent failure, so the
 *        enrollment reads "ended_failed" rather than claiming it completed.
 *        `channel` says which queue is reporting; it only matters for lazy
 *        enrollments, where a failed email ends the flow and a failed push or
 *        WhatsApp does not. Omitting it is read as narrative-breaking.
 * @returns {Promise<boolean>} whether this call closed the enrollment
 */
export async function settleEnrollmentIfFinished(
  enrollmentId,
  { at = new Date(), failed = false, channel } = {},
) {
  if (!enrollmentId) return false;

  const [emails, pushes, whatsapps] = await Promise.all([
    prisma.journeyJob.count({ where: { enrollmentId, ...LIVE_JOB } }),
    prisma.pushJob.count({ where: { enrollmentId, ...LIVE_JOB } }),
    prisma.whatsappJob.count({ where: { enrollmentId, ...LIVE_JOB } }),
  ]);
  if (emails + pushes + whatsapps > 0) return false;

  // ── Lazy enrollments are not finished just because nothing is queued ──────
  // Under lazy scheduling "no live jobs" is the normal state BETWEEN steps —
  // the next one has not been scheduled yet, because scheduling it is what
  // happens next. Applying the eager rule here would close every lazy
  // enrollment the moment its first message sent.
  //
  // So for lazy the job settling is a hand-off, not an ending: set the wake
  // time and let the advance worker decide what comes next. This is the only
  // place that hand-off happens, which is why every send worker funnels
  // through this one function.
  const enrollment = await prisma.journeyEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { schedulingMode: true, exitReason: true },
  });
  if (enrollment?.schedulingMode === "lazy") {
    if (enrollment.exitReason) return false;

    // The one exception: a permanently failed EMAIL ends the flow here.
    //
    // A flow is a narrative and step 3 assumes step 1 landed — the rule
    // sequence-gate.server.js exists to enforce. Continuing would schedule the
    // next step only for the gate to cancel it on arrival, then settle, then
    // schedule the one after that: every remaining step created and cancelled
    // in turn, each one a "cancelled" row in the merchant's report.
    //
    // Push and WhatsApp failures do NOT stop anything, exactly as they do not
    // gate anything: no browser subscription and no WhatsApp opt-in are benign
    // and must not kill a perfectly good email sequence. An unattributed
    // failure is treated as narrative-breaking, because guessing the other way
    // means sending mail that refers back to something that never arrived.
    const benign = channel === "push" || channel === "whatsapp";
    if (failed && !benign) {
      const { count } = await prisma.journeyEnrollment.updateMany({
        where: { id: enrollmentId, exitReason: "" },
        data: {
          completedAt: at,
          exitReason: "ended_failed",
          nextRunAt: null,
          currentStepId: null,
          currentStepKey: null,
        },
      });
      return count > 0;
    }

    await prisma.journeyEnrollment.updateMany({
      where: { id: enrollmentId, exitReason: "" },
      data: { nextRunAt: new Date() },
    });
    return false;
  }

  // Guarded on exitReason "" so an enrollment already closed for a real reason
  // — exit criteria, an unsubscribe, a shop shutting down — keeps that reason
  // rather than being overwritten with "completed" by a straggler job.
  const { count } = await prisma.journeyEnrollment.updateMany({
    where: { id: enrollmentId, exitReason: "" },
    data: { completedAt: at, exitReason: failed ? "ended_failed" : "completed" },
  });
  return count > 0;
}

export async function markJourneyJobDone(jobId, extras = {}) {
  const job = await prisma.journeyJob.update({
    where: { id: jobId },
    data: { status: "done", ...extras },
  });
  await settleEnrollmentIfFinished(job.enrollmentId, { at: extras.sentAt || new Date(), channel: "email" });
}

/**
 * Record a failed send and decide whether it gets another go.
 *
 * @param {string} jobId
 * @param {string} error human-readable, stored on the row
 * @param {string} [errorClass] from the adapter — see failure-policy.server.js.
 *        Omitted by callers that caught a thrown exception rather than a send
 *        result; those are treated as transient, because an unclassified
 *        failure is far more likely to be a blip than a permanently bad address.
 */
export async function markJourneyJobFailed(jobId, error, errorClass) {
  const job = await prisma.journeyJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  const now = new Date();
  const firstFailedAt = job.firstFailedAt || now;
  const outcome = decideFailureOutcome({
    errorClass,
    attempts: job.attempts,
    firstFailedAt: job.firstFailedAt,
    now,
  });

  await prisma.journeyJob.update({
    where: { id: jobId },
    data: {
      status: outcome.status,
      lastError: String(error).slice(0, 500),
      firstFailedAt,
      // An ops failure is our fault, not the job's, so it must not spend the
      // retry budget — the claim query rejects anything at attempts >= MAX.
      ...(outcome.consumesAttempt ? {} : { attempts: Math.max(0, job.attempts - 1) }),
      scheduledFor:
        outcome.status === "pending" ? new Date(now.getTime() + outcome.retryInMs) : job.scheduledFor,
    },
  });

  console.warn(
    `[journey-queue] job ${jobId} ${outcome.status} (${errorClass || "unclassified"}) — ${outcome.note}: ${String(error).slice(0, 120)}`,
  );

  // Only a permanent failure ends anything; a retry still owes an outcome.
  if (outcome.status === "failed") {
    await settleEnrollmentIfFinished(job.enrollmentId, { failed: true, channel: "email" });
  }
}
