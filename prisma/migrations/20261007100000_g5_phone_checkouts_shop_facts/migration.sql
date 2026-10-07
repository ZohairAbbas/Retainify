-- Growzar Phase 5 (G-RTN5-4, -5, -7): phones in E.164, checkout phone and
-- currency, and a cache of the shop's own country/currency/timezone.
--
-- Additive except one change: AbandonedCart.currency loses its "USD" default
-- and becomes nullable, so a checkout with no currency is stored as unknown
-- rather than as dollars. Existing values are kept as they are.

-- AlterTable
ALTER TABLE "AbandonedCart" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneE164" TEXT,
ALTER COLUMN "currency" DROP NOT NULL,
ALTER COLUMN "currency" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "phoneE164" TEXT;

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "shopifyCountry" TEXT,
ADD COLUMN     "shopifyCurrency" TEXT,
ADD COLUMN     "shopifyFactsAt" TIMESTAMP(3),
ADD COLUMN     "shopifyTimezone" TEXT;

-- CreateIndex
CREATE INDEX "AbandonedCart_shop_updatedAt_idx" ON "AbandonedCart"("shop", "updatedAt");

-- CreateIndex
CREATE INDEX "Contact_shop_updatedAt_idx" ON "Contact"("shop", "updatedAt");

-- CreateIndex
CREATE INDEX "Contact_shop_phoneE164_idx" ON "Contact"("shop", "phoneE164");
