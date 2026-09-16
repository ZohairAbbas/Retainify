/**
 * App-proxy authentication for the storefront endpoints.
 *
 * ── What this closes ───────────────────────────────────────────────────────
 * The storefront routes took `shop` from the request body or query string and
 * served any origin. Nothing proved the caller was a real storefront, so anyone
 * could create push subscriptions for any shop, attach them to any email
 * address, and flip Contact.pushEnabled for a customer they had never met.
 *
 * Shopify was already signing these requests. The theme extension calls through
 * `/apps/retainify/*` (see extensions/cart-rescue-popup/blocks/popup.liquid),
 * which is the app-proxy path, and Shopify appends a signed `shop`, `signature`
 * and `timestamp` to every request it forwards — POST included. The server
 * simply never looked. So this is not new plumbing: it reads a proof that has
 * been arriving all along.
 *
 * ── Why the shop must come from here, not the body ─────────────────────────
 * The signature covers the query string, so `shop` there is attested by Shopify.
 * `shop` in the body is just a string the caller typed. Routes must use the
 * value this returns and ignore their own body field entirely, or the check
 * proves something true about a shop the request is not actually acting on.
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 * Popup and web push are Shopify-only features: both admin pages hard-gate on
 * ctx.isShopify (app.popup.jsx, app.push.jsx), both are hidden from direct
 * workspaces in the nav, and no embed snippet or widget bundle exists for a
 * non-Shopify site. Nothing legitimate calls these endpoints except the theme
 * extension, which means the signature can simply be required — there is no
 * standalone caller to keep working.
 */
import { authenticate } from "../../shopify.server.js";

/**
 * Verify an app-proxy request and return the shop Shopify vouched for.
 *
 * @param {Request} request
 * @returns {Promise<{ ok: true, shop: string } | { ok: false, response: Response }>}
 */
export async function verifyAppProxy(request) {
  const url = new URL(request.url);

  try {
    // Throws a 400 Response when the signature is absent or wrong. A valid
    // signature with no stored session still resolves — that is a shop which
    // uninstalled, and it is the caller's business whether that matters.
    await authenticate.public.appProxy(request);
  } catch (thrown) {
    // The library signals failure by throwing a Response. Anything else is a
    // real fault and must not be reported as a bad signature.
    if (thrown instanceof Response) {
      return { ok: false, response: unauthorized() };
    }
    throw thrown;
  }

  // Read AFTER validation: before it, this is attacker-controlled text.
  const shop = url.searchParams.get("shop") || "";
  if (!shop) {
    // A signature that validates without a shop should be impossible — the
    // signed payload is the query string itself — but a route that proceeded
    // with an empty shop would write rows keyed on "".
    return { ok: false, response: unauthorized() };
  }

  return { ok: true, shop };
}

/**
 * Deliberately not 400.
 *
 * A signature failure and a missing shop are the same event to a caller who
 * should not be here: "this request was not proven to come from a storefront".
 * Distinguishing them would tell a prober which half they got right.
 */
function unauthorized() {
  return new Response(JSON.stringify({ ok: false }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * CORS for a proxied route.
 *
 * Still permissive on origin, and that is fine: the storefront's origin is the
 * merchant's own domain and varies per shop, so pinning it is not possible. The
 * signature — not the origin — is what authorises the request now. Credentials
 * are never allowed, so `*` cannot be used to ride a session.
 */
export const PROXY_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};
