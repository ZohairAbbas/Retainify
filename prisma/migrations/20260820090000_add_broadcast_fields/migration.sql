-- Broadcast (one-off campaign) support.
--
-- A broadcast reuses the Journey model rather than introducing a parallel
-- Campaign one: the step editor, renderer, job queue, suppression, quiet-hours
-- handling, quota checks and per-recipient analytics all already operate on a
-- Journey. `trigger = 'broadcast'` distinguishes it from an automation.

ALTER TABLE "Journey" ADD COLUMN "scheduledFor" TIMESTAMP(3);
-- Claimed-at marker. Writing it is how a dispatcher takes exclusive ownership
-- of a broadcast, so the audience can never be enrolled twice.
ALTER TABLE "Journey" ADD COLUMN "dispatchedAt" TIMESTAMP(3);
ALTER TABLE "Journey" ADD COLUMN "recipientCount" INTEGER NOT NULL DEFAULT 0;

-- Drives the dispatcher's "which broadcasts are due" query.
CREATE INDEX "Journey_trigger_status_scheduledFor_idx"
  ON "Journey"("trigger", "status", "scheduledFor");
