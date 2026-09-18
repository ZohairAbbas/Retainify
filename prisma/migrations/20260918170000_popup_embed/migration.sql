-- Website embed for popups outside Shopify: public site key, allowed domains,
-- and when the embed was last seen live (install check).
ALTER TABLE "PopupSettings" ADD COLUMN "siteKey" TEXT;
ALTER TABLE "PopupSettings" ADD COLUMN "siteDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PopupSettings" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "PopupSettings" ADD COLUMN "lastSeenOrigin" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "PopupSettings_siteKey_key" ON "PopupSettings"("siteKey");
