/**
 * The shop's own country, currency and timezone, as Shopify reports them.
 *
 * Every Growzar feed envelope carries all three (API-CONTRACT §5, §6.1), money
 * needs the currency (§4), and phone normalization needs the country as its
 * default region. None of them was stored: ShopSettings.storeTimezone is a
 * merchant setting that defaults to "UTC" and was still "UTC" on 17 of 18 shops
 * when this was written, so it cannot stand in for the real one.
 *
 * Cached on ShopSettings and refreshed from the Admin API when older than a
 * day. A shop that cannot be asked (no session, Shopify down) keeps what was
 * cached, and a value never fetched stays null. The contract's rule is that
 * unknown is null, never a default, so no fallback is invented here.
 */
import prisma from "../../db.server.js";
import { canonicalShop } from "./config.js";

export const FACTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const SHOP_QUERY = `#graphql
  query GrowzarShopFacts {
    shop {
      currencyCode
      ianaTimezone
      billingAddress { countryCodeV2 }
    }
  }`;

/**
 * @typedef {{ country: string|null, currency: string|null, timezone: string|null }} ShopFacts
 */

/**
 * @param {string} shop
 * @param {{ maxAgeMs?: number, fetchFacts?: (shop: string) => Promise<ShopFacts>, now?: Date }} [opts]
 * @returns {Promise<ShopFacts>}
 */
export async function getShopFacts(shop, { maxAgeMs = FACTS_MAX_AGE_MS, fetchFacts = fetchFromShopify, now = new Date() } = {}) {
  const row = await prisma.shopSettings.findUnique({
    where: { shop },
    select: { shopifyCountry: true, shopifyCurrency: true, shopifyTimezone: true, shopifyFactsAt: true },
  });
  const cached = {
    country: row?.shopifyCountry ?? null,
    currency: row?.shopifyCurrency ?? null,
    timezone: row?.shopifyTimezone ?? null,
  };
  const fresh = row?.shopifyFactsAt && now.getTime() - row.shopifyFactsAt.getTime() < maxAgeMs;
  if (fresh) return cached;
  // A direct workspace (or the internal tenant) has no store to ask. Its key is
  // never a myshopify domain, so this only saves a doomed Admin call; whether
  // a tenant is a real store for any purpose that matters is Account.kind's
  // question, not this regex's.
  if (!canonicalShop(shop)) return cached;

  let fetched;
  try {
    fetched = await fetchFacts(shop);
  } catch (err) {
    console.error(`[growzar] shop facts fetch failed for ${shop}:`, err.message);
    return cached;
  }

  const next = {
    country: validCountry(fetched?.country) ?? cached.country,
    currency: validCurrency(fetched?.currency) ?? cached.currency,
    timezone: fetched?.timezone || cached.timezone,
  };
  // updateMany, not upsert: a ShopSettings row is created by the app's own
  // install path with defaults that mean something (isActive, onboarding). A
  // read API must not be the thing that creates one.
  if (row) {
    await prisma.shopSettings.updateMany({
      where: { shop },
      data: {
        shopifyCountry: next.country,
        shopifyCurrency: next.currency,
        shopifyTimezone: next.timezone,
        shopifyFactsAt: now,
      },
    });
  }
  return next;
}

// Writers on the hot path (checkout webhook, contact upserts) need only the
// country, and a per-call ShopSettings read for it would be one more query on
// every write. Held per process for a few minutes; a country does not change.
const countryMemo = new Map();
const COUNTRY_MEMO_MS = 10 * 60 * 1000;

/**
 * The shop's country for phone parsing, or null if not known.
 *
 * @param {string} shop
 * @returns {Promise<string|null>}
 */
export async function getShopCountry(shop) {
  const hit = countryMemo.get(shop);
  if (hit && Date.now() - hit.at < COUNTRY_MEMO_MS) return hit.country;
  let country = null;
  try {
    ({ country } = await getShopFacts(shop));
  } catch (err) {
    console.error(`[growzar] shop country lookup failed for ${shop}:`, err.message);
  }
  countryMemo.set(shop, { country, at: Date.now() });
  return country;
}

/** Test seam. */
export function __resetShopCountryMemo() {
  countryMemo.clear();
}

async function fetchFromShopify(shop) {
  // Imported on use: shopify.server.js builds the whole Shopify client, and the
  // modules that import this one (contacts, checkouts) are loaded by the worker
  // as well, which otherwise never needs it on this path.
  const { unauthenticated } = await import("../../shopify.server.js");
  const { admin } = await unauthenticated.admin(shop);
  const resp = await admin.graphql(SHOP_QUERY);
  const json = await resp.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 300));
  const s = json.data?.shop;
  return {
    country: s?.billingAddress?.countryCodeV2 ?? null,
    currency: s?.currencyCode ?? null,
    timezone: s?.ianaTimezone ?? null,
  };
}

function validCountry(v) {
  return typeof v === "string" && /^[A-Z]{2}$/.test(v) ? v : null;
}

function validCurrency(v) {
  return typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : null;
}
