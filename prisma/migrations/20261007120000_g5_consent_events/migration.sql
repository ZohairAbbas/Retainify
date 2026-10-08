-- Growzar Phase 5 (G-RTN5-6, -7): consent history, and keeping feed rows'
-- updatedAt honest when the buyer behind them changes.
--
-- Both are triggers on "Contact", deliberately. About fifteen code paths change
-- consent, several of them in raw SQL (the contacts backfill) or createMany (CSV
-- import), and a phone or deletedAt change has to move the updatedAt of every
-- feed row that returns that buyer. App code at each writer would be correct
-- only until the next writer is added; a trigger cannot be bypassed.
--
-- Timestamps are written as UTC explicitly (AT TIME ZONE 'UTC') to match what
-- Prisma stores in these timestamp-without-time-zone columns, whatever the
-- session's TimeZone is. clock_timestamp(), not now(): now() is the start of
-- the transaction, which would stamp every event in a long bulk write with the
-- same, increasingly stale, moment.

-- CreateTable
CREATE TABLE "ConsentEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentEvent_shop_createdAt_id_idx" ON "ConsentEvent"("shop", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ConsentEvent_contactId_idx" ON "ConsentEvent"("contactId");

-- The reason a change gets when its writer did not say: read off the state it
-- moved to. A writer that knows better (a Shopify sync, an import, a provider
-- bounce) sets retainify.consent_reason and this is not consulted.
CREATE FUNCTION "retainify_consent_reason"(next TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE next
    WHEN 'subscribed'   THEN 'opt_in'
    WHEN 'unsubscribed' THEN 'unsubscribe'
    WHEN 'bounced'      THEN 'bounce'
    WHEN 'complained'   THEN 'complaint'
    WHEN 'invalid'      THEN 'invalid'
    ELSE NULL
  END
$$;

-- One ConsentEvent per channel whose state changed.
--
-- Context comes from transaction-local settings that withConsentContext()
-- (lib/consent/context.server.js) sets with set_config(..., true):
--   retainify.consent_reason  one of the reason codes, or empty
--   retainify.consent_source  where the change came from
-- Absent context is not an error: the event is still written, with source
-- 'unattributed', so a writer added later without context shows up as one
-- rather than as a gap in the history.
CREATE FUNCTION "retainify_contact_consent_event"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  ctx_reason TEXT := NULLIF(current_setting('retainify.consent_reason', true), '');
  ctx_source TEXT := COALESCE(NULLIF(current_setting('retainify.consent_source', true), ''), 'unattributed');
  at_utc     TIMESTAMP(3) := clock_timestamp() AT TIME ZONE 'UTC';
  old_email  TEXT := 'never_opted_in';
  old_wa     TEXT := 'never_opted_in';
  old_push   BOOLEAN := false;
  push_from  TEXT;
  push_to    TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_email := OLD."subscriptionStatus";
    old_wa    := OLD."whatsappStatus";
    old_push  := OLD."pushEnabled";
  END IF;

  IF NEW."subscriptionStatus" IS DISTINCT FROM old_email THEN
    INSERT INTO "ConsentEvent" ("id", "shop", "contactId", "channel", "from", "to", "reason", "source", "createdAt")
    VALUES (gen_random_uuid()::text, NEW."shop", NEW."id", 'email', old_email, NEW."subscriptionStatus",
            COALESCE(ctx_reason, "retainify_consent_reason"(NEW."subscriptionStatus")), ctx_source, at_utc);
  END IF;

  IF NEW."whatsappStatus" IS DISTINCT FROM old_wa THEN
    INSERT INTO "ConsentEvent" ("id", "shop", "contactId", "channel", "from", "to", "reason", "source", "createdAt")
    VALUES (gen_random_uuid()::text, NEW."shop", NEW."id", 'whatsapp', old_wa, NEW."whatsappStatus",
            COALESCE(ctx_reason, "retainify_consent_reason"(NEW."whatsappStatus")), ctx_source, at_utc);
  END IF;

  -- Push is a boolean on Contact (any active browser subscription), so "never"
  -- and "used to, not any more" look the same there. The history tells them
  -- apart: a contact that has ever been subscribed or unsubscribed (the
  -- baseline row included) is coming back, not new. A baseline row of
  -- "never_opted_in" does not count.
  IF NEW."pushEnabled" IS DISTINCT FROM old_push THEN
    IF NEW."pushEnabled" THEN
      push_to := 'subscribed';
      push_from := CASE WHEN EXISTS (
        SELECT 1 FROM "ConsentEvent"
         WHERE "contactId" = NEW."id" AND "channel" = 'push' AND "to" IN ('subscribed', 'unsubscribed')
      ) THEN 'unsubscribed' ELSE 'never_opted_in' END;
    ELSE
      push_to := 'unsubscribed';
      push_from := 'subscribed';
    END IF;
    INSERT INTO "ConsentEvent" ("id", "shop", "contactId", "channel", "from", "to", "reason", "source", "createdAt")
    VALUES (gen_random_uuid()::text, NEW."shop", NEW."id", 'push', push_from, push_to,
            COALESCE(ctx_reason, "retainify_consent_reason"(push_to)), ctx_source, at_utc);
  END IF;

  RETURN NULL;
END
$$;

CREATE TRIGGER "Contact_consent_event"
AFTER INSERT OR UPDATE OF "subscriptionStatus", "whatsappStatus", "pushEnabled" ON "Contact"
FOR EACH ROW EXECUTE FUNCTION "retainify_contact_consent_event"();

-- The message, enrollment and checkout feeds return a buyer block read from
-- the contact. When the contact's phone is filled in or it is deleted or
-- restored, those rows' contents change, so their updatedAt has to move or
-- Growzar never refetches them (API-CONTRACT §6.2).
--
-- Matched on the exact stored email, which the (shop, contactEmail) and
-- (shop, customerEmail) indexes serve. Rows stored with a differently-cased
-- address (about 1.6% at the time of writing) are not touched; a case-folding
-- match costs a scan of the shop's table per contact and would make a bulk
-- delete of a few thousand contacts take minutes.
CREATE FUNCTION "retainify_contact_buyer_touch"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  at_utc TIMESTAMP(3) := clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  UPDATE "JourneyEnrollment" SET "updatedAt" = at_utc
   WHERE "shop" = NEW."shop" AND "contactEmail" = NEW."email";
  UPDATE "JourneyJob" SET "updatedAt" = at_utc
   WHERE "shop" = NEW."shop" AND "enrollmentId" IN (
     SELECT "id" FROM "JourneyEnrollment" WHERE "shop" = NEW."shop" AND "contactEmail" = NEW."email");
  UPDATE "WhatsappJob" SET "updatedAt" = at_utc
   WHERE "shop" = NEW."shop" AND "enrollmentId" IN (
     SELECT "id" FROM "JourneyEnrollment" WHERE "shop" = NEW."shop" AND "contactEmail" = NEW."email");
  UPDATE "PushJob" SET "updatedAt" = at_utc
   WHERE "shop" = NEW."shop" AND "enrollmentId" IN (
     SELECT "id" FROM "JourneyEnrollment" WHERE "shop" = NEW."shop" AND "contactEmail" = NEW."email");
  UPDATE "AbandonedCart" SET "updatedAt" = at_utc
   WHERE "shop" = NEW."shop" AND "customerEmail" = NEW."email";
  RETURN NULL;
END
$$;

CREATE TRIGGER "Contact_buyer_touch_update"
AFTER UPDATE OF "phone", "phoneE164", "deletedAt" ON "Contact"
FOR EACH ROW
WHEN (OLD."phone" IS DISTINCT FROM NEW."phone"
   OR OLD."phoneE164" IS DISTINCT FROM NEW."phoneE164"
   OR (OLD."deletedAt" IS NULL) <> (NEW."deletedAt" IS NULL))
EXECUTE FUNCTION "retainify_contact_buyer_touch"();

-- A contact created after its enrollments or carts (the contacts backfill, or
-- a cart whose buyer is upserted afterwards) gives those rows a phone they did
-- not have.
CREATE TRIGGER "Contact_buyer_touch_insert"
AFTER INSERT ON "Contact"
FOR EACH ROW
WHEN (NEW."phone" IS NOT NULL OR NEW."phoneE164" IS NOT NULL)
EXECUTE FUNCTION "retainify_contact_buyer_touch"();

-- /consent reports whether a contact's WhatsApp number is suppressed, read
-- from WhatsappSuppression. A suppression added or lifted without a matching
-- Contact write (a STOP from a number whose subscription has no email, say)
-- would change that row without moving its updatedAt. This moves it.
--
-- Matched both ways the two tables can spell one number: the stored digits
-- (Contact.phone and phoneNumber are both normalizePhone output) and E.164.
-- No index on Contact.phone, so this scans one shop's contacts; suppressions
-- change a handful of times a day at most.
CREATE FUNCTION "retainify_whatsapp_suppression_touch"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  rec RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN rec := OLD; ELSE rec := NEW; END IF;
  UPDATE "Contact" SET "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
   WHERE "shop" = rec."shop"
     AND ("phone" = rec."phoneNumber" OR "phoneE164" = '+' || rec."phoneNumber");
  RETURN NULL;
END
$$;

CREATE TRIGGER "WhatsappSuppression_contact_touch"
AFTER INSERT OR UPDATE OR DELETE ON "WhatsappSuppression"
FOR EACH ROW EXECUTE FUNCTION "retainify_whatsapp_suppression_touch"();
