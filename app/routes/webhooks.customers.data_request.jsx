import { authenticate } from "../shopify.server.js";

// Shopify GDPR — respond with the customer data we hold.
// In a full implementation this would email a data export to the merchant.
export const action = async ({ request }) => {
  await authenticate.webhook(request);
  // Acknowledged — data request received.
  return new Response(null, { status: 200 });
};
