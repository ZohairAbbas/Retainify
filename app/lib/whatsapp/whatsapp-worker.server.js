/**
 * WhatsApp send worker — drains due WhatsappJob rows. Mirrors push-worker:
 * atomic claim, jittered quiet-hours reschedule, and the shared retry policy in
 * lib/journey/failure-policy.server.js (classify the failure, then retry a
 * transient one across a 24h horizon rather than three times in 30 minutes).
 *
 * Per-job gating specific to WhatsApp:
 *   - shop must have a connected WhatsappAccount;
 *   - recipient must have a subscribed, confirmed WhatsappSubscription and not
 *     be on the WhatsappSuppression list (explicit-opt-in consent model);
 *   - business-initiated marketing always uses approved HSM templates, so the
 *     24h session window does not block these sends (it only governs free-form
 *     session messages, which this path never produces).
 */
import prisma from "../../db.server.js";
import { isInQuietHours, quietHoursRetryDelay } from "../journey/quiet-hours.server.js";
import { incrementUsage } from "../billing/entitlements.server.js";
import { partitionByShopHealth, cancelReasonFor } from "../shopify/shop-health.server.js";
import { stopShopSending, releaseClaimedJob, cancelStaleJob } from "../journey/shop-work.server.js";
import { settleEnrollmentIfFinished } from "../journey/journey-queue.server.js";
import { checkStepSequence, CANCEL, WAIT, SEQUENCE_RECHECK_MS } from "../journey/sequence-gate.server.js";
import { decideFailureOutcome, MAX_ATTEMPTS, isStale } from "../journey/failure-policy.server.js";
import { toE164 } from "../contacts/contacts.server.js";
import { sendWhatsapp } from "./index.server.js";

async function claimDueWhatsappJobs(limit = 20) {
  const now = new Date();
  const candidates = await prisma.whatsappJob.findMany({
    where: { status: "pending", scheduledFor: { lte: now }, attempts: { lt: MAX_ATTEMPTS } },
    take: limit,
    orderBy: { scheduledFor: "asc" },
  });
  if (!candidates.length) return [];

  const claimed = [];
  for (const job of candidates) {
    const result = await prisma.whatsappJob.updateMany({
      where: { id: job.id, status: "pending" },
      data: { status: "processing", attempts: { increment: 1 }, updatedAt: new Date() },
    });
    if (result.count > 0) claimed.push(job);
  }
  return claimed;
}

export async function runWhatsappWorker() {
  const claimed = await claimDueWhatsappJobs(20);
  if (!claimed.length) return;

  // Never send on behalf of a shop that has uninstalled or closed.
  const { live: jobs, dead, holding } = await partitionByShopHealth(claimed);

  const condemned = new Map();
  for (const { job, status } of dead) condemned.set(job.shop, status);
  for (const [shop, status] of condemned) {
    const reason = cancelReasonFor(status);
    const { jobs: cancelled } = await stopShopSending(shop, reason);
    console.warn(`[whatsapp-worker] ${shop} — ${reason}; cancelled ${cancelled.total} queued jobs`);
  }

  for (const job of holding) {
    await releaseClaimedJob("whatsappJob", job.id);
  }

  // Too old to be worth sending. A queue that stalls — a suspended provider
  // key, a worker down for a weekend — resumes eventually, and without this the
  // whole backlog goes out at once: welcome mail for signups from months ago.
  const fresh = [];
  for (const job of jobs) {
    if (isStale(job.scheduledFor)) {
      await cancelStaleJob("whatsappJob", job);
      console.warn(`[whatsapp-worker] job ${job.id} cancelled — past the staleness cutoff`);
    } else {
      fresh.push(job);
    }
  }

  for (const job of fresh) {
    try {
      await processWhatsappJob(job);
    } catch (err) {
      console.error(`[whatsapp-worker] job ${job.id} threw:`, err);
      await markWhatsappJobFailed(job.id, err.message);
    }
  }
}

async function processWhatsappJob(job) {
  const [enrollment, step, settings, account] = await Promise.all([
    prisma.journeyEnrollment.findUnique({ where: { id: job.enrollmentId } }),
    prisma.journeyStep.findUnique({ where: { id: job.stepId } }),
    prisma.shopSettings.findUnique({ where: { shop: job.shop } }),
    prisma.whatsappAccount.findUnique({ where: { shop: job.shop } }),
  ]);

  if (!enrollment || !step || !settings) {
    await markWhatsappJobDone(job.id);
    return;
  }

  // Channel disabled or no connected WABA — nothing to send.
  if (!settings.whatsappEnabled || !account || account.status !== "connected") {
    console.warn(`[whatsapp-worker] job=${job.id} shop=${job.shop} not connected/enabled — skipping`);
    await markWhatsappJobDone(job.id);
    return;
  }

  // Enrollment exited — skip.
  if (enrollment.exitReason) {
    await markWhatsappJobDone(job.id);
    return;
  }

  // A failed EMAIL step ahead of this one means the sequence it belongs to
  // never reached the recipient, so this send is cancelled too. Push and
  // WhatsApp failures do not gate anything themselves — no subscription or no
  // opt-in is benign and must not kill the rest of the flow.
  const sequence = await checkStepSequence(enrollment, step);
  if (sequence.verdict === CANCEL) {
    await prisma.whatsappJob.update({
      where: { id: job.id },
      data: { status: "cancelled", lastError: `sequence broken — ${sequence.reason}` },
    });
    await settleEnrollmentIfFinished(job.enrollmentId, { failed: true, channel: "whatsapp" });
    console.warn(`[whatsapp-worker] job ${job.id} cancelled — ${sequence.reason}`);
    return;
  }
  if (sequence.verdict === WAIT) {
    await releaseClaimedJob("whatsappJob", job.id, SEQUENCE_RECHECK_MS);
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
    await releaseClaimedJob("whatsappJob", job.id, quietHoursRetryDelay());
    return;
  }

  // Resolve the recipient phone. A confirmed WhatsApp opt-in is always the
  // preferred source. When the shop has disabled the opt-in requirement, fall
  // back to the contact's phone (e.g. captured at checkout / from Shopify).
  const sub = await prisma.whatsappSubscription.findFirst({
    where: { shop: job.shop, contactEmail: enrollment.contactEmail, status: "subscribed" },
  });
  const requireOptIn = settings.whatsappRequireOptIn !== false;

  let phoneNumber = sub?.confirmedAt ? sub.phoneNumber : "";
  if (!phoneNumber && !requireOptIn) {
    // Opt-in not required — use whatever phone we have for this contact.
    const contact = await prisma.contact.findUnique({
      where: { shop_email: { shop: job.shop, email: enrollment.contactEmail } },
      select: { phone: true, whatsappStatus: true },
    });
    // A contact that explicitly opted out/invalid is never messaged, even here.
    if (contact?.phone && contact.whatsappStatus !== "unsubscribed" && contact.whatsappStatus !== "invalid") {
      phoneNumber = contact.phone;
    }
  }

  if (!phoneNumber) {
    console.warn(
      `[whatsapp-worker] job=${job.id} no ${requireOptIn ? "confirmed opt-in" : "phone"} for contactEmail=${enrollment.contactEmail} on shop=${job.shop} — skipping`,
    );
    await markWhatsappJobDone(job.id);
    return;
  }

  // The opt-in path validates on the way in, but the no-opt-in fallback reads
  // Contact.phone, which comes from Shopify and CSV imports and is stored as
  // whatever the merchant had. Sending a national-format number would earn a
  // permanent-failure code and get the contact suppressed forever, so an
  // unsendable one is skipped instead — the number stays, and starts working
  // the moment the merchant corrects it.
  const shape = toE164(phoneNumber);
  if (!shape.ok) {
    console.warn(
      `[whatsapp-worker] job=${job.id} phone for contactEmail=${enrollment.contactEmail} is not in international format — ${shape.error} — skipping`,
    );
    await markWhatsappJobDone(job.id);
    return;
  }
  phoneNumber = shape.phone;

  // Suppression / STOP opt-out — ALWAYS enforced regardless of opt-in mode.
  const suppressed = await prisma.whatsappSuppression.findUnique({
    where: { shop_phoneNumber: { shop: job.shop, phoneNumber } },
  });
  if (suppressed) {
    console.warn(`[whatsapp-worker] job=${job.id} phone suppressed (${suppressed.reason}) — skipping`);
    await markWhatsappJobDone(job.id);
    return;
  }

  if (!step.waTemplateName) {
    await markWhatsappJobFailed(job.id, "step has no WhatsApp template configured");
    return;
  }

  // Build template components from the step's variable map + enrollment payload.
  let payload = {};
  try { payload = JSON.parse(enrollment.payload); } catch { /* empty */ }

  // Templates created in Retainify carry our redirect in their URL buttons, and
  // buttonUrls records which button positions those are. A template synced from
  // Meta has none — its links point straight at the merchant, so there is
  // nothing to fill and no click to record.
  const template = await prisma.whatsappTemplate.findUnique({
    where: {
      shop_name_language: {
        shop: job.shop,
        name: step.waTemplateName,
        language: step.waLanguage || "en_US",
      },
    },
    select: { buttonUrls: true },
  });

  const components = buildComponents(step, payload, enrollment, job, template);

  const result = await sendWhatsapp(
    {
      to: phoneNumber,
      templateName: step.waTemplateName,
      language: step.waLanguage || "en_US",
      components,
    },
    { shop: job.shop, settings, account },
  );

  if (result.ok) {
    // Counted for cost visibility (Meta bills per conversation). WhatsApp is
    // gated at the connect step by plan, not per-message, so no quota check here.
    await incrementUsage(job.shop, "whatsapp", 1);
    await markWhatsappJobDone(job.id, {
      sentAt: new Date(),
      providerMessageId: result.providerMessageId || "",
      templateName: step.waTemplateName,
    });
    console.log(`[whatsapp-worker] job=${job.id} sent wamid=${result.providerMessageId || "?"}`);
    return;
  }

  if (result.invalid) {
    // Permanent recipient failure — suppress the number, don't retry.
    await prisma.whatsappSuppression.upsert({
      where: { shop_phoneNumber: { shop: job.shop, phoneNumber } },
      create: { shop: job.shop, phoneNumber, reason: "invalid" },
      update: { reason: "invalid" },
    });
    if (sub) {
      await prisma.whatsappSubscription.update({
        where: { id: sub.id },
        data: { status: "invalid" },
      }).catch(() => {});
    }
    await prisma.contact
      .updateMany({
        where: { shop: job.shop, email: enrollment.contactEmail },
        data: { whatsappStatus: "invalid" },
      })
      .catch(() => {});
    await markWhatsappJobDone(job.id, { failedAt: new Date(), lastError: result.error || "invalid recipient" });
    console.warn(`[whatsapp-worker] job=${job.id} permanent failure — suppressed ${phoneNumber}`);
    return;
  }

  // The connection is broken, not this message. Record it on the account so the
  // WhatsApp page can say what happened — otherwise the merchant's only symptom
  // is that nothing arrives, with a healthy-looking "Connected" badge above a
  // queue quietly retrying an unauthorized token for 24 hours.
  if (result.accountError) {
    await prisma.whatsappAccount
      .update({
        where: { shop: job.shop },
        data: { lastError: String(result.error || "").slice(0, 500) },
      })
      .catch(() => {});
    console.error(`[whatsapp-worker] shop=${job.shop} connection error — ${result.error}`);
  }

  await markWhatsappJobFailed(job.id, result.error || "send failed");
}

/**
 * Map a step's waVariables ({{1}}: "merge-tag or payload key") into a Meta
 * `components` body-parameter array. Values resolve from the enrollment payload
 * first, then fall back to a literal. Keeps it simple: BODY text params only;
 * header media uses step.waMediaUrl.
 */
function buildComponents(step, payload, enrollment, job, template) {
  const components = [];

  if (step.waMediaUrl) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: step.waMediaUrl } }],
    });
  }

  const vars = step.waVariables;
  if (vars && typeof vars === "object") {
    // Preserve positional order {{1}},{{2}},... by numeric key.
    const keys = Object.keys(vars).sort((a, b) => Number(a) - Number(b));
    const parameters = keys.map((k) => {
      const ref = vars[k];
      const resolved = resolveVar(ref, payload, enrollment);
      return { type: "text", text: String(resolved ?? "") };
    });
    if (parameters.length) {
      components.push({ type: "body", parameters });
    }
  }

  // Fill each tracked URL button's variable with a token naming this exact job
  // and button. That token is the whole reason WhatsApp can attribute revenue:
  // Meta never tells us who tapped a button, so the tap has to come back
  // through us. See app/routes/w.$token.jsx.
  for (const index of trackedButtonIndexes(template)) {
    components.push({
      type: "button",
      sub_type: "url",
      index: String(index),
      parameters: [{ type: "text", text: clickToken(job.id, index) }],
    });
  }

  return components;
}

/** Button positions whose URL points at our redirect, ascending. */
function trackedButtonIndexes(template) {
  const urls = template?.buttonUrls;
  if (!urls || typeof urls !== "object") return [];
  return Object.keys(urls)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);
}

/**
 * The value that fills a URL button's variable.
 *
 * `<jobId>-<buttonIndex>` — a cuid contains no hyphen, so the split is
 * unambiguous, and the index is what tells the redirect which destination of a
 * multi-button template to send the shopper to.
 */
export function clickToken(jobId, index) {
  return `${jobId}-${index}`;
}

function resolveVar(ref, payload, enrollment) {
  if (ref == null) return "";
  const key = String(ref);
  if (key in (payload || {})) return payload[key];
  if (key === "contactName") return enrollment.contactName || "";
  if (key === "recoveryUrl") return payload.recoveryUrl || "";
  // Literal fallback (e.g. a static discount string).
  return key;
}

async function markWhatsappJobDone(jobId, extras = {}) {
  const job = await prisma.whatsappJob.update({
    where: { id: jobId },
    data: { status: "done", ...extras },
  });
  await settleEnrollmentIfFinished(job.enrollmentId, { at: extras.sentAt || new Date(), channel: "whatsapp" });
}

async function markWhatsappJobFailed(jobId, error, errorClass) {
  const job = await prisma.whatsappJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const now = new Date();
  const firstFailedAt = job.firstFailedAt || now;
  const outcome = decideFailureOutcome({
    errorClass,
    attempts: job.attempts,
    firstFailedAt: job.firstFailedAt,
    now,
  });
  await prisma.whatsappJob.update({
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
    `[whatsapp-worker] job ${jobId} ${outcome.status} (${errorClass || "unclassified"}) — ${outcome.note}`,
  );
  if (outcome.status === "failed") {
    await settleEnrollmentIfFinished(job.enrollmentId, { failed: true, channel: "whatsapp" });
  }
}
