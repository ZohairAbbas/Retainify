-- Worker leases — the claim the periodic workers never had.
--
-- ── What it closes ─────────────────────────────────────────────────────────
-- Every queue was driven by a 60s setInterval inside the web server's entry
-- module, so running a second web instance ran every worker twice. The send
-- paths already survive that: email, push, WhatsApp, broadcast dispatch and the
-- enrollment advance each claim their work with a conditional UPDATE, and the
-- loser updates zero rows. The periodic workers — segment enrollment, segment
-- snapshots, the engagement rollup, the reapers — instead read a timestamp,
-- conclude they are due, and act. Two processes reach that conclusion together.
--
-- One row per worker name, held for a TTL. The expiry rather than a boolean is
-- the whole point: a holder that dies mid-tick must cost one skipped interval,
-- not a worker that never runs again.
CREATE TABLE "WorkerLease" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerLease_pkey" PRIMARY KEY ("name")
);

-- Sweeping expired leases, and the takeover predicate itself.
CREATE INDEX "WorkerLease_expiresAt_idx" ON "WorkerLease"("expiresAt");
