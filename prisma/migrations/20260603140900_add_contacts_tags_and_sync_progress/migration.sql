-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "contactsBackfilledAt" TIMESTAMP(3),
ADD COLUMN     "lastShopifyCustomerSyncAt" TIMESTAMP(3),
ADD COLUMN     "shopifyCustomerSyncCursor" TEXT,
ADD COLUMN     "shopifyCustomerSyncDone" INTEGER,
ADD COLUMN     "shopifyCustomerSyncIncludeNonOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shopifyCustomerSyncLastError" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "shopifyCustomerSyncStatus" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN     "shopifyCustomerSyncTotal" INTEGER;

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'never_opted_in',
    "marketingConsentAt" TIMESTAMP(3),
    "shopifyCustomerId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'forest',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTag" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateIndex
CREATE INDEX "Contact_shop_lastSeenAt_idx" ON "Contact"("shop", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Contact_shop_source_idx" ON "Contact"("shop", "source");

-- CreateIndex
CREATE INDEX "Contact_shop_subscriptionStatus_idx" ON "Contact"("shop", "subscriptionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_shop_email_key" ON "Contact"("shop", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_shop_nameKey_key" ON "Tag"("shop", "nameKey");

-- CreateIndex
CREATE INDEX "ContactTag_tagId_idx" ON "ContactTag"("tagId");

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
