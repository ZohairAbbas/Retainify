import { unauthenticated } from "../../shopify.server.js";

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
