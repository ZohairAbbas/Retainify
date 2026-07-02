/**
 * Meta WhatsApp Cloud API webhook ingestor.
 *
 * Configure in the Meta App dashboard → WhatsApp → Configuration → Webhook:
 *   Callback URL: https://<your-app-domain>/webhooks/whatsapp
 *   Verify token: WHATSAPP_WEBHOOK_VERIFY_TOKEN
 *   Subscribe to: messages
 *
 * GET  → verification handshake (echo hub.challenge when the verify token matches).
 * POST → signed status/message events. We verify X-Hub-Signature-256 (HMAC-SHA256
 *        of the raw body with META_APP_SECRET) before trusting anything, then:
 *
 *   statuses[].status = "delivered" → WhatsappJob.deliveredAt = now (if null)
 *   statuses[].status = "read"      → WhatsappJob.readAt      = now (if null)
 *   statuses[].status = "failed"    → WhatsappJob.failedAt; suppress if permanent
 *   messages[] (inbound)            → WhatsappSubscription.lastInboundAt = now;
 *                                     STOP/UNSUBSCRIBE keyword → recordOptOut
 *
 * Always returns 200 after handling (a code bug shouldn't make Meta hammer us),
 * mirroring webhooks.ses.jsx.
 */
import { createHmac, timingSafeEqual } from "crypto";
import prisma from "../db.server.js";
import { recordOptOut } from "../lib/whatsapp/optin.server.js";

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";
const APP_SECRET = process.env.META_APP_SECRET || "";

const STOP_KEYWORDS = new Set(["stop", "unsubscribe", "cancel", "end", "quit", "stopall"]);

// --- GET: subscription verification handshake -------------------------------
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    return new Response(challenge || "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
};

// --- POST: signed event delivery --------------------------------------------
export const action = async ({ request }) => {
  if (!APP_SECRET) {
    console.error("[wa-webhook] META_APP_SECRET not set — rejecting");
    return new Response("misconfigured", { status: 500 });
  }

  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256") || "";

  if (!verifySignature(raw, signature)) {
    console.warn("[wa-webhook] signature verification failed");
    return new Response("bad signature", { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad request", { status: 400 });
  }

  try {
    await handlePayload(body);
  } catch (err) {
    console.error("[wa-webhook] handler threw:", err.message);
  }

  return new Response(null, { status: 200 });
};

function verifySignature(raw, header) {
  if (!header.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length);
  const expected = createHmac("sha256", APP_SECRET).update(raw, "utf8").digest("hex");
  // Constant-time compare; lengths must match for timingSafeEqual.
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function handlePayload(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const metadata = value?.metadata || {};
      const phoneNumberId = metadata.phone_number_id || "";

      for (const status of value.statuses || []) {
        await handleStatus(status, phoneNumberId).catch((e) =>
          console.error("[wa-webhook] status handler:", e.message),
        );
      }
      for (const message of value.messages || []) {
        await handleInbound(message, phoneNumberId).catch((e) =>
          console.error("[wa-webhook] inbound handler:", e.message),
        );
      }
    }
  }
}

async function handleStatus(status, phoneNumberId) {
  const wamid = status?.id || "";
  const state = status?.status || "";
  if (!wamid) return;

  if (state === "delivered" || state === "read") {
    const field = state === "delivered" ? "deliveredAt" : "readAt";
    await prisma.whatsappJob.updateMany({
      where: { providerMessageId: wamid, [field]: null },
      data: { [field]: new Date() },
    });
    return;
  }

  if (state === "failed") {
    const job = await prisma.whatsappJob.findFirst({
      where: { providerMessageId: wamid },
      select: { id: true, shop: true },
    });
    await prisma.whatsappJob
      .updateMany({ where: { providerMessageId: wamid }, data: { failedAt: new Date() } })
      .catch(() => {});

    // Permanent failures carry recipient/blocked errors — suppress the number.
    const errs = Array.isArray(status.errors) ? status.errors : [];
    const recipient = normalize(status.recipient_id);
    const permanent = errs.some((e) => isPermanentError(e?.code));
    if (job && recipient && permanent) {
      await recordOptOut({ shop: job.shop, phoneNumber: recipient, reason: "blocked" }).catch(() => {});
    }
    return;
  }
}

async function handleInbound(message, phoneNumberId) {
  const from = normalize(message?.from);
  if (!from) return;

  // Find the shop owning this phone number id via the WhatsappAccount.
  const account = phoneNumberId
    ? await prisma.whatsappAccount.findFirst({ where: { phoneNumberId }, select: { shop: true } })
    : null;
  const shop = account?.shop;

  if (shop) {
    await prisma.whatsappSubscription
      .updateMany({
        where: { shop, phoneNumber: from },
        data: { lastInboundAt: new Date() },
      })
      .catch(() => {});
  }

  // STOP keyword → opt out.
  const text = (message?.text?.body || "").trim().toLowerCase();
  if (shop && text && STOP_KEYWORDS.has(text)) {
    await recordOptOut({ shop, phoneNumber: from, reason: "opt_out" }).catch(() => {});
  }
}

function normalize(raw) {
  if (!raw) return "";
  return String(raw).replace(/[^\d]/g, "");
}

// Meta error codes that indicate the recipient permanently can't be reached.
function isPermanentError(code) {
  const c = Number(code);
  return c === 131026 || c === 131049 || c === 131051 || c === 131053 || c === 131048;
}
