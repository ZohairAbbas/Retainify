-- Merchant-defined contact properties, saved Contacts views, and the content
-- library index.

-- AlterTable: JSONB bag of merchant-defined property values on each contact.
ALTER TABLE "Contact" ADD COLUMN "customProps" JSONB;

-- CreateTable
CREATE TABLE "ContactPropertyDef" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "options" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactPropertyDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactPropertyDef_shop_key_key" ON "ContactPropertyDef"("shop", "key");
CREATE INDEX "ContactPropertyDef_shop_position_idx" ON "ContactPropertyDef"("shop", "position");

-- CreateTable
CREATE TABLE "ContactView" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB,
    "columns" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactView_shop_position_idx" ON "ContactView"("shop", "position");

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "shopifyGid" TEXT NOT NULL DEFAULT '',
    "filename" TEXT NOT NULL DEFAULT '',
    "mimeType" TEXT NOT NULL DEFAULT '',
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "alt" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'library',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MediaAsset_shop_createdAt_idx" ON "MediaAsset"("shop", "createdAt");
CREATE INDEX "MediaAsset_shop_mimeType_idx" ON "MediaAsset"("shop", "mimeType");

-- Query custom properties efficiently (segment rules and view filters).
CREATE INDEX "Contact_customProps_idx" ON "Contact" USING GIN ("customProps");
