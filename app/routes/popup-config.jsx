import prisma from "../db.server.js";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=300",
};

// Public JSON endpoint — serves popup config for a given shop.
// Called by cart-rescue-popup.js on storefront load.
export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";

  if (!shop) {
    return new Response(JSON.stringify({ enabled: false }), { status: 400, headers: HEADERS });
  }

  const settings = await prisma.popupSettings.findUnique({ where: { shop } });

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
