/**
 * Job worker — processes due EmailJob rows.
 * Called on a timer (every 60s) from entry.server.jsx.
 * Keeps quiet hours, builds email HTML, sends via Resend, records the send.
 */
import prisma from "../../db.server.js";
import { sendEmail } from "../email/resend.server.js";
import { renderCartRescueEmail } from "../email/templates.server.js";
import { claimDueJobs, markJobDone, markJobFailed } from "./queue.server.js";
import { buildTrackingUrl, buildUnsubscribeUrl } from "../tracking/links.server.js";
import { createDiscountCode } from "../shopify/discounts.server.js";

function isInQuietHours(quietStart, quietEnd, timezone) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone });
    const hour = parseInt(formatter.format(now), 10);
    if (quietStart < quietEnd) {
      return hour >= quietStart && hour < quietEnd;
    }
    // wraps midnight
    return hour >= quietStart || hour < quietEnd;
  } catch {
    return false;
  }
}

export async function runWorker() {
  const jobs = await claimDueJobs(20);
  if (!jobs.length) return;

  for (const job of jobs) {
    try {
      await processJob(job);
    } catch (err) {
      console.error(`[worker] job ${job.id} threw:`, err);
      await markJobFailed(job.id, err.message);
    }
  }
}

async function processJob(job) {
  const { shop, emailNumber, abandonedCart } = job;

  // Load settings
  const [settings, journey, suppression] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.journeySettings.findUnique({ where: { shop } }),
    prisma.emailSuppression.findUnique({ where: { shop_email: { shop, email: abandonedCart.customerEmail } } }),
  ]);

  // Don't send if shop is inactive or email is suppressed
  if (!settings?.isActive || suppression) {
    await markJobDone(job.id);
    return;
  }

  // Quiet hours check — reschedule 1h forward if in quiet hours
  if (isInQuietHours(settings.quietHoursStart, settings.quietHoursEnd, settings.storeTimezone)) {
    await prisma.emailJob.update({
      where: { id: job.id },
      data: {
        status: "pending",
        scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return;
  }

  // Skip if already sent
  const alreadySent =
    (emailNumber === 1 && abandonedCart.email1SentAt) ||
    (emailNumber === 2 && abandonedCart.email2SentAt) ||
    (emailNumber === 3 && abandonedCart.email3SentAt);
  if (alreadySent) {
    await markJobDone(job.id);
    return;
  }

  // Skip if cart was recovered
  if (abandonedCart.recoveredAt) {
    await markJobDone(job.id);
    return;
  }

  // Build discount code for email 3 — generate via Shopify Admin API if not already created
  let discountCode = "";
  if (emailNumber === 3) {
    discountCode = abandonedCart.discountCode;
    if (!discountCode) {
      try {
        discountCode = await createDiscountCode(shop, journey?.email3DiscountPct ?? 10);
        await prisma.abandonedCart.update({
          where: { id: abandonedCart.id },
          data: { discountCode },
        });
      } catch (err) {
        console.error("[worker] discount code generation failed:", err.message);
        // Email still sends without a code
      }
    }
  }

  // Build tracked recovery URL
  const recoveryUrl = buildTrackingUrl({
    shop,
    abandonedCartId: abandonedCart.id,
    emailNumber,
    destination: abandonedCart.recoveryUrl,
  });

  const unsubscribeUrl = buildUnsubscribeUrl({ shop, email: abandonedCart.customerEmail });

  const lineItems = (() => {
    try {
      return JSON.parse(abandonedCart.lineItemsJson);
    } catch {
      return [];
    }
  })();

  const emailSubject =
    emailNumber === 1
      ? journey?.email1Subject || "You left something behind"
      : emailNumber === 2
        ? journey?.email2Subject || "Still thinking it over?"
        : journey?.email3Subject || `Last chance — ${journey?.email3DiscountPct ?? 10}% off`;

  const html = renderCartRescueEmail({
    style: journey?.templateStyle || "classic",
    emailNumber,
    customerName: abandonedCart.customerName,
    lineItems,
    totalPrice: abandonedCart.totalPrice,
    currency: abandonedCart.currency,
    storeName: settings.senderName,
    logoUrl: settings.logoUrl,
    brandColor: settings.brandColor,
    recoveryUrl,
    unsubscribeUrl,
    merchantAddress: "", // pulled from Shopify shop object — left empty for now
    discountCode,
  });

  const from = `${settings.senderName} <${settings.senderEmail || process.env.RESEND_FROM_EMAIL || "noreply@retainify.app"}>`;

  const result = await sendEmail({
    to: abandonedCart.customerEmail,
    from,
    replyTo: settings.replyTo || settings.senderEmail,
    subject: emailSubject,
    html,
  });

  if (!result.ok) {
    await markJobFailed(job.id, result.error);
    return;
  }

  // Record the send
  const sentAt = new Date();
  await prisma.$transaction([
    prisma.cartRescueEmail.create({
      data: {
        shop,
        abandonedCartId: abandonedCart.id,
        emailNumber,
        to: abandonedCart.customerEmail,
        subject: emailSubject,
        sentAt,
        resendMessageId: result.providerMessageId,
      },
    }),
    prisma.abandonedCart.update({
      where: { id: abandonedCart.id },
      data:
        emailNumber === 1
          ? { email1SentAt: sentAt }
          : emailNumber === 2
            ? { email2SentAt: sentAt }
            : { email3SentAt: sentAt },
    }),
  ]);

  await markJobDone(job.id);
}
