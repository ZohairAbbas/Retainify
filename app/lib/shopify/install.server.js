/**
 * Install-state guard for the job workers.
 *
 * A shop's rows (ShopSettings, Journey, queued jobs) outlive an uninstall — they
 * are only erased when shop/redact arrives 48 hours later. Between those two
 * points the workers would happily keep sending, so every send path checks that
 * the app is still installed first.
 *
 * The app/uninstalled webhook cancels queued work directly, which handles the
 * common case. This exists for the cases it can't: a webhook that was never
 * delivered, a shop uninstalled during a period when the topic wasn't
 * subscribed, or a delivery that failed all its retries. Presence of a Session
 * row is the check — the session IS the access token, and without one no API
 * call we make on the shop's behalf would succeed anyway.
 *
 * Batched per worker tick rather than per job: a tick claims up to 20 jobs that
 * usually span only one or two shops.
 */
import prisma from "../../db.server.js";

/**
 * Which of these shops still have the app installed.
 *
 * @param {string[]} shops
 * @returns {Promise<Set<string>>} the subset that is still installed
 */
export async function installedShops(shops) {
  const unique = [...new Set((shops || []).filter(Boolean))];
  if (unique.length === 0) return new Set();

  const rows = await prisma.session.findMany({
    where: { shop: { in: unique } },
    select: { shop: true },
    distinct: ["shop"],
  });

  return new Set(rows.map((r) => r.shop));
}

/**
 * Split claimed jobs into those safe to process and those whose shop has gone.
 *
 * @template {{ shop: string }} T
 * @param {T[]} jobs
 * @returns {Promise<{ live: T[], orphaned: T[] }>}
 */
export async function partitionByInstall(jobs) {
  const installed = await installedShops(jobs.map((j) => j.shop));
  const live = [];
  const orphaned = [];
  for (const job of jobs) {
    if (installed.has(job.shop)) live.push(job);
    else orphaned.push(job);
  }
  return { live, orphaned };
}
