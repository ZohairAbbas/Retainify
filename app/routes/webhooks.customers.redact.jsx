import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";

// Shopify GDPR — delete all customer PII for a given customer.
//
// Cascades handled by the schema:
//   JourneyEnrollment.delete → JourneyJob, PushJob (onDelete: Cascade)
// PushSubscription has no FK, so it's deleted explicitly.
export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  const customerEmail = payload.customer?.email;
  if (!customerEmail) return new Response(null, { status: 200 });

  await Promise.all([
    prisma.abandonedCart.deleteMany({ where: { shop, customerEmail } }),
    prisma.emailSuppression.deleteMany({ where: { shop, email: customerEmail } }),
    prisma.popupSignup.deleteMany({ where: { shop, email: customerEmail } }),
    prisma.journeyEnrollment.deleteMany({ where: { shop, contactEmail: customerEmail } }),
    prisma.pushSubscription.deleteMany({ where: { shop, contactEmail: customerEmail } }),
  ]);

  return new Response(null, { status: 200 });
};
