-- Push click tracking.
--
-- Until now PushJob had no click column, so the contact profile computed
-- "push clicks" as COUNT(status = 'done') — the number of pushes successfully
-- SENT — and displayed a 100% click-through rate for every contact who had
-- ever received one. /track/push-click now records real clicks here.

-- AlterTable
ALTER TABLE "PushJob" ADD COLUMN "clickedAt" TIMESTAMP(3);

-- Index the click lookup used by the per-contact and per-step stats queries.
CREATE INDEX "PushJob_shop_clickedAt_idx" ON "PushJob"("shop", "clickedAt");
