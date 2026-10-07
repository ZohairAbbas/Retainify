/**
 * What every Growzar read feed shares (API-CONTRACT §6): authentication, the
 * connection check, query parsing, the (updatedAt, id) cursor, the envelope,
 * money and timestamps.
 *
 * A feed route is: `const req = await openFeed(request); if (!req.ok) return
 * req.response;` then a page query, then `feedResponse(...)`.
 */
import prisma from "../../db.server.js";
import { authenticateGrowzarRequest, growzarError } from "./platform-auth.js";
import { getShopFacts } from "./shop-facts.server.js";

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;
/** Tombstones per response; beyond this the list is flagged as truncated. */
export const TOMBSTONE_CAP = 1000;

/**
 * Authenticate, resolve the shop, check it is connected, and parse the query.
 *
 * @param {Request} request
 * @returns {Promise<
 *   | { ok: true, shop: string, facts: import("./shop-facts.server.js").ShopFacts,
 *       limit: number, updatedSince: Date|null, after: { at: Date, id: string }|null }
 *   | { ok: false, response: Response }>}
 */
export async function openFeed(request) {
  if (request.method !== "GET") {
    return { ok: false, response: growzarError(405, "bad_request", "Use GET.") };
  }

  // The rate limiter must never fail open (§9): anything thrown while checking
  // the request is a 503, not a pass.
  let auth;
  try {
    auth = authenticateGrowzarRequest(request);
  } catch (err) {
    console.error("[growzar] feed auth threw", err);
    return { ok: false, response: growzarError(503, "not_configured", "Could not check this request.") };
  }
  if (!auth.ok) return { ok: false, response: auth.response };
  const { shop } = auth;

  const query = parseFeedQuery(new URL(request.url).searchParams);
  if (!query.ok) return { ok: false, response: growzarError(400, "bad_request", query.error) };

  try {
    const connected = await isConnectedShop(shop);
    if (!connected) {
      return {
        ok: false,
        response: growzarError(410, "shop_not_connected", "Retainify is not installed on this shop."),
      };
    }
    const facts = await getShopFacts(shop);
    return { ok: true, shop, facts, ...query.value };
  } catch (err) {
    console.error(`[growzar] feed setup failed for ${shop}`, err);
    return { ok: false, response: growzarError(500, "internal_error", "Could not read this shop.") };
  }
}

/**
 * Connected means a Shopify install: an offline session exists, and the
 * tenant is not a direct workspace. The shop header is already a myshopify
 * domain by the time this runs, but whether a tenant is a store is
 * Account.kind's to say, never the key's shape (see shop-health.server.js).
 *
 * @param {string} shop
 */
export async function isConnectedShop(shop) {
  const [account, session] = await Promise.all([
    prisma.account.findUnique({ where: { key: shop }, select: { kind: true } }),
    prisma.session.findFirst({ where: { shop, isOnline: false }, select: { id: true } }),
  ]);
  if (account && account.kind !== "shopify") return false;
  return Boolean(session);
}

/**
 * @param {URLSearchParams} params
 * @returns {{ ok: true, value: { limit: number, updatedSince: Date|null, after: { at: Date, id: string }|null } } | { ok: false, error: string }}
 */
export function parseFeedQuery(params) {
  let limit = DEFAULT_LIMIT;
  const rawLimit = params.get("limit");
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) {
      return { ok: false, error: "limit must be a positive integer." };
    }
    limit = Math.min(Number(rawLimit), MAX_LIMIT);
  }

  let updatedSince = null;
  const rawSince = params.get("updatedSince");
  if (rawSince !== null && rawSince !== "") {
    const d = new Date(rawSince);
    if (Number.isNaN(d.getTime()) || !/\d{4}-\d{2}-\d{2}T/.test(rawSince)) {
      return { ok: false, error: "updatedSince must be an ISO 8601 timestamp." };
    }
    updatedSince = d;
  }

  let after = null;
  const rawCursor = params.get("cursor");
  if (rawCursor !== null && rawCursor !== "") {
    after = decodeCursor(rawCursor);
    if (!after) return { ok: false, error: "cursor is not one this feed issued." };
  }

  return { ok: true, value: { limit, updatedSince, after } };
}

/**
 * The cursor is the last row's (updatedAt, id), opaque to the caller.
 *
 * @param {Date} at
 * @param {string} id
 */
export function encodeCursor(at, id) {
  return Buffer.from(JSON.stringify({ u: at.toISOString(), i: id })).toString("base64url");
}

/** @returns {{ at: Date, id: string } | null} */
export function decodeCursor(raw) {
  try {
    const { u, i } = JSON.parse(Buffer.from(String(raw), "base64url").toString("utf8"));
    const at = new Date(u);
    if (typeof u !== "string" || typeof i !== "string" || !i || Number.isNaN(at.getTime())) return null;
    return { at, id: i };
  } catch {
    return null;
  }
}

/**
 * Prisma `where` for "after the cursor, else from updatedSince (inclusive)",
 * in (timeField, idField) order. With a cursor, updatedSince is not needed:
 * the cursor already sits past it.
 *
 * @param {{ updatedSince: Date|null, after: { at: Date, id: string }|null }} q
 * @param {string} [timeField]
 * @param {string} [idField]
 */
export function windowWhere(q, timeField = "updatedAt", idField = "id") {
  if (q.after) {
    return {
      OR: [
        { [timeField]: { gt: q.after.at } },
        { [timeField]: q.after.at, [idField]: { gt: q.after.id } },
      ],
    };
  }
  return q.updatedSince ? { [timeField]: { gte: q.updatedSince } } : {};
}

/**
 * Split an over-fetched page (limit + 1 rows) into the page and pagination.
 *
 * @template R
 * @param {R[]} rows
 * @param {number} limit
 * @param {(row: R) => { at: Date, id: string }} keyOf
 */
export function paginate(rows, limit, keyOf) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    page,
    pagination: {
      limit,
      count: page.length,
      hasMore,
      // Given whenever the page is non-empty, not only when hasMore: a caller
      // that stores it can resume exactly where it stopped next time.
      nextCursor: last ? encodeCursor(keyOf(last).at, keyOf(last).id) : null,
    },
  };
}

/**
 * §6.1 envelope.
 *
 * @param {{ shop: string, facts: { country: string|null, currency: string|null, timezone: string|null } }} req
 * @param {object[]} data
 * @param {object} pagination
 * @param {Record<string, unknown>} [extra] tombstone keys and the like
 */
export function feedResponse(req, data, pagination, extra = {}) {
  const body = {
    shop: req.shop,
    shopTimezone: req.facts.timezone,
    shopCurrency: req.facts.currency,
    shopCountry: req.facts.country,
    data,
    pagination,
    ...extra,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** UTC ISO 8601 with Z, or null. */
export function iso(d) {
  return d ? new Date(d).toISOString() : null;
}

const minorUnitsMemo = new Map();
/** Decimal places the currency is counted in (JPY 0, PKR 2, KWD 3). */
export function minorUnits(currency) {
  if (!minorUnitsMemo.has(currency)) {
    let digits = 2;
    try {
      digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    } catch {
      digits = 2;
    }
    minorUnitsMemo.set(currency, digits);
  }
  return minorUnitsMemo.get(currency);
}

/**
 * §4 money: `{ amount: "1250.00", currency: "PKR" }`, or null when either
 * part is unknown. Amounts are stored as Float; they are rounded to the
 * currency's minor units here, at the edge, and nowhere else.
 *
 * @param {number|string|null|undefined} amount
 * @param {string|null|undefined} currency
 */
export function money(amount, currency) {
  if (amount == null || amount === "" || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const d = minorUnits(currency);
  const f = 10 ** d;
  const rounded = Math.round((Math.abs(n) + Number.EPSILON) * f) / f;
  return { amount: `${n < 0 ? "-" : ""}${rounded.toFixed(d)}`, currency };
}

/**
 * The buyer block (`{ email, phone, phoneRaw }`) for rows keyed by email, read
 * from the contacts in one query. A soft-deleted contact yields null: a
 * deleted buyer leaves every feed (G-RTN5-7). A row with no contact at all
 * (written before contacts existed) still has its own email.
 *
 * @param {string} shop
 * @param {string[]} emails as stored on the rows, any case
 * @returns {Promise<(email: string) => { email: string, phone: string|null, phoneRaw: string|null } | null>}
 */
export async function buyerLookup(shop, emails) {
  const keys = [...new Set(emails.filter(Boolean).map((e) => String(e).trim().toLowerCase()))];
  const contacts = keys.length
    ? await prisma.contact.findMany({
        where: { shop, email: { in: keys } },
        select: { email: true, phone: true, phoneE164: true, deletedAt: true },
      })
    : [];
  const byEmail = new Map(contacts.map((c) => [c.email, c]));
  return (rawEmail) => {
    const key = String(rawEmail || "").trim().toLowerCase();
    if (!key) return null;
    const c = byEmail.get(key);
    if (!c) return { email: key, phone: null, phoneRaw: null };
    if (c.deletedAt) return null;
    return { email: c.email, phone: c.phoneE164 || null, phoneRaw: c.phone || null };
  };
}

/** The checkout token a cart-triggered enrollment carries in its payload. */
export function payloadCheckoutToken(payload) {
  try {
    const p = typeof payload === "string" ? JSON.parse(payload) : payload;
    const t = p?.checkoutToken;
    return typeof t === "string" && t ? t : null;
  } catch {
    return null;
  }
}

/**
 * A whole feed route: open, read, respond. `read` gets the opened request and
 * returns `{ data, pagination, extra }`.
 *
 * @param {Request} request
 * @param {(req: object) => Promise<{ data: object[], pagination: object, extra?: object }>} read
 */
export async function serveFeed(request, read) {
  const req = await openFeed(request);
  if (!req.ok) return req.response;
  try {
    const { data, pagination, extra } = await read(req);
    return feedResponse(req, data, pagination, extra);
  } catch (err) {
    console.error(`[growzar] feed read failed for ${req.shop} ${new URL(request.url).pathname}`, err);
    return growzarError(500, "internal_error", "Could not read this feed.");
  }
}
