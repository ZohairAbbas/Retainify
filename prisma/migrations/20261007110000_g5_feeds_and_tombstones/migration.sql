-- Growzar Phase 5 (G-RTN5-1, -2, -3, -7): what the read feeds sync on.
--
-- JourneyEnrollment gets the updatedAt it never had, backfilled to the last
-- thing that happened to the row: coalesce(completedAt, enrolledAt). Added with
-- a temporary default so the NOT NULL column can be created on a populated
-- table, then the default is dropped to match Prisma's @updatedAt (client-set).
-- About 19k rows today.

-- AlterTable
ALTER TABLE "JourneyEnrollment" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "JourneyEnrollment" SET "updatedAt" = COALESCE("completedAt", "enrolledAt");
ALTER TABLE "JourneyEnrollment" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "GrowzarTombstone" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "feed" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowzarTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrowzarTombstone_shop_feed_deletedAt_idx" ON "GrowzarTombstone"("shop", "feed", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GrowzarTombstone_shop_feed_rowId_key" ON "GrowzarTombstone"("shop", "feed", "rowId");

-- CreateIndex
CREATE INDEX "Journey_shop_updatedAt_idx" ON "Journey"("shop", "updatedAt");

-- CreateIndex
CREATE INDEX "JourneyEnrollment_shop_updatedAt_idx" ON "JourneyEnrollment"("shop", "updatedAt");

-- CreateIndex
CREATE INDEX "PushJob_shop_updatedAt_idx" ON "PushJob"("shop", "updatedAt");

-- CreateIndex
CREATE INDEX "WhatsappJob_shop_updatedAt_idx" ON "WhatsappJob"("shop", "updatedAt");
