import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { enrollInAllFlows } from "../lib/journey/journey-queue.server.js";
import { upsertContact } from "../lib/contacts/contacts.server.js";
import { recalcContactCartStats } from "../lib/contacts/carts.server.js";
import { phoneToE164 } from "../lib/phone/e164.js";
import { getShopCountry } from "../lib/growzar/shop-facts.server.js";

/**
 * Numeric Shopify id as a string (API-CONTRACT §3), from either a number or a
 * GID. Null when there is none — a custom line item has no variant.
 */
export function shopifyNumericId(value) {
  if (value == null || value === "") return null;
  const m = /(\d+)$/.exec(String(value));
  return m ? m[1] : null;
}

/**
 * The checkout's currency, or null — never a default: an unknown currency is
 * stored as unknown, not as dollars.
 *
 * `currency` first, as this handler always read it, and `presentment_currency`
 * only when that is missing. Which of the two total_price is denominated in on
 * a multi-currency (Markets) shop is not settled here; see the Phase 5 report.
 */
export function checkoutCurrency(payload) {
  const c = payload?.currency || payload?.presentment_currency || null;
  return typeof c === "string" && /^[A-Z]{3}$/.test(c) ? c : null;
}

/** Line items as stored in AbandonedCart.lineItemsJson. */
export function checkoutLines(payload) {
  return (payload?.line_items || []).map((item) => ({
    title: item.title,
    variantTitle: item.variant_title || "",
    quantity: item.quantity,
    price: item.price,
    imageUrl: item.image_url || "",
    productUrl: "",
    // Join keys for Growzar (numeric strings, never GIDs). Rows written before
    // these were stored have neither, and are left that way.
    variantId: shopifyNumericId(item.variant_id),
    productId: shopifyNumericId(item.product_id),
  }));
}

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  // A checkout with neither an email nor a phone identifies nobody.
  //
  // One with only a phone is stored, so Growzar can join it to the buyer by
  // phone — common on COD stores — but nothing else acts on it: contact
  // creation, the cart rollups and flow enrollment below all still need an
  // email, exactly as before.
  // Stored as Shopify sent it, as it always was: cart-recovery exit criteria
  // match enrollments by this exact string.
  const email = payload.email || "";

  const checkoutToken = payload.token;
  const checkoutId = String(payload.id);
  const cartToken = payload.cart_token || "";
  const recoveryUrl = payload.abandoned_checkout_url || "";
  const totalPrice = parseFloat(payload.total_price || "0");
  const currency = checkoutCurrency(payload);
  const customerName =
    payload.billing_address?.name ||
    `${payload.billing_address?.first_name || ""} ${payload.billing_address?.last_name || ""}`.trim() ||
    "";
  // Phone for the WhatsApp channel — checkouts carry it on the checkout itself
  // or the billing/shipping address.
  const phone =
    payload.phone ||
    payload.billing_address?.phone ||
    payload.shipping_address?.phone ||
    "";
  if (!email && !phone) return new Response(null, { status: 200 });
  const phoneE164 = phone ? phoneToE164(phone, await getShopCountry(shop)) : null;

  const lineItems = checkoutLines(payload);

  if (topic === "CHECKOUTS_CREATE") {
    // Create or update abandoned cart record — don't schedule jobs yet (too early)
    await prisma.abandonedCart.upsert({
      where: { shop_checkoutToken: { shop, checkoutToken } },
      create: {
        shop,
        checkoutToken,
        checkoutId,
        cartToken,
        customerEmail: email,
        customerName,
        phone: phone || null,
        phoneE164,
        totalPrice,
        currency,
        lineItemsJson: JSON.stringify(lineItems),
        recoveryUrl,
      },
      update: {
        totalPrice,
        // Only when the payload carries one: an update without a currency
        // must not erase the one we already have.
        ...(currency ? { currency } : {}),
        lineItemsJson: JSON.stringify(lineItems),
        recoveryUrl,
        customerName,
        // A buyer who adds an email or phone later in checkout fills the gap;
        // one already stored is never cleared by an update that lacks it.
        ...(email ? { customerEmail: email } : {}),
        ...(phone ? { phone, phoneE164 } : {}),
      },
    });
    if (!email) return new Response(null, { status: 200 });
    await upsertContact({
      shop,
      email,
      name: customerName,
      phone: phone || undefined,
      source: "cart_abandoned",
    }).catch((err) =>
      console.error("[webhook] upsertContact (checkout_create) failed:", err.message),
    );
    await recalcContactCartStats(shop, email).catch((err) =>
      console.error("[webhook] cart rollup (checkout_create) failed:", err.message),
    );
  }

  if (topic === "CHECKOUTS_UPDATE") {
    // Only schedule jobs once we confirm the checkout hasn't been completed
    // (Shopify still fires updates on completed checkouts — skip those)
    if (payload.completed_at) return new Response(null, { status: 200 });

    const cart = await prisma.abandonedCart.upsert({
      where: { shop_checkoutToken: { shop, checkoutToken } },
      create: {
        shop,
        checkoutToken,
        checkoutId,
        cartToken,
        customerEmail: email,
        customerName,
        phone: phone || null,
        phoneE164,
        totalPrice,
        currency,
        lineItemsJson: JSON.stringify(lineItems),
        recoveryUrl,
      },
      update: {
        totalPrice,
        // Only when the payload carries one: an update without a currency
        // must not erase the one we already have.
        ...(currency ? { currency } : {}),
        lineItemsJson: JSON.stringify(lineItems),
        recoveryUrl,
        customerName,
        // A buyer who adds an email or phone later in checkout fills the gap;
        // one already stored is never cleared by an update that lacks it.
        ...(email ? { customerEmail: email } : {}),
        ...(phone ? { phone, phoneE164 } : {}),
      },
    });
    // Phone-only checkout: stored above for the feed, and that is all.
    if (!email) return new Response(null, { status: 200 });
    await upsertContact({
      shop,
      email,
      name: customerName,
      phone: phone || undefined,
      source: "cart_abandoned",
    }).catch((err) =>
      console.error("[webhook] upsertContact (checkout_update) failed:", err.message),
    );
    // Before the enrollment below, not after: a cart_abandoned flow's entry
    // filters are evaluated at the moment of enrollment, so a rule on "last cart
    // value" or "abandoned cart count" has to be reading this cart, not the one
    // before it.
    await recalcContactCartStats(shop, email).catch((err) =>
      console.error("[webhook] cart rollup (checkout_update) failed:", err.message),
    );

    // Enroll in any published cart_abandoned journey, gated on the shop being
    // active and the cart not already recovered.
    if (!cart.recoveredAt) {
      const settings = await prisma.shopSettings.findUnique({ where: { shop } });
      if (settings?.isActive) {
        await enrollInAllFlows(shop, "cart_abandoned", email, customerName, {
          cartId: cart.id,
          checkoutToken,
          recoveryUrl,
          totalPrice: String(totalPrice || ""),
          currency,
          lineItems,
        }).catch((err) => console.error("[webhook] cart_abandoned enroll failed:", err.message));
      }
    }
  }

  return new Response(null, { status: 200 });
};
