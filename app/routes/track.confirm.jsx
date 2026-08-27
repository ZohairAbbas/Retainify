import prisma from "../db.server.js";
import { verifyConfirmToken } from "../lib/email/confirm.server.js";
import { createDiscountCode } from "../lib/shopify/discounts.server.js";
import { syncConfirmedSubscriber } from "../lib/shopify/customers.server.js";
import { sendEmail, resolveFrom, resolveProvider } from "../lib/email/index.server.js";
import { renderDiscountRevealEmail } from "../lib/email/templates.server.js";
import { upsertContact } from "../lib/contacts/contacts.server.js";
import { checkShopHealth, SHOP_CLOSED, SHOP_UNINSTALLED } from "../lib/shopify/shop-health.server.js";

function html(title, body) {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  text-align:center;padding:80px 20px;background:#f9f9f9;color:#1a1a1a;}
  .card{max-width:440px;margin:0 auto;background:#fff;border-radius:12px;
  padding:40px 32px;box-shadow:0 2px 12px rgba(0,0,0,.08);}
  h1{margin:0 0 12px;font-size:24px;}
  p{margin:0;font-size:15px;color:#555;line-height:1.6;}
  .code{font-size:28px;font-weight:800;letter-spacing:3px;font-family:monospace;
  margin:20px 0 8px;}
  .sub{font-size:12px;color:#999;}
</style></head>
<body><div class="card">${body}</div></body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}

// Public route — GET from confirmation email link.
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  const email = url.searchParams.get("email") || "";
  const token = url.searchParams.get("token") || "";

  if (!shop || !email || !token) {
    return html("Invalid link", "<h1>Invalid link</h1><p>This confirmation link is missing required parameters.</p>");
  }

  if (!verifyConfirmToken(shop, email, token)) {
    return html("Invalid link", "<h1>Invalid link</h1><p>This confirmation link is invalid or has already been used.</p>");
  }

  const signup = await prisma.popupSignup.findFirst({ where: { shop, email } });
  if (!signup) {
    return html("Not found", "<h1>Not found</h1><p>No signup found for this email address.</p>");
  }

  // Already confirmed — idempotent
  if (signup.confirmedAt) {
    return html(
      "Already confirmed",
      `<h1>Already confirmed ✓</h1><p>Your email has already been confirmed.</p>${signup.discountCode ? `<div class="code">${signup.discountCode}</div><p class="sub">Use this code at checkout.</p>` : ""}`,
    );
  }

  // The link in a shopper's inbox keeps working long after a store closes, so
  // this route can fire for a shop the workers have already stopped sending
  // for. A dead shop gets no discount (Shopify would refuse to mint one anyway)
  // and no email.
  //
  // UNKNOWN counts as reachable here, unlike in the workers: a shopper is
  // waiting on this page right now, and a transient Shopify blip is not a
  // reason to break double opt-in for a live store.
  const health = await checkShopHealth(shop);
  const shopIsGone = health === SHOP_CLOSED || health === SHOP_UNINSTALLED;
  if (shopIsGone) {
    console.warn(`[confirm] ${shop} is ${health} — confirming consent only, no discount or email`);
  }

  // Generate discount code
  let discountCode = "";
  const popupSettings = await prisma.popupSettings.findUnique({ where: { shop } });
  const configDiscount = popupSettings?.config?.discount;
  const discountPct = Number.isFinite(configDiscount) ? configDiscount : (popupSettings?.discountPct ?? 10);

  if (!shopIsGone) {
    try {
      discountCode = await createDiscountCode(shop, discountPct);
    } catch (err) {
      console.error("[confirm] discount code generation failed:", err.message);
      // Confirm the email even if discount creation fails
    }
  }

  // Persist confirmation
  const confirmedAt = new Date();
  await prisma.popupSignup.update({
    where: { id: signup.id },
    data: { confirmedAt, discountCode },
  });

  // Mirror to the unified Contact record. Confirmation upgrades to subscribed
  // and stamps marketingConsentAt — upsertContact's guard prevents this from
  // downgrading a later suppression.
  upsertContact({
    shop,
    email,
    source: "popup",
    subscriptionStatus: "subscribed",
    marketingConsentAt: confirmedAt,
    revive: true,
  }).catch((err) =>
    console.error("[confirm] upsertContact failed:", err.message),
  );

  // Push subscriber to Shopify with CONFIRMED_OPT_IN marketing consent (fire-and-forget)
  syncConfirmedSubscriber(shop, email, confirmedAt).catch((err) =>
    console.error("[confirm] shopify customer sync failed:", err.message),
  );

  // Send discount reveal email (fire-and-forget). Guarded on shop health as
  // well as on the code itself — the two are linked today, but a future edit
  // that sends something here regardless of discount must not reopen this hole.
  if (discountCode && !shopIsGone) {
    sendDiscountEmail(shop, email, discountCode, discountPct).catch((err) =>
      console.error("[confirm] discount reveal email failed:", err.message),
    );
  }

  return html(
    "Email confirmed!",
    discountCode
      ? `<h1>You're confirmed! 🎉</h1>
         <p>Here's your exclusive discount code:</p>
         <div class="code">${discountCode}</div>
         <p class="sub">Valid for 48 hours &middot; Single use &middot; Apply at checkout</p>`
      : `<h1>You're confirmed! 🎉</h1><p>Your email has been confirmed. Happy shopping!</p>`,
  );
};

async function sendDiscountEmail(shop, email, discountCode, discountPct) {
  const shopSettings = await prisma.shopSettings.findUnique({ where: { shop } });
  const popupSettings = await prisma.popupSettings.findUnique({ where: { shop } });

  const storeName = shopSettings?.senderName || shop;
  const brandColor = shopSettings?.brandColor || popupSettings?.brandColor || "#000000";
  const logoUrl = shopSettings?.logoUrl || popupSettings?.logoUrl || "";

  const htmlContent = renderDiscountRevealEmail({ storeName, logoUrl, brandColor, discountCode, discountPct });

  const provider = resolveProvider(shopSettings);
  const { from, replyTo } = resolveFrom({ settings: shopSettings, provider });

  const result = await sendEmail(
    {
      to: email,
      from,
      replyTo,
      subject: `Your ${discountPct}% discount code from ${storeName}`,
      html: htmlContent,
    },
    { shop, settings: shopSettings },
  );

  // Same trap as the confirmation send: the adapters return provider errors
  // rather than throwing, so an unchecked result means a shopper who confirmed
  // never gets their discount code and nothing anywhere records why.
  if (!result.ok) {
    console.error(
      `[track.confirm] discount email REJECTED by provider shop=${shop} from="${from}" replyTo="${replyTo}": ${result.error}`,
    );
  }
}
