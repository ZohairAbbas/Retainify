import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";

// Shopify GDPR — delete all customer PII for a given customer.
export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  const customerEmail = payload.customer?.email;
  if (!customerEmail) return new Response(null, { status: 200 });

  await Promise.all([
    prisma.abandonedCart.deleteMany({ where: { shop, customerEmail } }),
    prisma.emailSuppression.deleteMany({ where: { shop, email: customerEmail } }),
    prisma.popupSignup.deleteMany({ where: { shop, email: customerEmail } }),
    prisma.cartRescueEmail.deleteMany({ where: { shop, to: customerEmail } }),
  ]);

  return new Response(null, { status: 200 });
};
