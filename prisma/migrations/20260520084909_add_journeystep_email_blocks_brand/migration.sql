-- AlterTable
ALTER TABLE "JourneyStep" ADD COLUMN     "emailBlocks" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "emailBrand" TEXT NOT NULL DEFAULT '{}';
