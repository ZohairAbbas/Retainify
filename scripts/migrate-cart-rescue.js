/**
 * One-time migration: legacy Cart Rescue (JourneySettings + EmailJob) → unified Journey engine.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-cart-rescue.js
 *
 * Idempotent — safe to re-run. Per-shop summary is printed at the end.
 *
 * Run locally against staging by pointing DATABASE_URL at your staging DB.
 * Run on the prod VPS with prod DATABASE_URL when ready to cut over.
 */
import { migrateCartRescueForAllShops } from "../app/lib/journey/migrate-cart-rescue.server.js";

const start = Date.now();

try {
  const results = await migrateCartRescueForAllShops();

  console.log("\n=== Migration results ===");
  console.log(JSON.stringify(results, null, 2));

  const totals = results.reduce(
    (acc, r) => ({
      shops: acc.shops + 1,
      journeysCreated: acc.journeysCreated + (r.createdJourney ? 1 : 0),
      stepsCreated: acc.stepsCreated + r.stepCount,
      jobsMigrated: acc.jobsMigrated + r.migratedJobs,
      jobsSkipped: acc.jobsSkipped + r.skippedJobs,
    }),
    { shops: 0, journeysCreated: 0, stepsCreated: 0, jobsMigrated: 0, jobsSkipped: 0 },
  );

  console.log("\n=== Totals ===");
  console.log(`  Shops processed:   ${totals.shops}`);
  console.log(`  Journeys created:  ${totals.journeysCreated}`);
  console.log(`  Steps created:     ${totals.stepsCreated}`);
  console.log(`  Jobs migrated:     ${totals.jobsMigrated}`);
  console.log(`  Jobs skipped:      ${totals.jobsSkipped}`);
  console.log(`  Duration:          ${((Date.now() - start) / 1000).toFixed(2)}s`);

  process.exit(0);
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
}
