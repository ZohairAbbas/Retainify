/**
 * The website embed: a popup on a site that isn't a Shopify storefront.
 *
 * A Shopify storefront reaches us through the app proxy, and Shopify's
 * signature says which shop it is. Any other website has nothing like that,
 * so it identifies itself with a public site key from its script tag — and
 * because that key is public (it's in the page source), it is never enough on
 * its own. Every request must also come from one of the domains the merchant
 * listed. A browser sets Origin itself and a page cannot forge it, so another
 * site that copies the tag gets nothing. (A script outside a browser can send
 * any Origin; that case is left to the same rate limits, cooldowns and double
 * opt-in that protect the Shopify endpoint.)
 */
import crypto from "node:crypto";
import prisma from "../../db.server.js";

const HOST_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/;
const MAX_DOMAINS = 10;
const SEEN_EVERY_MS = 5 * 60 * 1000;

/** A new public site key. Not a secret — just unguessable, so keys can't be enumerated. */
export function newSiteKey() {
  return "site_" + crypto.randomBytes(12).toString("base64url");
}

/** The popup row's site key, creating the row or the key if needed. */
export async function ensureSiteKey(shop) {
  const row = await prisma.popupSettings.findUnique({ where: { shop }, select: { siteKey: true } });
  if (row?.siteKey) return row.siteKey;
  const siteKey = newSiteKey();
  await prisma.popupSettings.upsert({
    where: { shop },
    // A brand-new row starts paused: nothing should appear on a live site
    // before the merchant has picked and saved a popup.
    create: { shop, enabled: false, siteKey },
    update: { siteKey },
  });
  return siteKey;
}

/**
 * "https://www.Example.com/shop?x" → "www.example.com". Returns "" for
 * anything that isn't a plain host name (IPs are refused too: a popup on a
 * bare IP is a test box, and localhost is accepted for exactly that).
 */
export function normalizeDomain(input) {
  let s = String(input || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (s.startsWith("*.")) s = s.slice(2);
  if (s === "localhost") return s;
  if (/^\d+(\.\d+){3}$/.test(s)) return "";
  if (!s.includes(".") || !HOST_RE.test(s)) return "";
  return s;
}

/** Parse a textarea of domains into a clean, de-duplicated list. */
export function parseDomains(text) {
  const out = [];
  const invalid = [];
  for (const raw of String(text || "").split(/[\s,]+/)) {
    if (!raw) continue;
    const d = normalizeDomain(raw);
    if (!d) invalid.push(raw);
    else if (!out.includes(d)) out.push(d);
  }
  return { domains: out.slice(0, MAX_DOMAINS), invalid, truncated: out.length > MAX_DOMAINS };
}

/**
 * Is this host one of the listed domains? A listed domain also covers its
 * subdomains ("example.com" allows "www.example.com" and "shop.example.com"),
 * and "www.example.com" also covers the bare "example.com" — people type
 * whichever they see in their address bar.
 */
export function hostAllowed(host, domains) {
  const h = normalizeDomain(host);
  if (!h) return false;
  for (const d of domains || []) {
    if (h === d || h.endsWith("." + d)) return true;
    if (d.startsWith("www.") && h === d.slice(4)) return true;
  }
  return false;
}

/** The host the browser says this request came from, from Origin or Referer. */
export function requestHost(request) {
  const origin = request.headers.get("origin");
  const src = origin && origin !== "null" ? origin : request.headers.get("referer");
  if (!src) return "";
  try { return new URL(src).hostname.toLowerCase(); } catch { return ""; }
}

/**
 * Resolve an embed request to its workspace.
 *
 * @returns {Promise<{ ok: true, shop: string, settings: object, host: string, origin: string }
 *                  | { ok: false, reason: "no_key" | "unknown_key" | "no_domains" | "wrong_domain" }>}
 */
export async function resolveEmbedRequest(request, siteKey) {
  const key = String(siteKey || "").trim();
  if (!/^site_[A-Za-z0-9_-]{8,64}$/.test(key)) return { ok: false, reason: "no_key" };
  const settings = await prisma.popupSettings.findUnique({ where: { siteKey: key } });
  if (!settings) return { ok: false, reason: "unknown_key" };
  if (!settings.siteDomains?.length) return { ok: false, reason: "no_domains" };
  const host = requestHost(request);
  if (!hostAllowed(host, settings.siteDomains)) return { ok: false, reason: "wrong_domain", host };
  const origin = request.headers.get("origin") || "";
  return { ok: true, shop: settings.shop, settings, host, origin };
}

/** Note that the embed loaded on an allowed domain — at most every few minutes. */
export async function recordEmbedSeen(settings, host) {
  const last = settings.lastSeenAt ? new Date(settings.lastSeenAt).getTime() : 0;
  if (Date.now() - last < SEEN_EVERY_MS && settings.lastSeenOrigin === host) return;
  await prisma.popupSettings
    .update({ where: { id: settings.id }, data: { lastSeenAt: new Date(), lastSeenOrigin: host } })
    .catch(() => {});
}

/** CORS for an embed response: echo the verified origin, never "*". */
export function embedCors(origin) {
  return {
    "Content-Type": "application/json",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  };
}
