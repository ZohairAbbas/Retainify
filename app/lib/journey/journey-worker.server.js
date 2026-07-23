/**
 * Generic journey worker — processes due JourneyJob rows.
 * Called every 60s alongside the cart rescue worker.
 */
import prisma from "../../db.server.js";
import { sendEmail, resolveFrom, resolveProvider } from "../email/index.server.js";
import { renderVisualEmail, renderCustomHtmlEmail } from "../email/visual-renderer.server.js";
import { buildUnsubscribeUrl } from "../tracking/links.server.js";
import { createDiscountCode } from "../shopify/discounts.server.js";
import {
  claimDueJourneyJobs,
  markJourneyJobDone,
  markJourneyJobFailed,
} from "./journey-queue.server.js";

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

export async function runJourneyWorker() {
  const jobs = await claimDueJourneyJobs(20);
  if (!jobs.length) return;

  for (const job of jobs) {
    try {
      await processJourneyJob(job);
    } catch (err) {
      console.error(`[journey-worker] job ${job.id} threw:`, err);
      await markJourneyJobFailed(job.id, err.message);
    }
  }
}

async function processJourneyJob(job) {
  const { enrollment, step } = job;
  const { journey } = step;
  const shop = job.shop;

  // Skip if enrollment exited
  if (enrollment.exitReason) {
    await markJourneyJobDone(job.id);
    return;
  }

  const [settings, suppression] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.emailSuppression.findFirst({ where: { shop, email: enrollment.contactEmail } }),
  ]);

  if (!settings || suppression) {
    await markJourneyJobDone(job.id);
    return;
  }

  // Quiet hours — reschedule 1h forward
  if (isInQuietHours(settings.quietHoursStart, settings.quietHoursEnd, settings.storeTimezone)) {
    await prisma.journeyJob.update({
      where: { id: job.id },
      data: { status: "pending", scheduledFor: new Date(Date.now() + 60 * 60 * 1000) },
    });
    return;
  }

  const unsubscribeUrl = buildUnsubscribeUrl({ shop, email: enrollment.contactEmail });

  // Parse enrollment payload for the {cart_url} merge tag (cart_abandoned trigger).
  // Other triggers may attach other fields; only recoveryUrl is read here.
  let payload = {};
  try { payload = JSON.parse(enrollment.payload); } catch { /* empty */ }

  const recoveryUrl = payload.recoveryUrl || "";

  const emailMode = step.emailMode || "blocks";
  const [firstName, ...rest] = String(enrollment.contactName || "").trim().split(/\s+/);

  let parsedBlocks = [];
  let brand = {};

  // Discount handling: discount blocks are the single source of truth for
  // "this email has a discount". The first discount block's percent drives a
  // single createDiscountCode() call; the resulting code is exposed via the
  // ctx.discount_code merge tag and used by the renderer for the block itself.
  // If no discount block is present, no code is generated. Custom-HTML steps
  // have no discount block, so they never generate a code (discount_code = "").
  let discountCode = "";
  if (emailMode === "blocks") {
    try { parsedBlocks = JSON.parse(step.emailBlocks || "[]"); } catch { parsedBlocks = []; }
    try { brand = JSON.parse(step.emailBrand || "{}"); } catch { brand = {}; }
    const discountBlock = parsedBlocks.find((b) => b && b.type === "discount" && Number(b.percent) > 0);
    if (discountBlock) {
      try {
        discountCode = await createDiscountCode(shop, Number(discountBlock.percent));
      } catch (err) {
        console.error("[journey-worker] discount code failed:", err.message);
      }
    }
  }

  const ctx = {
    first_name: firstName || "",
    last_name: rest.join(" "),
    store_name: settings.senderName || "",
    store_url: `https://${shop}`,
    discount_code: discountCode || "",
    cart_url: recoveryUrl || "",
    unsubscribeUrl,
  };

  const html = emailMode === "html"
    ? renderCustomHtmlEmail({ html: step.emailHtml || "", ctx, stepId: step.id })
    : await renderVisualEmail({ blocks: parsedBlocks, brand, ctx, stepId: step.id, shop });

  const subject = step.subject || defaultSubject(journey.trigger, step.stepNumber, settings.senderName);
  const provider = resolveProvider(settings);
  const { from, replyTo } = resolveFrom({ settings, provider });

  const result = await sendEmail(
    {
      to: enrollment.contactEmail,
      from,
      replyTo,
      subject,
      html,
    },
    { shop, settings },
  );

  if (!result.ok) {
    await markJourneyJobFailed(job.id, result.error);
    return;
  }

  const sentAt = new Date();
  // Dual-write during the Resend→SES transition: resendMessageId keeps the
  // existing Resend webhook join working; providerMessageId is the neutral key
  // the SES webhook uses.
  const messageId = result.providerMessageId || "";
  await markJourneyJobDone(job.id, {
    sentAt,
    resendMessageId: messageId,
    providerMessageId: messageId,
  });

  // Check if all steps for this enrollment are done — complete enrollment
  const pendingCount = await prisma.journeyJob.count({
    where: { enrollmentId: enrollment.id, status: { in: ["pending", "processing"] } },
  });
  if (pendingCount === 0) {
    await prisma.journeyEnrollment.update({
      where: { id: enrollment.id },
      data: { completedAt: sentAt, exitReason: "completed" },
    });
  }
}

function defaultSubject(trigger, stepNumber, storeName) {
  const defaults = {
    customer_created: ["Welcome to " + storeName + "!", "Here's what makes us different", "Your first order — 10% off"],
    order_placed: ["Thank you for your order!", "How's your order? Leave a review", "Time to restock?"],
    win_back: ["We miss you!", "Still thinking about us?", "Come back — 15% off, just for you"],
  };
  const list = defaults[trigger] || [];
  return list[stepNumber - 1] || "A message from " + storeName;
}
