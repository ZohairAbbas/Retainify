import { unauthenticated } from "../../shopify.server.js";

const CUSTOMER_CREATE = `#graphql
  mutation customerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer {
        id
        email
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMER_SEARCH = `#graphql
  query customerByEmail($query: String!) {
    customers(first: 1, query: $query) {
      nodes {
        id
        email
      }
    }
  }
`;

const CUSTOMER_CONSENT_UPDATE = `#graphql
  mutation customerEmailMarketingConsentUpdate($input: CustomerEmailMarketingConsentUpdateInput!) {
    customerEmailMarketingConsentUpdate(input: $input) {
      customer {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Sync a confirmed double-opt-in popup signup back to the merchant's Shopify customer list.
 * If the customer already exists, updates their email marketing consent to subscribed.
 * Uses CONFIRMED_OPT_IN because the email was verified via a confirmation link click.
 *
 * @param {string} shop - mystore.myshopify.com
 * @param {string} email - confirmed shopper email
 * @param {Date} consentUpdatedAt - moment of confirmation click
 */
export async function syncConfirmedSubscriber(shop, email, consentUpdatedAt) {
  const { admin } = await unauthenticated.admin(shop);
  const consentTimestamp = consentUpdatedAt.toISOString();

  const createResp = await admin.graphql(CUSTOMER_CREATE, {
    variables: {
      input: {
        email,
        emailMarketingConsent: {
          marketingState: "SUBSCRIBED",
          marketingOptInLevel: "CONFIRMED_OPT_IN",
          consentUpdatedAt: consentTimestamp,
        },
      },
    },
  });
  const createJson = await createResp.json();
  const created = createJson.data?.customerCreate?.customer;
  if (created?.id) return { customerId: created.id, action: "created" };

  const userErrors = createJson.data?.customerCreate?.userErrors || [];
  const isTaken = userErrors.some(
    (e) => /taken|already|exists/i.test(e.message) && (e.field || []).includes("email"),
  );
  if (!isTaken) {
    throw new Error(userErrors.map((e) => e.message).join("; ") || "customerCreate failed");
  }

  const searchResp = await admin.graphql(CUSTOMER_SEARCH, {
    variables: { query: `email:${email}` },
  });
  const searchJson = await searchResp.json();
  const existing = searchJson.data?.customers?.nodes?.[0];
  if (!existing?.id) {
    throw new Error(`customer email taken but lookup returned no record for ${email}`);
  }

  const consentResp = await admin.graphql(CUSTOMER_CONSENT_UPDATE, {
    variables: {
      input: {
        customerId: existing.id,
        emailMarketingConsent: {
          marketingState: "SUBSCRIBED",
          marketingOptInLevel: "CONFIRMED_OPT_IN",
          consentUpdatedAt: consentTimestamp,
        },
      },
    },
  });
  const consentJson = await consentResp.json();
  const consentErrors = consentJson.data?.customerEmailMarketingConsentUpdate?.userErrors || [];
  if (consentErrors.length) {
    throw new Error(consentErrors.map((e) => e.message).join("; "));
  }

  return { customerId: existing.id, action: "updated" };
}
