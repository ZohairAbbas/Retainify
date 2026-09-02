-- Whether a send's domain had click tracking active, recorded per job.
--
-- Revenue attribution credits a flow when a recipient clicks and then orders.
-- That makes a NULL clickedAt ambiguous: it means either "nobody clicked" or
-- "clicks were never measurable on the domain this went out on". Reporting the
-- second as zero revenue is the worst failure mode the feature has, because it
-- reads as "your flows earned nothing" and merchants act on it.
--
-- Every send that exists today left on the shared domain, whose click tracking
-- was not working -- so DEFAULT false is not a placeholder, it is the correct
-- value for all of them. New sends on a merchant's own verified domain record
-- true, and only those windows report a revenue figure at all.
ALTER TABLE "JourneyJob" ADD COLUMN "clickTracked" BOOLEAN NOT NULL DEFAULT false;

-- The attribution touch set scans every click for a shop. PushJob already
-- carries the equivalent index for the same query.
CREATE INDEX "JourneyJob_shop_clickedAt_idx" ON "JourneyJob"("shop", "clickedAt");
