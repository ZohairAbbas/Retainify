/**
 * POST /internal/event — a Growzar app reports a lifecycle event.
 *
 * The one integration surface for internal messaging. Our apps (Financify,
 * Courierify, Whatkabot) report what happened to one of their users; flows
 * built in Retainify decide what that means. Financify sends "installed" once,
 * and whether that starts a three-email onboarding, a single welcome, or nothing
 * at all is changed in the flow builder without a Financify deploy.
 *
 *   POST /internal/event
 *   Authorization: Bearer <INTERNAL_APP_SECRET_FINANCIFY>
 *   { "app":   "financify",
 *     "event": "installed",
 *     "email": "merchant@example.com",
 *     "name":  "Ayesha",                       // optional
 *     "phone": "923001234567",                 // optional; staged for WhatsApp
 *     "data":  { "store_name": "Acme", "plan": "pro" },  // optional; {data.*} in emails
 *     "eventId": "m360-48213" }                // optional; makes retries safe
 *
 * A broker (Merchant360) reporting for an app adds `X-Internal-Caller: <broker>`
 * and presents the broker's secret instead — see lib/internal/auth.server.js.
 *
 * Responses
 *   200 { ok: true, duplicate, exited, enrolled: [{flow, enrollmentId}], declined: [{flow, reason}] }
 *       duplicate: true means this eventId was already handled, and the
 *       outcome shown is the original one — nothing ran again.
 *   400 / 401 / 429                       the caller must fix something
 *   409                                   the same eventId is being handled right now; retry
 *
 * All-empty is a normal 200: an event no flow subscribes to, for someone in no
 * flow, simply changes nothing. The arrays are returned rather than a bare "ok"
 * because they are the first thing to read when a caller believes something
 * should have happened — they separate "the event arrived and matched nothing"
 * from "the event never arrived".
 *
 * Deliberately outside authenticate.admin: see app/lib/internal/auth.server.js.
 * Behaviour lives in app/lib/internal/events.server.js.
 */
import { authenticateInternalCaller } from "../lib/internal/auth.server.js";
import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  readEventData,
  readEventId,
} from "../lib/internal/api.server.js";
import { validateInternalEmail } from "../lib/internal/contacts.server.js";
import { handleLoggedAppEvent } from "../lib/internal/events.server.js";
import { validateExternalKey } from "../lib/triggerConfig.js";

export const action = async ({ request }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return errorResponse(400, parsed.error);
  const body = parsed.body;

  const auth = authenticateInternalCaller(request, body.app);
  if (!auth.ok) return errorResponse(auth.status, auth.error);

  const eventCheck = validateExternalKey(body.event, "event");
  if (!eventCheck.ok) return errorResponse(400, eventCheck.error);

  const emailCheck = validateInternalEmail(body.email);
  if (!emailCheck.ok) return errorResponse(400, emailCheck.error);

  const dataCheck = readEventData(body.data);
  if (!dataCheck.ok) return errorResponse(400, dataCheck.error);

  const idCheck = readEventId(body.eventId);
  if (!idCheck.ok) return errorResponse(400, idCheck.error);

  // A broker must say which app the event belongs to; an app is its own answer.
  if (!auth.app) return errorResponse(400, "app is required.");

  let result;
  try {
    result = await handleLoggedAppEvent({
      caller: auth.caller,
      eventId: idCheck.eventId,
      app: auth.app,
      event: eventCheck.key,
      email: emailCheck.email,
      name: typeof body.name === "string" ? body.name : "",
      phone: typeof body.phone === "string" ? body.phone : "",
      data: dataCheck.data,
    });
  } catch (err) {
    console.error(`[internal-api] ${auth.app} event "${eventCheck.key}" failed:`, err);
    // 500 so the caller retries; nothing here is the caller's fault.
    return errorResponse(500, "The event could not be processed. Retry later.");
  }

  if (result.inProgress) {
    return errorResponse(409, "This eventId is already being processed. Retry shortly.");
  }

  if (!result.duplicate && (result.exited || result.enrolled.length)) {
    console.log(
      `[internal-api] ${auth.app} "${eventCheck.key}" for ${emailCheck.email}` +
        (auth.caller !== auth.app ? ` (via ${auth.caller})` : "") + ": " +
        `exited ${result.exited}, enrolled ${result.enrolled.length}, declined ${result.declined.length}`,
    );
  }

  return jsonResponse({ ok: true, ...result });
};

/**
 * A GET here is a person pasting the URL into a browser, or a misconfigured
 * caller. Neither should see a framework 404 that looks like the route is
 * missing — this endpoint exists and the method is the problem.
 */
export const loader = () => errorResponse(405, "Use POST.");
