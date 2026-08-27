-- The workspace's public website, used for the {store_url} merge tag and as the
-- fallback target for an email button with no URL. A Shopify install derives it
-- from the shop domain; a direct workspace has no domain to derive it from.
ALTER TABLE "ShopSettings" ADD COLUMN "websiteUrl" TEXT NOT NULL DEFAULT '';
