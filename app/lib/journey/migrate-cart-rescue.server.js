/**
 * One-time migration: legacy Cart Rescue (JourneySettings + AbandonedCart + EmailJob)
 *   → unified Flows engine (Journey + JourneyEnrollment + JourneyJob).
 *
 * Idempotent: tracked via Journey.source="cart_rescue_legacy" sentinel per shop.
 * Safe to re-run; already-migrated EmailJobs (status="migrated") are skipped.
 *
 * Trigger via:
 *   import { migrateCartRescueForAllShops } from "./migrate-cart-rescue.server.js";
 *   await migrateCartRescueForAllShops();
 */
import prisma from "../../db.server.js";

const CART_ABANDONED = "cart_abandoned";

export async function migrateCartRescueForAllShops() {
  const shops = await prisma.journeySettings.findMany({ select: { shop: true } });
  const results = [];
  for (const { shop } of shops) {
    results.push(await migrateCartRescueForShop(shop));
  }
  return results;
}

export async function migrateCartRescueForShop(shop) {
  const summary = { shop, createdJourney: false, stepCount: 0, migratedJobs: 0, skippedJobs: 0 };

  const settings = await prisma.journeySettings.findUnique({ where: { shop } });
  if (!settings) return summary;

  // 1. Ensure the legacy-source Journey exists (idempotent sentinel)
  let journey = await prisma.journey.findFirst({
    where: { shop, trigger: CART_ABANDONED, source: "cart_rescue_legacy" },
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });

  if (!journey) {
    journey = await prisma.journey.create({
      data: {
        shop,
        name: "Cart Rescue",
        trigger: CART_ABANDONED,
        source: "cart_rescue_legacy",
        status: settings.isActive ? "published" : "draft",
        publishedAt: settings.isActive ? new Date() : null,
        publishedVersion: settings.isActive ? 1 : 0,
        isActive: settings.isActive,
        entryFrequency: "no_reentry",
        exitCriteria: JSON.stringify(["order_placed"]),
      },
      include: { steps: true },
    });
    summary.createdJourney = true;
  }

  // 2. Recreate steps from JourneySettings if missing
  if (journey.steps.length === 0) {
    const stepDefs = [
      {
        stepNumber: 1,
        delayHours: settings.email1DelayHours,
        subject: settings.email1Subject,
        isEnabled: settings.email1Enabled,
        discountPct: 0,
      },
      {
        stepNumber: 2,
        delayHours: settings.email2DelayHours,
        subject: settings.email2Subject,
        isEnabled: settings.email2Enabled,
        discountPct: 0,
      },
      {
        stepNumber: 3,
        delayHours: settings.email3DelayHours,
        subject: settings.email3Subject,
        isEnabled: settings.email3Enabled,
        discountPct: settings.email3DiscountPct,
      },
    ];

    await prisma.journeyStep.createMany({
      data: stepDefs.map((s, idx) => ({
        journeyId: journey.id,
        stepNumber: s.stepNumber,
        positionY: idx,
        nodeType: "email",
        delayHours: s.delayHours,
        subject: s.subject,
        templateStyle: settings.templateStyle,
        discountPct: s.discountPct,
        isEnabled: s.isEnabled,
      })),
    });
    summary.stepCount = stepDefs.length;
  }

  // Reload journey with steps for the in-flight job mapping
  journey = await prisma.journey.findUnique({
    where: { id: journey.id },
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });
  const stepByNumber = new Map(journey.steps.map((s) => [s.stepNumber, s]));

  // 3. Migrate in-flight EmailJobs (pending only) to JourneyJobs
  const pendingJobs = await prisma.emailJob.findMany({
    where: { shop, status: "pending" },
    include: { abandonedCart: true },
  });

  for (const oldJob of pendingJobs) {
    const cart = oldJob.abandonedCart;
    if (!cart) {
      summary.skippedJobs++;
      continue;
    }
    const step = stepByNumber.get(oldJob.emailNumber);
    if (!step) {
      summary.skippedJobs++;
      continue;
    }

    // Find or create enrollment for this customer+cart in the legacy journey
    let enrollment = await prisma.journeyEnrollment.findFirst({
      where: { journeyId: journey.id, contactEmail: cart.customerEmail, shop, exitReason: "" },
    });

    if (!enrollment) {
      enrollment = await prisma.journeyEnrollment.create({
        data: {
          shop,
          journeyId: journey.id,
          contactEmail: cart.customerEmail,
          contactName: cart.customerName,
          payload: JSON.stringify({
            lineItems: safeJson(cart.lineItemsJson, []),
            totalPrice: cart.totalPrice,
            currency: cart.currency,
            recoveryUrl: cart.recoveryUrl,
            legacyCartId: cart.id,
          }),
          enrolledAt: cart.abandonedAt,
        },
      });
    }

    // Don't double-schedule if an equivalent JourneyJob already exists for this enrollment+step
    const existing = await prisma.journeyJob.findFirst({
      where: { enrollmentId: enrollment.id, stepId: step.id },
    });

    if (!existing) {
      await prisma.journeyJob.create({
        data: {
          shop,
          enrollmentId: enrollment.id,
          stepId: step.id,
          scheduledFor: oldJob.scheduledFor,
          status: "pending",
        },
      });
    }

    // Mark legacy job migrated so legacy worker skips it
    await prisma.emailJob.update({
      where: { id: oldJob.id },
      data: { status: "migrated" },
    });
    summary.migratedJobs++;
  }

  return summary;
}

function safeJson(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
