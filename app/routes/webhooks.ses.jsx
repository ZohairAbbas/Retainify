/**
 * Amazon SES event ingestor (via SNS).
 *
 * SES publishes events to an SNS topic; SNS delivers them here over HTTPS.
 * Configure: SES configuration set → event destination → SNS topic, then
 * subscribe that topic (HTTPS) to:
 *   https://<your-app-domain>/webhooks/ses
 * Event types published: send, delivery, open, click, bounce, complaint.
 * Only open/click/bounce/complaint drive DB changes — send/delivery are
 * received and ignored (see the fall-through in handleSesEvent).
 *
 * This mirrors webhooks.resend.jsx but keys on JourneyJob.providerMessageId
 * (the provider-neutral id) instead of resendMessageId.
 *
 * SNS message lifecycle handled here:
 *   SubscriptionConfirmation → GET the SubscribeURL to confirm, then 200.
 *   Notification             → verify signature, parse SES event, update DB.
 *   UnsubscribeConfirmation  → log + 200.
 *
 * Behavior (matching the Resend ingestor):
 *   Open      → JourneyJob.openedAt  = now (if null)
 *   Click     → JourneyJob.clickedAt = now (if null)
 *   Bounce    → EmailSuppression upsert reason='bounce'    + Contact bounced
 *   Complaint → EmailSuppression upsert reason='complaint' + Contact complained
 */
import { createVerify } from "crypto";
import prisma from "../db.server.js";
import { upsertContact } from "../lib/contacts/contacts.server.js";

export const action = async ({ request }) => {
  const raw = await request.text();

  let snsMessage;
  try {
    snsMessage = JSON.parse(raw);
  } catch {
    console.warn("[ses-webhook] body was not valid JSON");
    return new Response("bad request", { status: 400 });
  }

  // Verify the SNS message signature before trusting anything in it.
  const valid = await verifySnsSignature(snsMessage);
  if (!valid) {
    console.warn("[ses-webhook] SNS signature verification failed");
    return new Response("bad signature", { status: 401 });
  }

  const messageType =
    request.headers.get("x-amz-sns-message-type") || snsMessage.Type || "";

  // Confirm the subscription handshake on first connect (and re-subscribes).
  if (messageType === "SubscriptionConfirmation") {
    const url = snsMessage.SubscribeURL;
    if (url && isAwsSnsUrl(url)) {
      try {
        await fetch(url);
        console.log("[ses-webhook] subscription confirmed");
      } catch (err) {
        console.error("[ses-webhook] failed to confirm subscription:", err.message);
      }
    }
    return new Response(null, { status: 200 });
  }

  if (messageType === "UnsubscribeConfirmation") {
    console.log("[ses-webhook] received unsubscribe confirmation");
    return new Response(null, { status: 200 });
  }

  if (messageType !== "Notification") {
    return new Response(null, { status: 200 });
  }

  // The SES event payload is JSON inside the SNS Message string.
  let event;
  try {
    event = JSON.parse(snsMessage.Message);
  } catch {
    console.warn("[ses-webhook] SNS Message was not valid JSON");
    return new Response(null, { status: 200 });
  }

  try {
    await handleSesEvent(event);
  } catch (err) {
    console.error("[ses-webhook] handler threw:", err.message);
    // Still 200 — SNS retrying won't fix a code bug, and we don't want it
    // hammering the endpoint.
  }

  return new Response(null, { status: 200 });
};

async function handleSesEvent(event) {
  // SES event type lives in eventType (event publishing) or notificationType
  // (legacy/feedback notifications). Normalize both.
  const type = event.eventType || event.notificationType || "";
  const messageId = event?.mail?.messageId || "";

  if (!type || !messageId) {
    console.warn(`[ses-webhook] malformed event type=${type} messageId=${messageId}`);
    return;
  }

  if (type === "Open" || type === "Click") {
    const field = type === "Open" ? "openedAt" : "clickedAt";
    // Idempotent: only set the first-seen timestamp, never overwrite.
    const result = await prisma.journeyJob.updateMany({
      where: { providerMessageId: messageId, [field]: null },
      data: { [field]: new Date() },
    });

    if (result.count === 0) {
      const exists = await prisma.journeyJob.findFirst({
        where: { providerMessageId: messageId },
        select: { id: true },
      });
      if (!exists) {
        console.log(`[ses-webhook] unmatched messageId=${messageId} event=${type} — ignored`);
      }
    }
    return;
  }

  if (type === "Bounce" || type === "Complaint") {
    const reason = type === "Bounce" ? "bounce" : "complaint";
    const recipients = extractRecipients(event, type);
    if (recipients.length === 0) {
      console.warn(`[ses-webhook] ${type} ${messageId} had no recipients`);
      return;
    }

    // Need the shop. Look it up from the JourneyJob that sent this email.
    const job = await prisma.journeyJob.findFirst({
      where: { providerMessageId: messageId },
      select: { shop: true },
    });
    if (!job) {
      console.log(`[ses-webhook] unmatched messageId=${messageId} event=${type} — ignored`);
      return;
    }

    for (const toAddr of recipients) {
      await prisma.emailSuppression.upsert({
        where: { shop_email: { shop: job.shop, email: toAddr } },
        create: { shop: job.shop, email: toAddr, reason },
        update: { reason },
      });
      await upsertContact({
        shop: job.shop,
        email: toAddr,
        subscriptionStatus: reason === "bounce" ? "bounced" : "complained",
      }).catch((err) =>
        console.error("[ses-webhook] upsertContact failed:", err.message),
      );
      console.log(`[ses-webhook] suppressed ${toAddr} on ${job.shop} reason=${reason} via messageId=${messageId}`);
    }
    return;
  }

  // Delivery / Send / other — received but nothing to persist.
}

/**
 * Pull recipient addresses out of a Bounce or Complaint event.
 */
function extractRecipients(event, type) {
  const list =
    type === "Bounce"
      ? event?.bounce?.bouncedRecipients
      : event?.complaint?.complainedRecipients;
  if (!Array.isArray(list)) return [];
  return list.map((r) => r.emailAddress).filter(Boolean);
}

// --- SNS signature verification ---------------------------------------------

const SIGNING_CERT_CACHE = new Map();

function isAwsSnsUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Verify an SNS message signature (SignatureVersion 1 or 2). Builds the
 * canonical string-to-sign per AWS spec, fetches the signing cert (cert URL
 * must be an AWS SNS host), and RSA-verifies the signature.
 */
async function verifySnsSignature(msg) {
  try {
    if (!msg.SigningCertURL || !isAwsSnsUrl(msg.SigningCertURL)) return false;

    const stringToSign = buildStringToSign(msg);
    if (!stringToSign) return false;

    const cert = await getSigningCert(msg.SigningCertURL);
    if (!cert) return false;

    const algo = msg.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
    const verifier = createVerify(algo);
    verifier.update(stringToSign, "utf8");
    return verifier.verify(cert, msg.Signature, "base64");
  } catch (err) {
    console.error("[ses-webhook] signature verify error:", err.message);
    return false;
  }
}

function buildStringToSign(msg) {
  // Field order is defined by AWS and differs by message type.
  let keys;
  if (msg.Type === "Notification") {
    keys = msg.Subject
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "Timestamp", "TopicArn", "Type"];
  } else if (
    msg.Type === "SubscriptionConfirmation" ||
    msg.Type === "UnsubscribeConfirmation"
  ) {
    keys = [
      "Message",
      "MessageId",
      "SubscribeURL",
      "Timestamp",
      "Token",
      "TopicArn",
      "Type",
    ];
  } else {
    return null;
  }

  let out = "";
  for (const k of keys) {
    if (msg[k] === undefined || msg[k] === null) continue;
    out += `${k}\n${msg[k]}\n`;
  }
  return out;
}

async function getSigningCert(certUrl) {
  if (SIGNING_CERT_CACHE.has(certUrl)) return SIGNING_CERT_CACHE.get(certUrl);
  const res = await fetch(certUrl);
  if (!res.ok) return null;
  const pem = await res.text();
  SIGNING_CERT_CACHE.set(certUrl, pem);
  return pem;
}
