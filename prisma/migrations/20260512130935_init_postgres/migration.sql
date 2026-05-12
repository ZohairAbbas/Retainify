-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "senderName" TEXT NOT NULL DEFAULT 'Your Store',
    "senderEmail" TEXT NOT NULL DEFAULT '',
    "replyTo" TEXT NOT NULL DEFAULT '',
    "brandColor" TEXT NOT NULL DEFAULT '#000000',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "quietHoursStart" INTEGER NOT NULL DEFAULT 22,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 8,
    "storeTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "verifiedDomain" TEXT NOT NULL DEFAULT '',
    "domainVerified" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneySettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "templateStyle" TEXT NOT NULL DEFAULT 'classic',
    "email1Enabled" BOOLEAN NOT NULL DEFAULT true,
    "email1DelayHours" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "email1Subject" TEXT NOT NULL DEFAULT 'You left something behind',
    "email1Body" TEXT NOT NULL DEFAULT '',
    "email2Enabled" BOOLEAN NOT NULL DEFAULT true,
    "email2DelayHours" DOUBLE PRECISION NOT NULL DEFAULT 24,
    "email2Subject" TEXT NOT NULL DEFAULT 'Still thinking it over?',
    "email2Body" TEXT NOT NULL DEFAULT '',
    "email3Enabled" BOOLEAN NOT NULL DEFAULT true,
    "email3DelayHours" DOUBLE PRECISION NOT NULL DEFAULT 72,
    "email3Subject" TEXT NOT NULL DEFAULT 'Last chance — 10% off',
    "email3Body" TEXT NOT NULL DEFAULT '',
    "email3DiscountPct" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbandonedCart" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "checkoutToken" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "cartToken" TEXT NOT NULL DEFAULT '',
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT NOT NULL DEFAULT '',
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "lineItemsJson" TEXT NOT NULL,
    "recoveryUrl" TEXT NOT NULL,
    "abandonedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recoveredAt" TIMESTAMP(3),
    "recoveredRevenue" DOUBLE PRECISION,
    "email1SentAt" TIMESTAMP(3),
    "email2SentAt" TIMESTAMP(3),
    "email3SentAt" TIMESTAMP(3),
    "discountCode" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbandonedCart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartRescueEmail" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "abandonedCartId" TEXT NOT NULL,
    "emailNumber" INTEGER NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bounced" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribed" BOOLEAN NOT NULL DEFAULT false,
    "resendMessageId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartRescueEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "abandonedCartId" TEXT NOT NULL,
    "emailNumber" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'unsubscribe',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PopupSignup" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'exit_intent_popup',
    "discountCode" TEXT NOT NULL DEFAULT '',
    "confirmToken" TEXT NOT NULL DEFAULT '',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PopupSignup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PopupSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT 'Wait — don''t go yet!',
    "bodyText" TEXT NOT NULL DEFAULT 'Enter your email and get 10% off your first order.',
    "buttonText" TEXT NOT NULL DEFAULT 'Get my discount',
    "brandColor" TEXT NOT NULL DEFAULT '#000000',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "discountPct" INTEGER NOT NULL DEFAULT 10,
    "delayMs" INTEGER NOT NULL DEFAULT 3000,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PopupSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journey" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyStep" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "delayHours" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "subject" TEXT NOT NULL DEFAULT '',
    "templateStyle" TEXT NOT NULL DEFAULT 'classic',
    "discountPct" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneyStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyEnrollment" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactName" TEXT NOT NULL DEFAULT '',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "exitReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "JourneyEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "resendMessageId" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneyJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "JourneySettings_shop_key" ON "JourneySettings"("shop");

-- CreateIndex
CREATE INDEX "AbandonedCart_shop_customerEmail_idx" ON "AbandonedCart"("shop", "customerEmail");

-- CreateIndex
CREATE INDEX "AbandonedCart_shop_recoveredAt_idx" ON "AbandonedCart"("shop", "recoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AbandonedCart_shop_checkoutToken_key" ON "AbandonedCart"("shop", "checkoutToken");

-- CreateIndex
CREATE INDEX "CartRescueEmail_shop_sentAt_idx" ON "CartRescueEmail"("shop", "sentAt");

-- CreateIndex
CREATE INDEX "CartRescueEmail_resendMessageId_idx" ON "CartRescueEmail"("resendMessageId");

-- CreateIndex
CREATE INDEX "EmailJob_status_scheduledFor_idx" ON "EmailJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "EmailJob_shop_abandonedCartId_idx" ON "EmailJob"("shop", "abandonedCartId");

-- CreateIndex
CREATE INDEX "EmailSuppression_shop_email_idx" ON "EmailSuppression"("shop", "email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_shop_email_key" ON "EmailSuppression"("shop", "email");

-- CreateIndex
CREATE INDEX "PopupSignup_shop_email_idx" ON "PopupSignup"("shop", "email");

-- CreateIndex
CREATE UNIQUE INDEX "PopupSettings_shop_key" ON "PopupSettings"("shop");

-- CreateIndex
CREATE INDEX "Journey_shop_trigger_idx" ON "Journey"("shop", "trigger");

-- CreateIndex
CREATE INDEX "JourneyStep_journeyId_stepNumber_idx" ON "JourneyStep"("journeyId", "stepNumber");

-- CreateIndex
CREATE INDEX "JourneyEnrollment_shop_contactEmail_idx" ON "JourneyEnrollment"("shop", "contactEmail");

-- CreateIndex
CREATE INDEX "JourneyEnrollment_journeyId_idx" ON "JourneyEnrollment"("journeyId");

-- CreateIndex
CREATE INDEX "JourneyJob_status_scheduledFor_idx" ON "JourneyJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "JourneyJob_shop_enrollmentId_idx" ON "JourneyJob"("shop", "enrollmentId");

-- AddForeignKey
ALTER TABLE "CartRescueEmail" ADD CONSTRAINT "CartRescueEmail_abandonedCartId_fkey" FOREIGN KEY ("abandonedCartId") REFERENCES "AbandonedCart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_abandonedCartId_fkey" FOREIGN KEY ("abandonedCartId") REFERENCES "AbandonedCart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyStep" ADD CONSTRAINT "JourneyStep_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyEnrollment" ADD CONSTRAINT "JourneyEnrollment_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyJob" ADD CONSTRAINT "JourneyJob_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "JourneyEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyJob" ADD CONSTRAINT "JourneyJob_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "JourneyStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
