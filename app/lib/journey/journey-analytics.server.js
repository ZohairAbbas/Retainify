/**
 * Inline per-step stats for the flow builder canvas.
 *
 * Scope is deliberately narrow: the three numbers NodeCard renders behind the
 * "Inline stats" toggle. Everything richer — per-channel breakdowns, recipients,
 * revenue — belongs to the campaign report (lib/analytics/campaign.server.js),
 * which is a page rather than an overlay on a node.
 *
 * This module previously exported getJourneyStats() and getShopFlowStats(),
 * neither of which was ever called, and getStepStats() returned ten fields for
 * a caller that reads three — including a hardcoded `revenue: 0, orders: 0,
 * orderRate: 0` that no surface displayed. Attribution now lives in
 * lib/analytics/attribution.server.js and reports real figures.
 *
 * ── Why jobs are rolled up rather than read per step ────────────────────────
 * Saving a flow deletes and recreates its steps (journey-lifecycle.server.js).
 * A step that already has jobs cannot be deleted without cascading them away,
 * so it is archived and a fresh row takes its place — and the send history
 * stays attached to the archived predecessor. The canvas only knows about live
 * steps, so asking for stats by live step id returned zeros for every flow
 * edited after it had sent.
 *
 * Counting against all of a flow's steps and rolling up by
 * (stepNumber, nodeType) — the identity a step keeps across a save — puts the
 * history back on the node the merchant is looking at. Same rule the campaign
 * report's step table uses, so the canvas and the report agree.
 */
import prisma from "../../db.server.js";

function sinceDate(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Canvas stats for every email step of one flow, keyed by LIVE step id.
 *
 * One grouped query for the whole flow. This was three counts per step, so a
 * ten-email flow issued thirty round trips to render thirty numbers.
 *
 * `sent` counts sentAt — the provider accepting the message. It was called
 * `delivered`, which campaign.server.js uses for the narrower thing the
 * provider confirms afterwards.
 *
 * @param {string} journeyId
 * @param {number} days
 * @returns {Promise<Record<string, {sent: number, openRate: number, clickRate: number}>>}
 */
export async function getJourneyStepStats(journeyId, days = 30) {
  const since = sinceDate(days);

  const steps = await prisma.journeyStep.findMany({
    where: { journeyId, nodeType: "email" },
    select: { id: true, stepNumber: true, isArchived: true },
  });
  if (!steps.length) return {};

  const rows = await prisma.$queryRaw`
    SELECT j."stepId" AS "stepId",
           COUNT(*) FILTER (WHERE j."sentAt"    IS NOT NULL) AS sent,
           COUNT(*) FILTER (WHERE j."openedAt"  IS NOT NULL) AS opened,
           COUNT(*) FILTER (WHERE j."clickedAt" IS NOT NULL) AS clicked
      FROM "JourneyJob" j
     WHERE j."stepId" = ANY(${steps.map((s) => s.id)})
       AND j."sentAt" >= ${since}
     GROUP BY j."stepId"`;

  // Roll up by position, so an archived step's history lands on whichever live
  // row replaced it.
  const byNumber = {};
  const numberOf = Object.fromEntries(steps.map((s) => [s.id, s.stepNumber]));
  for (const r of rows) {
    const n = numberOf[r.stepId];
    if (n === undefined) continue;
    const acc = (byNumber[n] ||= { sent: 0, opened: 0, clicked: 0 });
    acc.sent += Number(r.sent) || 0;
    acc.opened += Number(r.opened) || 0;
    acc.clicked += Number(r.clicked) || 0;
  }

  const out = {};
  for (const step of steps) {
    if (step.isArchived) continue;
    const s = byNumber[step.stepNumber] || { sent: 0, opened: 0, clicked: 0 };
    out[step.id] = {
      sent: s.sent,
      openRate: round(s.sent ? (s.opened / s.sent) * 100 : 0, 1),
      clickRate: round(s.sent ? (s.clicked / s.sent) * 100 : 0, 1),
    };
  }
  return out;
}

function round(n, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
