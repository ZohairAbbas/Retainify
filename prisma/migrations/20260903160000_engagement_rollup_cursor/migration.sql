-- Reconciliation cursor for the engagement rollup sweep.
--
-- Split out from 20260903120000_add_contact_engagement_rollup rather than added
-- to it: that migration was already applied, and an applied migration is not
-- something to edit -- environments that ran it would never pick up an
-- amendment, and the ones that had not would silently diverge from the ones
-- that had.
--
-- Contact's engagement columns are maintained live, by the journey worker after
-- each send and by the Resend/SES webhooks after each open, click and failure.
-- This cursor drives the sweep that repairs what that path cannot: a webhook the
-- provider dropped, a rollup that threw while its send succeeded, a process
-- killed between the two writes. Each of those leaves one contact's figures
-- permanently wrong, and a wrong open rate is invisible -- it looks exactly like
-- a contact who does not open.
--
-- NULL means "never swept", which is the correct starting state: the backfill in
-- the migration above has already made every shop's columns exact, so the first
-- pass only has to cover the window since then rather than replay all history.
ALTER TABLE "ShopSettings" ADD COLUMN "lastEngagementRollupAt" TIMESTAMP(3);

-- The sweep asks "which jobs changed since the last pass", per shop. Without
-- this it seq-scans JourneyJob once per shop per pass -- on the table that
-- already carries the whole send history, and on a worker that runs every
-- 60 seconds.
CREATE INDEX "JourneyJob_shop_updatedAt_idx" ON "JourneyJob"("shop", "updatedAt");
