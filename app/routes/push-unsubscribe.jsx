import prisma from "../db.server.js";

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

  await prisma.pushSubscription.updateMany({
    where: { shop, endpoint },
    data: { isActive: false, unsubscribedAt: new Date() },
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return new Response(null, { status: 405 });
};
