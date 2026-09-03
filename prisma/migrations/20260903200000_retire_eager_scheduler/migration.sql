-- Retire the pre-branching scheduler.
--
-- Every enrollment is now walked one node at a time by advance.server.js. The
-- old scheduler — which created every job for a whole flow at enrollment, on
-- absolute schedules — has no callers left and no rows depending on it:
-- verified at zero open eager enrollments, zero eager enrollments holding a
-- live job, and zero live jobs of any kind before this ran.
--
-- ── Why the column stays ───────────────────────────────────────────────────
-- schedulingMode is kept as history. 18,852 existing enrollments truthfully
-- record that they ran under the old model, and that is worth being able to
-- read when someone asks why a 2026 enrollment behaved the way it did.
-- Nothing branches on it any more.
--
-- ── Why the default has to change ──────────────────────────────────────────
-- It defaulted to 'eager'. With the eager code paths gone, any row created
-- without naming the column would have been marked for a scheduler that no
-- longer exists — and, worse, the advance worker used to filter on
-- schedulingMode = 'lazy', so such a row would have been skipped silently and
-- forever. That filter is removed in the same change, but leaving a default
-- that describes a dead scheduler is a trap for the next person.
ALTER TABLE "JourneyEnrollment" ALTER COLUMN "schedulingMode" SET DEFAULT 'lazy';

-- The advance worker claims on nextRunAt alone now. The old composite index
-- led with schedulingMode, so it cannot serve that query — Postgres can only
-- use a leading column prefix. Without this the claim degrades to a sequential
-- scan of every enrollment on every tick, which grows with the table forever.
CREATE INDEX "JourneyEnrollment_nextRunAt_idx" ON "JourneyEnrollment"("nextRunAt");

-- The composite index is now dead weight: nothing filters on schedulingMode.
DROP INDEX IF EXISTS "JourneyEnrollment_schedulingMode_nextRunAt_idx";
