/*
  Warnings:

  - You are about to alter the column `email1DelayHours` on the `JourneySettings` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.
  - You are about to alter the column `email2DelayHours` on the `JourneySettings` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.
  - You are about to alter the column `email3DelayHours` on the `JourneySettings` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JourneySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "templateStyle" TEXT NOT NULL DEFAULT 'classic',
    "email1Enabled" BOOLEAN NOT NULL DEFAULT true,
    "email1DelayHours" REAL NOT NULL DEFAULT 1,
    "email1Subject" TEXT NOT NULL DEFAULT 'You left something behind',
    "email1Body" TEXT NOT NULL DEFAULT '',
    "email2Enabled" BOOLEAN NOT NULL DEFAULT true,
    "email2DelayHours" REAL NOT NULL DEFAULT 24,
    "email2Subject" TEXT NOT NULL DEFAULT 'Still thinking it over?',
    "email2Body" TEXT NOT NULL DEFAULT '',
    "email3Enabled" BOOLEAN NOT NULL DEFAULT true,
    "email3DelayHours" REAL NOT NULL DEFAULT 72,
    "email3Subject" TEXT NOT NULL DEFAULT 'Last chance — 10% off',
    "email3Body" TEXT NOT NULL DEFAULT '',
    "email3DiscountPct" INTEGER NOT NULL DEFAULT 10,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_JourneySettings" ("createdAt", "email1Body", "email1DelayHours", "email1Enabled", "email1Subject", "email2Body", "email2DelayHours", "email2Enabled", "email2Subject", "email3Body", "email3DelayHours", "email3DiscountPct", "email3Enabled", "email3Subject", "id", "shop", "templateStyle", "updatedAt") SELECT "createdAt", "email1Body", "email1DelayHours", "email1Enabled", "email1Subject", "email2Body", "email2DelayHours", "email2Enabled", "email2Subject", "email3Body", "email3DelayHours", "email3DiscountPct", "email3Enabled", "email3Subject", "id", "shop", "templateStyle", "updatedAt" FROM "JourneySettings";
DROP TABLE "JourneySettings";
ALTER TABLE "new_JourneySettings" RENAME TO "JourneySettings";
CREATE UNIQUE INDEX "JourneySettings_shop_key" ON "JourneySettings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
