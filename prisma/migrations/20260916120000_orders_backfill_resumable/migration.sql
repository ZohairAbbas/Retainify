-- Orders backfill: make a partial run resumable.
--
-- ── What it closes ─────────────────────────────────────────────────────────
-- backfillOrders processes 20 pages (100 orders each) per invocation and then
-- returned, leaving ordersBackfillStatus = 'running'. runOrdersBackfillIfNeeded
-- refuses to start while the status is 'running', so the next trigger never
-- resumed: any shop with more than ~2,000 orders imported its first 2,000 and
-- stopped there, permanently. The cursor was being saved correctly the whole
-- time — nothing ever read it again.
--
-- Two things were conflated in one value. 'running' meant both "a run is in
-- flight right now" and "a run ended with work remaining", and the guard could
-- only be right about one of them. 'partial' now carries the second meaning, so
-- the guard can resume from the cursor instead of treating it as a lock.
--
-- ordersBackfillRunAt is the heartbeat that makes 'running' safe to trust: a
-- process killed mid-run leaves the flag set with nothing to clear it, so the
-- code treats a 'running' older than its staleness window as abandoned.
ALTER TABLE "ShopSettings" ADD COLUMN "ordersBackfillRunAt" TIMESTAMP(3);

-- Release the shops already stuck.
--
-- Every row sitting at 'running' right now is frozen by definition: the status
-- is only written by a run that has already returned, and nothing else clears
-- it. Their cursors are intact, so moving them to 'partial' lets the next
-- trigger pick up exactly where each left off rather than re-importing from the
-- beginning.
--
-- Scoped to rows that never completed. A shop with ordersBackfilledAt set is
-- finished regardless of what the status column says, and must not be restarted.
UPDATE "ShopSettings"
   SET "ordersBackfillStatus" = 'partial'
 WHERE "ordersBackfillStatus" = 'running'
   AND "ordersBackfilledAt" IS NULL;
