import { unauthenticated } from "../../shopify.server.js";
import prisma from "../../db.server.js";
import { upsertContact } from "./contacts.server.js";

const CUSTOMERS_QUERY = `#graphql
  query syncCustomers($cursor: String, $query: String) {
    customers(first: 200, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        email
        firstName
        lastName
        createdAt
        emailMarketingConsent {
          marketingState
          consentUpdatedAt
        }
      }
    }
  }
`;

export async function getSyncProgress(shop) {
  const s = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!s) {
    return {
      status: "idle",
      done: 0,
      total: null,
      lastError: "",
      lastSyncedAt: null,
      includeNonOptIn: false,
    };
  }
  return {
    status: s.shopifyCustomerSyncStatus || "idle",
    done: s.shopifyCustomerSyncDone || 0,
    total: s.shopifyCustomerSyncTotal,
    lastError: s.shopifyCustomerSyncLastError || "",
    lastSyncedAt: s.lastShopifyCustomerSyncAt,
    includeNonOptIn: !!s.shopifyCustomerSyncIncludeNonOptIn,
  };
}

export async function startSync(shop, { includeNonOptIn = false } = {}) {
  const settings = await prisma.shopSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
  if (settings.shopifyCustomerSyncStatus === "running") {
    return { started: false, reason: "already_running" };
  }
  await prisma.shopSettings.update({
    where: { shop },
    data: {
      shopifyCustomerSyncStatus: "running",
      shopifyCustomerSyncCursor: null,
      shopifyCustomerSyncDone: 0,
      shopifyCustomerSyncTotal: null,
      shopifyCustomerSyncLastError: "",
      shopifyCustomerSyncIncludeNonOptIn: includeNonOptIn,
    },
  });
  // Fire-and-forget — no await. Same pattern as the journey worker.
  setImmediate(() => {
    runSync(shop).catch((err) => {
      console.error("[contacts sync] runSync failed:", err);
    });
  });
  return { started: true };
}

async function runSync(shop) {
  try {
    const { admin } = await unauthenticated.admin(shop);
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    if (!settings) throw new Error("ShopSettings missing");
    let cursor = settings.shopifyCustomerSyncCursor || null;
    const query = settings.shopifyCustomerSyncIncludeNonOptIn
      ? undefined
      : "email_marketing_state:SUBSCRIBED";

    let done = settings.shopifyCustomerSyncDone || 0;
    let hasMore = true;

    while (hasMore) {
      const resp = await admin.graphql(CUSTOMERS_QUERY, {
        variables: { cursor, query },
      });
      const json = await resp.json();
      if (json.errors) {
        throw new Error(JSON.stringify(json.errors));
      }
      const conn = json.data?.customers;
      if (!conn) break;

      for (const node of conn.nodes) {
        if (!node.email) continue;
        const name = [node.firstName, node.lastName].filter(Boolean).join(" ");
        const consent = node.emailMarketingConsent;
        const isSubscribed = consent?.marketingState === "SUBSCRIBED";
        await upsertContact({
          shop,
          email: node.email,
          name,
          source: "shopify_customer",
          shopifyCustomerId: node.id,
          subscriptionStatus: isSubscribed ? "subscribed" : undefined,
          marketingConsentAt: consent?.consentUpdatedAt || null,
        });
        done += 1;
      }

      cursor = conn.pageInfo?.endCursor || null;
      await prisma.shopSettings.update({
        where: { shop },
        data: {
          shopifyCustomerSyncDone: done,
          shopifyCustomerSyncCursor: cursor,
        },
      });

      hasMore = !!conn.pageInfo?.hasNextPage;
    }

    await prisma.shopSettings.update({
      where: { shop },
      data: {
        shopifyCustomerSyncStatus: "idle",
        shopifyCustomerSyncCursor: null,
        shopifyCustomerSyncTotal: done,
        lastShopifyCustomerSyncAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.shopSettings.update({
      where: { shop },
      data: {
        shopifyCustomerSyncStatus: "failed",
        shopifyCustomerSyncLastError: String(err?.message || err).slice(0, 500),
      },
    });
    throw err;
  }
}
