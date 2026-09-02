-- WhatsApp click attribution.
--
-- WhatsApp was the only paid channel structurally unable to report revenue.
-- Meta reports URL-button taps only through Template Analytics, as counts per
-- template per period with no wamid and no recipient -- so a tap could never be
-- tied to a person, and therefore never to their order.
--
-- The fix is the one push already uses: the button points at us, not at the
-- store. We record the tap against the exact job that carried it and forward
-- the shopper on. WhatsApp then joins the same last-click attribution model as
-- email and push.
--
-- Templates carry the redirect from birth. A template's button URL is part of
-- what Meta approves, so rewriting it afterwards would mean re-approval for
-- every template. Instead createTemplate() submits our redirect with a variable
-- suffix -- https://<app>/w/{{1}} -- which Meta approves once; the per-send
-- value fills the variable and never needs review. buttonUrls holds the
-- merchant's real destination, which we resolve at redirect time.
--
-- A consequence worth knowing: because Meta only ever sees the redirect, a
-- merchant can change where a button points WITHOUT re-approval. Messages
-- already delivered follow the new destination, which is the intended
-- behaviour -- the alternative is a live button pointing at a dead URL.
--
-- Templates synced from Meta rather than created here have buttonUrls NULL.
-- Those keep their original hard-coded links, cannot be attributed, and the
-- WhatsApp settings page says so.
ALTER TABLE "WhatsappJob" ADD COLUMN "clickedAt" TIMESTAMP(3);
ALTER TABLE "WhatsappTemplate" ADD COLUMN "buttonUrls" JSONB;

CREATE INDEX "WhatsappJob_shop_clickedAt_idx" ON "WhatsappJob"("shop", "clickedAt");
CREATE INDEX "WhatsappJob_enrollmentId_clickedAt_idx" ON "WhatsappJob"("enrollmentId", "clickedAt");
