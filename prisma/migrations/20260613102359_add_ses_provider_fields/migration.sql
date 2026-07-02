-- AlterTable
ALTER TABLE "JourneyJob" ADD COLUMN     "providerMessageId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "emailProvider" TEXT NOT NULL DEFAULT 'resend';

-- CreateIndex
CREATE INDEX "JourneyJob_providerMessageId_idx" ON "JourneyJob"("providerMessageId");
