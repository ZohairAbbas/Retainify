-- CreateTable
CREATE TABLE "InternalEvent" (
    "id" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "eventId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "exited" INTEGER NOT NULL DEFAULT 0,
    "enrolled" JSONB,
    "declined" JSONB,
    "data" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "InternalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InternalEvent_caller_eventId_key" ON "InternalEvent"("caller", "eventId");

-- CreateIndex
CREATE INDEX "InternalEvent_app_event_receivedAt_idx" ON "InternalEvent"("app", "event", "receivedAt");

-- CreateIndex
CREATE INDEX "InternalEvent_email_receivedAt_idx" ON "InternalEvent"("email", "receivedAt");

-- CreateIndex
CREATE INDEX "InternalEvent_receivedAt_idx" ON "InternalEvent"("receivedAt");
