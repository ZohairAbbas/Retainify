/**
 * POST /internal/segments — keep Merchant360-managed segments in the internal
 * workspace in step with Merchant360.
 *
 *   { "segments": [{ "key": "free-near-limit", "name": "Free, near limit", "description": "…" }],
 *     "prune": true }
 *
 * Each becomes a dynamic segment "M360 · <name>" matching contacts tagged
 * "m360:seg:<key>" — tags the contact sync applies. With prune, managed
 * segments no longer listed are soft-deleted. Broker-only.
 */
import { authenticateInternalCaller } from "../lib/internal/auth.server.js";
import { errorResponse, jsonResponse, readJsonBody } from "../lib/internal/api.server.js";
import { ensureManagedSegments } from "../lib/internal/reporting.server.js";

export const action = async ({ request }) => {
  if (!request.headers.get("x-internal-caller")) return errorResponse(401, "Unknown app or invalid secret.");
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return errorResponse(400, parsed.error);
  const auth = authenticateInternalCaller(request, null);
  if (!auth.ok) return errorResponse(auth.status, auth.error);
  const { segments, prune } = parsed.body;
  if (!Array.isArray(segments) || segments.length > 200) return errorResponse(400, "segments must be an array of at most 200.");
  const result = await ensureManagedSegments(segments, { prune: prune === true });
  if (!result.ok) return errorResponse(400, result.error);
  return jsonResponse(result);
};

export const loader = () => errorResponse(405, "Use POST.");
