/**
 * The popup signup itself, shared by both ways a popup can post:
 *
 *   /apps/retainify/popup-signup  — a Shopify storefront, via the app proxy
 *   /embed/popup-signup           — any other website, via its site key
 *
 * Each route establishes WHICH workspace the request is for (proxy signature,
 * or site key + allowed domain) and then hands over here, so the defences
 * below — shape checks, rate limits, per-address cooldown, suppression,
 * double opt-in — are identical for both. See routes/popup-signup.js for why
 * each one exists.
 */
import prisma from "../../db.server.js";
import { sendEmail, resolveFrom, resolveProvider } from "../email/index.server.js";
import { checkShopHealth, SHOP_CLOSED, SHOP_UNINSTALLED } from "../shopify/shop-health.server.js";
import { renderConfirmationEmail } from "../email/templates.server.js";
import { generateConfirmToken } from "../email/confirm.server.js";
import { upsertContact, normalizeEmail, toE164 } from "../contacts/contacts.server.js";
import { recordOptIn } from "../whatsapp/optin.server.js";
import { hit, clientIp } from "../security/rate-limit.server.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// One confirmation per address per hour. A shopper who genuinely didn't get the
// first email retries within seconds, not within the hour, and the "check your
// inbox" response is identical either way — so this is invisible to real users
// and decisive against targeting one victim.
const RESEND_COOLDOWN_MS = 60 * 60 * 1000;
const IP_LIMIT = 8;
const IP_WINDOW_MS = 10 * 60 * 1000;
// Generous: a busy store during a launch can legitimately capture hundreds of
// addresses an hour. This is a ceiling on catastrophe, not a traffic shaper.
const SHOP_LIMIT = 500;
const SHOP_WINDOW_MS = 60 * 60 * 1000;

/**
 * @param {object} args
 * @param {string} args.shop     the workspace, already authenticated by the caller
 * @param {Request} args.request
 * @param {object} args.headers  response headers (CORS) for this entry point
 * @param {(shop: string) => boolean} [args.shopShapeOk]  extra shape check on the shop key
 */
export async function processPopupSignup({ shop, request, headers, shopShapeOk = () => true }) {
  const CORS = headers;
  const SHOP_RE = { test: shopShapeOk };
  function accepted(extra) {
    return new Response(JSON.stringify({ ok: true, message: "check_email", ...extra }), {
      status: 200,
      headers: CORS,
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
  }
  if (!body || typeof body !== "object") {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
  }

  const email = normalizeEmail(body.email);
  const anonId = String(body.anonId || "").trim() || null;
  // WhatsApp opt-in, captured by the popup when the merchant enables it. Both
  // must be present: a phone number is not consent, and a ticked box with no
  // number is nothing to send to.
  const waConsent = body.whatsappConsent === true || body.whatsappConsent === "true";
  // A consented number is held to WhatsApp's standard, not the contacts one: a
  // national-format number is rejected by Meta permanently, and the worker
  // reacts to that by suppressing the subscriber for good. Refusing the opt-in
  // here — while still completing the email signup — is the only outcome that
  // doesn't quietly cost the shop a subscriber it thinks it has.
  const phoneCheck = body.phone ? toE164(body.phone) : { ok: false, error: "" };
  const phone = phoneCheck.ok ? phoneCheck.phone : "";
  const phoneRejected = waConsent && !phoneCheck.ok;
  if (phoneRejected) {
    console.warn(`[popup-signup] WhatsApp opt-in rejected for shop=${shop} — ${phoneCheck.error}`);
  }

  // 1. Shape. The shop is no longer shape-checked as a stand-in for
  // authentication — the signature covers that — but it is still required to
  // look like a shop domain, since every downstream row is keyed on it.
  if (!email || !EMAIL_RE.test(email) || !SHOP_RE.test(shop)) {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
  }

  // 4a. Per-IP, checked before any database work.
  const ip = clientIp(request);
  if (!hit(`signup:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS).allowed) {
    console.warn(`[popup-signup] rate limited ip=${ip} shop=${shop}`);
    return accepted();
  }

  // 2. The shop must be a real install with the popup switched on.
  const popupSettings = await prisma.popupSettings.findUnique({ where: { shop } });
  if (!popupSettings?.enabled) {
    console.warn(`[popup-signup] rejected — no enabled popup for shop=${shop}`);
    return accepted();
  }

  // 4b. Per-shop ceiling.
  if (!hit(`signup:shop:${shop}`, SHOP_LIMIT, SHOP_WINDOW_MS).allowed) {
    console.error(`[popup-signup] SHOP RATE LIMIT hit for ${shop} — possible abuse`);
    return accepted();
  }

  // Check suppression list — silently accept so we don't leak suppression state
  const suppressed = await prisma.emailSuppression.findUnique({
    where: { shop_email: { shop, email } },
  });
  if (suppressed) return accepted();

  // Find or create the signup record
  let signup = await prisma.popupSignup.findFirst({ where: { shop, email } });

  // Already confirmed — idempotent, don't re-send
  if (signup?.confirmedAt) {
    return new Response(JSON.stringify({ ok: true, message: "already_confirmed" }), {
      status: 200,
      headers: CORS,
    });
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

  // 3. Per-address cooldown. Recording the signup above is cheap and harmless;
  // it is the EMAIL that must be throttled, so the gate sits here rather than
  // earlier. A shopper retrying because the first mail hasn't arrived sees the
  // same "check your inbox" response either way.
  if (!hit(`signup:email:${shop}:${email}`, 1, RESEND_COOLDOWN_MS).allowed) {
    console.warn(`[popup-signup] confirmation suppressed — cooldown active shop=${shop}`);
    return accepted();
  }

  // Mirror the touchpoint to the unified Contact record. Fire-and-forget so
  // the popup response isn't held up by a Contacts table write.
  upsertContact({
    shop,
    email,
    source: "popup",
    revive: true,
    ...(phone ? { phone } : {}),
  }).catch((err) => console.error("[popup-signup] upsertContact failed:", err.message));

  // WhatsApp opt-in. The ticked checkbox IS the consent record Meta requires,
  // so it is stored confirmed — this is the caller recordOptIn never had, and
  // the reason the channel could not acquire a single subscriber.
  if (phone && waConsent) {
    recordOptIn({
      shop,
      phoneNumber: phone,
      contactEmail: email,
      optInMethod: "popup",
      confirmed: true,
    }).catch((err) => console.error("[popup-signup] recordOptIn failed:", err.message));
  }

  const shopSettings = await prisma.shopSettings.findUnique({ where: { shop } });

  // eslint-disable-next-line no-undef
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

  // Fire-and-forget — don't block the popup response.
  //
  // The shop-health gate rides inside this chain rather than in front of the
  // response for the same reason: it costs a Shopify round trip on a cache
  // miss, and the shopper should not wait on it. The signup is already
  // recorded above; it is only the EMAIL a dead shop must not send.
  //
  // UNKNOWN is allowed through, unlike in the workers: a queued job can wait
  // for a definite answer, a shopper expecting "check your inbox" cannot, so a
  // transient Shopify blip must not silently break double opt-in.
  checkShopHealth(shop)
    .then((health) => {
      if (health === SHOP_CLOSED || health === SHOP_UNINSTALLED) {
        console.warn(`[popup-signup] confirmation suppressed — ${shop} is ${health}`);
        return null;
      }
      return sendEmail(
        {
          to: email,
          from,
          replyTo,
          subject: `Confirm your email for ${storeName}`,
          html,
          // Double opt-in confirmation is transactional: no List-Unsubscribe, since
          // the recipient has not yet been subscribed to anything.
          idempotencyKey: `confirm:${signup.id}:${Math.floor(Date.now() / RESEND_COOLDOWN_MS)}`,
        },
        { shop, settings: shopSettings },
      ).then(async (result) => {
        // The adapters RETURN provider errors, they don't throw — so the .catch
        // below never sees them. Without this branch a rejected send (a bad
        // reply_to, a revoked key, an unverified domain) is invisible in both
        // our logs and the provider dashboard, since the provider never
        // accepted the message and has nothing to show.
        if (result && !result.ok) {
          console.error(
            `[popup-signup] confirmation REJECTED by provider shop=${shop} from="${from}" replyTo="${replyTo}": ${result.error}`,
          );
          return result;
        }
        // Store the provider message id so the open/click webhook has something
        // to match on. Without it these events arrive, find no JourneyJob, and
        // are discarded — which is how 92 real engagement events were lost.
        if (result?.providerMessageId) {
          await prisma.popupSignup
            .update({
              where: { id: signup.id },
              data: { confirmMessageId: result.providerMessageId },
            })
            .catch((err) =>
              console.error("[popup-signup] could not store confirm message id:", err.message),
            );
        }
        return result;
      });
    })
    .catch((err) => console.error("[popup-signup] confirmation email failed:", err.message));

  // The email signup succeeded either way; whatsappError says only that the
  // WhatsApp opt-in was not recorded, so the popup can say so rather than
  // letting the shopper believe they subscribed to a channel they didn't.
  return accepted(phoneRejected ? { whatsappError: phoneCheck.error } : undefined);
}
