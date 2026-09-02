import prisma from "../db.server.js";
import { recalcContactPushEnabled } from "../lib/contacts/engagement.server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
  }

  const { shop, endpoint } = body;
  if (!shop || !endpoint) {
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
