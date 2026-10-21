-- How a WhatsApp number was onboarded: "cloud_api" (registered to the Cloud API)
-- or "coexistence" (stays live on the merchant's WhatsApp Business app, and must
-- never be registered by us). Every existing account came through the ordinary
-- flow, so the default describes them correctly.
ALTER TABLE "WhatsappAccount" ADD COLUMN "connectionType" TEXT NOT NULL DEFAULT 'cloud_api';
