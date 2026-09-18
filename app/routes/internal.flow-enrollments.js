/**
 * GET /internal/flow-enrollments?flowId=&since=&cursor=&limit=
 *
 * One internal flow's enrollments with per-message engagement (email sent /
 * opened / clicked, WhatsApp delivered / read / replied), newest first. Keyed
 * by email; Merchant360 joins it to stores. Broker-only.
 */
import { authenticateInternalCaller } from "../lib/internal/auth.server.js";
import { errorResponse, jsonResponse } from "../lib/internal/api.server.js";
import { flowEnrollments } from "../lib/internal/reporting.server.js";

export const loader = async ({ request }) => {
  if (!request.headers.get("x-internal-caller")) return errorResponse(401, "Unknown app or invalid secret.");
  const auth = authenticateInternalCaller(request, null);
  if (!auth.ok) return errorResponse(auth.status, auth.error);

  const url = new URL(request.url);
  const flowId = url.searchParams.get("flowId") || "";
  if (!flowId) return errorResponse(400, "flowId is required.");
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (since && Number.isNaN(since.getTime())) return errorResponse(400, "since must be a date.");

  const result = await flowEnrollments(flowId, {
    since,
    cursor: url.searchParams.get("cursor") || null,
    limit: parseInt(url.searchParams.get("limit") || "1000", 10) || 1000,
  });
  if (!result) return errorResponse(404, "No such internal flow.");
  return jsonResponse({ ok: true, ...result });
};
