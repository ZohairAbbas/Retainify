-- Per-contact engagement aggregates, denormalized onto Contact.
--
-- Open rate, click rate, last email opened and push enabled all appeared in the
-- segment field picker greyed out with a "Soon" pill. The data existed --
-- getContactStatsBatch has been computing the rates all along -- but only as a
-- grouped join over JourneyJob, which the evaluator can run solely inside its
-- 5,000-contact JS scan. A merchant building "everyone who hasn't opened
-- anything in 90 days", the standard re-engagement segment, hit a wall.
--
-- As columns they are ordinary indexed values: the rules translate into a
-- Prisma WHERE, and the count is exact regardless of audience size. Same
-- reasoning, same shape, as the orderCount/totalSpent columns next to them.

ALTER TABLE "Contact" ADD COLUMN "emailsSent"         INTEGER   NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN "emailsOpened"       INTEGER   NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN "emailsClicked"      INTEGER   NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN "emailsClickTracked" INTEGER   NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN "openRate"           DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN "clickRate"          DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN "lastEmailOpenedAt"  TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "pushEnabled"        BOOLEAN   NOT NULL DEFAULT false;

-- ── Backfill: email engagement ────────────────────────────────────────────
-- One grouped pass over the whole send history. The rollup worker keeps these
-- current from here on; this is the only time the full table is recomputed.
--
-- The denominators are deliberately different. emailsSent excludes sends the
-- provider later reported as failed, so a bounce does not sit in an open-rate
-- denominator forever. emailsClickTracked excludes sends whose domain had no
-- click tracking, because those cannot record a click -- counting them would
-- publish a measurement gap as a 0% click rate.
UPDATE "Contact" c
   SET "emailsSent"         = agg.sent,
       "emailsOpened"       = agg.opened,
       "emailsClicked"      = agg.clicked,
       "emailsClickTracked" = agg.click_tracked,
       "openRate"           = CASE WHEN agg.sent > 0
                                   THEN (agg.opened::double precision / agg.sent) * 100
                                   ELSE 0 END,
       "clickRate"          = CASE WHEN agg.click_tracked > 0
                                   THEN (agg.clicked::double precision / agg.click_tracked) * 100
                                   ELSE 0 END,
       "lastEmailOpenedAt"  = agg.last_opened
  FROM (
        SELECT j."shop"                AS shop,
               e."contactEmail"        AS email,
               COUNT(*) FILTER (WHERE j."sentAt" IS NOT NULL
                                  AND j."failedAt" IS NULL)          AS sent,
               COUNT(*) FILTER (WHERE j."openedAt" IS NOT NULL)      AS opened,
               COUNT(*) FILTER (WHERE j."clickedAt" IS NOT NULL)     AS clicked,
               COUNT(*) FILTER (WHERE j."sentAt" IS NOT NULL
                                  AND j."failedAt" IS NULL
                                  AND j."clickTracked")              AS click_tracked,
               MAX(j."openedAt")                                     AS last_opened
          FROM "JourneyJob" j
          JOIN "JourneyEnrollment" e ON e."id" = j."enrollmentId"
         GROUP BY j."shop", e."contactEmail"
       ) agg
 WHERE c."shop" = agg.shop AND c."email" = agg.email;

-- ── Backfill: push ────────────────────────────────────────────────────────
-- First, normalize the join key. PushSubscription.contactEmail was written with
-- whatever case the browser sent, while Contact.email is always lowercased on
-- write, so any subscription saved with a capital letter matched no contact at
-- all -- not for the pushEnabled rollup below, and not for the push worker
-- looking up a recipient's endpoints either. The route now lowercases on write;
-- this repairs the rows already stored.
UPDATE "PushSubscription"
   SET "contactEmail" = lower(btrim("contactEmail"))
 WHERE "contactEmail" IS NOT NULL
   AND "contactEmail" <> lower(btrim("contactEmail"));

-- A subscription with no contactEmail is an anonymous browser (anonId only) and
-- belongs to no contact, so the join drops it.
UPDATE "Contact" c
   SET "pushEnabled" = true
  FROM (
        SELECT DISTINCT p."shop" AS shop, p."contactEmail" AS email
          FROM "PushSubscription" p
         WHERE p."isActive" AND p."contactEmail" IS NOT NULL
       ) sub
 WHERE c."shop" = sub.shop AND c."email" = sub.email;

CREATE INDEX "Contact_shop_openRate_idx"          ON "Contact"("shop", "openRate");
CREATE INDEX "Contact_shop_clickRate_idx"         ON "Contact"("shop", "clickRate");
CREATE INDEX "Contact_shop_lastEmailOpenedAt_idx" ON "Contact"("shop", "lastEmailOpenedAt");
