-- The shop country was read from Shopify's billing address, which for at
-- least one Karachi store selling in PKR is GB. Used as the phone region, it
-- turned local numbers ("0300 1234567") into valid UK ones. The country now
-- comes from the primary location (lib/growzar/shop-facts.server.js).
--
-- Forget every cached fact so the next read fetches the right country, and
-- every E.164 computed since the Phase 5 deploy (2026-10-08), since any of
-- them may have been parsed with the wrong region. scripts/growzar-g5-
-- backfill.mjs recomputes them from the raw phones, which are untouched.
-- Data only; no schema change.
UPDATE "ShopSettings"
   SET "shopifyCountry" = NULL, "shopifyCurrency" = NULL, "shopifyTimezone" = NULL, "shopifyFactsAt" = NULL
 WHERE "shopifyFactsAt" IS NOT NULL;

UPDATE "Contact" SET "phoneE164" = NULL WHERE "phoneE164" IS NOT NULL;
UPDATE "AbandonedCart" SET "phoneE164" = NULL WHERE "phoneE164" IS NOT NULL;
