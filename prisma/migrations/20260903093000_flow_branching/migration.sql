-- Flow branching, phase 1: schema and backfill only.
--
-- Nothing here changes behaviour. Every column is additive, every existing flow
-- is backfilled into the new shape as the straight line it already is, and no
-- code path reads the graph yet. The point of landing it alone is that the
-- backfill below is the one irreversible-ish step in the project, and it
-- deserves to be verified on its own before anything depends on it.

-- ── JourneyStep.stepKey ────────────────────────────────────────────────────
--
-- The identity a step keeps across a save. saveDraft deletes and recreates
-- every step, so JourneyStep.id changes on every edit; a step that still has
-- jobs is archived instead and a fresh row takes its place, leaving the send
-- history on the archived predecessor.
--
-- Both reports work around that today by rolling history up on
-- (stepNumber, nodeType) — the pair a recreated row preserves. That pair stops
-- being unique the moment a flow branches, so it has to be replaced by a real
-- key.
--
-- THE BACKFILL MUST GROUP, NOT ASSIGN PER ROW. An archived step and the live
-- step that replaced it currently roll up together *because* they share
-- (journeyId, stepNumber, nodeType). Give each row its own fresh key and every
-- flow edited since it started sending silently detaches from its own history:
-- the report still renders, just with smaller numbers and no error anywhere.
-- Hence the deterministic hash below — same group, same key, by construction.
ALTER TABLE "JourneyStep" ADD COLUMN "stepKey" TEXT;

UPDATE "JourneyStep"
   SET "stepKey" = 'sk_' || md5("journeyId" || ':' || "stepNumber"::text || ':' || "nodeType");

ALTER TABLE "JourneyStep" ALTER COLUMN "stepKey" SET NOT NULL;

CREATE INDEX "JourneyStep_journeyId_stepKey_idx" ON "JourneyStep"("journeyId", "stepKey");

-- ── JourneyStep.splitCondition ─────────────────────────────────────────────
--
-- Branch condition for nodeType "split". Same rule-tree shape as
-- Journey.entryFilters and Segment.filterTree, evaluated by the same
-- evalTreeForContact(), so a rule means what it means everywhere else in the
-- app. NULL on every other node type, which is every row that exists today.
ALTER TABLE "JourneyStep" ADD COLUMN "splitCondition" JSONB;

-- ── JourneyEdge ────────────────────────────────────────────────────────────
--
-- What makes a flow a tree. `branch` is 'next' for an ordinary step and
-- 'yes'/'no' for the two sides of a split.
--
-- Branches never merge back, so a step has at most one incoming edge; the
-- unique constraint enforces the other half of that rule, one target per branch
-- out of any given step.
CREATE TABLE "JourneyEdge" (
    "id"         TEXT NOT NULL,
    "journeyId"  TEXT NOT NULL,
    "fromStepId" TEXT NOT NULL,
    "toStepId"   TEXT NOT NULL,
    "branch"     TEXT NOT NULL DEFAULT 'next',

    CONSTRAINT "JourneyEdge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JourneyEdge_fromStepId_branch_key" ON "JourneyEdge"("fromStepId", "branch");
CREATE INDEX "JourneyEdge_journeyId_idx" ON "JourneyEdge"("journeyId");
CREATE INDEX "JourneyEdge_fromStepId_idx" ON "JourneyEdge"("fromStepId");

ALTER TABLE "JourneyEdge"
  ADD CONSTRAINT "JourneyEdge_journeyId_fkey"
  FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: chain every flow's live steps in stepNumber order, so the graph is
-- authoritative from day one and no reader ever has to fall back to the list.
--
-- Live steps only. An archived step is kept solely so its jobs are not
-- cascade-deleted; it is already excluded from the canvas, the step counts and
-- every read, and putting it in the graph would place a step in the path that
-- the merchant cannot see.
INSERT INTO "JourneyEdge" ("id", "journeyId", "fromStepId", "toStepId", "branch")
SELECT 'je_' || md5(s."id" || ':next'), s."journeyId", s."id", s."nextId", 'next'
  FROM (
    SELECT "id",
           "journeyId",
           LEAD("id") OVER (PARTITION BY "journeyId" ORDER BY "stepNumber", "id") AS "nextId"
      FROM "JourneyStep"
     WHERE "isArchived" = false
  ) s
 WHERE s."nextId" IS NOT NULL;

-- ── JourneyPathEvent ───────────────────────────────────────────────────────
--
-- Which way one enrollment went at one split. Without it there is no branch
-- report, and no way to answer "why did this person get that email" — the jobs
-- that exist hint at the route, but say nothing about a split whose chosen side
-- had no sendable step, and cannot tell "not evaluated yet" from
-- "evaluated false".
--
-- Carries stepKey as well as stepId so the report survives the merchant editing
-- the flow, on the same reasoning as the column above.
CREATE TABLE "JourneyPathEvent" (
    "id"           TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepId"       TEXT NOT NULL,
    "stepKey"      TEXT NOT NULL,
    "branch"       TEXT NOT NULL,
    "matched"      BOOLEAN NOT NULL,
    "evaluatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyPathEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JourneyPathEvent_enrollmentId_idx" ON "JourneyPathEvent"("enrollmentId");
CREATE INDEX "JourneyPathEvent_stepKey_branch_idx" ON "JourneyPathEvent"("stepKey", "branch");

-- Cascade, so a redacted contact's enrollments take their path history with
-- them. gdpr.server.js deletes enrollments by shop+email; this row is reachable
-- only through one, and holds no address of its own.
ALTER TABLE "JourneyPathEvent"
  ADD CONSTRAINT "JourneyPathEvent_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "JourneyEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── JourneyEnrollment scheduling ───────────────────────────────────────────
--
-- 'eager' is how this app has always worked: every job for the whole flow is
-- created at enrollment, each on its own absolute schedule. It cannot express a
-- branch, because you cannot pre-schedule a path nobody has chosen yet.
--
-- 'lazy' schedules the next node only when the current one settles.
-- currentStepId is where the contact stands in the graph; nextRunAt is when the
-- advance worker should look at them again — set while parked on a Wait, null
-- while waiting on an outstanding job.
--
-- Defaulting to 'eager' is what lets the two run side by side: every enrollment
-- that exists right now keeps its pre-created jobs and finishes exactly as it
-- would have. Nothing writes 'lazy' until phase 3.
ALTER TABLE "JourneyEnrollment" ADD COLUMN "schedulingMode" TEXT NOT NULL DEFAULT 'eager';
ALTER TABLE "JourneyEnrollment" ADD COLUMN "currentStepId"  TEXT;
ALTER TABLE "JourneyEnrollment" ADD COLUMN "nextRunAt"      TIMESTAMP(3);

CREATE INDEX "JourneyEnrollment_schedulingMode_nextRunAt_idx"
  ON "JourneyEnrollment"("schedulingMode", "nextRunAt");
