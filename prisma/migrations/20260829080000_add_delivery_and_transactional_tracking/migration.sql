-- Delivery outcome, and engagement for transactional email.
--
-- 1. JourneyJob.status = 'done' only ever meant "Resend accepted the API call".
--    Reading real sends back from Resend showed messages sitting at
--    last_event=failed/bounced while our row said done, so every "sent" figure
--    shown to a merchant was overstated by an unknown margin. deliveredAt and
--    failedAt record what the provider actually did.
--
-- 2. The popup confirmation and discount-reveal emails have no JourneyJob, so
--    their open/click webhooks matched nothing and were logged as "unmatched"
--    and dropped -- 92 real engagement events lost. Storing their message ids
--    on PopupSignup gives those events somewhere to land.
ALTER TABLE "JourneyJob" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "JourneyJob" ADD COLUMN "failedAt"    TIMESTAMP(3);

ALTER TABLE "PopupSignup" ADD COLUMN "confirmMessageId"  TEXT NOT NULL DEFAULT '';
ALTER TABLE "PopupSignup" ADD COLUMN "discountMessageId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PopupSignup" ADD COLUMN "openedAt"          TIMESTAMP(3);
ALTER TABLE "PopupSignup" ADD COLUMN "clickedAt"         TIMESTAMP(3);

CREATE INDEX "PopupSignup_confirmMessageId_idx"  ON "PopupSignup"("confirmMessageId");
CREATE INDEX "PopupSignup_discountMessageId_idx" ON "PopupSignup"("discountMessageId");
