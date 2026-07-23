-- AlterTable
ALTER TABLE "JourneyStep" ADD COLUMN     "emailHtml" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "emailMode" TEXT NOT NULL DEFAULT 'blocks';
