/**
 * GET /internal/flows — the internal workspace's flows and campaigns, with
 * enrollment counts. For Merchant360's analytics flow picker.
 *
 * Broker-only (X-Internal-Caller + broker secret): reporting spans every app's
 * flows, so no single app's secret should read it.
 */
import { authenticateInternalCaller } from "../lib/internal/auth.server.js";
import { errorResponse, jsonResponse } from "../lib/internal/api.server.js";
import { listInternalFlows } from "../lib/internal/reporting.server.js";

export const loader = async ({ request }) => {
  if (!request.headers.get("x-internal-caller")) return errorResponse(401, "Unknown app or invalid secret.");
  const auth = authenticateInternalCaller(request, null);
  if (!auth.ok) return errorResponse(auth.status, auth.error);
  return jsonResponse({ ok: true, flows: await listInternalFlows() });
};
