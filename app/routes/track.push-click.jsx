/**
 * Public push-click beacon.
 *
 * Called by the service worker's notificationclick handler (see push-sw.jsx).
 * The push payload carries the PushJob id, so a click resolves to exactly one
 * send — which is what makes a real click-through rate possible. Before this
 * existed the UI derived "clicks" from the count of successfully sent pushes.
 *
 * Threat model is mild: the worst a forged call can do is mark one job clicked,
 * inflating a merchant's own stats. That does not warrant a signature round
 * trip inside a service worker, but it does warrant the write being strictly
 * idempotent and bounded — the update only ever sets a null clickedAt, so
 * replaying it cannot move the timestamp or double-count.
 */
import prisma from "../db.server.js";
import { hit, clientIp } from "../lib/security/rate-limit.server.js";

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

  const jobId = String(body.jobId || "").trim();
  // cuid, so anything wildly outside that shape is not worth a query.
  if (!jobId || jobId.length > 64) {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
  }

  const ip = clientIp(request);
  if (!hit(`pushclick:ip:${ip}`, 60, 60 * 1000).allowed) {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  }

  // Idempotent: only the first click is recorded, so a service worker that
  // retries the beacon cannot overwrite the original timestamp.
  await prisma.pushJob
    .updateMany({
      where: { id: jobId, clickedAt: null, sentAt: { not: null } },
      data: { clickedAt: new Date() },
    })
    .catch((err) => console.error("[push-click] write failed:", err.message));

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return new Response(null, { status: 405 });
};
