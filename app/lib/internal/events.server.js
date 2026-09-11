/**
 * What happens when a Growzar app reports a lifecycle event.
 *
 * One call does both halves of lifecycle messaging, in this order:
 *
 *   1. EXIT  — flows this app's event is meant to end. "setup_completed" stops
 *              the setup nudges.
 *   2. ENROLL — flows subscribed to this (app, event). "setup_completed" may
 *              start a tips series.
 *
 * Exits run first so a single event can hand someone from one flow to the next.
 * Run the other way round, a flow that both starts and ends on the same event
 * would enroll the person and then immediately exit them.
 *
 * Everything is scoped to the calling app. The apps share one tenant and often
 * the same merchants, so Financify's "installed" must neither start nor end
 * anything belonging to Courierify.
 *
 * ── "uninstalled" is reserved ──────────────────────────────────────────────
 * It exits every active enrollment in the app's flows, whether or not each flow
 * lists it. Relying on every flow author to remember is how someone ends up
 * receiving "finish your setup" mail for an app they removed. It still enrolls
 * afterwards like any other event, which is where a win-back or feedback flow
 * belongs.
 */
import prisma from "../../db.server.js";
import { enrollContact, exitEnrollment } from "../journey/journey-queue.server.js";
import { evaluateExitCriteria } from "../journey/exit-criteria.server.js";
import { UNINSTALL_EVENT } from "../triggerConfig.js";
import { upsertInternalContact } from "./contacts.server.js";
import { INTERNAL_SHOP } from "./tenant.js";

/**
 * Exit every active enrollment in this app's flows for this person.
 * @returns {Promise<number>}
 */
async function exitAllForApp(app, email) {
  const active = await prisma.journeyEnrollment.findMany({
    where: {
      shop: INTERNAL_SHOP,
      contactEmail: email,
      exitReason: "",
      journey: { triggerApp: app },
    },
    select: { id: true },
  });
  for (const e of active) {
    await exitEnrollment(e.id, `app_uninstalled:${app}`);
  }
  return active.length;
}

/**
 * Enroll the person into one flow, reporting honestly whether it happened.
 *
 * enrollContact returns the EXISTING enrollment when the flow's re-entry rules
 * decline, and null for its other refusals, so a truthy return does not mean
 * "enrolled". Comparing against the latest enrollment from before the call is
 * what tells a new enrollment from a declined one — otherwise a caller retrying
 * a failed request would be told it had just started a second drip.
 */
async function enrollInto(flow, { email, name, payload }) {
  const prior = await prisma.journeyEnrollment.findFirst({
    where: { journeyId: flow.id, contactEmail: email },
    select: { id: true },
    orderBy: { enrolledAt: "desc" },
  });

  const enrollment = await enrollContact(flow.id, email, name || "", payload);

  if (!enrollment) {
    return {
      enrolled: false,
      reason: "The flow's entry filters declined this person, or it has nothing to send.",
    };
  }
  if (prior && prior.id === enrollment.id) {
    return {
      enrolled: false,
      reason: "Already in this flow — its re-entry setting declined a new enrollment.",
    };
  }
  return { enrolled: true, enrollmentId: enrollment.id };
}

/**
 * Handle one lifecycle event from a Growzar app.
 *
 * @param {object} input
 * @param {string} input.app    authenticated caller
 * @param {string} input.event  validated event key
 * @param {string} input.email  validated address
 * @param {string} [input.name]
 * @param {string} [input.phone]
 * @param {Record<string, string|number|boolean>} [input.data] validated; becomes {data.*}
 * @returns {Promise<{
 *   exited: number,
 *   enrolled: Array<{ flow: string, enrollmentId: string }>,
 *   declined: Array<{ flow: string, reason: string }>,
 * }>}
 */
export async function handleAppEvent({ app, event, email, name, phone, data = {} }) {
  // The contact first: enrollment needs it, and even an event that starts and
  // ends nothing keeps the person's name and phone current for the next one.
  const { contact } = await upsertInternalContact({ email, name, phone, app });
  if (!contact) throw new Error("Could not store the contact.");

  const exited =
    event === UNINSTALL_EVENT
      ? await exitAllForApp(app, email)
      : await evaluateExitCriteria(INTERNAL_SHOP, email, event, { app });

  const flows = await prisma.journey.findMany({
    where: {
      shop: INTERNAL_SHOP,
      trigger: "api_event",
      triggerApp: app,
      triggerEvent: event,
      status: "published",
      archivedAt: null,
    },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  const enrolled = [];
  const declined = [];
  for (const flow of flows) {
    const result = await enrollInto(flow, {
      email,
      name,
      // `data` is what the email renderer reads for {data.*}; the rest is the
      // audit trail — the flow is shared by every person this app sends, and
      // its enrollments otherwise cannot say which event put them there.
      payload: { data, app, event, source: "internal_api" },
    });
    if (result.enrolled) enrolled.push({ flow: flow.name, enrollmentId: result.enrollmentId });
    else declined.push({ flow: flow.name, reason: result.reason });
  }

  return { exited, enrolled, declined };
}
