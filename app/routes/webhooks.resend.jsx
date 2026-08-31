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
 *   email.delivered → JourneyJob.deliveredAt = now (if null)
 *   email.failed    → JourneyJob.failedAt    = now (if null)
 *   email.opened    → openedAt  = now (if null), JourneyJob or PopupSignup
 *   email.clicked   → clickedAt = now (if null), JourneyJob or PopupSignup
 *   email.bounced   → EmailSuppression upsert with reason='bounce'
 *   email.complained → EmailSuppression upsert with reason='complaint'
 *   domain.updated  → ShopSettings.domainStatus/domainVerified synced from Resend
 *
 * ── Why delivered/failed are ingested ──────────────────────────────────────
 * A JourneyJob reaching status "done" only ever meant Resend accepted the API
 * call. Reading real sends back from the Resend API showed messages sitting at
 * last_event=failed while our row said done, so "emails sent" was overstated in
 * every report with no way to measure by how much. These two events are what
 * make the number honest — they need enabling in the Resend dashboard too.
 *
 * ── Why PopupSignup is a fallback target ───────────────────────────────────
 * The popup confirmation and discount-reveal emails are not journey sends and
 * have no JourneyJob row. Their open/click events therefore matched nothing and
 * were logged "unmatched" and discarded — 92 real engagement events lost before
 * anyone looked. They carry their own message ids on PopupSignup instead.
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

/** Stamp a timestamp field on whichever record owns this provider message id. */
async function stampByMessageId(messageId, field, eventType) {
  // updateMany with the null filter makes this idempotent — a second open for
  // the same email must not overwrite the first-open timestamp.
  const onJob = await prisma.journeyJob.updateMany({
    where: { resendMessageId: messageId, [field]: null },
    data: { [field]: new Date() },
  });
  if (onJob.count > 0) return true;

  // Already stamped? Then this is a repeat event, not an unmatched one.
  const jobExists = await prisma.journeyJob.findFirst({
    where: { resendMessageId: messageId },
    select: { id: true },
  });
  if (jobExists) return true;

  // Not a journey send — try the transactional emails, which carry their own
  // message ids. Only opens and clicks are meaningful here; PopupSignup has no
  // delivery columns because it is not a sending queue.
  if (field === "openedAt" || field === "clickedAt") {
    const onSignup = await prisma.popupSignup.updateMany({
      where: {
        OR: [{ confirmMessageId: messageId }, { discountMessageId: messageId }],
        [field]: null,
      },
      data: { [field]: new Date() },
    });
    if (onSignup.count > 0) return true;

    const signupExists = await prisma.popupSignup.findFirst({
      where: { OR: [{ confirmMessageId: messageId }, { discountMessageId: messageId }] },
      select: { id: true },
    });
    if (signupExists) return true;
  }

  console.log(`[resend-webhook] unmatched messageId=${messageId} event=${eventType} — ignored`);
  return false;
}

async function handleEvent(eventType, messageId, data) {
  // Delivery outcome. Without these, "done" (provider accepted the call) was
  // the only signal we had, and it silently counted failures as sends.
  if (eventType === "email.delivered" || eventType === "email.failed") {
    const field = eventType === "email.delivered" ? "deliveredAt" : "failedAt";
    const stamped = await prisma.journeyJob.updateMany({
      where: { resendMessageId: messageId, [field]: null },
      data: { [field]: new Date() },
    });
    // Logged either way. Without a line here the only way to tell ingestion
    // from silent no-op was to query the database, which made "is this even
    // working?" unanswerable from the logs — and these events are only ever
    // emitted for mail sent after the topic was subscribed, so an empty result
    // is usually just "nothing sent yet" rather than a fault.
    if (stamped.count > 0) {
      console.log(`[resend-webhook] ${eventType} recorded for messageId=${messageId}`);
    } else {
      console.log(
        `[resend-webhook] ${eventType} messageId=${messageId} matched no journey send (transactional email, or already recorded)`,
      );
    }
    return;
  }

  if (eventType === "email.opened" || eventType === "email.clicked") {
    const field = eventType === "email.opened" ? "openedAt" : "clickedAt";
    await stampByMessageId(messageId, field, eventType);
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
