-- Wall-clock anchor for the transient retry horizon.
--
-- Retries used to be bounded by an attempt count (3 tries over 30 minutes),
-- which meant a daily sending quota — resetting up to 24h later — could never
-- be outlived. Bounding by elapsed time instead needs to know when a job first
-- failed; scheduledFor is overwritten on every retry, so it cannot serve.
--
-- Nullable and with no default: NULL means "has never failed", which is the
-- correct state for every existing row.
ALTER TABLE "JourneyJob"  ADD COLUMN "firstFailedAt" TIMESTAMP(3);
ALTER TABLE "PushJob"     ADD COLUMN "firstFailedAt" TIMESTAMP(3);
ALTER TABLE "WhatsappJob" ADD COLUMN "firstFailedAt" TIMESTAMP(3);
