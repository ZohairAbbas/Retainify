-- Indexes the revenue attribution query needs to stay linear.
--
-- Attribution answers "which click earned this order" by walking, for each
-- order, that buyer's own clicks inside the window. The obvious alternative --
-- collect every click for the shop, then filter per order -- makes the planner
-- drive from the click window instead: for every order it scans every click in
-- the surrounding seven days and only then checks whose they were.
--
-- Measured on the reference store (3,355 sends, 1,737 orders): 328,859
-- enrollment lookups and 1.1 seconds. With these three indexes and the
-- email-first query shape, 31ms. Both numbers grow with sends x orders, so this
-- is the difference between a report that loads and one that times out.
--
-- The JourneyEnrollment index is on lower("contactEmail") because
-- JourneyEnrollment.contactEmail is not normalised on write while Order.email
-- is, so the join has to lower both sides. Prisma cannot express a functional
-- index in schema.prisma, so this one exists only here -- do not expect
-- `prisma migrate diff` to reproduce it.
CREATE INDEX "JourneyEnrollment_shop_lower_email_idx"
    ON "JourneyEnrollment" (shop, lower("contactEmail"));

CREATE INDEX "JourneyJob_enrollmentId_clickedAt_idx"
    ON "JourneyJob" ("enrollmentId", "clickedAt");

CREATE INDEX "PushJob_enrollmentId_clickedAt_idx"
    ON "PushJob" ("enrollmentId", "clickedAt");
