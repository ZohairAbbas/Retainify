-- Holds the granted token between Meta returning the merchant and the merchant
-- choosing which WhatsApp Business account to connect. Separate from
-- WhatsappAccount so a re-connect cannot damage a live one.
CREATE TABLE "WhatsappConnectPending" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsappConnectPending_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsappConnectPending_shop_key" ON "WhatsappConnectPending"("shop");
