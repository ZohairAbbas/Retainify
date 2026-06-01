/**
 * Analytics query helpers for the dashboard.
 *
 * Scoped to cart_abandoned journeys to preserve the dashboard's current
 * "Cart Rescue performance" framing. Widening the scope to all triggers is a
 * UX decision deferred to a follow-up.
 */
import prisma from "../../db.server.js";

function sinceDate(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function cartAbandonedJourneyIds(shop) {
  const journeys = await prisma.journey.findMany({
    where: { shop, trigger: "cart_abandoned", archivedAt: null },
    select: { id: true },
  });
  return journeys.map((j) => j.id);
}

/**
 * Headline stats for the dashboard over the last N days.
 */
export async function getCartRescueStats(shop, days = 30) {
  const since = sinceDate(days);
  const journeyIds = await cartAbandonedJourneyIds(shop);
  const hasJourneys = journeyIds.length > 0;

  const stepFilter = { step: { journeyId: { in: journeyIds } } };

  const [sent, opened, clicked, recovered, abandoned, pendingJobs, signups, suppressions] = await Promise.all([
    hasJourneys
      ? prisma.journeyJob.count({ where: { ...stepFilter, sentAt: { gte: since, not: null } } })
      : 0,
    hasJourneys
      ? prisma.journeyJob.count({ where: { ...stepFilter, openedAt: { gte: since, not: null } } })
      : 0,
    hasJourneys
      ? prisma.journeyJob.count({ where: { ...stepFilter, clickedAt: { gte: since, not: null } } })
      : 0,
    prisma.abandonedCart.findMany({
      where: { shop, recoveredAt: { gte: since }, recoveredRevenue: { not: null } },
      select: { recoveredRevenue: true, recoveredAt: true },
    }),
    prisma.abandonedCart.count({ where: { shop, createdAt: { gte: since } } }),
    hasJourneys
      ? prisma.journeyJob.count({ where: { ...stepFilter, status: { in: ["pending", "processing"] } } })
      : 0,
    prisma.popupSignup.count({ where: { shop, confirmedAt: { not: null } } }),
    prisma.emailSuppression.count({ where: { shop } }),
  ]);

  const recoveredCount = recovered.length;
  const recoveredRevenue = recovered.reduce((sum, r) => sum + (r.recoveredRevenue ?? 0), 0);

  return {
    sent,
    opened,
    clicked,
    recoveredCount,
    recoveredRevenue,
    abandoned,
    pendingJobs,
    signups,
    suppressions,
    openRate: sent > 0 ? (opened / sent) * 100 : 0,
    clickRate: sent > 0 ? (clicked / sent) * 100 : 0,
    recoveryRate: abandoned > 0 ? (recoveredCount / abandoned) * 100 : 0,
  };
}

/**
 * Per-step breakdown for the dashboard's "Email performance" table.
 * Returns one row per email step in any cart_abandoned journey, keyed by step.
 */
export async function getEmailBreakdown(shop, days = 30) {
  const since = sinceDate(days);
  const journeyIds = await cartAbandonedJourneyIds(shop);
  if (journeyIds.length === 0) return [];

  const steps = await prisma.journeyStep.findMany({
    where: {
      journeyId: { in: journeyIds },
      nodeType: "email",
      isArchived: false,
    },
    select: {
      id: true,
      stepNumber: true,
      subject: true,
      emailName: true,
      journey: { select: { name: true } },
    },
    orderBy: [{ journeyId: "asc" }, { stepNumber: "asc" }],
  });

  return Promise.all(
    steps.map(async (step) => {
      const [sent, opened, clicked] = await Promise.all([
        prisma.journeyJob.count({ where: { stepId: step.id, sentAt: { gte: since, not: null } } }),
        prisma.journeyJob.count({ where: { stepId: step.id, openedAt: { gte: since, not: null } } }),
        prisma.journeyJob.count({ where: { stepId: step.id, clickedAt: { gte: since, not: null } } }),
      ]);
      return {
        stepId: step.id,
        stepNumber: step.stepNumber,
        label: step.emailName || step.subject || `Email ${step.stepNumber}`,
        journeyName: step.journey?.name || "",
        sent,
        opened,
        clicked,
      };
    }),
  );
}
