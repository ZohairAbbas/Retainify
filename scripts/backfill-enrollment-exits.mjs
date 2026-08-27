/**
 * One-off backfill: close enrollments that were never settled.
 *
 * Two distinct bugs left JourneyEnrollment rows with completedAt null and
 * exitReason "" forever, so every report counted them as still in flight:
 *
 *   1. A shop closed or uninstalled. Its queued jobs were cancelled, but
 *      nothing closed the enrollments those jobs belonged to.
 *   2. The enrollment-completion check only ran on the successful-send path, so
 *      an enrollment whose LAST job ended any other way — a permanent failure, a
 *      suppressed recipient, a missing settings row — was never closed. Fixed
 *      forward in settleEnrollmentIfFinished(); this cleans up the residue.
 *
 * Three labels, because these are not the same event:
 *   shop_closed   — the shop went away mid-journey
 *   completed     — every step was handled and the last one succeeded
 *   ended_failed  — the last step failed permanently; claiming "completed"
 *                   would overstate completion in campaign analytics, which
 *                   buckets anything not in ("", "completed") as exited early
 *
 * SAFETY: only touches enrollments with NO live job in ANY of the three queues.
 * An enrollment with a pending push is still running even if its email jobs are
 * all terminal, and closing it early would make the push worker skip the rest —
 * its first check is `if (enrollment.exitReason)`.
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-enrollment-exits.mjs --dry-run
 *   node --env-file=.env scripts/backfill-enrollment-exits.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

/** Shops whose enrollments ended because the shop itself went away. */
const DEAD_SHOPS = ["r1ykqj-dj.myshopify.com"];

/** No live job in any queue — the enrollment genuinely has nothing left to do. */
const SETTLED = `
  not exists (select 1 from "JourneyJob"  j where j."enrollmentId" = e.id and j.status in ('pending','processing'))
  and not exists (select 1 from "PushJob"     p where p."enrollmentId" = e.id and p.status in ('pending','processing'))
  and not exists (select 1 from "WhatsappJob" w where w."enrollmentId" = e.id and w.status in ('pending','processing'))
`;

const OPEN = `e."completedAt" is null and e."exitReason" = ''`;

async function main() {
  console.log(DRY_RUN ? "DRY RUN — no writes\n" : "APPLYING CHANGES\n");

  const deadList = DEAD_SHOPS.map((s) => `'${s}'`).join(",");

  // ── Pass 1: dead shops ────────────────────────────────────────────────────
  const deadRows = await prisma.$queryRawUnsafe(`
    select e.shop, count(*)::int as n
    from "JourneyEnrollment" e
    where ${OPEN} and e.shop in (${deadList}) and ${SETTLED}
    group by 1 order by 2 desc
  `);
  report("shop_closed", deadRows);

  // ── Passes 2 and 3: orphans on shops that are still alive ─────────────────
  // Classified by the LAST job to settle (updatedAt), which is what the
  // forward-looking fix keys on — not the highest step number, since steps do
  // not run in order.
  const orphanRows = await prisma.$queryRawUnsafe(`
    with orphan as (
      select e.id, e.shop from "JourneyEnrollment" e
      where ${OPEN} and e.shop not in (${deadList}) and ${SETTLED}
    ),
    last_settled as (
      select distinct on (j."enrollmentId") j."enrollmentId", j.status
      from "JourneyJob" j
      where j."enrollmentId" in (select id from orphan)
      order by j."enrollmentId", j."updatedAt" desc
    )
    select o.shop, coalesce(l.status, 'none') as last_status, count(*)::int as n
    from orphan o left join last_settled l on l."enrollmentId" = o.id
    group by 1, 2 order by 1, 3 desc
  `);
  report("completed", orphanRows.filter((r) => r.last_status === "done"));
  report("ended_failed", orphanRows.filter((r) => r.last_status === "failed"));

  const unclassified = orphanRows.filter((r) => !["done", "failed"].includes(r.last_status));
  if (unclassified.length) {
    console.log("\n⚠ unclassified (left untouched — no email jobs to judge by):");
    for (const r of unclassified) console.log(`   ${r.shop} ${r.last_status} ${r.n}`);
  }

  if (DRY_RUN) {
    console.log("\nDry run complete — nothing written.");
    return;
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  const dead = await prisma.$executeRawUnsafe(`
    update "JourneyEnrollment" e
       set "exitReason" = 'shop_closed', "completedAt" = now()
     where ${OPEN} and e.shop in (${deadList}) and ${SETTLED}
  `);
  console.log(`\nshop_closed:  ${dead} rows`);

  // completedAt is set from the job that actually ended the journey rather than
  // now(), so timeline and analytics show when it really finished.
  const completed = await prisma.$executeRawUnsafe(`
    update "JourneyEnrollment" e
       set "exitReason" = 'completed', "completedAt" = last.settled_at
      from (
        select distinct on (j."enrollmentId") j."enrollmentId" as eid, j.status, j."updatedAt" as settled_at
        from "JourneyJob" j order by j."enrollmentId", j."updatedAt" desc
      ) last
     where last.eid = e.id and last.status = 'done'
       and ${OPEN} and e.shop not in (${deadList}) and ${SETTLED}
  `);
  console.log(`completed:    ${completed} rows`);

  const failed = await prisma.$executeRawUnsafe(`
    update "JourneyEnrollment" e
       set "exitReason" = 'ended_failed', "completedAt" = last.settled_at
      from (
        select distinct on (j."enrollmentId") j."enrollmentId" as eid, j.status, j."updatedAt" as settled_at
        from "JourneyJob" j order by j."enrollmentId", j."updatedAt" desc
      ) last
     where last.eid = e.id and last.status = 'failed'
       and ${OPEN} and e.shop not in (${deadList}) and ${SETTLED}
  `);
  console.log(`ended_failed: ${failed} rows`);
  console.log(`\nTotal: ${dead + completed + failed} enrollments closed.`);
}

function report(label, rows) {
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  console.log(`${label.padEnd(13)} ${String(total).padStart(6)}  ${rows.map((r) => `${r.shop}:${r.n}`).join("  ") || "-"}`);
}

main()
  .catch((err) => {
    console.error("backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
