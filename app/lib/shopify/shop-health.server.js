/**
 * Live shop-health probe for the job workers.
 *
 * ── Why this replaced install.server.js ────────────────────────────────────
 * That module's installedShops() answered "is there a Session row?", a proxy
 * for "is the app installed". Every worker used it; none use it now, because
 * two real incidents showed the proxy is not enough:
 *
 *   1. A merchant CLOSED their store while the app stayed installed. The
 *      Session row survived, every install check passed, and a backlog of
 *      7,154 queued emails drained to the customers of a shop that no longer
 *      existed. Shopify answers such a shop with 403 "Unavailable Shop" — the
 *      only signal we get, and one nothing was asking for.
 *   2. A merchant UNINSTALLED and the Session row was still present afterwards
 *      (webhook not delivered, or a later request re-created it). The install
 *      check happily classified the shop as live.
 *
 * So the authoritative answer comes from asking Shopify, not from our own rows.
 *
 * ── Reading the response ───────────────────────────────────────────────────
 * Probed live against three real shops before this was written:
 *
 *   200                        → live
 *   403 "Unavailable Shop"     → closed/frozen. Unambiguous: it came back even
 *                                for a token seven days past its cached expiry,
 *                                so token staleness does not produce it.
 *   401 invalid access token   → AMBIGUOUS, and the reason this file is careful.
 *                                The same 401 was returned by a genuinely
 *                                uninstalled shop AND by a perfectly live shop
 *                                whose rotated token we had cached stale. Acting
 *                                on a bare 401 would have cancelled a live
 *                                merchant's whole queue.
 *
 * A 401 therefore forces a token refresh and re-probes; only if the refresh
 * itself fails do we conclude the app is gone. Everything else — throttling,
 * 5xx, network — is UNKNOWN, which means "do not send, do not cancel, try
 * again next tick".
 */
import prisma from "../../db.server.js";
import { apiVersion, unauthenticated } from "../../shopify.server.js";

/** Shop answered normally — safe to send. */
export const SHOP_LIVE = "live";
/** Shop is closed/frozen on Shopify's side — cancel its queued work. */
export const SHOP_CLOSED = "closed";
/** No usable credentials left — app removed or access revoked. Cancel. */
export const SHOP_UNINSTALLED = "uninstalled";
/** Transient or unrecognised failure — hold the work, decide later. */
export const SHOP_UNKNOWN = "unknown";

/**
 * How long a verdict is trusted before re-probing. A worker tick claims up to
 * 20 jobs that usually belong to one or two shops, and a large backlog drains
 * over many ticks — without this, a single shop's backlog would spend one
 * Admin API call per tick forever.
 *
 * Live verdicts are cached longer than negative ones: a shop that just answered
 * is unlikely to close in the next few minutes, whereas a "closed"/"uninstalled"
 * verdict is the one we want to stop trusting quickly if the merchant comes
 * back (reinstall, store reopened).
 */
const LIVE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
/** Transient verdicts must not stick at all — the next tick should retry. */
const UNKNOWN_TTL_MS = 30 * 1000;

/** shop → { status, checkedAt } */
const cache = new Map();

function ttlFor(status) {
  if (status === SHOP_LIVE) return LIVE_TTL_MS;
  if (status === SHOP_UNKNOWN) return UNKNOWN_TTL_MS;
  return NEGATIVE_TTL_MS;
}

function cached(shop) {
  const hit = cache.get(shop);
  if (!hit) return null;
  if (Date.now() - hit.checkedAt > ttlFor(hit.status)) {
    cache.delete(shop);
    return null;
  }
  return hit.status;
}

function remember(shop, status) {
  cache.set(shop, { status, checkedAt: Date.now() });
  return status;
}

/** Drop a shop's cached verdict — call after a reinstall so it re-probes. */
export function forgetShopHealth(shop) {
  cache.delete(shop);
}

/** Shopify's wording for a closed/frozen shop, seen on the 403 body. */
function isUnavailableShop(body) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  return /unavailable shop/i.test(text || "");
}

/**
 * The probe itself: the cheapest authenticated REST call there is.
 *
 * Deliberately a raw fetch rather than the library's admin client. The client
 * refreshes the token before every call and, when that refresh fails, rethrows
 * a bare 500 Response with no body — which erases the very distinction this
 * module exists to make (a closed shop and an uninstalled one both arrive as
 * "500, no detail"). Talking to Shopify directly keeps the real status code and
 * body, which is what the classification below is built on.
 *
 * @returns {Promise<{ code: number|null, body: unknown }>} code null = no answer
 */
async function rawProbe(shop, accessToken) {
  try {
    const response = await fetch(`https://${shop}/admin/api/${apiVersion}/shop.json`, {
      headers: { "X-Shopify-Access-Token": accessToken },
      signal: AbortSignal.timeout(10_000),
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { code: response.status, body };
  } catch (err) {
    // DNS failure, timeout, connection reset — says nothing about the shop.
    console.error(`[shop-health] ${shop} probe could not reach Shopify:`, err.message);
    return { code: null, body: null };
  }
}

/** Map one probe result onto a verdict. 401 is handled by the caller. */
function classify(shop, { code, body }) {
  if (code === 200) return SHOP_LIVE;
  if (code === 403 && isUnavailableShop(body)) {
    console.warn(`[shop-health] ${shop} is closed on Shopify ("Unavailable Shop")`);
    return SHOP_CLOSED;
  }
  return null;
}

/** Load the offline session row backing every call we make for this shop. */
function loadOfflineSession(shop) {
  return prisma.session.findFirst({ where: { shop, isOnline: false } });
}

/**
 * Force the library to refresh the stored offline token on its next use.
 *
 * The library refreshes only when the session is within five minutes of its
 * cached `expires`. A token rotated out from under us is invalid *before* that
 * moment arrives, which is exactly the false-401 case. Backdating `expires`
 * makes the very next unauthenticated.admin() call take the refresh path, so
 * the rotation logic stays in the library where it belongs.
 *
 * @returns {Promise<boolean>} whether a refresh could be attempted at all
 */
async function forceTokenRefresh(shop, session) {
  // No refresh token means nothing to refresh with — the only way back is a
  // fresh OAuth grant, i.e. the merchant reinstalling.
  if (!session?.refreshToken) return false;
  if (session.refreshTokenExpires && session.refreshTokenExpires <= new Date()) return false;

  await prisma.session.update({
    where: { id: session.id },
    data: { expires: new Date(Date.now() - 1000) },
  });

  try {
    // Takes the library's refresh path and re-stores the rotated token. It
    // throws a bare 500 Response when the refresh is rejected, so the result is
    // not trustworthy on its own — the re-probe below is what decides.
    await unauthenticated.admin(shop);
  } catch (err) {
    console.warn(`[shop-health] ${shop} token refresh rejected:`, err?.message || `HTTP ${err?.status}`);
  }
  return true;
}

/**
 * Ask Shopify whether we should still be sending for this shop.
 *
 * @param {string} shop
 * @param {{ force?: boolean }} [options] force skips the cache
 * @returns {Promise<SHOP_LIVE|SHOP_CLOSED|SHOP_UNINSTALLED|SHOP_UNKNOWN>}
 */
export async function checkShopHealth(shop, { force = false } = {}) {
  if (!shop) return SHOP_UNKNOWN;
  if (!force) {
    const hit = cached(shop);
    if (hit) return hit;
  }

  // Cheap local check first: no session at all is a definitive answer that
  // costs no API call. Its inverse is NOT definitive, which is the whole point
  // of everything below.
  const session = await loadOfflineSession(shop);
  if (!session) return remember(shop, SHOP_UNINSTALLED);

  const first = await rawProbe(shop, session.accessToken);
  const verdict = classify(shop, first);
  if (verdict) return remember(shop, verdict);

  // Anything other than 200/403-closed/401 is a shop we simply could not reach
  // — throttling, 5xx, a network blip, 402, 423. None of those are evidence
  // that the merchant has gone, so they hold rather than cancel.
  if (first.code !== 401) {
    console.error(`[shop-health] ${shop} probe inconclusive (code=${first.code ?? "n/a"})`);
    return remember(shop, SHOP_UNKNOWN);
  }

  // 401 is the ambiguous one: a live shop whose rotated token we cached stale
  // looks exactly like a shop whose credentials are gone. Refresh, then ask
  // again — only the second answer is allowed to condemn anything.
  let refreshable = false;
  try {
    refreshable = await forceTokenRefresh(shop, session);
  } catch (err) {
    console.error(`[shop-health] ${shop} refresh bookkeeping failed:`, err.message);
    return remember(shop, SHOP_UNKNOWN);
  }
  if (!refreshable) {
    console.warn(`[shop-health] ${shop} returned 401 and has no usable refresh token`);
    return remember(shop, SHOP_UNINSTALLED);
  }

  const refreshed = await loadOfflineSession(shop);
  if (!refreshed) return remember(shop, SHOP_UNINSTALLED);

  const second = await rawProbe(shop, refreshed.accessToken);
  const retryVerdict = classify(shop, second);
  if (retryVerdict) {
    if (retryVerdict === SHOP_LIVE) console.log(`[shop-health] ${shop} recovered after token refresh`);
    return remember(shop, retryVerdict);
  }
  if (second.code === 401) {
    console.warn(`[shop-health] ${shop} still 401 after refresh — treating as uninstalled`);
    return remember(shop, SHOP_UNINSTALLED);
  }

  console.error(`[shop-health] ${shop} re-probe inconclusive (code=${second.code ?? "n/a"})`);
  return remember(shop, SHOP_UNKNOWN);
}

/**
 * Group claimed jobs by what their shop's health says to do with them.
 *
 * One probe per distinct shop per call (and per TTL window), never one per job.
 *
 * @template {{ shop: string }} T
 * @param {T[]} jobs
 * @returns {Promise<{ live: T[], dead: Array<{ job: T, status: string }>, holding: T[] }>}
 */
export async function partitionByShopHealth(jobs) {
  const shops = [...new Set((jobs || []).map((j) => j.shop).filter(Boolean))];
  const verdicts = new Map();
  await Promise.all(
    shops.map(async (shop) => {
      verdicts.set(shop, await checkShopHealth(shop));
    }),
  );

  const live = [];
  const dead = [];
  const holding = [];
  for (const job of jobs || []) {
    const status = verdicts.get(job.shop) ?? SHOP_UNKNOWN;
    if (status === SHOP_LIVE) live.push(job);
    else if (status === SHOP_UNKNOWN) holding.push(job);
    else dead.push({ job, status });
  }
  return { live, dead, holding };
}

/** Human-readable reason stored on cancelled rows. */
export function cancelReasonFor(status) {
  return status === SHOP_CLOSED ? "shop closed on Shopify" : "app uninstalled";
}
