/**
 * Per-campaign (per-flow) analytics.
 *
 * The app previously had no campaign report at all. The only analytics surface
 * was a toggle in the flow builder that overlaid three numbers on email nodes,
 * and only for published flows in canvas view — so a paused or draft flow, or
 * anyone in form view, had no way to see performance. getJourneyStats() and
 * getShopFlowStats() existed in journey-analytics.server.js but were never
 * called from anywhere.
 *
 * Everything here is scoped to one journey and a time window, and covers all
 * three channels rather than email alone.
 *
 * ── Honest attribution ──────────────────────────────────────────────────────
 * Two numbers are approximations and are labelled as such in the UI:
 *   - Unsubscribes: EmailSuppression carries no campaign reference, so we count
 *     recipients of this flow whose suppression was created AFTER their send.
 *     That over-counts someone who would have unsubscribed anyway and
 *     under-counts nothing.
 *   - Revenue: only cart-recovery flows can attribute it, because AbandonedCart
 *     is the only table carrying money. Every other trigger reports null rather
 *     than a fabricated zero.
 */
import prisma from "../../db.server.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const RANGE_OPTIONS = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 365, label: "Last 12 months" },
];

export function resolveRange(raw) {
  const n = Number(raw);
  return RANGE_OPTIONS.some((o) => o.value === n) ? n : 30;
}

function sinceDate(days) {
  return new Date(Date.now() - days * DAY_MS);
}

function rate(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * When Resend's email.delivered / email.failed topics were subscribed.
 *
 * Before this moment no delivery event was ever emitted, so every send in that
 * period has deliveredAt null regardless of whether it actually arrived. A
 * delivery rate computed across it would report 0% for months of healthy mail —
 * worse than showing nothing, because it looks like a catastrophe rather than
 * an absence of data.
 */
const DELIVERY_TRACKING_SINCE = new Date("2026-08-29T00:00:00Z");

/** Whether a reporting window contains only sends we could measure delivery for. */
function deliveryTrackingCoversWindow(since) {
  return since >= DELIVERY_TRACKING_SINCE;
}

/**
 * Headline numbers for one campaign.
 *
 * @param {string} shop
 * @param {string} journeyId
 * @param {number} days
 */
export async function getCampaignOverview(shop, journeyId, days = 30) {
  const since = sinceDate(days);
  const journey = await prisma.journey.findFirst({
    where: { id: journeyId, shop },
    select: { id: true, name: true, trigger: true, status: true, publishedAt: true },
  });
  if (!journey) return null;

  const stepScope = { step: { journeyId } };

  const [
    enrolled,
    completed,
    exited,
    emailSent,
    emailDelivered,
    emailOpened,
    emailClicked,
    emailFailed,
    emailPending,
    pushSent,
    pushClicked,
    waSent,
    waDelivered,
    waRead,
  ] = await Promise.all([
    prisma.journeyEnrollment.count({ where: { journeyId, enrolledAt: { gte: since } } }),
    prisma.journeyEnrollment.count({
      where: { journeyId, enrolledAt: { gte: since }, exitReason: "completed" },
    }),
    prisma.journeyEnrollment.count({
      where: {
        journeyId,
        enrolledAt: { gte: since },
        exitReason: { notIn: ["", "completed"] },
      },
    }),
    prisma.journeyJob.count({ where: { ...stepScope, sentAt: { gte: since, not: null } } }),
    prisma.journeyJob.count({ where: { ...stepScope, deliveredAt: { gte: since, not: null } } }),
    prisma.journeyJob.count({ where: { ...stepScope, openedAt: { gte: since, not: null } } }),
    prisma.journeyJob.count({ where: { ...stepScope, clickedAt: { gte: since, not: null } } }),
    prisma.journeyJob.count({ where: { ...stepScope, status: "failed", updatedAt: { gte: since } } }),
    prisma.journeyJob.count({ where: { ...stepScope, status: { in: ["pending", "processing"] } } }),
    prisma.pushJob.count({ where: { ...stepScope, sentAt: { gte: since, not: null } } }),
    prisma.pushJob.count({ where: { ...stepScope, clickedAt: { gte: since, not: null } } }),
    prisma.whatsappJob.count({ where: { ...stepScope, sentAt: { gte: since, not: null } } }),
    prisma.whatsappJob.count({ where: { ...stepScope, deliveredAt: { gte: since, not: null } } }),
    prisma.whatsappJob.count({ where: { ...stepScope, readAt: { gte: since, not: null } } }),
  ]);

  const [unsubscribed, revenue] = await Promise.all([
    countUnsubscribesAfterSend(shop, journeyId, since),
    journey.trigger === "cart_abandoned" ? attributedRevenue(shop, journeyId, since) : null,
  ]);

  return {
    journey,
    days,
    enrolled,
    completed,
    exited,
    inProgress: emailPending,
    email: {
      // "sent" means the provider accepted the message — that is all it has
      // ever meant. "delivered" is the provider confirming it reached the
      // inbox, which is a different and smaller number.
      sent: emailSent,
      delivered: emailDelivered,
      opened: emailOpened,
      clicked: emailClicked,
      failed: emailFailed,
      // Delivery events were subscribed on 2026-08-29; every send before that
      // has deliveredAt null because the events were never emitted, not because
      // the mail bounced. Reporting a delivery rate over that history would
      // read as "0% delivered" for months of perfectly fine email, so the rate
      // is deliberately null until the window contains only measurable sends.
      // deliveryRate is therefore honest-or-absent, never wrong.
      deliveryRate: deliveryTrackingCoversWindow(since)
        ? rate(emailDelivered, emailSent)
        : null,
      deliveryTracked: deliveryTrackingCoversWindow(since),
      // Engagement rates stay on "sent" so they remain comparable with the
      // historical figures merchants have already seen.
      openRate: rate(emailOpened, emailSent),
      clickRate: rate(emailClicked, emailSent),
      clickToOpenRate: rate(emailClicked, emailOpened),
    },
    push: {
      sent: pushSent,
      clicked: pushClicked,
      clickRate: rate(pushClicked, pushSent),
    },
    whatsapp: {
      sent: waSent,
      delivered: waDelivered,
      read: waRead,
      readRate: rate(waRead, waSent),
    },
    unsubscribed,
    unsubscribeRate: rate(unsubscribed, emailSent),
    revenue,
  };
}

/**
 * Recipients of this flow who unsubscribed after we sent to them.
 *
 * Approximate by construction — see the module header. The time bracket is what
 * keeps it meaningful: without it, anyone who had ever unsubscribed from the
 * shop would count against every campaign they were ever enrolled in.
 */
async function countUnsubscribesAfterSend(shop, journeyId, since) {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT e."contactEmail")::int AS count
      FROM "JourneyEnrollment" e
      JOIN "JourneyJob" j ON j."enrollmentId" = e.id
      JOIN "JourneyStep" s ON s.id = j."stepId"
      JOIN "EmailSuppression" sup
        ON sup.shop = e.shop
       AND lower(sup.email) = lower(e."contactEmail")
     WHERE e.shop = ${shop}
       AND s."journeyId" = ${journeyId}
       AND j."sentAt" IS NOT NULL
       AND j."sentAt" >= ${since}
       AND sup.reason = 'unsubscribe'
       AND sup."createdAt" >= j."sentAt"
  `;
  return Number(rows?.[0]?.count ?? 0);
}

/**
 * Revenue from carts recovered after a rescue email from THIS flow landed.
 * Same 1-hour bracket the dashboard uses, so the two agree.
 */
async function attributedRevenue(shop, journeyId, since) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(c."recoveredRevenue"), 0)::float8 AS revenue,
           COUNT(*)::int AS orders
      FROM "AbandonedCart" c
     WHERE c.shop = ${shop}
       AND c."recoveredAt" >= ${since}
       AND c."recoveredRevenue" IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM "JourneyJob" j
           JOIN "JourneyEnrollment" e ON e.id = j."enrollmentId"
           JOIN "JourneyStep" s ON s.id = j."stepId"
          WHERE s."journeyId" = ${journeyId}
            AND e.shop = c.shop
            AND lower(e."contactEmail") = lower(c."customerEmail")
            AND j."sentAt" IS NOT NULL
            AND j."sentAt" > c."abandonedAt" + INTERVAL '1 hour'
            AND j."sentAt" < c."recoveredAt"
       )
  `;
  return {
    amount: Number(rows?.[0]?.revenue ?? 0),
    orders: Number(rows?.[0]?.orders ?? 0),
  };
}

/**
 * Per-step performance across all three channels, in canvas order.
 */
export async function getCampaignStepBreakdown(shop, journeyId, days = 30) {
  const since = sinceDate(days);

  const steps = await prisma.journeyStep.findMany({
    where: { journeyId, isArchived: false, nodeType: { in: ["email", "push", "whatsapp"] } },
    orderBy: { stepNumber: "asc" },
    select: {
      id: true,
      stepNumber: true,
      nodeType: true,
      emailName: true,
      subject: true,
      pushTitle: true,
      waTemplateName: true,
      delayHours: true,
      isEnabled: true,
    },
  });
  if (!steps.length) return [];

  const ids = steps.map((s) => s.id);

  // One grouped query per channel rather than three counts per step.
  const [emailRows, pushRows, waRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT j."stepId" AS "stepId",
             COUNT(*) FILTER (WHERE j."sentAt"    IS NOT NULL) AS sent,
             COUNT(*) FILTER (WHERE j."openedAt"  IS NOT NULL) AS opened,
             COUNT(*) FILTER (WHERE j."clickedAt" IS NOT NULL) AS clicked,
             COUNT(*) FILTER (WHERE j."status" = 'failed')     AS failed
        FROM "JourneyJob" j
       WHERE j."stepId" = ANY(${ids}) AND j."sentAt" >= ${since}
       GROUP BY j."stepId"`,
    prisma.$queryRaw`
      SELECT p."stepId" AS "stepId",
             COUNT(*) FILTER (WHERE p."sentAt"    IS NOT NULL) AS sent,
             COUNT(*) FILTER (WHERE p."clickedAt" IS NOT NULL) AS clicked
        FROM "PushJob" p
       WHERE p."stepId" = ANY(${ids}) AND p."sentAt" >= ${since}
       GROUP BY p."stepId"`,
    prisma.$queryRaw`
      SELECT w."stepId" AS "stepId",
             COUNT(*) FILTER (WHERE w."sentAt"      IS NOT NULL) AS sent,
             COUNT(*) FILTER (WHERE w."deliveredAt" IS NOT NULL) AS delivered,
             COUNT(*) FILTER (WHERE w."readAt"      IS NOT NULL) AS read
        FROM "WhatsappJob" w
       WHERE w."stepId" = ANY(${ids}) AND w."sentAt" >= ${since}
       GROUP BY w."stepId"`,
  ]);

  const byId = {};
  for (const r of emailRows) byId[r.stepId] = { ...byId[r.stepId], ...numeric(r) };
  for (const r of pushRows) byId[r.stepId] = { ...byId[r.stepId], ...numeric(r) };
  for (const r of waRows) byId[r.stepId] = { ...byId[r.stepId], ...numeric(r) };

  return steps.map((step) => {
    const s = byId[step.id] || {};
    const sent = s.sent || 0;
    return {
      stepId: step.id,
      stepNumber: step.stepNumber,
      channel: step.nodeType,
      isEnabled: step.isEnabled,
      delayHours: step.delayHours,
      label:
        step.nodeType === "email"
          ? step.emailName || step.subject || `Email ${step.stepNumber}`
          : step.nodeType === "push"
            ? step.pushTitle || `Push ${step.stepNumber}`
            : step.waTemplateName || `WhatsApp ${step.stepNumber}`,
      subject: step.subject || "",
      sent,
      opened: s.opened || 0,
      clicked: s.clicked || 0,
      delivered: s.delivered ?? null,
      read: s.read || 0,
      failed: s.failed || 0,
      openRate: rate(s.opened || 0, sent),
      clickRate: rate(s.clicked || 0, sent),
    };
  });
}

/** Postgres returns bigints for COUNT — coerce everything to Number. */
function numeric(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "stepId") continue;
    out[k] = Number(v) || 0;
  }
  return out;
}

/**
 * Recipient-level rows: one per message sent, with its own open/click state.
 *
 * Cursor-paginated on job id so a campaign with a large audience doesn't have to
 * be loaded at once. `filter` narrows to a delivery outcome so a merchant can
 * jump straight to, say, everyone who clicked.
 *
 * @param {object} args
 * @param {"all"|"opened"|"clicked"|"unopened"} [args.filter]
 */
export async function listCampaignRecipients({
  shop,
  journeyId,
  days = 30,
  cursor = null,
  limit = 100,
  filter = "all",
  stepId = null,
}) {
  const since = sinceDate(days);

  const where = {
    shop,
    step: { journeyId, ...(stepId ? { id: stepId } : {}) },
    sentAt: { gte: since, not: null },
    ...(filter === "opened" ? { openedAt: { not: null } } : {}),
    ...(filter === "clicked" ? { clickedAt: { not: null } } : {}),
    ...(filter === "unopened" ? { openedAt: null } : {}),
  };

  const rows = await prisma.journeyJob.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      sentAt: true,
      openedAt: true,
      clickedAt: true,
      status: true,
      lastError: true,
      enrollment: { select: { contactEmail: true, contactName: true, enrolledAt: true } },
      step: { select: { stepNumber: true, emailName: true, subject: true, nodeType: true } },
    },
  });

  let nextCursor = null;
  if (rows.length > limit) {
    nextCursor = rows[limit - 1].id;
    rows.length = limit;
  }

  return {
    rows: rows.map(toRecipientRow),
    nextCursor,
  };
}

function toRecipientRow(j) {
  return {
    id: j.id,
    email: j.enrollment?.contactEmail || "",
    name: j.enrollment?.contactName || "",
    enrolledAt: j.enrollment?.enrolledAt || null,
    step: j.step?.emailName || j.step?.subject || `Step ${j.step?.stepNumber ?? ""}`,
    stepNumber: j.step?.stepNumber ?? null,
    channel: j.step?.nodeType || "email",
    sentAt: j.sentAt,
    openedAt: j.openedAt,
    clickedAt: j.clickedAt,
    status: j.status,
    error: j.lastError || "",
  };
}

/**
 * Total recipient rows for the current filter — drives the "N recipients" label
 * and tells the merchant how large an export will be before they start one.
 */
export async function countCampaignRecipients({ shop, journeyId, days = 30, filter = "all", stepId = null }) {
  const since = sinceDate(days);
  return prisma.journeyJob.count({
    where: {
      shop,
      step: { journeyId, ...(stepId ? { id: stepId } : {}) },
      sentAt: { gte: since, not: null },
      ...(filter === "opened" ? { openedAt: { not: null } } : {}),
      ...(filter === "clicked" ? { clickedAt: { not: null } } : {}),
      ...(filter === "unopened" ? { openedAt: null } : {}),
    },
  });
}

/**
 * Async generator of recipient rows for CSV export.
 *
 * Batched with a keyset cursor rather than loaded whole: an export is exactly
 * the operation most likely to hit a campaign with a six-figure audience, and
 * holding that in memory to build one string is how an export endpoint takes
 * the process down.
 */
export async function* iterateCampaignRecipients({ shop, journeyId, days = 30, filter = "all", batchSize = 500 }) {
  let cursor = null;
  for (;;) {
    const { rows, nextCursor } = await listCampaignRecipients({
      shop,
      journeyId,
      days,
      cursor,
      limit: batchSize,
      filter,
    });
    if (!rows.length) return;
    yield rows;
    if (!nextCursor) return;
    cursor = nextCursor;
  }
}
