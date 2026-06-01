/*
  Warnings:

  - You are about to drop the column `discountCode` on the `AbandonedCart` table. All the data in the column will be lost.
  - You are about to drop the column `email1SentAt` on the `AbandonedCart` table. All the data in the column will be lost.
  - You are about to drop the column `email2SentAt` on the `AbandonedCart` table. All the data in the column will be lost.
  - You are about to drop the column `email3SentAt` on the `AbandonedCart` table. All the data in the column will be lost.
  - You are about to drop the `CartRescueEmail` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmailJob` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JourneySettings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "CartRescueEmail" DROP CONSTRAINT "CartRescueEmail_abandonedCartId_fkey";

-- DropForeignKey
ALTER TABLE "EmailJob" DROP CONSTRAINT "EmailJob_abandonedCartId_fkey";

-- AlterTable
ALTER TABLE "AbandonedCart" DROP COLUMN "discountCode",
DROP COLUMN "email1SentAt",
DROP COLUMN "email2SentAt",
DROP COLUMN "email3SentAt";

-- DropTable
DROP TABLE "CartRescueEmail";

-- DropTable
DROP TABLE "EmailJob";

-- DropTable
DROP TABLE "JourneySettings";
