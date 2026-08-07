-- CreateTable
CREATE TABLE "ShopPlan" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "planKey" TEXT NOT NULL DEFAULT 'free',
    "subscriptionGid" TEXT NOT NULL DEFAULT '',
    "subscriptionName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "isComped" BOOLEAN NOT NULL DEFAULT false,
    "compedReason" TEXT NOT NULL DEFAULT '',
    "compedUntil" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "pushSent" INTEGER NOT NULL DEFAULT 0,
    "whatsappSent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopPlan_shop_key" ON "ShopPlan"("shop");

-- CreateIndex
CREATE INDEX "ShopPlan_planKey_idx" ON "ShopPlan"("planKey");

-- CreateIndex
CREATE INDEX "UsageCounter_shop_periodStart_idx" ON "UsageCounter"("shop", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_shop_periodStart_key" ON "UsageCounter"("shop", "periodStart");
