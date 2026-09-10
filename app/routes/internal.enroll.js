/**
 * POST /internal/enroll — enroll a Growzar app user into an internal flow.
 *
 * Called server-to-server by our own apps (Courierify, Financify, Whatkabot) so
 * their lifecycle messaging runs on Retainify's flow engine instead of being
 * rebuilt in each of them. See docs/internal-messaging.md.
 *
 *   POST /internal/enroll
 *   Authorization: Bearer <INTERNAL_APP_SECRET_COURIERIFY>
 *   { "app": "courierify",
 *     "email": "merchant@example.com",
 *     "name": "Ayesha",              // optional
 *     "phone": "923001234567",       // optional; staged for the WhatsApp phase
 *     "journeyKey": "courierify_onboarding",
 *     "payload": { "plan": "pro" } } // optional; readable as email merge tags
 *
 * Responses
 *   200 { ok: true, enrolled: true,  enrollmentId }   enrolled now
 *   200 { ok: true, enrolled: false, reason }         engine declined (see below)
 *   400 / 401 / 404 / 409 / 429                       caller must fix something
 *
 * `enrolled: false` is a success: the flow's own entry rules — re-entry
 * frequency, entry filters — decided not to enroll this person, which is a
 * normal outcome and not the caller's error. A missing or unpublished flow is
 * NOT that, and answers 404/409, because it means the two sides disagree about
 * what exists.
 *
 * Deliberately outside authenticate.admin: see app/lib/internal/auth.server.js.
 */
import prisma from "../db.server.js";
import { authenticateInternalCaller } from "../lib/internal/auth.server.js";
import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  readPayload,
} from "../lib/internal/api.server.js";
import {
  upsertInternalContact,
  validateInternalEmail,
} from "../lib/internal/contacts.server.js";
import { INTERNAL_SHOP } from "../lib/internal/tenant.js";
import { validateExternalKey } from "../lib/triggerConfig.js";
import { enrollContact } from "../lib/journey/journey-queue.server.js";

export const action = async ({ request }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return errorResponse(400, parsed.error);
  const body = parsed.body;

  const auth = authenticateInternalCaller(request, body.app);
  if (!auth.ok) return errorResponse(auth.status, auth.error);

  const emailCheck = validateInternalEmail(body.email);
  if (!emailCheck.ok) return errorResponse(400, emailCheck.error);

  const keyCheck = validateExternalKey(body.journeyKey, "journeyKey");
  if (!keyCheck.ok) return errorResponse(400, keyCheck.error);

  const payloadCheck = readPayload(body.payload);
  if (!payloadCheck.ok) return errorResponse(400, payloadCheck.error);

  const { email } = emailCheck;
  const journeyKey = keyCheck.key;

  // Resolve the flow first. Creating a contact for an enrollment that cannot
  // happen would leave a row nobody asked for every time a caller typos a key.
  const journey = await prisma.journey.findFirst({
    where: { shop: INTERNAL_SHOP, journeyKey, archivedAt: null },
    select: { id: true, status: true, trigger: true },
  });

  if (!journey) {
    console.warn(`[internal-api] ${auth.app} referenced unknown journeyKey "${journeyKey}"`);
    return errorResponse(404, `No internal flow with journeyKey "${journeyKey}".`);
  }
  if (journey.status !== "published") {
    // enrollContact would refuse this anyway, but silently and with a null
    // return that looks exactly like "entry rules declined". Worth its own code.
    return errorResponse(
      409,
      `Flow "${journeyKey}" is ${journey.status}, not published — nothing would be sent.`,
      { status: journey.status },
    );
  }

  const { contact } = await upsertInternalContact({
    email,
    name: body.name,
    phone: body.phone,
    app: auth.app,
  });
  if (!contact) {
    return errorResponse(500, "Could not store the contact.");
  }

  // enrollContact returns the EXISTING enrollment when its re-entry rules
  // decline (no_reentry, or inside a delayed_/duplicate-webhook window), and
  // null only for the other refusals. A truthy return therefore does not mean
  // "enrolled" — reporting it as one would tell a caller retrying a failed job
  // that it had just started a second drip, when nothing happened at all. One
  // indexed lookup up front is what makes the two distinguishable.
  const priorLatest = await prisma.journeyEnrollment.findFirst({
    where: { journeyId: journey.id, contactEmail: email },
    select: { id: true },
    orderBy: { enrolledAt: "desc" },
  });

  const enrollment = await enrollContact(journey.id, email, body.name || "", {
    ...payloadCheck.payload,
    // Stamped so an enrollment can be traced back to the app that asked for it
    // — the flow itself is shared, and its analytics otherwise cannot tell one
    // caller's users from another's.
    source: "internal_api",
    app: auth.app,
  });

  if (!enrollment) {
    return jsonResponse({
      ok: true,
      enrolled: false,
      reason: "The flow's entry rules declined this contact (entry filters, or it has no sendable steps).",
    });
  }

  if (priorLatest && priorLatest.id === enrollment.id) {
    return jsonResponse({
      ok: true,
      enrolled: false,
      reason: "Already enrolled — the flow's re-entry frequency declined a new enrollment.",
      enrollmentId: enrollment.id,
    });
  }

  return jsonResponse({ ok: true, enrolled: true, enrollmentId: enrollment.id });
};

/**
 * A GET here is a person pasting the URL into a browser, or a misconfigured
 * caller. Neither should see a framework 404 that looks like the route is
 * missing — this endpoint exists and the method is the problem.
 */
export const loader = () => errorResponse(405, "Use POST.");
