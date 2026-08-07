/**
 * Plan-selection page URL.
 *
 * Shopify App Pricing hosts the plan picker — we never build a checkout. The URL
 * is derived from the STORE handle and the APP handle:
 *
 *   https://admin.shopify.com/store/{storeHandle}/charges/{appHandle}/pricing_plans
 *
 * The app handle is `retainify`, confirmed from the live App Store listing
 * (https://apps.shopify.com/retainify) and set as `handle` in shopify.app.toml.
 * It is NOT the same as application_url. A wrong handle 404s the plan page for
 * every merchant.
 */

/**
 * The App Home handle — NOT the App Store listing slug.
 *
 * These are two different identifiers and they do not match for this app:
 *   - listing slug: "retainify"     (apps.shopify.com/retainify)
 *   - App Home handle: "retainify-1" (admin.shopify.com/store/x/apps/retainify-1)
 *
 * The charges/pricing_plans URL uses the App Home handle. Verified by loading
 * /store/<shop>/charges/retainify-1/pricing_plans successfully, where the
 * "retainify" variant 404s.
 *
 * To confirm this value: open the app in the Shopify admin and read the slug
 * after /apps/ in the URL, or run `shopify app info`.
 */
export const APP_HANDLE =
  // eslint-disable-next-line no-undef
  process.env.SHOPIFY_APP_HANDLE || "retainify-1";

/**
 * Build the hosted plan-selection URL for a shop.
 * @param {string} shop e.g. "cool-shop.myshopify.com"
 */
export function planSelectionUrl(shop) {
  const storeHandle = String(shop || "").replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
}

/**
 * Read the `plan_handle` Shopify appends to the welcome/redirect URL after a
 * merchant approves a charge.
 *
 * ⚠️ Do NOT treat this as authorization on its own — it's a URL parameter the
 * merchant can edit. Use it only to resolve which plan to record, then confirm
 * against billing.check() in the same request before granting access.
 *
 * @param {Request} request
 * @returns {string|null}
 */
export function planHandleFromRequest(request) {
  try {
    return new URL(request.url).searchParams.get("plan_handle");
  } catch {
    return null;
  }
}
