/**
 * Shopify Products — search (for the picker) and top-sellers (for the product
 * grid block when no IDs are pinned).
 *
 * Top-sellers is computed from the last 30 days of orders, aggregated by
 * line-item product, and cached in-process per shop for 1 hour. The cache
 * is intentionally a Map (single-instance VPS); a multi-instance deploy
 * would move this to Redis.
 */

import { unauthenticated } from "../../shopify.server.js";

const PRODUCTS_SEARCH = `#graphql
  query productsSearch($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      nodes {
        id
        title
        handle
        onlineStoreUrl
        featuredImage { url altText }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
      }
    }
  }
`;

const PRODUCTS_BY_IDS = `#graphql
  query productsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        onlineStoreUrl
        featuredImage { url altText }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
      }
    }
  }
`;

const ORDERS_FOR_TOP_SELLERS = `#graphql
  query topSellerOrders($query: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        lineItems(first: 50) {
          nodes {
            quantity
            product {
              id
              title
              handle
              onlineStoreUrl
              featuredImage { url altText }
              priceRangeV2 { minVariantPrice { amount currencyCode } }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const TOP_SELLERS_CACHE_MS = 60 * 60 * 1000; // 1 hour
const topSellersCache = new Map(); // shop -> { ts, products }

function buildProductUrl(p, shop) {
  if (p.onlineStoreUrl) return p.onlineStoreUrl;
  if (!p.handle) return "";
  // Fall back to the .myshopify.com domain when the Online Store sales channel
  // doesn't expose a public URL (storefront not published or a custom domain
  // isn't queryable here). `shop` is `<name>.myshopify.com`.
  const host = shop ? `https://${shop}` : "";
  return `${host}/products/${p.handle}`;
}

function shapeProduct(p, shop) {
  if (!p?.id) return null;
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    url: buildProductUrl(p, shop),
    image: p.featuredImage?.url || "",
    imageAlt: p.featuredImage?.altText || p.title || "",
    price: p.priceRangeV2?.minVariantPrice?.amount || "",
    currency: p.priceRangeV2?.minVariantPrice?.currencyCode || "USD",
  };
}

function escapeQueryTerm(s) {
  // Shopify search syntax: wrap in quotes and escape backslashes/quotes.
  return String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Used by the editor's product picker. Free-text title match.
 * @param {{ admin: { graphql: Function } }} ctx
 * @param {string} q — search query (may be empty → returns most recent products)
 * @returns {Promise<Array>}
 */
export async function searchProducts({ admin, shop }, q, limit = 20) {
  const term = String(q || "").trim();
  const query = term ? `title:*${escapeQueryTerm(term)}*` : "";
  const resp = await admin.graphql(PRODUCTS_SEARCH, {
    variables: { query, first: Math.min(limit, 50) },
  });
  const json = await resp.json();
  const nodes = json.data?.products?.nodes || [];
  return nodes.map((p) => shapeProduct(p, shop)).filter(Boolean);
}

/**
 * Resolve pinned product IDs back to display data at send time.
 * Order is preserved. Missing IDs are silently dropped.
 */
export async function getProductsByIds({ admin, shop }, ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return [];
  const resp = await admin.graphql(PRODUCTS_BY_IDS, { variables: { ids: list } });
  const json = await resp.json();
  const nodes = json.data?.nodes || [];
  return nodes.map((p) => shapeProduct(p, shop)).filter(Boolean);
}

/**
 * Aggregate top-selling products from the last 30 days of orders. Cached
 * per-shop for 1 hour.
 *
 * @param {string} shop — mystore.myshopify.com
 * @param {number} count — number of products to return
 */
export async function getTopSellers(shop, count = 6) {
  const cached = topSellersCache.get(shop);
  if (cached && Date.now() - cached.ts < TOP_SELLERS_CACHE_MS) {
    return cached.products.slice(0, count);
  }

  const { admin } = await unauthenticated.admin(shop);

  // Build query: orders created in the last 30 days, financial_status=paid
  // (skips abandoned/draft orders).
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();
  const query = `created_at:>=${sinceIso} financial_status:paid`;

  const counts = new Map(); // productId -> { product, qty }
  let after = null;
  let pages = 0;
  const MAX_PAGES = 5; // hard cap to keep this query bounded

  while (pages < MAX_PAGES) {
    const resp = await admin.graphql(ORDERS_FOR_TOP_SELLERS, {
      variables: { query, first: 50, after },
    });
    const json = await resp.json();
    const orders = json.data?.orders;
    if (!orders) break;

    for (const order of orders.nodes || []) {
      for (const li of order.lineItems?.nodes || []) {
        const p = li.product;
        if (!p?.id) continue;
        const existing = counts.get(p.id);
        const qty = Number(li.quantity) || 1;
        if (existing) existing.qty += qty;
        else counts.set(p.id, { product: p, qty });
      }
    }

    if (!orders.pageInfo?.hasNextPage) break;
    after = orders.pageInfo.endCursor;
    pages++;
  }

  const ranked = [...counts.values()]
    .sort((a, b) => b.qty - a.qty)
    .map((x) => shapeProduct(x.product, shop))
    .filter(Boolean);

  topSellersCache.set(shop, { ts: Date.now(), products: ranked });
  return ranked.slice(0, count);
}

/**
 * Top-sellers helper for code paths that already have an admin client.
 * Bypasses the cache because callers in the worker context have the client.
 */
export async function getTopSellersWithAdmin({ admin, shop }, count = 6) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const query = `created_at:>=${since} financial_status:paid`;
  const counts = new Map();
  let after = null;
  let pages = 0;
  const MAX_PAGES = 5;
  while (pages < MAX_PAGES) {
    const resp = await admin.graphql(ORDERS_FOR_TOP_SELLERS, {
      variables: { query, first: 50, after },
    });
    const json = await resp.json();
    const orders = json.data?.orders;
    if (!orders) break;
    for (const order of orders.nodes || []) {
      for (const li of order.lineItems?.nodes || []) {
        const p = li.product;
        if (!p?.id) continue;
        const qty = Number(li.quantity) || 1;
        const existing = counts.get(p.id);
        if (existing) existing.qty += qty;
        else counts.set(p.id, { product: p, qty });
      }
    }
    if (!orders.pageInfo?.hasNextPage) break;
    after = orders.pageInfo.endCursor;
    pages++;
  }
  return [...counts.values()]
    .sort((a, b) => b.qty - a.qty)
    .map((x) => shapeProduct(x.product, shop))
    .filter(Boolean)
    .slice(0, count);
}
