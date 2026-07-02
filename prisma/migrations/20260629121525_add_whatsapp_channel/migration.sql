-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "whatsappOptInAt" TIMESTAMP(3),
ADD COLUMN     "whatsappStatus" TEXT NOT NULL DEFAULT 'never_opted_in';

-- AlterTable
ALTER TABLE "JourneyStep" ADD COLUMN     "waLanguage" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "waMediaUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "waTemplateName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "waVariables" JSONB;

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappProvider" TEXT NOT NULL DEFAULT 'meta';

-- CreateTable
CREATE TABLE "WhatsappAccount" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL DEFAULT '',
    "phoneNumberId" TEXT NOT NULL DEFAULT '',
    "displayPhoneNumber" TEXT NOT NULL DEFAULT '',
    "businessId" TEXT NOT NULL DEFAULT '',
    "accessTokenEnc" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "connectedAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappTemplate" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "metaTemplateId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "bodyText" TEXT NOT NULL DEFAULT '',
    "components" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappSubscription" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'subscribed',
    "optInMethod" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "optInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "templateName" TEXT NOT NULL DEFAULT '',
    "providerMessageId" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappSuppression" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappAccount_shop_key" ON "WhatsappAccount"("shop");

-- CreateIndex
CREATE INDEX "WhatsappTemplate_shop_status_idx" ON "WhatsappTemplate"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplate_shop_name_language_key" ON "WhatsappTemplate"("shop", "name", "language");

-- CreateIndex
CREATE INDEX "WhatsappSubscription_shop_contactEmail_idx" ON "WhatsappSubscription"("shop", "contactEmail");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappSubscription_shop_phoneNumber_key" ON "WhatsappSubscription"("shop", "phoneNumber");

-- CreateIndex
CREATE INDEX "WhatsappJob_status_scheduledFor_idx" ON "WhatsappJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "WhatsappJob_shop_enrollmentId_idx" ON "WhatsappJob"("shop", "enrollmentId");

-- CreateIndex
CREATE INDEX "WhatsappJob_providerMessageId_idx" ON "WhatsappJob"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappSuppression_shop_phoneNumber_key" ON "WhatsappSuppression"("shop", "phoneNumber");

-- CreateIndex
CREATE INDEX "Contact_shop_whatsappStatus_idx" ON "Contact"("shop", "whatsappStatus");

-- AddForeignKey
ALTER TABLE "WhatsappJob" ADD CONSTRAINT "WhatsappJob_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "JourneyEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappJob" ADD CONSTRAINT "WhatsappJob_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "JourneyStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
