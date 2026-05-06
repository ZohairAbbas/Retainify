/**
 * Builds tracked URLs that pass through our /track/click route before
 * redirecting to the real destination. This is how we attribute recovered revenue.
 */

const APP_URL = process.env.SHOPIFY_APP_URL || "https://example.com";

/**
 * Build a click-tracked recovery URL.
 * The /track/click route records the click then redirects to destination.
 */
export function buildTrackingUrl({ shop, abandonedCartId, emailNumber, destination }) {
  const params = new URLSearchParams({
    shop,
    cart: abandonedCartId,
    em: String(emailNumber),
    dest: destination,
  });
  return `${APP_URL}/track/click?${params.toString()}`;
}

/**
 * Build a one-click unsubscribe URL.
 */
export function buildUnsubscribeUrl({ shop, email }) {
  const params = new URLSearchParams({ shop, email });
  return `${APP_URL}/track/unsubscribe?${params.toString()}`;
}
