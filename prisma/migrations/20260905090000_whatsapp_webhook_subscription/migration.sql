-- Track our app's subscription to each merchant's WABA, and when the granted
-- token lapses. Without the subscription Meta delivers no webhook for the shop
-- at all, so every existing row starts NULL: unsubscribed until proven
-- otherwise, which is the honest reading for accounts connected before the
-- subscribed_apps call existed.
ALTER TABLE "WhatsappAccount" ADD COLUMN "webhooksSubscribedAt" TIMESTAMP(3);
ALTER TABLE "WhatsappAccount" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
