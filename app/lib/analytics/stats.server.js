/**
 * Analytics query helpers for the dashboard.
 */
import prisma from "../../db.server.js";

/**
 * Returns headline stats for a shop over the last N days.
 */
export async function getCartRescueStats(shop, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [emails, recovered, abandoned, pendingJobs, signups, suppressions] = await Promise.all([
    prisma.cartRescueEmail.findMany({
      where: { shop, createdAt: { gte: since } },
      select: { sentAt: true, openedAt: true, clickedAt: true, emailNumber: true },
    }),
    prisma.abandonedCart.findMany({
      where: { shop, recoveredAt: { gte: since }, recoveredRevenue: { not: null } },
      select: { recoveredRevenue: true, recoveredAt: true },
    }),
    prisma.abandonedCart.count({ where: { shop, createdAt: { gte: since } } }),
    prisma.emailJob.count({ where: { shop, status: { in: ["pending", "processing"] } } }),
    prisma.popupSignup.count({ where: { shop, confirmedAt: { not: null } } }),
    prisma.emailSuppression.count({ where: { shop } }),
  ]);

  const sent = emails.filter((e) => e.sentAt).length;
  const opened = emails.filter((e) => e.openedAt).length;
  const clicked = emails.filter((e) => e.clickedAt).length;
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
 * Per-email breakdown (email 1, 2, 3).
 */
export async function getEmailBreakdown(shop, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const emails = await prisma.cartRescueEmail.findMany({
    where: { shop, createdAt: { gte: since } },
    select: { emailNumber: true, sentAt: true, openedAt: true, clickedAt: true },
  });

  const breakdown = [1, 2, 3].map((num) => {
    const group = emails.filter((e) => e.emailNumber === num);
    const sent = group.filter((e) => e.sentAt).length;
    const opened = group.filter((e) => e.openedAt).length;
    const clicked = group.filter((e) => e.clickedAt).length;
    return { emailNumber: num, sent, opened, clicked };
  });

  return breakdown;
}
