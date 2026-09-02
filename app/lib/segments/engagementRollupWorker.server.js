// Engagement rollup reconciliation sweep.
//
// Contact's engagement columns are maintained live: the journey worker rolls up
// after each send, and the Resend/SES webhooks roll up after each open, click
// and failure. That is what keeps a segment current with the open that just
// happened rather than with the last pass of this worker.
//
// This exists for what that path cannot cover. A webhook the provider dropped,
// a rollup that threw while the send itself succeeded, a process killed between
// the two writes — each leaves one contact's figures permanently wrong, and a
// wrong open rate is invisible: it looks exactly like a contact who doesn't
// open. So every address with recent job activity gets recomputed here as well,
// and a full recompute is idempotent, so doing the work twice costs only time.
//
// Bounded the same way the enrollment worker is:
//   1. A shop is skipped unless SWEEP_INTERVAL_MS has elapsed since its last
//      pass — this is a repair pass, not the live path, so it does not need to
//      run on every 60s tick.
//   2. At most MAX_EMAILS_PER_PASS addresses per shop per pass.
//   3. The worklist is ordered by job activity time and the cursor advances to
//      the last address actually processed, so a shop that exceeds the budget
//      resumes where it stopped rather than skipping the remainder — or, worse,
//      re-reading the same arbitrary 500 rows forever.

import prisma from "../../db.server.js";
import { recalcManyContactEmailStats } from "../contacts/engagement.server.js";

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const MAX_EMAILS_PER_PASS = 500;
const CHUNK = 100;

// How far back a shop's first sweep looks. Its columns were made exact by the
// backfill in the migration, so there is no history to replay — this only has
// to cover events the live path might have missed since then.
const FIRST_PASS_LOOKBACK_MS = 24 * 60 * 60 * 1000;

// A completed pass parks the cursor slightly behind the clock it read. A job
// updated while the pass was running would otherwise fall between the window
// that pass read and the cursor it wrote, and never be swept at all.
const OVERLAP_MS = 5 * 60 * 1000;

/**
 * Repair engagement columns for every shop with recent send activity.
 * Idempotent — safe to call on every tick.
 */
export async function runEngagementRollupWorker() {
  const settings = await prisma.shopSettings.findMany({
    select: { shop: true, lastEngagementRollupAt: true },
  });
  for (const s of settings) {
    if (!isDue(s.lastEngagementRollupAt)) continue;
    try {
      await sweepShop(s.shop, s.lastEngagementRollupAt);
    } catch (e) {
      console.error(`[engagement-rollup] ${s.shop} failed:`, e);
    }
  }
}

function isDue(lastAt) {
  if (!lastAt) return true;
  return Date.now() - new Date(lastAt).getTime() >= SWEEP_INTERVAL_MS;
}

async function sweepShop(shop, lastAt) {
  // Read the clock before the query, not after: anything that lands while this
  // pass runs must fall inside the next window, never before it.
  const passStartedAt = new Date();
  const since = lastAt ? new Date(lastAt) : new Date(Date.now() - FIRST_PASS_LOOKBACK_MS);

  // Ordered by activity time, and carrying it, so a truncated pass has somewhere
  // to move the cursor to. One extra row tells us whether it was truncated.
  const rows = await prisma.$queryRaw`
    SELECT e."contactEmail"  AS email,
           MAX(j."updatedAt") AS last_at
      FROM "JourneyJob" j
      JOIN "JourneyEnrollment" e ON e."id" = j."enrollmentId"
     WHERE j."shop" = ${shop}
       AND j."updatedAt" >= ${since}
     GROUP BY e."contactEmail"
     ORDER BY MAX(j."updatedAt") ASC
     LIMIT ${MAX_EMAILS_PER_PASS + 1}`;

  const truncated = rows.length > MAX_EMAILS_PER_PASS;
  const done = rows.slice(0, MAX_EMAILS_PER_PASS);
  const emails = done.map((r) => r.email).filter(Boolean);

  // Chunked so one pass never holds a single enormous IN list.
  for (let i = 0; i < emails.length; i += CHUNK) {
    await recalcManyContactEmailStats(shop, emails.slice(i, i + CHUNK));
  }

  let cursor;
  if (truncated) {
    // Resume from the last address actually processed. The window is
    // half-open on the wrong side (>=), so that address is read again next
    // pass — harmless, since a recompute is idempotent, and far better than
    // the alternatives: holding the cursor re-reads the same rows forever,
    // and jumping it to now drops everyone this pass didn't reach.
    //
    // The one case this does not advance past is more than MAX_EMAILS_PER_PASS
    // contacts sharing a single millisecond of job activity, which would repeat
    // the pass. It logs, it stays correct, and it is not a shape real send
    // traffic produces.
    cursor = done[done.length - 1]?.last_at || since;
    console.warn(
      `[engagement-rollup] ${shop} hit the ${MAX_EMAILS_PER_PASS} budget — resuming from ${cursor.toISOString?.() || cursor}`,
    );
  } else {
    cursor = new Date(passStartedAt.getTime() - OVERLAP_MS);
  }

  await prisma.shopSettings.update({
    where: { shop },
    data: { lastEngagementRollupAt: cursor },
  });
}
