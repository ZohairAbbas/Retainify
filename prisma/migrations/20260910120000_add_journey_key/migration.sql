-- A stable external identifier for a flow, so a caller outside the app can name
-- one without knowing its cuid. Only api_event flows need a key; NULL on every
-- existing row, which is correct — merchant-authored flows are never addressed
-- from outside.
--
-- Postgres treats NULLs as distinct in a unique index, so this constraint does
-- not force the existing flows to invent a key, and any number of them may keep
-- NULL. It does what it is for: within one workspace, a non-null key names
-- exactly one flow.
ALTER TABLE "Journey" ADD COLUMN "journeyKey" TEXT;

CREATE UNIQUE INDEX "Journey_shop_journeyKey_key" ON "Journey"("shop", "journeyKey");
