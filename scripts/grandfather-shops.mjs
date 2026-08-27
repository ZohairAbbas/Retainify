#!/usr/bin/env node
/**
 * Billing cutover: grandfather every currently-installed shop onto a comped plan.
 *
 * Run this ONCE, immediately before flipping BILLING_ENFORCE=true. The app is
 * publicly listed, so the installed base grows continuously — running it at
 * cutover is what closes the cohort at a known set. Shops that install after
 * this point are new customers and hit real caps.
 *
 * grandfatherExistingShops() was written months ago with the comment "Run this
 * ONCE AT CUTOVER" and never had a caller, so there was no way to actually run
 * it. This is that caller.
 *
 * Idempotent: shops that already have a ShopPlan row are skipped, so a re-run
 * cannot extend anyone's comp window or downgrade a paying shop.
 *
 * Usage:
 *   node scripts/grandfather-shops.mjs --dry-run     # report only, no writes
 *   node scripts/grandfather-shops.mjs               # 30-day comp window
 *   node scripts/grandfather-shops.mjs --days 60     # custom window
 */
import { pathToFileURL } from "node:url";
import prisma from "../app/db.server.js";
import { grandfatherExistingShops } from "../app/lib/billing/sync.server.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dryRun = process.argv.includes("--dry-run");
const days = Number(arg("days", 30));

if (!Number.isFinite(days) || days <= 0) {
  console.error("--days must be a positive number");
  process.exit(1);
}

async function main() {
  const shops = await prisma.shopSettings.findMany({ select: { shop: true } });
  const existing = await prisma.shopPlan.findMany({ select: { shop: true } });
  const covered = new Set(existing.map((p) => p.shop));
  const wouldCreate = shops.filter((s) => !covered.has(s.shop));

  console.log(`Installed shops:        ${shops.length}`);
  console.log(`Already have a plan:    ${covered.size}`);
  console.log(`Would be grandfathered: ${wouldCreate.length}`);
  console.log(`Comp window:            ${days} days`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    if (wouldCreate.length) {
      console.log("\nShops that would be comped:");
      for (const s of wouldCreate.slice(0, 50)) console.log("  " + s.shop);
      if (wouldCreate.length > 50) console.log(`  …and ${wouldCreate.length - 50} more`);
    }
    return;
  }

  const result = await grandfatherExistingShops(days);
  console.log(
    `\nDone. Comped ${result.created} shop(s), skipped ${result.skipped} that already had a plan.`,
  );
  console.log(`Comp expires ${result.until.toISOString()}.`);
  console.log("\nNext: set BILLING_ENFORCE=true and restart, once you're ready to enforce caps.");
}

// Only run when executed directly. Importing this module — for a load check, a
// test, or by a bundler walking the tree — must never comp anyone's shop.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .catch((err) => {
      console.error("Cutover failed:", err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
} else {
  console.warn("[cutover] imported rather than executed — no action taken.");
}
