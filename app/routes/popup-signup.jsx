import prisma from "../db.server.js";
import { sendEmail, resolveFrom, resolveProvider } from "../lib/email/index.server.js";
import { renderConfirmationEmail } from "../lib/email/templates.server.js";
import { generateConfirmToken } from "../lib/email/confirm.server.js";
import { upsertContact } from "../lib/contacts/contacts.server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

// Public API — called from the storefront popup JS.
export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
  }

  const email = (body.email || "").trim().toLowerCase();
  const shop = (body.shop || "").trim();
  const anonId = (body.anonId || "").trim() || null;

  if (!email || !shop) {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
  }

  // Check suppression list — silently accept so we don't leak suppression state
  const suppressed = await prisma.emailSuppression.findUnique({
    where: { shop_email: { shop, email } },
  });
  if (suppressed) {
    return new Response(JSON.stringify({ ok: true, message: "check_email" }), { status: 200, headers: CORS });
  }

  // Find or create the signup record
  let signup = await prisma.popupSignup.findFirst({ where: { shop, email } });

  // Already confirmed — idempotent, don't re-send
  if (signup?.confirmedAt) {
    return new Response(JSON.stringify({ ok: true, message: "already_confirmed" }), { status: 200, headers: CORS });
  }

  const confirmToken = generateConfirmToken(shop, email);

  if (!signup) {
    signup = await prisma.popupSignup.create({
      data: { shop, email, source: "exit_intent_popup", confirmToken },
    });
  } else {
    await prisma.popupSignup.update({
      where: { id: signup.id },
      data: { confirmToken },
    });
  }

  // Mirror the touchpoint to the unified Contact record. Fire-and-forget so
  // the popup response isn't held up by a Contacts table write.
  upsertContact({ shop, email, source: "popup" }).catch((err) =>
    console.error("[popup-signup] upsertContact failed:", err.message),
  );

  // Load shop settings for sender details and popup config for discount %
  const [shopSettings, popupSettings] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.popupSettings.findUnique({ where: { shop } }),
  ]);

  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const confirmUrl = `${appUrl}/track/confirm?shop=${encodeURIComponent(shop)}&email=${encodeURIComponent(email)}&token=${confirmToken}`;

  const storeName = shopSettings?.senderName || shop;
  const brandColor = shopSettings?.brandColor || popupSettings?.brandColor || "#000000";
  const logoUrl = shopSettings?.logoUrl || popupSettings?.logoUrl || "";
  const provider = resolveProvider(shopSettings);
  const { from, replyTo } = resolveFrom({ settings: shopSettings, provider });

  const html = renderConfirmationEmail({ storeName, logoUrl, brandColor, confirmUrl });

  // Link any anonymous push subscriptions to this email — fire-and-forget
  if (anonId) {
    prisma.pushSubscription.updateMany({
      where: { shop, anonId, contactEmail: null },
      data: { contactEmail: email },
    }).catch(() => {});
  }

  // Fire-and-forget — don't block the popup response
  sendEmail(
    {
      to: email,
      from,
      replyTo,
      subject: `Confirm your email for ${storeName}`,
      html,
    },
    { shop, settings: shopSettings },
  ).catch((err) => console.error("[popup-signup] confirmation email failed:", err.message));

  return new Response(JSON.stringify({ ok: true, message: "check_email" }), { status: 200, headers: CORS });
};

// CORS preflight
export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return new Response(null, { status: 405 });
};
