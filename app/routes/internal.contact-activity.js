/**
 * GET /internal/contact-activity?email= — every internal flow one person has
 * been in, with engagement, plus their consent state and tags. For the
 * Merchant360 store page. Broker-only.
 */
import { authenticateInternalCaller } from "../lib/internal/auth.server.js";
import { errorResponse, jsonResponse } from "../lib/internal/api.server.js";
import { validateInternalEmail } from "../lib/internal/contacts.server.js";
import { contactActivity } from "../lib/internal/reporting.server.js";

export const loader = async ({ request }) => {
  if (!request.headers.get("x-internal-caller")) return errorResponse(401, "Unknown app or invalid secret.");
  const auth = authenticateInternalCaller(request, null);
  if (!auth.ok) return errorResponse(auth.status, auth.error);
  const email = validateInternalEmail(new URL(request.url).searchParams.get("email"));
  if (!email.ok) return errorResponse(400, email.error);
  return jsonResponse({ ok: true, ...(await contactActivity(email.email)) });
};
