import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";

// Shopify GDPR — delete all data for a shop after uninstall + 48h.
//
// Cascades handled by the schema:
//   Journey.delete → JourneyStep, JourneyEnrollment (onDelete: Cascade)
//   JourneyStep.delete → JourneyJob, PushJob
//   JourneyEnrollment.delete → JourneyJob, PushJob
// So a single Journey.deleteMany takes out the entire journey graph.
// PushSubscription has no FK relation, so it's deleted explicitly.
export const action = async ({ request }) => {
  const { shop } = await authenticate.webhook(request);

  await Promise.all([
    prisma.abandonedCart.deleteMany({ where: { shop } }),
    prisma.emailSuppression.deleteMany({ where: { shop } }),
    prisma.popupSignup.deleteMany({ where: { shop } }),
    prisma.popupSettings.deleteMany({ where: { shop } }),
    prisma.journey.deleteMany({ where: { shop } }),
    prisma.pushSubscription.deleteMany({ where: { shop } }),
    prisma.shopSettings.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);

  return new Response(null, { status: 200 });
};
