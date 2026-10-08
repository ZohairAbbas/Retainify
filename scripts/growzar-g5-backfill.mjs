#!/usr/bin/env node
/**
 * Growzar Phase 5 one-off fills: E.164 phones on existing contacts, and the
 * baseline consent row per contact and channel. Logic and its guarantees are
 * in app/lib/growzar/backfill.server.js.
 *
 *   node scripts/growzar-g5-backfill.mjs                 # dry run, counts only
 *   node scripts/growzar-g5-backfill.mjs --apply         # write
 *   node scripts/growzar-g5-backfill.mjs --apply --shop=x.myshopify.com
 *
 * Idempotent: a second --apply writes 0. Re-run it after merchants approve the
 * read_locations scope: a shop whose country was unknown leaves phones written
 * without "+" null until then, and the next run fills them. Prints counts only, never a phone or
 * an address.
 *
 * --apply refuses to run between 05:00 and 15:00 UTC (Pakistan business
 * hours) unless --force is given, because it updates every contact with a
 * phone, and each of those updates moves the updatedAt of that buyer's
 * enrollments, messages and carts (the Contact trigger), so Growzar refetches
 * them. A dry run only reads and may run at any time.
 *
 * Run it after `prisma migrate deploy` and before Growzar's first sync of
 * /consent, so the history starts with the baseline. Shop facts (country) are
 * fetched from Shopify for any shop that has none cached; that needs the
 * app's .env, which load-env.js reads.
 */
import "../load-env.js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const force = args.has("--force");
const shopArg = process.argv.slice(2).find((a) => a.startsWith("--shop="))?.slice(7) || null;

const hour = new Date().getUTCHours();
if (apply && hour >= 5 && hour < 15 && !force) {
  console.error("Refusing to --apply between 05:00 and 15:00 UTC. Run later, or pass --force.");
  process.exit(2);
}

const { default: prisma } = await import("../app/db.server.js");
const { shopifyShops, backfillPhones, backfillConsentBaseline } = await import("../app/lib/growzar/backfill.server.js");

const totals = { candidates: 0, normalized: 0, unparseable: 0, written: 0, email: 0, whatsapp: 0, push: 0 };
try {
  const shops = await shopifyShops(shopArg);
  console.log(`${apply ? "APPLY" : "DRY RUN"} — ${shops.length} Shopify shop(s)`);
  for (const shop of shops) {
    const p = await backfillPhones(shop, { apply });
    const c = await backfillConsentBaseline(shop, { apply });
    console.log(
      `${shop}  country=${p.country ?? "unknown"}  phones: ${p.candidates} to fill, ${p.normalized} normalize, ` +
        `${p.unparseable} stay null${apply ? `, ${p.written} written` : ""}; carts ${p.carts.candidates} to fill, ` +
        `${p.carts.normalized} normalize${apply ? `, ${p.carts.written} written` : ""}  ` +
        `baseline ${apply ? "written" : "missing"}: email ${c.email}, whatsapp ${c.whatsapp}, push ${c.push}`,
    );
    for (const k of ["candidates", "normalized", "unparseable", "written"]) totals[k] += p[k];
    for (const k of ["email", "whatsapp", "push"]) totals[k] += c[k];
  }
  console.log("TOTAL", JSON.stringify(totals));
} finally {
  await prisma.$disconnect();
}
