/**
 * One-off fills for Growzar Phase 5, run by scripts/growzar-g5-backfill.mjs.
 *
 *   1. Contact.phoneE164 for contacts stored before the column existed, parsed
 *      against the shop's country.
 *   2. A baseline ConsentEvent per contact and channel, holding the state at
 *      that moment (source "baseline", reason null), so the history is
 *      complete from day one rather than from each contact's next change.
 *
 * Both are idempotent: a phone is written only where phoneE164 is still null
 * and the number parses, and a baseline only where that contact and channel
 * has none. A second run writes nothing. A number that does not parse stays
 * null and is counted, never guessed.
 *
 * Every function takes { apply }: false counts what would be written and
 * writes nothing. Counts only — no phone or address is ever returned.
 */
import prisma from "../../db.server.js";
import { phoneToE164 } from "../phone/e164.js";
import { getShopFacts } from "./shop-facts.server.js";
import { canonicalShop } from "./config.js";

const BATCH = 500;

/**
 * Shops to fill: every myshopify shop holding contacts that is not a direct
 * workspace — the same rule the feeds use to decide a shop is a store.
 *
 * Not Account.kind = "shopify": five live installs (one of them the busiest
 * email sender) have an offline session and no Account row at all, and would
 * have been skipped. A direct workspace or the internal tenant never has a
 * myshopify key, and an explicit direct Account is excluded besides.
 */
export async function shopifyShops(only = null) {
  const rows = await prisma.contact.findMany({
    where: { shop: only ? only : { endsWith: ".myshopify.com" } },
    distinct: ["shop"],
    select: { shop: true },
    orderBy: { shop: "asc" },
  });
  const shops = rows.map((r) => r.shop).filter((s) => canonicalShop(s) === s);
  const direct = await prisma.account.findMany({
    where: { key: { in: shops }, kind: { not: "shopify" } },
    select: { key: true },
  });
  const excluded = new Set(direct.map((a) => a.key));
  return shops.filter((s) => !excluded.has(s));
}

/**
 * @param {string} shop
 * @param {{ apply: boolean, country?: string|null }} opts
 *   country: override for tests; otherwise the cached shop facts (fetched
 *   from Shopify if stale)
 * @returns {Promise<{ shop: string, country: string|null, candidates: number, normalized: number, unparseable: number, written: number }>}
 */
export async function backfillPhones(shop, { apply, country } = {}) {
  const c = country !== undefined ? country : (await getShopFacts(shop)).country;
  const out = { shop, country: c, candidates: 0, normalized: 0, unparseable: 0, written: 0 };
  let cursor = null;
  for (;;) {
    const rows = await prisma.contact.findMany({
      where: { shop, phoneE164: null, phone: { not: null }, NOT: { phone: "" }, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, phone: true },
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    for (const r of rows) {
      out.candidates++;
      const e164 = phoneToE164(r.phone, c);
      if (!e164) {
        out.unparseable++;
        continue;
      }
      out.normalized++;
      if (apply) {
        // Guarded on phoneE164 still null, so a concurrent write by the app
        // (which computes it from the raw input, a better source) wins.
        const { count } = await prisma.contact.updateMany({
          where: { id: r.id, phoneE164: null },
          data: { phoneE164: e164 },
        });
        out.written += count;
      }
    }
  }
  return out;
}

/**
 * Baseline consent rows for one shop.
 *
 * Push state is read the way /consent reads it: subscribed when pushEnabled,
 * unsubscribed when the address has an inactive browser subscription (it
 * subscribed once), never_opted_in otherwise.
 *
 * @returns {Promise<{ shop: string, email: number, whatsapp: number, push: number }>}
 */
export async function backfillConsentBaseline(shop, { apply }) {
  const missing = (channel) => prisma.$queryRaw`
    SELECT COUNT(*)::int AS n FROM "Contact" c
     WHERE c."shop" = ${shop}
       AND NOT EXISTS (SELECT 1 FROM "ConsentEvent" e
                        WHERE e."contactId" = c."id" AND e."channel" = ${channel} AND e."source" = 'baseline')`;
  if (!apply) {
    const [[e], [w], [p]] = await Promise.all([missing("email"), missing("whatsapp"), missing("push")]);
    return { shop, email: e.n, whatsapp: w.n, push: p.n };
  }

  const email = await prisma.$executeRaw`
    INSERT INTO "ConsentEvent" ("id", "shop", "contactId", "channel", "from", "to", "reason", "source", "createdAt")
    SELECT gen_random_uuid()::text, c."shop", c."id", 'email', c."subscriptionStatus", c."subscriptionStatus", NULL, 'baseline', (clock_timestamp() AT TIME ZONE 'UTC')
      FROM "Contact" c
     WHERE c."shop" = ${shop}
       AND NOT EXISTS (SELECT 1 FROM "ConsentEvent" e
                        WHERE e."contactId" = c."id" AND e."channel" = 'email' AND e."source" = 'baseline')`;
  const whatsapp = await prisma.$executeRaw`
    INSERT INTO "ConsentEvent" ("id", "shop", "contactId", "channel", "from", "to", "reason", "source", "createdAt")
    SELECT gen_random_uuid()::text, c."shop", c."id", 'whatsapp', c."whatsappStatus", c."whatsappStatus", NULL, 'baseline', (clock_timestamp() AT TIME ZONE 'UTC')
      FROM "Contact" c
     WHERE c."shop" = ${shop}
       AND NOT EXISTS (SELECT 1 FROM "ConsentEvent" e
                        WHERE e."contactId" = c."id" AND e."channel" = 'whatsapp' AND e."source" = 'baseline')`;
  const push = await prisma.$executeRaw`
    INSERT INTO "ConsentEvent" ("id", "shop", "contactId", "channel", "from", "to", "reason", "source", "createdAt")
    SELECT gen_random_uuid()::text, c."shop", c."id", 'push', s.state, s.state, NULL, 'baseline', (clock_timestamp() AT TIME ZONE 'UTC')
      FROM "Contact" c
     CROSS JOIN LATERAL (
       SELECT CASE
         WHEN c."pushEnabled" THEN 'subscribed'
         WHEN EXISTS (SELECT 1 FROM "PushSubscription" p
                       WHERE p."shop" = c."shop" AND p."contactEmail" = c."email" AND NOT p."isActive")
           THEN 'unsubscribed'
         ELSE 'never_opted_in'
       END AS state
     ) s
     WHERE c."shop" = ${shop}
       AND NOT EXISTS (SELECT 1 FROM "ConsentEvent" e
                        WHERE e."contactId" = c."id" AND e."channel" = 'push' AND e."source" = 'baseline')`;
  return { shop, email, whatsapp, push };
}
