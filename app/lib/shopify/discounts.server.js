import { unauthenticated } from "../../shopify.server.js";
import { OPS, PERMANENT, TRANSIENT } from "../journey/failure-policy.server.js";

/**
 * Classify a discount-minting failure the same way the email adapters classify
 * a send failure, so the queue can react instead of shrugging.
 *
 * This used to be swallowed: the caller caught the throw, logged it, and sent
 * the email anyway with discount_code empty. The renderer then dropped the
 * discount block — but the SUBJECT still promised the offer, and any
 * {discount_code} merge tag in body text rendered as an empty string. The job
 * was marked done, so a broken email looked like a clean send.
 */
export function classifyDiscountError(err) {
  const status = Number(err?.status ?? err?.response?.code ?? err?.$metadata?.httpStatusCode) || 0;
  const message = String(err?.message || "");

  if (status === 429 || /throttl|rate limit/i.test(message)) return TRANSIENT;
  if (status >= 500) return TRANSIENT;
  // A shop we can no longer authenticate against, or one missing write_discounts.
  if (status === 401 || status === 403) return OPS;
  if (/access denied|not approved|scope/i.test(message)) return OPS;
  // userErrors from the mutation are a malformed request; retrying is pointless.
  if (status >= 400) return PERMANENT;
  // Network blips and anything unrecognised: retry rather than discard.
  return TRANSIENT;
}

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(len = 6) {
  return Array.from(
    { length: len },
    () => CHARSET[Math.floor(Math.random() * CHARSET.length)],
  ).join("");
}

const MUTATION = `#graphql
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        codeDiscount {
          ... on DiscountCodeBasic {
            codes(first: 1) {
              nodes {
                code
              }
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Create a single-use percentage discount code via Shopify Admin API.
 * Valid for 48 hours. Applies to all products, all customers.
 *
 * @param {string} shop - mystore.myshopify.com
 * @param {number} discountPct - integer e.g. 10 for 10%
 * @returns {Promise<string>} the generated discount code
 */
export async function createDiscountCode(shop, discountPct) {
  const { admin } = await unauthenticated.admin(shop);
  console.log("[discount] session shop:", shop);
  const code = `RETAINIFY-${randomCode()}`;
  const now = new Date();
  const endsAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const response = await admin.graphql(MUTATION, {
    variables: {
      basicCodeDiscount: {
        title: code,
        code,
        startsAt: now.toISOString(),
        endsAt: endsAt.toISOString(),
        customerGets: {
          value: { percentage: discountPct / 100 },
          items: { all: true },
        },
        customerSelection: { all: true },
        appliesOncePerCustomer: true,
        usageLimit: 1,
      },
    },
  });

  const json = await response.json();
  const userErrors = json.data?.discountCodeBasicCreate?.userErrors;
  if (userErrors?.length) {
    throw new Error(userErrors.map((e) => e.message).join("; "));
  }

  const returned =
    json.data?.discountCodeBasicCreate?.codeDiscountNode?.codeDiscount?.codes
      ?.nodes?.[0]?.code;

  return returned ?? code;
}
