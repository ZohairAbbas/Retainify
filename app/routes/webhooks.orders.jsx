import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { cancelCartJobs } from "../lib/journey/queue.server.js";
import { enrollContact } from "../lib/journey/journey-queue.server.js";

export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  const checkoutToken = payload.checkout_token;
  const customerEmail = payload.email || payload.contact_email;

  // Cancel cart rescue emails if this order recovers an abandoned cart
  if (checkoutToken) {
    const cart = await prisma.abandonedCart.findUnique({
      where: { shop_checkoutToken: { shop, checkoutToken } },
    });
    if (cart) {
      const orderTotal = parseFloat(payload.total_price || "0");
      await Promise.all([
        prisma.abandonedCart.update({
          where: { id: cart.id },
          data: { recoveredAt: new Date(), recoveredRevenue: orderTotal },
        }),
        cancelCartJobs(shop, cart.id),
      ]);
    }
  }

  // Enroll in post-purchase journey
  if (customerEmail) {
    const journey = await prisma.journey.findFirst({
      where: { shop, trigger: "order_placed", isActive: true },
    });
    if (journey) {
      const firstName = payload.customer?.first_name || "";
      const lastName = payload.customer?.last_name || "";
      const name = [firstName, lastName].filter(Boolean).join(" ");
      await enrollContact(journey.id, customerEmail, name, {
        orderId: String(payload.id || ""),
        totalPrice: payload.total_price || "",
        currency: payload.currency || "USD",
      }).catch((err) => console.error("[webhook] post-purchase enroll failed:", err.message));
    }
  }

  return new Response(null, { status: 200 });
};
