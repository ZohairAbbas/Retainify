import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { enrollContact } from "../lib/journey/journey-queue.server.js";
import { upsertContact } from "../lib/contacts/contacts.server.js";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  // Only process checkouts that have an email — anonymous carts can't be rescued
  const email = payload.email;
  if (!email) return new Response(null, { status: 200 });

  const checkoutToken = payload.token;
  const checkoutId = String(payload.id);
  const cartToken = payload.cart_token || "";
  const recoveryUrl = payload.abandoned_checkout_url || "";
  const totalPrice = parseFloat(payload.total_price || "0");
  const currency = payload.currency || "USD";
  const customerName =
    payload.billing_address?.name ||
    `${payload.billing_address?.first_name || ""} ${payload.billing_address?.last_name || ""}`.trim() ||
    "";

  const lineItems = (payload.line_items || []).map((item) => ({
    title: item.title,
    variantTitle: item.variant_title || "",
    quantity: item.quantity,
    price: item.price,
    imageUrl: item.image_url || "",
    productUrl: "",
  }));

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
        totalPrice,
        currency,
        lineItemsJson: JSON.stringify(lineItems),
        recoveryUrl,
      },
      update: {
        totalPrice,
        lineItemsJson: JSON.stringify(lineItems),
        recoveryUrl,
        customerName,
      },
    });
    await upsertContact({
      shop,
      email,
      name: customerName,
      source: "cart_abandoned",
    }).catch((err) =>
      console.error("[webhook] upsertContact (checkout_create) failed:", err.message),
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
        totalPrice,
        currency,
        lineItemsJson: JSON.stringify(lineItems),
        recoveryUrl,
      },
      update: {
        totalPrice,
        lineItemsJson: JSON.stringify(lineItems),
        recoveryUrl,
        customerName,
      },
    });
    await upsertContact({
      shop,
      email,
      name: customerName,
      source: "cart_abandoned",
    }).catch((err) =>
      console.error("[webhook] upsertContact (checkout_update) failed:", err.message),
    );

    // Enroll in any published cart_abandoned journey, gated on the shop being
    // active and the cart not already recovered.
    if (!cart.recoveredAt) {
      const settings = await prisma.shopSettings.findUnique({ where: { shop } });
      if (settings?.isActive) {
        const journey = await prisma.journey.findFirst({
          where: { shop, trigger: "cart_abandoned", status: "published" },
        });
        if (journey) {
          await enrollContact(journey.id, email, customerName, {
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
  }

  return new Response(null, { status: 200 });
};
