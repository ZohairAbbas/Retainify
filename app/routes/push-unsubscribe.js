/**
 * Deactivate a web-push subscription.
 *
 * Served through the Shopify app proxy, so the shop comes from the signed query
 * string rather than the body.
 *
 * The endpoint is still required and still scopes the write. That matters more
 * here than the shop does: an endpoint is a long, unguessable, browser-issued
 * URL, and holding one is itself close to proof that you are the browser it
 * belongs to. The worst an attacker with a stolen endpoint can do is stop push
 * reaching a device — the safe direction for a mistake to point.
 */
import prisma from "../db.server.js";
import { recalcContactPushEnabled } from "../lib/contacts/engagement.server.js";
import { verifyAppProxy, PROXY_CORS as CORS } from "../lib/security/app-proxy.server.js";

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const auth = await verifyAppProxy(request);
  if (!auth.ok) return auth.response;
  const { shop } = auth;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
  }

  // `shop` comes from the verified signature, never the body.
  const { endpoint } = body;
  if (!endpoint) {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
  }

  // Read the owner before deactivating — the row is the only link from this
  // endpoint back to a contact, and pushEnabled has to be recomputed from
  // whatever subscriptions that contact has left. They may still have another
  // browser subscribed, so this is a recompute and not a flip to false.
  const sub = await prisma.pushSubscription.findUnique({
    where: { shop_endpoint: { shop, endpoint } },
    select: { contactEmail: true },
  });

  await prisma.pushSubscription.updateMany({
    where: { shop, endpoint },
    data: { isActive: false, unsubscribedAt: new Date() },
  });

  if (sub?.contactEmail) {
    await recalcContactPushEnabled(shop, sub.contactEmail).catch((err) =>
      console.error("[push-unsubscribe] pushEnabled rollup failed:", err.message),
    );
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return new Response(null, { status: 405 });
};
