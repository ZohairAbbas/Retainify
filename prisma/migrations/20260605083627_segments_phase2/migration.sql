-- AlterTable
ALTER TABLE "Journey" ADD COLUMN     "lastEnrollmentAt" TIMESTAMP(3),
ADD COLUMN     "lastEnrollmentHash" TEXT,
ADD COLUMN     "triggerSegmentKey" TEXT;

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "lastSegmentSnapshotAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SegmentEntryLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "segmentKey" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "SegmentEntryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SegmentSnapshot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "segmentKey" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL,

    CONSTRAINT "SegmentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SegmentEntryLog_shop_segmentKey_enteredAt_idx" ON "SegmentEntryLog"("shop", "segmentKey", "enteredAt");

-- CreateIndex
CREATE INDEX "SegmentEntryLog_shop_segmentKey_leftAt_idx" ON "SegmentEntryLog"("shop", "segmentKey", "leftAt");

-- CreateIndex
CREATE INDEX "SegmentEntryLog_contactId_idx" ON "SegmentEntryLog"("contactId");

-- CreateIndex
CREATE INDEX "SegmentSnapshot_shop_segmentKey_takenAt_idx" ON "SegmentSnapshot"("shop", "segmentKey", "takenAt");

-- CreateIndex
CREATE INDEX "Journey_trigger_status_lastEnrollmentAt_idx" ON "Journey"("trigger", "status", "lastEnrollmentAt");
