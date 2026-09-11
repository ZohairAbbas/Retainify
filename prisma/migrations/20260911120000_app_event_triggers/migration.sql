-- The (app, event) pair that starts an api_event flow, replacing v1's journeyKey.
-- Another Growzar app reports a lifecycle event to /internal/event and every
-- published flow subscribed to that exact pair enrolls the person.
--
-- Additive only. journeyKey is left in place, unused, and dropped by a later
-- migration once no running build still selects it — Prisma names every column
-- in its SELECTs, so removing one under a live older build fails every Journey
-- query. NULL on every existing row: no flow is event-triggered yet.
ALTER TABLE "Journey" ADD COLUMN "triggerApp" TEXT;
ALTER TABLE "Journey" ADD COLUMN "triggerEvent" TEXT;

CREATE INDEX "Journey_shop_trigger_triggerApp_triggerEvent_idx"
  ON "Journey"("shop", "trigger", "triggerApp", "triggerEvent");
