-- A/B split — a split that decides by chance rather than by a rule.
--
-- ── Why this is the same node, not a new one ───────────────────────────────
-- Structurally an A/B test IS a split: one step in, two branches out, each
-- running to its own exit. The walk, the edge table, the canvas render, the
-- ancestry gate and the branch report already handle exactly that shape. What
-- differs is a single question — how the branch is chosen — so that is the
-- only thing this adds.
ALTER TABLE "JourneyStep" ADD COLUMN "splitMode" TEXT NOT NULL DEFAULT 'condition';

-- Percentage of arrivals sent to arm A, in random mode. 50 is an even split.
--
-- Adjustable rather than fixed at half, because the safest way to run a first
-- test is a small slice: try the risky discount on 10% and leave 90% on the
-- copy that already works. A fixed 50/50 forces the merchant to bet the whole
-- audience on an untested variant.
ALTER TABLE "JourneyStep" ADD COLUMN "splitWeight" INTEGER NOT NULL DEFAULT 50;

-- Which number decides the winner: open | click | order | revenue.
--
-- Per test, because a subject-line test is judged on opens and an offer test
-- on orders — and reporting significance on the wrong one is worse than
-- reporting none, since it looks equally authoritative.
ALTER TABLE "JourneyStep" ADD COLUMN "splitMetric" TEXT NOT NULL DEFAULT 'click';

-- ── matched becomes nullable ───────────────────────────────────────────────
-- It records whether a split's CONDITION was true. A random assignment has no
-- condition, so there is no honest value to write: false would claim the rule
-- was evaluated and failed, true would claim it passed. NULL says the question
-- does not apply, which is the only accurate answer.
--
-- Non-destructive: every existing row keeps its true/false.
ALTER TABLE "JourneyPathEvent" ALTER COLUMN "matched" DROP NOT NULL;
