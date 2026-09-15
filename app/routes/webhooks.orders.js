import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { enrollContact } from "../lib/journey/journey-queue.server.js";
import { evaluateExitCriteria } from "../lib/journey/exit-criteria.server.js";
import { recordOrder } from "../lib/orders/orders.server.js";

export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  const checkoutToken = payload.checkout_token;
  const customerEmail = payload.email || payload.contact_email;
  const phone =
    payload.phone ||
    payload.customer?.phone ||
    payload.billing_address?.phone ||
    payload.shipping_address?.phone ||
    "";

  // Persist the order and refresh the buyer's purchase aggregates. This also
  // upserts the Contact (carrying the phone through for the WhatsApp channel),
  // which is what the previous inline upsert did on its own.
  //
  // Idempotent: orders/create and orders/paid both fire for the same order, and
  // Shopify retries, so this runs more than once per order by design.
  if (customerEmail) {
    await recordOrder(shop, { ...payload, phone: payload.phone || phone }).catch((err) =>
      console.error("[webhook] recordOrder failed:", err.message),
    );
  }

  // Mark abandoned cart recovered if this order matches one. Pending journey
  // jobs are cancelled via evaluateExitCriteria below (cart_recovered event).
  if (checkoutToken) {
    const cart = await prisma.abandonedCart.findUnique({
      where: { shop_checkoutToken: { shop, checkoutToken } },
    });
    if (cart) {
      const orderTotal = parseFloat(payload.total_price || "0");
      await prisma.abandonedCart.update({
        where: { id: cart.id },
        data: { recoveredAt: new Date(), recoveredRevenue: orderTotal },
      });
      if (cart.customerEmail) {
        await evaluateExitCriteria(shop, cart.customerEmail, "cart_recovered").catch((err) =>
          console.error("[webhook] exit-criteria cart_recovered failed:", err.message),
        );
      }
    }
  }

  // Fire exit-criteria for active enrollments (win-back, welcome, etc.)
  if (customerEmail) {
    await evaluateExitCriteria(shop, customerEmail, "order_placed").catch((err) =>
      console.error("[webhook] exit-criteria order_placed failed:", err.message),
    );
  }

  // Enroll in post-purchase journey
  if (customerEmail) {
    const journey = await prisma.journey.findFirst({
      where: { shop, trigger: "order_placed", status: "published" },
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
