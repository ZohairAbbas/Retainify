/**
 * Dashboard analytics.
 *
 * Scope note: messaging stats cover EVERY flow and every channel. They used to
 * be filtered to `trigger: "cart_abandoned"`, which made the dashboard lie to
 * anyone whose flows were welcome series, post-purchase or segment-triggered —
 * they saw "Emails sent: 0" and an empty performance table while mail was
 * actively going out.
 *
 * Cart-recovery attribution stays cart-scoped, because it genuinely is: it
 * measures recovered checkouts against rescue emails, and no other trigger
 * participates in that funnel.
 */
import prisma from "../../db.server.js";

function sinceDate(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Ids of every live flow for a shop, optionally narrowed to one trigger or to a
 * single campaign (the dashboard's flow selector).
 */
async function journeyIds(shop, { trigger, journeyId } = {}) {
  const journeys = await prisma.journey.findMany({
    where: {
      shop,
      archivedAt: null,
      ...(trigger ? { trigger } : {}),
      ...(journeyId ? { id: journeyId } : {}),
    },
    select: { id: true },
  });
  return journeys.map((j) => j.id);
}

/** Flows for the dashboard's campaign selector, most recently updated first. */
export async function listCampaignChoices(shop) {
  const journeys = await prisma.journey.findMany({
    where: { shop, archivedAt: null },
    select: { id: true, name: true, status: true, trigger: true },
    orderBy: { updatedAt: "desc" },
  });
  return journeys;
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
export async function getCartRescueStats(shop, days = 30, { journeyId = null } = {}) {
  const since = sinceDate(days);

  // `journeyId` scopes the whole card to one campaign, driving the dashboard's
  // flow selector. Null means every live flow.
  const [allJourneyIds, cartJourneyIds] = await Promise.all([
    journeyIds(shop, { journeyId }),
    journeyIds(shop, { trigger: "cart_abandoned", journeyId }),
  ]);

  const hasAny = allJourneyIds.length > 0;
  const hasCartJourneys = cartJourneyIds.length > 0;

  // Messaging counters span every flow and every channel.
  const allSteps = { step: { journeyId: { in: allJourneyIds } } };

  const [
    sent,
    opened,
    clicked,
    pushSent,
    pushClicked,
    whatsappSent,
    pendingJobs,
    abandoned,
    recoveredRows,
    subscribers,
    suppressions,
  ] = await Promise.all([
    hasAny ? prisma.journeyJob.count({ where: { ...allSteps, sentAt: { gte: since, not: null } } }) : 0,
    hasAny ? prisma.journeyJob.count({ where: { ...allSteps, openedAt: { gte: since, not: null } } }) : 0,
    hasAny ? prisma.journeyJob.count({ where: { ...allSteps, clickedAt: { gte: since, not: null } } }) : 0,
    hasAny ? prisma.pushJob.count({ where: { ...allSteps, sentAt: { gte: since, not: null } } }) : 0,
    hasAny ? prisma.pushJob.count({ where: { ...allSteps, clickedAt: { gte: since, not: null } } }) : 0,
    hasAny ? prisma.whatsappJob.count({ where: { ...allSteps, sentAt: { gte: since, not: null } } }) : 0,
    hasAny
      ? prisma.journeyJob.count({ where: { ...allSteps, status: { in: ["pending", "processing"] } } })
      : 0,

    // ── Cart-recovery funnel: deliberately cart-scoped ──────────────────────
    hasCartJourneys
      ? prisma.$queryRaw`
          SELECT COUNT(*)::int AS count
          FROM "JourneyEnrollment" e
          WHERE e.shop = ${shop}
            AND e."journeyId" = ANY(${cartJourneyIds})
            AND e."enrolledAt" >= ${since}
            AND EXISTS (
              SELECT 1 FROM "JourneyJob" j
              WHERE j."enrollmentId" = e.id
                AND j."sentAt" IS NOT NULL
                AND j."sentAt" > e."enrolledAt" + INTERVAL '1 hour'
            )
        `
      : [{ count: 0 }],
    hasCartJourneys
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

    // ── Audience ────────────────────────────────────────────────────────────
    // The whole marketable list, not just confirmed popup signups — the old
    // number contradicted the figure the Contacts page showed for the same shop.
    prisma.contact.count({
      where: { shop, deletedAt: null, subscriptionStatus: "subscribed" },
    }),
    // Scoped to the reporting window, like every other figure on the card.
    prisma.emailSuppression.count({ where: { shop, createdAt: { gte: since } } }),
  ]);

  const recoveredCount = recoveredRows.length;
  const recoveredRevenue = recoveredRows.reduce((sum, r) => sum + (r.recoveredRevenue ?? 0), 0);
  // Denominator comes back as [{ count: N }] from raw SQL.
  const abandonedCount = Array.isArray(abandoned) ? Number(abandoned[0]?.count ?? 0) : Number(abandoned || 0);

  return {
    sent,
    opened,
    clicked,
    pushSent,
    pushClicked,
    whatsappSent,
    recoveredCount,
    recoveredRevenue,
    abandoned: abandonedCount,
    pendingJobs,
    subscribers,
    suppressions,
    hasCartJourneys,
    openRate: sent > 0 ? (opened / sent) * 100 : 0,
    clickRate: sent > 0 ? (clicked / sent) * 100 : 0,
    pushClickRate: pushSent > 0 ? (pushClicked / pushSent) * 100 : 0,
    recoveryRate: abandonedCount > 0 ? (recoveredCount / abandonedCount) * 100 : 0,
  };
}

/**
 * Per-step breakdown for the dashboard's "Email performance" table.
 *
 * One row per email step across ALL flows, carrying the flow name so the table
 * stays readable once a shop runs more than one.
 */
export async function getEmailBreakdown(shop, days = 30, { journeyId = null } = {}) {
  const since = sinceDate(days);
  const ids = await journeyIds(shop, { journeyId });
  if (ids.length === 0) return [];

  const steps = await prisma.journeyStep.findMany({
    where: {
      journeyId: { in: ids },
      nodeType: "email",
      isArchived: false,
    },
    select: {
      id: true,
      stepNumber: true,
      subject: true,
      emailName: true,
      journeyId: true,
      journey: { select: { name: true } },
    },
    orderBy: [{ journeyId: "asc" }, { stepNumber: "asc" }],
  });
  if (steps.length === 0) return [];

  // One grouped query instead of three counts per step — a shop with a handful
  // of flows was previously issuing dozens of round trips to render this table.
  const grouped = await prisma.$queryRaw`
    SELECT j."stepId"                                          AS "stepId",
           COUNT(*) FILTER (WHERE j."sentAt"    IS NOT NULL)    AS sent,
           COUNT(*) FILTER (WHERE j."openedAt"  IS NOT NULL)    AS opened,
           COUNT(*) FILTER (WHERE j."clickedAt" IS NOT NULL)    AS clicked
      FROM "JourneyJob" j
     WHERE j."shop" = ${shop}
       AND j."stepId" = ANY(${steps.map((s) => s.id)})
       AND j."sentAt" >= ${since}
     GROUP BY j."stepId"
  `;
  const statsByStep = Object.fromEntries(
    grouped.map((r) => [
      r.stepId,
      { sent: Number(r.sent) || 0, opened: Number(r.opened) || 0, clicked: Number(r.clicked) || 0 },
    ]),
  );

  return steps.map((step) => {
    const s = statsByStep[step.id] || { sent: 0, opened: 0, clicked: 0 };
    return {
      stepId: step.id,
      stepNumber: step.stepNumber,
      label: step.emailName || step.subject || `Email ${step.stepNumber}`,
      journeyName: step.journey?.name || "",
      sent: s.sent,
      opened: s.opened,
      clicked: s.clicked,
    };
  });
}
