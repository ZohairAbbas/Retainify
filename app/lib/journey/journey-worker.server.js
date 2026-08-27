/**
 * Generic journey worker — processes due JourneyJob rows.
 * Called every 60s alongside the cart rescue worker.
 */
import prisma from "../../db.server.js";
// Shared with the push and WhatsApp workers — the email path used to carry its
// own copy of isInQuietHours, which is how three send paths drift apart.
import { isInQuietHours, quietHoursRetryDelay } from "./quiet-hours.server.js";
import { sendEmail, resolveFrom, resolveProvider, resolveStoreUrl } from "../email/index.server.js";
import { renderVisualEmail, renderCustomHtmlEmail, brandingFooterHtml } from "../email/visual-renderer.server.js";
import { buildTextPart } from "../email/text.server.js";
import { buildUnsubscribeUrl, listUnsubscribeHeaders } from "../tracking/links.server.js";
import { createDiscountCode } from "../shopify/discounts.server.js";
import {
  claimDueJourneyJobs,
  markJourneyJobDone,
  markJourneyJobFailed,
} from "./journey-queue.server.js";
import { checkQuota, incrementUsage } from "../billing/entitlements.server.js";
import { partitionByShopHealth, cancelReasonFor } from "../shopify/shop-health.server.js";
import { stopShopSending, releaseClaimedJob } from "./shop-work.server.js";


export async function runJourneyWorker() {
  const claimed = await claimDueJourneyJobs(20);
  if (!claimed.length) return;

  // Never send on behalf of a shop that has gone away. Asking Shopify is the
  // only reliable test: a Session row survives both an uninstall whose webhook
  // never landed and a store the merchant has closed outright.
  const { live, dead, holding } = await partitionByShopHealth(claimed);

  // One shop's verdict condemns its whole backlog, not just the jobs this tick
  // happened to claim — otherwise the queue drains 20 rows per minute while the
  // shop stays dead.
  const condemned = new Map();
  for (const { job, status } of dead) condemned.set(job.shop, status);
  for (const [shop, status] of condemned) {
    const reason = cancelReasonFor(status);
    const { jobs } = await stopShopSending(shop, reason);
    console.warn(
      `[journey-worker] ${shop} — ${reason}; cancelled ${jobs.total} queued jobs ` +
        `(${jobs.byQueue.email} email, ${jobs.byQueue.push} push, ${jobs.byQueue.whatsapp} whatsapp)`,
    );
  }

  // Unreachable, not dead: give the work back and let a later tick decide.
  for (const job of holding) {
    await releaseClaimedJob("journeyJob", job.id);
  }
  if (holding.length) {
    console.warn(`[journey-worker] held ${holding.length} job(s) — shop health unknown`);
  }

  for (const job of live) {
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

  // Inside quiet hours — defer, with jitter so the overnight backlog doesn't
  // all become due in the same tick.
  if (isInQuietHours(settings.quietHoursStart, settings.quietHoursEnd, settings.storeTimezone)) {
    await prisma.journeyJob.update({
      where: { id: job.id },
      data: { status: "pending", scheduledFor: new Date(Date.now() + quietHoursRetryDelay()) },
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
  let discountBlock = null;
  if (emailMode === "blocks") {
    try { parsedBlocks = JSON.parse(step.emailBlocks || "[]"); } catch { parsedBlocks = []; }
    try { brand = JSON.parse(step.emailBrand || "{}"); } catch { brand = {}; }
    discountBlock = parsedBlocks.find((b) => b && b.type === "discount" && Number(b.percent) > 0) || null;
  }

  // Email send quota, checked BEFORE minting a discount code. A code created for
  // a send that is then blocked would sit in the merchant's Shopify admin
  // forever, redeemable by nobody who was ever told about it.
  const quota = await checkQuota(shop, "emails", 1);
  if (quota.exceeded) {
    if (quota.shouldBlock) {
      // Fail the job explicitly rather than dropping it silently, so the
      // merchant can see why nothing sent.
      await markJourneyJobFailed(job.id, "quota_exceeded");
      return;
    }
    console.warn(
      `[billing:shadow] email quota exceeded shop=${shop} used=${quota.used} limit=${quota.limit} plan=${quota.planKey} — allowed (enforcement off)`,
    );
  }

  // Minted last, once everything that could abort the send has passed. It can
  // still be orphaned if the provider itself rejects the message, but that is a
  // genuine failure rather than a decision we made a moment earlier.
  let discountCode = "";
  if (discountBlock) {
    try {
      discountCode = await createDiscountCode(shop, Number(discountBlock.percent));
    } catch (err) {
      console.error("[journey-worker] discount code failed:", err.message);
    }
  }

  const ctx = {
    first_name: firstName || "",
    last_name: rest.join(" "),
    store_name: settings.senderName || "",
    // Resolved, not interpolated: the tenant key is a domain only for a Shopify
    // install. A direct workspace's key is a slug, and `https://<slug>` is a
    // host that does not exist — which would then become the href of every
    // button left without a URL.
    store_url: resolveStoreUrl({ shop, settings }),
    discount_code: discountCode || "",
    cart_url: recoveryUrl || "",
    unsubscribeUrl,
  };

  const html = emailMode === "html"
    ? renderCustomHtmlEmail({
        html: step.emailHtml || "",
        ctx,
        stepId: step.id,
        // Block path resolves this internally; the custom-HTML path is sync, so
        // the branding line is resolved here and passed in.
        branding: await brandingFooterHtml(shop),
      })
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
      // Multipart: HTML-only is a long-standing spam heuristic, and the text
      // part is what watch previews and text-only clients render.
      text: buildTextPart({ html, unsubscribeUrl }),
      // RFC 8058 one-click unsubscribe — required by Gmail's and Yahoo's
      // bulk-sender rules. Without it they throttle or spam-folder the sender,
      // and every shop on the shared sending domain shares that reputation.
      headers: listUnsubscribeHeaders({ unsubscribeUrl }),
      // Stable per job, so a retry after a network timeout that actually
      // succeeded upstream cannot deliver the same email twice.
      idempotencyKey: job.id,
    },
    { shop, settings },
  );

  if (!result.ok) {
    await markJourneyJobFailed(job.id, result.error);
    return;
  }

  // Count only successful sends — a failed send must never burn quota.
  await incrementUsage(shop, "emails", 1);

  const sentAt = new Date();
  // Dual-write during the Resend→SES transition: resendMessageId keeps the
  // existing Resend webhook join working; providerMessageId is the neutral key
  // the SES webhook uses.
  const messageId = result.providerMessageId || "";
  // markJourneyJobDone settles the enrollment when this was the last job
  // outstanding — across all three queues, and on every terminal path, not just
  // this successful one. See settleEnrollmentIfFinished.
  await markJourneyJobDone(job.id, {
    sentAt,
    resendMessageId: messageId,
    providerMessageId: messageId,
  });
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
