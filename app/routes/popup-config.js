/**
 * Popup configuration for a storefront, served through the Shopify app proxy.
 *
 * Lower stakes than the write endpoints — it returns presentation settings the
 * shopper is about to see rendered anyway — but it is proxied like the rest, so
 * the signature is verified and the shop comes from it rather than from an
 * arbitrary query parameter.
 */
import prisma from "../db.server.js";
import { verifyAppProxy } from "../lib/security/app-proxy.server.js";
import { popupConfigPayload } from "../lib/popup/config.server.js";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
  // Private, not public: the response varies per shop and the signed URL that
  // produced it carries a timestamp and signature. A shared cache keyed on a
  // URL that includes those would store a per-shop body under a one-time key —
  // wasteful at best, and a cross-shop mix-up if any proxy ever normalised them
  // away. The browser still caches it for the storefront page's own reloads.
  "Cache-Control": "private, max-age=300",
};

// Called by cart-rescue-popup.js on storefront load.
export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const auth = await verifyAppProxy(request);
  if (!auth.ok) return auth.response;
  const { shop } = auth;

  const settings = await prisma.popupSettings.findUnique({ where: { shop } });
  const payload = await popupConfigPayload(settings, { isShopify: true });
  return new Response(JSON.stringify(payload), { status: 200, headers: HEADERS });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return new Response(null, { status: 405 });
};
