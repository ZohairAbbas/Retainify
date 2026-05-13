-- AlterTable
ALTER TABLE "Journey" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "draftVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "entryFrequency" TEXT NOT NULL DEFAULT 'no_reentry',
ADD COLUMN     "exitCriteria" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'flows',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft';

-- AlterTable
ALTER TABLE "JourneyStep" ADD COLUMN     "emailName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "nodeType" TEXT NOT NULL DEFAULT 'email',
ADD COLUMN     "positionY" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "previewText" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "JourneyTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "trigger" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "bestFor" TEXT NOT NULL DEFAULT '[]',
    "definition" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JourneyTemplate_key_key" ON "JourneyTemplate"("key");

-- CreateIndex
CREATE INDEX "Journey_shop_status_idx" ON "Journey"("shop", "status");
