-- Records the last successful template pull from Meta for a shop's WABA.
-- Template rows carry their own lastSyncedAt, but a WABA with zero templates
-- leaves no row to read, so "never synced" and "synced, found nothing" were
-- indistinguishable. NULL on every existing account: they have never been
-- auto-synced, which is exactly what we want the first page load to fix.
ALTER TABLE "WhatsappAccount" ADD COLUMN "templatesSyncedAt" TIMESTAMP(3);
