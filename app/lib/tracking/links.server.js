/**
 * Email link helpers.
 *
 * Click tracking is currently unimplemented for the flow-engine pipeline.
 * Planned: Resend webhook ingesting email.opened / email.clicked events keyed
 * by JourneyJob.resendMessageId. Until then there is no tracked link wrapper.
 */

const APP_URL = process.env.SHOPIFY_APP_URL || "https://example.com";

/**
 * Build a one-click unsubscribe URL.
 */
export function buildUnsubscribeUrl({ shop, email }) {
  const params = new URLSearchParams({ shop, email });
  return `${APP_URL}/track/unsubscribe?${params.toString()}`;
}
