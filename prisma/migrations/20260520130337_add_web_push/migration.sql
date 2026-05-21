-- AlterTable
ALTER TABLE "JourneyStep" ADD COLUMN     "pushBody" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pushClickUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pushIconUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pushTitle" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "pushEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "contactEmail" TEXT,
    "anonId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushSubscription_shop_contactEmail_idx" ON "PushSubscription"("shop", "contactEmail");

-- CreateIndex
CREATE INDEX "PushSubscription_shop_anonId_idx" ON "PushSubscription"("shop", "anonId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_shop_endpoint_key" ON "PushSubscription"("shop", "endpoint");

-- CreateIndex
CREATE INDEX "PushJob_status_scheduledFor_idx" ON "PushJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "PushJob_shop_enrollmentId_idx" ON "PushJob"("shop", "enrollmentId");

-- AddForeignKey
ALTER TABLE "PushJob" ADD CONSTRAINT "PushJob_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "JourneyEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushJob" ADD CONSTRAINT "PushJob_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "JourneyStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
