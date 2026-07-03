/**
 * WhatsApp send worker — drains due WhatsappJob rows. Mirrors push-worker:
 * atomic claim, quiet-hours reschedule, 3-attempt exponential backoff.
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
import { isInQuietHours } from "../journey/quiet-hours.server.js";
import { sendWhatsapp } from "./index.server.js";

async function claimDueWhatsappJobs(limit = 20) {
  const now = new Date();
  const candidates = await prisma.whatsappJob.findMany({
    where: { status: "pending", scheduledFor: { lte: now }, attempts: { lt: 3 } },
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
  const jobs = await claimDueWhatsappJobs(20);
  if (!jobs.length) return;

  for (const job of jobs) {
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

  // Quiet hours — reschedule 1h forward.
  if (isInQuietHours(settings.quietHoursStart, settings.quietHoursEnd, settings.storeTimezone)) {
    await prisma.whatsappJob.update({
      where: { id: job.id },
      data: { status: "pending", scheduledFor: new Date(Date.now() + 60 * 60 * 1000) },
    });
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
  const components = buildComponents(step, payload, enrollment);

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

  await markWhatsappJobFailed(job.id, result.error || "send failed");
}

/**
 * Map a step's waVariables ({{1}}: "merge-tag or payload key") into a Meta
 * `components` body-parameter array. Values resolve from the enrollment payload
 * first, then fall back to a literal. Keeps it simple: BODY text params only;
 * header media uses step.waMediaUrl.
 */
function buildComponents(step, payload, enrollment) {
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

  return components;
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
  await prisma.whatsappJob.update({
    where: { id: jobId },
    data: { status: "done", ...extras },
  });
}

async function markWhatsappJobFailed(jobId, error) {
  const job = await prisma.whatsappJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const newStatus = job.attempts >= 3 ? "failed" : "pending";
  const backoffMs = Math.pow(2, job.attempts) * 5 * 60 * 1000;
  const scheduledFor = newStatus === "pending" ? new Date(Date.now() + backoffMs) : job.scheduledFor;
  await prisma.whatsappJob.update({
    where: { id: jobId },
    data: { status: newStatus, lastError: String(error).slice(0, 500), scheduledFor },
  });
}
