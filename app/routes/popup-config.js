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

  const [settings, shopSettings] = await Promise.all([
    prisma.popupSettings.findUnique({ where: { shop } }),
    prisma.shopSettings.findUnique({
      where: { shop },
      select: { whatsappEnabled: true },
    }),
  ]);

  if (!settings || !settings.enabled) {
    return new Response(JSON.stringify({ enabled: false }), { status: 200, headers: HEADERS });
  }

  const config = settings.config || null;
  const template = settings.template || "editorial";

  return new Response(
    JSON.stringify({
      enabled: true,
      template,
      config,
      // Whether the popup should collect a WhatsApp number and consent. Gated on
      // the channel being switched on for the shop AND opted into for the popup
      // — collecting consent for a channel that can't send is just extra
      // friction on the email signup.
      whatsappOptIn: !!shopSettings?.whatsappEnabled && config?.whatsappOptIn === true,
      // Legacy fields — kept for any old extension build still in the wild.
      headline: settings.headline,
      bodyText: settings.bodyText,
      buttonText: settings.buttonText,
      brandColor: settings.brandColor,
      logoUrl: settings.logoUrl,
      discountPct: config?.discount ?? settings.discountPct,
      delayMs: settings.delayMs,
    }),
    { status: 200, headers: HEADERS },
  );
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return new Response(null, { status: 405 });
};
