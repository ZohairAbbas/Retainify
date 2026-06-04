-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "filterTree" JSONB,
    "contactCount" INTEGER NOT NULL DEFAULT 0,
    "lastComputedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SegmentMembership" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SegmentMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Segment_shop_deletedAt_idx" ON "Segment"("shop", "deletedAt");

-- CreateIndex
CREATE INDEX "Segment_shop_updatedAt_idx" ON "Segment"("shop", "updatedAt");

-- CreateIndex
CREATE INDEX "SegmentMembership_segmentId_idx" ON "SegmentMembership"("segmentId");

-- CreateIndex
CREATE INDEX "SegmentMembership_contactId_idx" ON "SegmentMembership"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "SegmentMembership_segmentId_contactId_key" ON "SegmentMembership"("segmentId", "contactId");

-- AddForeignKey
ALTER TABLE "SegmentMembership" ADD CONSTRAINT "SegmentMembership_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
