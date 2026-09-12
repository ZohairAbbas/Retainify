-- v1's external flow name, replaced by Journey.triggerApp/triggerEvent in
-- 20260911120000_app_event_triggers. Nothing has read or written it since.
--
-- DEPLOY ORDER MATTERS. Prisma names every column in its SELECTs, so this may
-- only run once every process is on a build whose client was generated WITHOUT
-- journeyKey in schema.prisma. Applied under an older build, every Journey query
-- fails with P2022 until that process restarts.
DROP INDEX IF EXISTS "Journey_shop_journeyKey_key";
ALTER TABLE "Journey" DROP COLUMN IF EXISTS "journeyKey";
