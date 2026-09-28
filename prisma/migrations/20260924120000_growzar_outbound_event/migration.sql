-- Outbox for events posted to Growzar (API-CONTRACT §7). Additive only.
-- CreateTable
CREATE TABLE "GrowzarOutboundEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "GrowzarOutboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrowzarOutboundEvent_eventId_key" ON "GrowzarOutboundEvent"("eventId");

-- CreateIndex
CREATE INDEX "GrowzarOutboundEvent_status_nextAttemptAt_idx" ON "GrowzarOutboundEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "GrowzarOutboundEvent_shop_topic_idx" ON "GrowzarOutboundEvent"("shop", "topic");
