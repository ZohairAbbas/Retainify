/**
 * Popup signup, called from the storefront popup JS through the Shopify app
 * proxy (/apps/retainify/popup-signup).
 *
 * It runs in the shopper's browser on the merchant's domain, so it can never
 * require an admin session — but it is no longer unauthenticated. Shopify signs
 * every request it forwards through the proxy, and the shop now comes from that
 * signature rather than from the request body.
 *
 * Every accepted request still sends a confirmation email from the SHARED
 * sending domain, so a flood would burn deliverability for every shop at once.
 * The rest of the defences therefore stay exactly as they were.
 *
 * Defences, cheapest first:
 *   0. Proxy signature — proves the request came through a real storefront, and
 *      supplies the shop. Replaces the guess that a well-formed *.myshopify.com
 *      string in the body meant anything.
 *   1. Shape validation — the address must look like an address.
 *   2. Existence check — the shop must have an enabled popup. Now a
 *      belt-and-braces check rather than the main gate, since the signature
 *      already establishes which shop this is.
 *   3. Per-address cooldown — one confirmation email per address per hour, so
 *      the endpoint cannot be used to mail-bomb a specific person.
 *   4. Per-IP and per-shop rate limits. Still per-process; see the note in
 *      lib/security/rate-limit.server.js.
 *   5. Shop health — a closed or uninstalled shop sends nothing, matching the
 *      rule the workers enforce on queued sends.
 */
import { verifyAppProxy } from "../lib/security/app-proxy.server.js";
import { processPopupSignup } from "../lib/popup/signup.server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // 0. The signature, before any parsing or database work.
  const auth = await verifyAppProxy(request);
  if (!auth.ok) return auth.response;
  // Attested by Shopify. The body's own `shop` field is ignored.
  const shop = auth.shop.trim().toLowerCase();

  return processPopupSignup({ shop, request, headers: CORS, shopShapeOk: (s) => SHOP_RE.test(s) });
};

// CORS preflight
export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return new Response(null, { status: 405 });
};
