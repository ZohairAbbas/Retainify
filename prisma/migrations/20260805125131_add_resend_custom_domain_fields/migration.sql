-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "domainRecords" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "domainStatus" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "resendDomainId" TEXT NOT NULL DEFAULT '';
