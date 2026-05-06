import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { cancelCartJobs } from "../lib/journey/queue.server.js";

export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  const checkoutToken = payload.checkout_token;
  if (!checkoutToken) return new Response(null, { status: 200 });

  const cart = await prisma.abandonedCart.findUnique({
    where: { shop_checkoutToken: { shop, checkoutToken } },
  });
  if (!cart) return new Response(null, { status: 200 });

  const orderTotal = parseFloat(payload.total_price || "0");

  // Mark as recovered and cancel remaining queued emails
  await Promise.all([
    prisma.abandonedCart.update({
      where: { id: cart.id },
      data: {
        recoveredAt: new Date(),
        recoveredRevenue: orderTotal,
      },
    }),
    cancelCartJobs(shop, cart.id),
  ]);

  return new Response(null, { status: 200 });
};
