-- Cart and AOV aggregates on Contact -- the last fields the segment evaluator
-- could not compare in SQL.
--
-- Everything else was closed by the engagement rollup. What remained forcing the
-- in-memory scan was the four Cart fields (a live aggregate over AbandonedCart),
-- lifecycleStage, and AOV. Lifecycle needs no column: once lastCartAt exists,
-- all of its inputs are columns and it becomes date arithmetic in the WHERE.
-- AOV needs one only because a Prisma WHERE cannot divide one column by another.
--
-- With these in place no rule requires loading a contact into memory, so the
-- 5,000-row scan cap comes out. That cap was not a performance guard, it was a
-- correctness bug: a shop above it evaluated a partial audience, and the scan
-- was ordered by lastSeenAt DESC, so the contacts it skipped were exactly the
-- dormant ones that recency segments are built to find.

ALTER TABLE "Contact" ADD COLUMN "aov"              DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN "cartAbandonCount" INTEGER          NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN "lastCartAt"       TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "lastCartValue"    DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ── Backfill: AOV ─────────────────────────────────────────────────────────
-- Straight from the columns beside it. Zero orders means zero, not a division
-- by zero, matching what averageOrderValue() has always returned on read.
UPDATE "Contact"
   SET "aov" = CASE WHEN "orderCount" > 0
                    THEN "totalSpent" / "orderCount"
                    ELSE 0 END
 WHERE "orderCount" > 0;

-- ── Backfill: cart ────────────────────────────────────────────────────────
-- DISTINCT ON gives the latest cart per contact, which is what lastCartValue
-- has to read: the field is labelled "Last cart value" but was computed as
-- MAX(totalPrice), so a shopper whose largest cart was not their most recent
-- one reported a value they never actually abandoned.
--
-- customerEmail is lowercased in the join because Contact.email always is, and
-- AbandonedCart is written from checkout payloads that are not normalized.
UPDATE "Contact" c
   SET "cartAbandonCount" = agg.carts,
       "lastCartAt"       = agg.last_at,
       "lastCartValue"    = agg.last_value
  FROM (
        SELECT DISTINCT ON (a."shop", lower(btrim(a."customerEmail")))
               a."shop"                            AS shop,
               lower(btrim(a."customerEmail"))     AS email,
               a."abandonedAt"                     AS last_at,
               a."totalPrice"                      AS last_value,
               COUNT(*) OVER (PARTITION BY a."shop", lower(btrim(a."customerEmail"))) AS carts
          FROM "AbandonedCart" a
         WHERE a."customerEmail" IS NOT NULL AND a."customerEmail" <> ''
         ORDER BY a."shop", lower(btrim(a."customerEmail")), a."abandonedAt" DESC
       ) agg
 WHERE c."shop" = agg.shop AND c."email" = agg.email;

CREATE INDEX "Contact_shop_aov_idx"              ON "Contact"("shop", "aov");
CREATE INDEX "Contact_shop_lastCartAt_idx"       ON "Contact"("shop", "lastCartAt");
CREATE INDEX "Contact_shop_cartAbandonCount_idx" ON "Contact"("shop", "cartAbandonCount");
