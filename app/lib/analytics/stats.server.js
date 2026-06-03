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
 *
 * Recovery attribution rule: an AbandonedCart only counts as recovered when
 * at least one rescue email actually shipped for that contact between the
 * cart's abandonedAt and its recoveredAt. Without this filter every completed
 * checkout looks like a recovery, because AbandonedCart rows are created the
 * moment a customer enters their email at checkout — long before any rescue
 * was attempted. Same time-bracket protects against over-attribution from a
 * stale enrollment on a prior cart.
 *
 * The "abandoned" denominator follows the same principle: we only count
 * enrollments where a rescue email actually shipped, so fast-completing
 * checkouts (enrolled at email-entry, completed seconds later before any
 * delay elapsed) don't pollute the rate.
 */
export async function getCartRescueStats(shop, days = 30) {
  const since = sinceDate(days);
  const journeyIds = await cartAbandonedJourneyIds(shop);
  const hasJourneys = journeyIds.length > 0;

  const stepFilter = { step: { journeyId: { in: journeyIds } } };

  const [sent, opened, clicked, abandoned, recoveredRows, pendingJobs, signups, suppressions] = await Promise.all([
    hasJourneys
      ? prisma.journeyJob.count({ where: { ...stepFilter, sentAt: { gte: since, not: null } } })
      : 0,
    hasJourneys
      ? prisma.journeyJob.count({ where: { ...stepFilter, openedAt: { gte: since, not: null } } })
      : 0,
    hasJourneys
      ? prisma.journeyJob.count({ where: { ...stepFilter, clickedAt: { gte: since, not: null } } })
      : 0,
    // Denominator: enrollments where a rescue email landed AT LEAST 1 HOUR
    // AFTER the customer abandoned. That threshold excludes "noise"
    // enrollments — customers who entered their email at checkout, got a
    // rescue email fired within seconds by the worker (because the step's
    // delayHours was 0), and completed their order anyway. A genuine
    // abandonment is one where the customer was gone long enough for the
    // email to plausibly have a role.
    //
    // Symmetric with the numerator below: both sides require the same
    // "real rescue attempt" definition, so the rate is interpretable.
    hasJourneys
      ? prisma.$queryRaw`
          SELECT COUNT(*)::int AS count
          FROM "JourneyEnrollment" e
          WHERE e.shop = ${shop}
            AND e."journeyId" = ANY(${journeyIds})
            AND e."enrolledAt" >= ${since}
            AND EXISTS (
              SELECT 1 FROM "JourneyJob" j
              WHERE j."enrollmentId" = e.id
                AND j."sentAt" IS NOT NULL
                AND j."sentAt" > e."enrolledAt" + INTERVAL '1 hour'
            )
        `
      : [{ count: 0 }],
    // Numerator: AbandonedCart rows recovered in the window, but ONLY when a
    // rescue email shipped at least 1 hour after the customer abandoned AND
    // before they recovered. The 1-hour gap is what makes the attribution
    // meaningful: anything shorter means the email landed while the customer
    // was still in their checkout session and the recovery would have
    // happened regardless.
    //
    // Raw SQL because Prisma can't express the cross-row time-bracket
    // condition cleanly.
    hasJourneys
      ? prisma.$queryRaw`
          SELECT c."recoveredRevenue"
          FROM "AbandonedCart" c
          WHERE c.shop = ${shop}
            AND c."recoveredAt" >= ${since}
            AND c."recoveredRevenue" IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM "JourneyJob" j
              JOIN "JourneyEnrollment" e ON e.id = j."enrollmentId"
              WHERE e.shop = c.shop
                AND e."contactEmail" = c."customerEmail"
                AND j."sentAt" IS NOT NULL
                AND j."sentAt" > c."abandonedAt" + INTERVAL '1 hour'
                AND j."sentAt" < c."recoveredAt"
            )
        `
      : [],
    hasJourneys
      ? prisma.journeyJob.count({ where: { ...stepFilter, status: { in: ["pending", "processing"] } } })
      : 0,
    prisma.popupSignup.count({ where: { shop, confirmedAt: { not: null } } }),
    prisma.emailSuppression.count({ where: { shop } }),
  ]);

  const recoveredCount = recoveredRows.length;
  const recoveredRevenue = recoveredRows.reduce((sum, r) => sum + (r.recoveredRevenue ?? 0), 0);
  // Denominator comes back as [{ count: N }] from raw SQL.
  const abandonedCount = Array.isArray(abandoned) ? Number(abandoned[0]?.count ?? 0) : Number(abandoned || 0);

  return {
    sent,
    opened,
    clicked,
    recoveredCount,
    recoveredRevenue,
    abandoned: abandonedCount,
    pendingJobs,
    signups,
    suppressions,
    openRate: sent > 0 ? (opened / sent) * 100 : 0,
    clickRate: sent > 0 ? (clicked / sent) * 100 : 0,
    recoveryRate: abandonedCount > 0 ? (recoveredCount / abandonedCount) * 100 : 0,
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
