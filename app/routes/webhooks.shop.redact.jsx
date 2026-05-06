import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";

// Shopify GDPR — delete all data for a shop after uninstall + 48h.
export const action = async ({ request }) => {
  const { shop } = await authenticate.webhook(request);

  await Promise.all([
    prisma.abandonedCart.deleteMany({ where: { shop } }),
    prisma.cartRescueEmail.deleteMany({ where: { shop } }),
    prisma.emailJob.deleteMany({ where: { shop } }),
    prisma.emailSuppression.deleteMany({ where: { shop } }),
    prisma.popupSignup.deleteMany({ where: { shop } }),
    prisma.shopSettings.deleteMany({ where: { shop } }),
    prisma.journeySettings.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);

  return new Response(null, { status: 200 });
};
