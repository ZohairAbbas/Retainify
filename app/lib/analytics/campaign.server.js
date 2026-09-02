/**
 * Per-campaign (per-flow) analytics.
 *
 * The app previously had no campaign report at all. The only analytics surface
 * was a toggle in the flow builder that overlaid three numbers on email nodes,
 * and only for published flows in canvas view — so a paused or draft flow, or
 * anyone in form view, had no way to see performance.
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
 *   - Revenue: attributed by attribution.server.js, which credits an order to
 *     the last click within its window. Available for every trigger. Returns
 *     null — never zero — for windows whose sends had no click tracking, so an
 *     unmeasurable period reads as unmeasured rather than as no revenue.
 */
import prisma from "../../db.server.js";
import { getFlowAttribution, getStepAttribution } from "./attribution.server.js";

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
    waReplied,
    waFailed,
    waClicked,
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
    // The one per-recipient engagement signal WhatsApp offers — see
    // recordQuickReply in webhooks.whatsapp.jsx for why clicks are not one.
    prisma.whatsappJob.count({ where: { ...stepScope, repliedAt: { gte: since, not: null } } }),
    prisma.whatsappJob.count({ where: { ...stepScope, failedAt: { gte: since, not: null } } }),
    // Recorded by our own redirect, so a row exists only for templates created
    // in Retainify — see w.$token.jsx.
    prisma.whatsappJob.count({ where: { ...stepScope, clickedAt: { gte: since, not: null } } }),
  ]);

  const [unsubscribed, revenue] = await Promise.all([
    countUnsubscribesAfterSend(shop, journeyId, since),
    // Every trigger now, not just cart rescue. The old query could only read
    // AbandonedCart, so a welcome or win-back flow reported nothing however
    // much it earned.
    getFlowAttribution(shop, journeyId, since),
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
      replied: waReplied,
      failed: waFailed,
      clicked: waClicked,
      readRate: rate(waRead, waSent),
      deliveryRate: rate(waDelivered, waSent),
      clickRate: rate(waClicked, waSent),
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
 * Per-step performance across all three channels, in canvas order.
 *
 * ── Why this reads archived steps ───────────────────────────────────────────
 * Saving a flow deletes and recreates its steps (journey-lifecycle.server.js).
 * A step that already has jobs cannot be deleted without cascading them away,
 * so it is archived and a fresh row takes its place. The send history stays
 * attached to the archived predecessor.
 *
 * Reading only live steps therefore showed zeros for every flow edited after it
 * had sent — while the overview above, which scopes by journeyId and ignores
 * the archive flag, reported the true totals. The same page contradicted
 * itself, and the merchant had no way to tell which half was lying.
 *
 * Jobs are counted against ALL steps of the flow and rolled up by stepKey,
 * which the canvas round-trips so a recreated row carries it.
 *
 * This used to be (stepNumber, nodeType) — a position, which is a workable
 * identity only while a flow is a straight line. One consequence of the change
 * is worth knowing: reordering two steps now moves their history with them,
 * where before the history stayed with the position. The new behaviour is the
 * one merchants expect ("that's the offer email, and it has always performed
 * like that"), but it does mean a reordered flow's table reads differently
 * than it did before branching shipped.
 *
 * A group whose history has no live step left — the merchant deleted that step
 * — still gets a row, marked removed. Without it the table would not reconcile
 * with the totals above it.
 */
export async function getCampaignStepBreakdown(shop, journeyId, days = 30) {
  const since = sinceDate(days);

  const SENDABLE = ["email", "push", "whatsapp"];
  const allSteps = await prisma.journeyStep.findMany({
    where: { journeyId, nodeType: { in: SENDABLE } },
    orderBy: { stepNumber: "asc" },
    select: {
      id: true,
      stepNumber: true,
      stepKey: true,
      nodeType: true,
      isArchived: true,
      emailName: true,
      subject: true,
      pushTitle: true,
      waTemplateName: true,
      waLanguage: true,
      delayHours: true,
      isEnabled: true,
    },
  });
  if (!allSteps.length) return [];

  const steps = allSteps.filter((s) => !s.isArchived);
  // Every step, live or archived — jobs hang off whichever row was current when
  // they were created.
  const ids = allSteps.map((s) => s.id);
  /**
   * Identity a step keeps across a save.
   *
   * This was `${s.stepNumber}:${s.nodeType}` — the pair a recreated row happens
   * to preserve. It worked only because a flow was a straight line, where a
   * position IS an identity. Once a flow can branch, two steps on opposite
   * sides of a split sit at different positions in the same flow and the same
   * position means nothing, so history is keyed on the step's own stable key
   * instead. Backfilled per (journeyId, stepNumber, nodeType) group, so every
   * roll-up that was correct under the old key stays correct under this one.
   */
  const groupKey = (s) => s.stepKey;
  const groupOf = Object.fromEntries(allSteps.map((s) => [s.id, groupKey(s)]));

  // One grouped query per channel rather than three counts per step.
  const [emailRows, pushRows, waRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT j."stepId" AS "stepId",
             COUNT(*) FILTER (WHERE j."sentAt"      IS NOT NULL) AS sent,
             COUNT(*) FILTER (WHERE j."deliveredAt" IS NOT NULL) AS delivered,
             COUNT(*) FILTER (WHERE j."openedAt"    IS NOT NULL) AS opened,
             COUNT(*) FILTER (WHERE j."clickedAt"   IS NOT NULL) AS clicked,
             COUNT(*) FILTER (WHERE j."status" = 'failed')       AS failed
        FROM "JourneyJob" j
       WHERE j."stepId" = ANY(${ids}) AND j."sentAt" >= ${since}
       GROUP BY j."stepId"`,
    prisma.$queryRaw`
      SELECT p."stepId" AS "stepId",
             COUNT(*) FILTER (WHERE p."sentAt"    IS NOT NULL) AS sent,
             COUNT(*) FILTER (WHERE p."clickedAt" IS NOT NULL) AS clicked,
             COUNT(*) FILTER (WHERE p."status" = 'failed')     AS failed
        FROM "PushJob" p
       WHERE p."stepId" = ANY(${ids}) AND p."sentAt" >= ${since}
       GROUP BY p."stepId"`,
    prisma.$queryRaw`
      SELECT w."stepId" AS "stepId",
             COUNT(*) FILTER (WHERE w."sentAt"      IS NOT NULL) AS sent,
             COUNT(*) FILTER (WHERE w."deliveredAt" IS NOT NULL) AS delivered,
             COUNT(*) FILTER (WHERE w."readAt"      IS NOT NULL) AS read,
             COUNT(*) FILTER (WHERE w."repliedAt"   IS NOT NULL) AS replied,
             COUNT(*) FILTER (WHERE w."clickedAt"   IS NOT NULL) AS clicked,
             COUNT(*) FILTER (WHERE w."failedAt"    IS NOT NULL) AS failed
        FROM "WhatsappJob" w
       WHERE w."stepId" = ANY(${ids}) AND w."sentAt" >= ${since}
       GROUP BY w."stepId"`,
  ]);

  // Counters roll up by group, so an archived step's history lands on whichever
  // live row replaced it.
  const byGroup = {};
  const add = (rows) => {
    for (const r of rows) {
      const g = groupOf[r.stepId];
      if (!g) continue;
      const acc = (byGroup[g] ||= {});
      for (const [k, v] of Object.entries(numeric(r))) acc[k] = (acc[k] || 0) + v;
    }
  };
  add(emailRows);
  add(pushRows);
  add(waRows);

  // Which message earned the money, not just that the flow did. Empty when the
  // window had no click tracking — the report states that once, at the top.
  const attribution = await getStepAttribution(shop, journeyId, since);

  // WhatsApp steps whose template was created here, and so carries our redirect
  // in its URL buttons. Only those can ever record a click; one synced from
  // Meta links straight to the merchant and the tap never reaches us.
  const trackedWaSteps = await trackedWhatsappSteps(shop, allSteps);
  const revenueByGroup = {};
  for (const [stepId, v] of attribution) {
    const g = groupOf[stepId];
    if (!g) continue;
    const acc = (revenueByGroup[g] ||= { revenue: 0, orders: 0, currency: "" });
    acc.revenue += v.revenue;
    acc.orders += v.orders;
    acc.currency = acc.currency || v.currency;
  }

  const row = (step, { removed = false } = {}) => {
    const g = groupKey(step);
    const s = byGroup[g] || {};
    const sent = s.sent || 0;
    const money = revenueByGroup[g];
    const label =
      step.nodeType === "email"
        ? step.emailName || step.subject || `Email ${step.stepNumber}`
        : step.nodeType === "push"
          ? step.pushTitle || `Push ${step.stepNumber}`
          : step.waTemplateName || `WhatsApp ${step.stepNumber}`;
    return {
      stepId: step.id,
      stepNumber: step.stepNumber,
      channel: step.nodeType,
      isEnabled: step.isEnabled,
      // A removed step is not "disabled" — it is gone from the flow, and only
      // its history keeps it on this table.
      removed,
      delayHours: step.delayHours,
      label,
      subject: step.subject || "",
      sent,
      opened: s.opened || 0,
      clicked: s.clicked || 0,
      // Email delivery is honest-or-absent, exactly as the overview treats it:
      // every send before the delivery topics were subscribed has deliveredAt
      // null because no event was emitted, not because the mail bounced.
      // WhatsApp has no such gap — Meta has always reported delivery.
      delivered:
        step.nodeType === "email"
          ? deliveryTrackingCoversWindow(since)
            ? s.delivered || 0
            : null
          : step.nodeType === "whatsapp"
            ? s.delivered || 0
            : null,
      read: step.nodeType === "whatsapp" ? s.read || 0 : null,
      replied: step.nodeType === "whatsapp" ? s.replied || 0 : null,
      failed: s.failed || 0,
      openRate: rate(s.opened || 0, sent),
      clickRate: rate(s.clicked || 0, sent),
      readRate: step.nodeType === "whatsapp" ? rate(s.read || 0, sent) : null,
      // WhatsApp clicks exist only for templates created here, whose buttons
      // carry our redirect. Null for a synced template means "we never see the
      // tap", which is different from "nobody tapped" — the settings page
      // explains it, and the column shows a dash rather than a zero.
      clickTracked: step.nodeType !== "whatsapp" || (s.clicked || 0) > 0 || trackedWaSteps.has(step.id),
      // Null rather than 0 when nothing was attributed to this step, so the
      // table can show a dash. A step that genuinely earned nothing and a step
      // in an unmeasurable window must not render identically to one that did.
      revenue: money?.revenue ?? null,
      orders: money?.orders ?? null,
      currency: money?.currency || "",
    };
  };

  const rows = steps.map((step) => row(step));

  // Groups that still carry history but have no live step left. Without these
  // the table's numbers would not add up to the totals above it.
  const liveGroups = new Set(steps.map(groupKey));
  const orphans = [];
  const seen = new Set();
  for (const step of allSteps) {
    const g = groupKey(step);
    if (liveGroups.has(g) || seen.has(g) || !byGroup[g]?.sent) continue;
    seen.add(g);
    orphans.push(row(step, { removed: true }));
  }

  return [...rows, ...orphans].sort((a, b) => a.stepNumber - b.stepNumber);
}

/**
 * WhatsApp steps whose template carries our click redirect.
 *
 * A template created in Retainify has buttonUrls set — its URL buttons point at
 * /w/:token, so a tap comes back to us and can be attributed. A template synced
 * from Meta has buttonUrls null: its links go straight to the merchant, we
 * never observe the tap, and reporting zero clicks for it would read as "nobody
 * tapped" rather than "we cannot see taps".
 *
 * @returns {Promise<Set<string>>} step ids whose clicks are observable
 */
async function trackedWhatsappSteps(shop, steps) {
  const waSteps = steps.filter((s) => s.nodeType === "whatsapp");
  if (!waSteps.length) return new Set();

  const templates = await prisma.whatsappTemplate.findMany({
    where: { shop, name: { in: [...new Set(waSteps.map((s) => s.waTemplateName).filter(Boolean))] } },
    select: { name: true, language: true, buttonUrls: true },
  });
  const tracked = new Set(
    templates.filter((t) => t.buttonUrls && Object.keys(t.buttonUrls).length).map((t) => `${t.name}:${t.language}`),
  );

  return new Set(
    waSteps
      .filter((s) => tracked.has(`${s.waTemplateName}:${s.waLanguage || "en_US"}`))
      .map((s) => s.id),
  );
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
