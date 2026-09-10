/**
 * POST /internal/event — report that a Growzar app user did something.
 *
 * The counterpart to /internal/enroll. An onboarding drip that keeps nagging
 * someone who finished setup two days ago is worse than no drip at all, so the
 * calling app tells us when the thing happened and any flow listing that event
 * in its exit criteria releases the contact.
 *
 *   POST /internal/event
 *   Authorization: Bearer <INTERNAL_APP_SECRET_COURIERIFY>
 *   { "app": "courierify",
 *     "email": "merchant@example.com",
 *     "event": "setup_completed" }
 *
 * Responses
 *   200 { ok: true, exited: 2 }   two enrollments released
 *   200 { ok: true, exited: 0 }   nobody was waiting on this event
 *   400 / 401 / 429
 *
 * `exited: 0` is reported rather than hidden behind a bare 200. It is the normal
 * answer when the user is in no flow, and the first thing to look at when a
 * caller believes exits are not working — the count is what separates "the
 * event arrived and matched nothing" from "the event never arrived".
 *
 * The event vocabulary is open: a flow's own exit criteria decide what exits it.
 * See app/lib/journey/exit-criteria.server.js.
 */
import { authenticateInternalCaller } from "../lib/internal/auth.server.js";
import { errorResponse, jsonResponse, readJsonBody } from "../lib/internal/api.server.js";
import { validateInternalEmail } from "../lib/internal/contacts.server.js";
import { INTERNAL_SHOP } from "../lib/internal/tenant.js";
import { validateExternalKey } from "../lib/triggerConfig.js";
import { evaluateExitCriteria } from "../lib/journey/exit-criteria.server.js";

export const action = async ({ request }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return errorResponse(400, parsed.error);
  const body = parsed.body;

  const auth = authenticateInternalCaller(request, body.app);
  if (!auth.ok) return errorResponse(auth.status, auth.error);

  const emailCheck = validateInternalEmail(body.email);
  if (!emailCheck.ok) return errorResponse(400, emailCheck.error);

  const eventCheck = validateExternalKey(body.event, "event");
  if (!eventCheck.ok) return errorResponse(400, eventCheck.error);

  const exited = await evaluateExitCriteria(
    INTERNAL_SHOP,
    emailCheck.email,
    eventCheck.key,
  );

  if (exited > 0) {
    console.log(
      `[internal-api] ${auth.app} event "${eventCheck.key}" exited ${exited} enrollment(s)`,
    );
  }

  return jsonResponse({ ok: true, exited });
};

export const loader = () => errorResponse(405, "Use POST.");
