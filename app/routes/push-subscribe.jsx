import prisma from "../db.server.js";
import { upsertContact } from "../lib/contacts/contacts.server.js";

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

  const { shop, endpoint, p256dh, auth, anonId, contactEmail } = body;
  if (!shop || !endpoint || !p256dh || !auth) {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
  }

  await prisma.pushSubscription.upsert({
    where: { shop_endpoint: { shop, endpoint } },
    create: {
      shop,
      endpoint,
      p256dh,
      auth,
      anonId: anonId ?? null,
      contactEmail: contactEmail ?? null,
    },
    update: {
      isActive: true,
      p256dh,
      auth,
      ...(anonId ? { anonId } : {}),
      ...(contactEmail ? { contactEmail } : {}),
    },
  });

  if (contactEmail) {
    upsertContact({ shop, email: contactEmail, source: "push_only" }).catch((err) =>
      console.error("[push-subscribe] upsertContact failed:", err.message),
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
