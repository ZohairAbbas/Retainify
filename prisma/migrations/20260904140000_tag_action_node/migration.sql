-- Tag action node — the first step type that WRITES rather than sends or decides.
--
-- ── What it closes ─────────────────────────────────────────────────────────
-- A flow could read the contact record (entry filters, split conditions) but
-- never write to it, so nothing a flow learned could be used by the next one.
-- Tagging is the loop: a flow tags, a segment collects, the next flow targets.

-- Which tag, and whether to add or remove it. Null on every other node type.
ALTER TABLE "JourneyStep" ADD COLUMN "tagId" TEXT;
ALTER TABLE "JourneyStep" ADD COLUMN "tagAction" TEXT NOT NULL DEFAULT 'add'; -- add | remove

-- ── Where the tag came from ────────────────────────────────────────────────
-- A tag applied by a flow and one applied by hand are the same tag to the
-- merchant, and should stay that way in the UI. But they are not the same
-- thing to fix: a flow that mis-tags four thousand contacts overnight leaves
-- no way to find which rows it touched, and "remove this tag from everyone"
-- would also strip the ones a human applied deliberately.
--
-- The step's stable key rather than its id: saveDraft recreates every step
-- row on each edit, so an id here would go stale the first time the merchant
-- touched the flow. The key is what survives, and it is what every report
-- already groups by.
--
-- Nullable, and null means "applied by hand" — which is exactly what every
-- row that exists today is.
ALTER TABLE "ContactTag" ADD COLUMN "appliedByStepKey" TEXT;

-- Finding a flow's own tagging is the reason the column exists, so it gets an
-- index rather than a sequential scan of the join table.
CREATE INDEX "ContactTag_appliedByStepKey_idx" ON "ContactTag"("appliedByStepKey");
