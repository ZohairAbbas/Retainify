-- The lazy cursor's stepKey, carried alongside its step id.
--
-- currentStepId alone is not a durable cursor. saveDraft deletes and recreates
-- every step on every edit: a step that still has jobs is archived and replaced,
-- and a step with no jobs is deleted outright. Either way the id under the
-- cursor stops being a live step the moment a merchant touches a flow that has
-- contacts moving through it.
--
-- Recovering from that needs the step's stepKey, and the id cannot yield it —
-- a deleted row leaves nothing to look it up on. So the key rides on the
-- enrollment itself, and the walk resolves the cursor as "the live step with
-- this key", falling back to ending the flow only when the merchant genuinely
-- removed that step.
--
-- Without this, every contact mid-flight through an edited flow silently stops
-- receiving mail — no failed job, no error, nothing in any report.
ALTER TABLE "JourneyEnrollment" ADD COLUMN "currentStepKey" TEXT;

-- Backfill for any lazy enrollment created between the branching migration and
-- this one. Normally none exist (the lazy scheduler ships with this change),
-- but a partial deploy must not leave a cursor that cannot be resolved.
UPDATE "JourneyEnrollment" e
   SET "currentStepKey" = s."stepKey"
  FROM "JourneyStep" s
 WHERE s."id" = e."currentStepId"
   AND e."currentStepKey" IS NULL;
