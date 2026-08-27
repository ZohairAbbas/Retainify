/**
 * Plan-selection page URL, and the provider seam that decides which one to use.
 *
 * A Shopify workspace checks out through Shopify App Pricing. A direct (web)
 * workspace has no store and therefore no Shopify checkout — today it has no
 * self-serve checkout at all, and changes plan by contacting us.
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
 * Which billing provider owns checkout for a workspace.
 *
 * This is the seam to extend when web workspaces get self-serve billing: add a
 * "stripe" case here and a matching branch in the Plans page CTA, and nothing
 * else on the page has to change. Everything else it renders — usage meters,
 * entitlements, the comparison table — is provider-agnostic already.
 */
export const BILLING_SHOPIFY = "shopify";
/** No self-serve checkout: the plan is changed by talking to us. */
export const BILLING_NONE = "none";

/**
 * @param {{ isShopify: boolean }} ctx the result of requireAccount()
 * @returns {"shopify"|"none"}
 */
export function billingProviderFor(ctx) {
  return ctx?.isShopify ? BILLING_SHOPIFY : BILLING_NONE;
}

/**
 * Where a workspace with no self-serve checkout should write to change plan.
 * Empty when unset — the page then asks them to get in touch without naming an
 * address, rather than printing a mailbox that may not exist.
 */
export function billingContactEmail() {
  // eslint-disable-next-line no-undef
  return process.env.BILLING_CONTACT_EMAIL || "";
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
