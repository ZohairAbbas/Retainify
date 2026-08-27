-- Order ingestion.
--
-- Until now no order data was stored anywhere, which is why the four Purchase
-- segment fields (total spent, order count, last order date, AOV) were all
-- disabled, why revenue attribution only existed for cart recovery, and why
-- lifecycle staging could not consider purchase recency.

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "financialStatus" TEXT NOT NULL DEFAULT '',
    "processedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Order_shop_shopifyOrderId_key" ON "Order"("shop", "shopifyOrderId");
CREATE INDEX "Order_shop_email_idx" ON "Order"("shop", "email");
CREATE INDEX "Order_shop_processedAt_idx" ON "Order"("shop", "processedAt");

-- Purchase facts denormalized onto Contact so segment rules can compare them
-- as indexed columns instead of aggregating per contact at evaluation time.
ALTER TABLE "Contact" ADD COLUMN "orderCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN "firstOrderAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "lastOrderAt" TIMESTAMP(3);

CREATE INDEX "Contact_shop_lastOrderAt_idx" ON "Contact"("shop", "lastOrderAt");
CREATE INDEX "Contact_shop_totalSpent_idx" ON "Contact"("shop", "totalSpent");

-- Resumable historical backfill state.
ALTER TABLE "ShopSettings" ADD COLUMN "ordersBackfilledAt" TIMESTAMP(3);
ALTER TABLE "ShopSettings" ADD COLUMN "ordersBackfillCursor" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "ordersBackfillStatus" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "ShopSettings" ADD COLUMN "ordersBackfillError" TEXT NOT NULL DEFAULT '';
