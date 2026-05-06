-- CreateTable
CREATE TABLE "PopupSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT 'Wait — don''t go yet!',
    "bodyText" TEXT NOT NULL DEFAULT 'Enter your email and get 10% off your first order.',
    "buttonText" TEXT NOT NULL DEFAULT 'Get my discount',
    "brandColor" TEXT NOT NULL DEFAULT '#000000',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "discountPct" INTEGER NOT NULL DEFAULT 10,
    "delayMs" INTEGER NOT NULL DEFAULT 3000,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PopupSignup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'exit_intent_popup',
    "discountCode" TEXT NOT NULL DEFAULT '',
    "confirmToken" TEXT NOT NULL DEFAULT '',
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_PopupSignup" ("confirmedAt", "createdAt", "discountCode", "email", "id", "shop", "source") SELECT "confirmedAt", "createdAt", "discountCode", "email", "id", "shop", "source" FROM "PopupSignup";
DROP TABLE "PopupSignup";
ALTER TABLE "new_PopupSignup" RENAME TO "PopupSignup";
CREATE INDEX "PopupSignup_shop_email_idx" ON "PopupSignup"("shop", "email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PopupSettings_shop_key" ON "PopupSettings"("shop");
