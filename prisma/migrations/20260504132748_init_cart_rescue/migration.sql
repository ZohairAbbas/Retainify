-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "JourneySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "templateStyle" TEXT NOT NULL DEFAULT 'classic',
    "email1Enabled" BOOLEAN NOT NULL DEFAULT true,
    "email1DelayHours" INTEGER NOT NULL DEFAULT 1,
    "email1Subject" TEXT NOT NULL DEFAULT 'You left something behind',
    "email1Body" TEXT NOT NULL DEFAULT '',
    "email2Enabled" BOOLEAN NOT NULL DEFAULT true,
    "email2DelayHours" INTEGER NOT NULL DEFAULT 24,
    "email2Subject" TEXT NOT NULL DEFAULT 'Still thinking it over?',
    "email2Body" TEXT NOT NULL DEFAULT '',
    "email3Enabled" BOOLEAN NOT NULL DEFAULT true,
    "email3DelayHours" INTEGER NOT NULL DEFAULT 72,
    "email3Subject" TEXT NOT NULL DEFAULT 'Last chance — 10% off',
    "email3Body" TEXT NOT NULL DEFAULT '',
    "email3DiscountPct" INTEGER NOT NULL DEFAULT 10,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AbandonedCart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "checkoutToken" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "cartToken" TEXT NOT NULL DEFAULT '',
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT NOT NULL DEFAULT '',
    "totalPrice" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "lineItemsJson" TEXT NOT NULL,
    "recoveryUrl" TEXT NOT NULL,
    "abandonedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recoveredAt" DATETIME,
    "recoveredRevenue" REAL,
    "email1SentAt" DATETIME,
    "email2SentAt" DATETIME,
    "email3SentAt" DATETIME,
    "discountCode" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CartRescueEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "abandonedCartId" TEXT NOT NULL,
    "emailNumber" INTEGER NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sentAt" DATETIME,
    "openedAt" DATETIME,
    "clickedAt" DATETIME,
    "bounced" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribed" BOOLEAN NOT NULL DEFAULT false,
    "resendMessageId" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CartRescueEmail_abandonedCartId_fkey" FOREIGN KEY ("abandonedCartId") REFERENCES "AbandonedCart" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "abandonedCartId" TEXT NOT NULL,
    "emailNumber" INTEGER NOT NULL,
    "scheduledFor" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailJob_abandonedCartId_fkey" FOREIGN KEY ("abandonedCartId") REFERENCES "AbandonedCart" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'unsubscribe',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PopupSignup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'exit_intent_popup',
    "discountCode" TEXT NOT NULL DEFAULT '',
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
