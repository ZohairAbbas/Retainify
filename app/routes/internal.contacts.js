/**
 * POST /internal/contacts — sync what is currently true about Growzar users.
 *
 * The state half of internal messaging; /internal/event is the "something
 * happened" half. Merchant360 calls this with each merchant's plan, usage and
 * installed apps so the internal workspace can segment on them.
 *
 *   POST /internal/contacts
 *   Authorization: Bearer <INTERNAL_BROKER_SECRET_MERCHANT360>
 *   X-Internal-Caller: merchant360
 *   { "properties": [                                   // optional definitions
 *       { "key": "courierify_plan", "label": "Courierify plan", "type": "select",
 *         "options": ["free", "starter", "pro", "growzar"] } ],
 *     "contacts": [                                     // 1-200
 *       { "email": "owner@store.com", "name": "Ayesha", "phone": "923001234567",
 *         "properties": { "courierify_plan": "pro", "courierify_usage_pct": 82 },
 *         "tags": ["courierify:active", "courierify:plan:pro"] } ] }
 *
 * An app can call it with its own secret and an `app` field instead.
 *
 * Responses
 *   200 { ok: true, results: [{ email, status: created|updated|skipped|error, ... }] }
 *       One bad contact is reported in its own result and never fails the batch.
 *   400 / 401 / 429   the request as a whole is unusable
 *
 * Behaviour and the ownership rule for tags: app/lib/internal/sync.server.js.
 */
import { authenticateInternalCaller } from "../lib/internal/auth.server.js";
import { errorResponse, jsonResponse, readJsonBody } from "../lib/internal/api.server.js";
import { readSyncRequest, syncInternalContacts } from "../lib/internal/sync.server.js";

export const action = async ({ request }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return errorResponse(400, parsed.error);
  const body = parsed.body;

  const auth = authenticateInternalCaller(request, body.app);
  if (!auth.ok) return errorResponse(auth.status, auth.error);

  const shape = readSyncRequest(body);
  if (!shape.ok) return errorResponse(400, shape.error);

  let outcome;
  try {
    outcome = await syncInternalContacts({
      caller: auth.caller,
      app: auth.app,
      defs: shape.defs,
      contacts: shape.contacts,
    });
  } catch (err) {
    console.error(`[internal-api] contact sync from ${auth.caller} failed:`, err);
    return errorResponse(500, "The contacts could not be synced. Retry later.");
  }
  if (!outcome.ok) return errorResponse(400, outcome.error);

  const counts = outcome.results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log(`[internal-api] ${auth.caller} synced ${outcome.results.length} contacts`, counts);

  return jsonResponse({ ok: true, results: outcome.results });
};

export const loader = () => errorResponse(405, "Use POST.");
