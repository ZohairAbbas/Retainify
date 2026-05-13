/**
 * Aggregate analytics for flows.
 * Per-step stats power inline analytics on the canvas.
 * Per-journey rollups power the list view and dashboard.
 */
import prisma from "../../db.server.js";

function sinceDate(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function getStepStats(stepId, days = 30) {
  const since = sinceDate(days);
  const [delivered, opened, clicked, completed, skipped] = await Promise.all([
    prisma.journeyJob.count({ where: { stepId, sentAt: { gte: since, not: null } } }),
    prisma.journeyJob.count({ where: { stepId, openedAt: { gte: since, not: null } } }),
    prisma.journeyJob.count({ where: { stepId, clickedAt: { gte: since, not: null } } }),
    prisma.journeyJob.count({ where: { stepId, status: "done", updatedAt: { gte: since } } }),
    prisma.journeyJob.count({ where: { stepId, status: "cancelled", updatedAt: { gte: since } } }),
  ]);

  const openRate = delivered ? (opened / delivered) * 100 : 0;
  const clickRate = delivered ? (clicked / delivered) * 100 : 0;

  return {
    delivered,
    opened,
    clicked,
    completed,
    skipped,
    openRate: round(openRate, 1),
    clickRate: round(clickRate, 1),
    // Revenue + orders left at 0 in V1 — Phase 4 attribution wiring fills these in.
    revenue: 0,
    orders: 0,
    orderRate: 0,
  };
}

export async function getJourneyStats(journeyId, days = 30) {
  const since = sinceDate(days);
  const [delivered, opened, clicked, enrollments] = await Promise.all([
    prisma.journeyJob.count({ where: { step: { journeyId }, sentAt: { gte: since, not: null } } }),
    prisma.journeyJob.count({ where: { step: { journeyId }, openedAt: { gte: since, not: null } } }),
    prisma.journeyJob.count({ where: { step: { journeyId }, clickedAt: { gte: since, not: null } } }),
    prisma.journeyEnrollment.count({ where: { journeyId, enrolledAt: { gte: since } } }),
  ]);

  const openRate = delivered ? (opened / delivered) * 100 : 0;
  const clickRate = delivered ? (clicked / delivered) * 100 : 0;

  return {
    delivered,
    opened,
    clicked,
    enrollments,
    openRate: round(openRate, 1),
    clickRate: round(clickRate, 1),
    revenue: 0,
    orders: 0,
  };
}

export async function getShopFlowStats(shop, days = 30) {
  const journeys = await prisma.journey.findMany({
    where: { shop, archivedAt: null },
    select: { id: true },
  });
  const since = sinceDate(days);
  const ids = journeys.map((j) => j.id);
  if (!ids.length) {
    return { delivered: 0, opened: 0, clicked: 0, enrollments: 0, openRate: 0, clickRate: 0 };
  }
  const [delivered, opened, clicked, enrollments] = await Promise.all([
    prisma.journeyJob.count({ where: { step: { journeyId: { in: ids } }, sentAt: { gte: since, not: null } } }),
    prisma.journeyJob.count({ where: { step: { journeyId: { in: ids } }, openedAt: { gte: since, not: null } } }),
    prisma.journeyJob.count({ where: { step: { journeyId: { in: ids } }, clickedAt: { gte: since, not: null } } }),
    prisma.journeyEnrollment.count({ where: { journeyId: { in: ids }, enrolledAt: { gte: since } } }),
  ]);

  const openRate = delivered ? (opened / delivered) * 100 : 0;
  const clickRate = delivered ? (clicked / delivered) * 100 : 0;

  return {
    delivered,
    opened,
    clicked,
    enrollments,
    openRate: round(openRate, 1),
    clickRate: round(clickRate, 1),
  };
}

function round(n, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
