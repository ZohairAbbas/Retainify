/**
 * Resend webhook ingestor.
 *
 * Configure in Resend dashboard → Webhooks. Point at:
 *   https://<your-app-domain>/webhooks/resend
 * Enable events: email.opened, email.clicked, email.bounced, email.complained,
 * and domain.updated (for the custom sending-domain flow).
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
 *   domain.updated  → ShopSettings.domainStatus/domainVerified synced from Resend
 *
 * Unmatched messageId / domainId → log + 200 (Resend stops retrying).
 */
import { Webhook } from "svix";
import prisma from "../db.server.js";
import { unsubscribeContact } from "../lib/contacts/contacts.server.js";
import { canUseDomainSlot, MAX_CUSTOM_DOMAINS } from "../lib/email/domain-slots.server.js";

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

  // Domain lifecycle events carry a domain object, not an email_id — handle them
  // on their own path so the email-event messageId guard below doesn't reject them.
  if (eventType === "domain.updated") {
    try {
      await handleDomainUpdated(data);
    } catch (err) {
      console.error(`[resend-webhook] domain.updated handler threw:`, err.message);
    }
    return new Response(null, { status: 200 });
  }

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

/**
 * Sync a shop's domain state from a Resend `domain.updated` event. The event data
 * is a domain object: `{ id, name, status, records? }`. We match on resendDomainId,
 * mirror the status, and flip domainVerified only when status === "verified" AND a
 * slot is still free (re-checking the cap here guards a race where two shops both
 * finish verification against the last slot).
 */
async function handleDomainUpdated(data) {
  const domainId = data?.id || "";
  const status = data?.status || "";
  if (!domainId) {
    console.warn("[resend-webhook] domain.updated with no domain id — ignored");
    return;
  }

  const shopSettings = await prisma.shopSettings.findFirst({
    where: { resendDomainId: domainId },
    select: { shop: true, domainVerified: true },
  });
  if (!shopSettings) {
    console.log(`[resend-webhook] domain.updated for unknown domainId=${domainId} — ignored`);
    return;
  }

  let verified = status === "verified";

  // Cap re-check: only let a NEWLY verifying shop consume a slot if one is free.
  if (verified && !shopSettings.domainVerified) {
    const free = await canUseDomainSlot(shopSettings.shop);
    if (!free) {
      verified = false;
      console.warn(
        `[resend-webhook] ${shopSettings.shop} verified domain ${domainId} but all ${MAX_CUSTOM_DOMAINS} slots are taken — not activating`,
      );
    }
  }

  const update = { domainStatus: status };
  if (verified) update.domainVerified = true;
  // If Resend reports it's no longer verified, revoke Mode A so we fall back to
  // the shared address rather than sending from an unverifiable domain.
  if (status && status !== "verified") update.domainVerified = false;
  if (Array.isArray(data.records)) update.domainRecords = JSON.stringify(data.records);

  await prisma.shopSettings.update({
    where: { shop: shopSettings.shop },
    data: update,
  });
  console.log(
    `[resend-webhook] domain.updated ${shopSettings.shop} domainId=${domainId} status=${status} verified=${!!update.domainVerified}`,
  );
}

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

    // unsubscribeContact normalizes the address before writing. Providers echo
    // back whatever casing the envelope carried, and the suppression lookup on
    // the send path uses the normalized Contact email — writing a mixed-case row
    // here would leave a suppression that never matches.
    await unsubscribeContact(job.shop, toAddr, reason).catch((err) =>
      console.error("[resend-webhook] suppression write failed:", err.message),
    );
    console.log(`[resend-webhook] suppressed ${toAddr} on ${job.shop} reason=${reason} via messageId=${messageId}`);
    return;
  }

  // Any other event type — ignore quietly. We didn't subscribe to it.
}
