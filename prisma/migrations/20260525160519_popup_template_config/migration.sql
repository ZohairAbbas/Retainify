-- Add template + config columns for the popup template revamp.
ALTER TABLE "PopupSettings"
  ADD COLUMN "template" TEXT NOT NULL DEFAULT 'editorial',
  ADD COLUMN "config" JSONB;

-- Backfill existing rows: map the old single-modal fields onto the Editorial template's schema
-- so merchants see a popup that resembles what they had configured before.
UPDATE "PopupSettings"
SET "config" = jsonb_build_object(
  'masthead', 'YOUR BRAND',
  'headline', "headline",
  'body', "bodyText",
  'cta', "buttonText",
  'placeholder', 'your address',
  'fine', 'By subscribing you agree to receive marketing emails. Unsubscribe anytime.',
  'image', 'amber',
  'accent', 'burgundy',
  'discount', "discountPct",
  'trigger', 'delay',
  'delay', GREATEST(0, ("delayMs" / 1000))::text,
  'frequency', 'session'
)
WHERE "config" IS NULL;
