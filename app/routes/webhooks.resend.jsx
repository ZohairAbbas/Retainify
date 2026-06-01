/**
 * Resend webhook ingestor.
 *
 * Configure in Resend dashboard → Webhooks. Point at:
 *   https://<your-app-domain>/webhooks/resend
 * Enable events: email.opened, email.clicked, email.bounced, email.complained.
 * Copy the signing secret into env var RESEND_WEBHOOK_SECRET.
 *
 * Resend uses Svix-style signed webhooks. We verify the signature using the
 * `svix` package (already a transitive dependency via the resend SDK).
 *
 * Behavior:
 *   email.opened    → JourneyJob.openedAt  = now (if null)
 *   email.clicked   → JourneyJob.clickedAt = now (if null)
 *   email.bounced   → EmailSuppression upsert with reason='bounce'
 *   email.complained → EmailSuppression upsert with reason='complaint'
 *
 * Unmatched messageId → log + 200 (Resend stops retrying).
 */
import { Webhook } from "svix";
import prisma from "../db.server.js";

const SECRET = process.env.RESEND_WEBHOOK_SECRET || "";

export const action = async ({ request }) => {
  if (!SECRET) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET not set — rejecting");
    return new Response("misconfigured", { status: 500 });
  }

  const body = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") || "",
    "svix-timestamp": request.headers.get("svix-timestamp") || "",
    "svix-signature": request.headers.get("svix-signature") || "",
  };

  let payload;
  try {
    const wh = new Webhook(SECRET);
    payload = wh.verify(body, headers);
  } catch (err) {
    console.warn(`[resend-webhook] signature verify failed: ${err.message}`);
    return new Response("bad signature", { status: 401 });
  }

  const eventType = payload?.type || "";
  const data = payload?.data || {};
  const messageId = data.email_id || "";

  if (!eventType || !messageId) {
    console.warn(`[resend-webhook] malformed payload type=${eventType} messageId=${messageId}`);
    return new Response(null, { status: 200 });
  }

  try {
    await handleEvent(eventType, messageId, data);
  } catch (err) {
    console.error(`[resend-webhook] handler threw for ${eventType} ${messageId}:`, err.message);
    // Still 200 — Resend retrying won't help a code bug.
  }

  return new Response(null, { status: 200 });
};

async function handleEvent(eventType, messageId, data) {
  // For open/click we update the JourneyJob row by resendMessageId.
  if (eventType === "email.opened" || eventType === "email.clicked") {
    const field = eventType === "email.opened" ? "openedAt" : "clickedAt";

    // updateMany with the null filter makes this idempotent — multiple opens
    // for the same email won't overwrite the first-open timestamp.
    const result = await prisma.journeyJob.updateMany({
      where: { resendMessageId: messageId, [field]: null },
      data: { [field]: new Date() },
    });

    if (result.count === 0) {
      // Either the messageId doesn't exist, or this field was already set.
      // Distinguish by checking existence — if it exists we just no-op silently;
      // if not, log it so we can debug stale events / cascade deletions.
      const exists = await prisma.journeyJob.findFirst({
        where: { resendMessageId: messageId },
        select: { id: true },
      });
      if (!exists) {
        console.log(`[resend-webhook] unmatched messageId=${messageId} event=${eventType} — ignored`);
      }
    }
    return;
  }

  // For bounce/complaint we suppress the recipient so we don't keep sending.
  if (eventType === "email.bounced" || eventType === "email.complained") {
    const reason = eventType === "email.bounced" ? "bounce" : "complaint";
    // Resend's bounce events expose the recipient as `email` (string); other
    // events use `to` (array). Try both — defensive against payload variation.
    const toAddr = data.email
      || (Array.isArray(data.to) ? data.to[0] : data.to)
      || "";
    if (!toAddr) {
      console.warn(`[resend-webhook] ${eventType} ${messageId} had no recipient`);
      return;
    }

    // Need the shop too. Look it up from the JourneyJob that sent this email.
    const job = await prisma.journeyJob.findFirst({
      where: { resendMessageId: messageId },
      select: { shop: true },
    });

    if (!job) {
      console.log(`[resend-webhook] unmatched messageId=${messageId} event=${eventType} recipient=${toAddr} — ignored`);
      return;
    }

    await prisma.emailSuppression.upsert({
      where: { shop_email: { shop: job.shop, email: toAddr } },
      create: { shop: job.shop, email: toAddr, reason },
      update: { reason },
    });
    console.log(`[resend-webhook] suppressed ${toAddr} on ${job.shop} reason=${reason} via messageId=${messageId}`);
    return;
  }

  // Any other event type — ignore quietly. We didn't subscribe to it.
}
