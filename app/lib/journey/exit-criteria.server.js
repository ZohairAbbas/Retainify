/**
 * Exit-criteria evaluator.
 *
 * Called from webhooks when an event occurs (order placed, customer unsubscribed,
 * cart recovered), and from /internal/event when another Growzar app reports one
 * of its own. Scans active enrollments for the shop+email and exits any whose
 * journey lists the event in its exitCriteria JSON array.
 *
 * ── Why the event vocabulary is open ───────────────────────────────────────
 * This used to guard on a closed set of the three commerce events above, which
 * was right while webhooks were the only caller. Internal lifecycle flows exit
 * on events only the calling app knows about — "setup_completed",
 * "first_shipment_created" — and a closed set turned those into silent no-ops:
 * the drip kept running after the user had already done the thing it was
 * nagging them about.
 *
 * So the authority moved to where it belongs. A journey's own exitCriteria
 * array decides what exits it; this module only checks that the key is a
 * plausible identifier before going to the database with it. An event no flow
 * lists still exits nothing — it is simply no longer rejected before anyone
 * gets to say whether they wanted it.
 */
import prisma from "../../db.server.js";
import { exitEnrollment } from "./journey-queue.server.js";
import { validateExternalKey } from "../triggerConfig.js";

/**
 * Events the app itself raises from its webhooks. Kept named for documentation
 * and for the builder's built-in picker options — not as a gate.
 */
export const COMMERCE_EXIT_EVENTS = ["order_placed", "unsubscribed", "cart_recovered"];

/**
 * Exit every active enrollment for this contact whose flow lists `event`.
 *
 * @param {string} shop
 * @param {string} contactEmail
 * @param {string} event
 * @returns {Promise<number>} how many enrollments were exited
 */
export async function evaluateExitCriteria(shop, contactEmail, event) {
  if (!shop || !contactEmail) return 0;
  // Shape only. A malformed key cannot match any stored criterion anyway, so
  // this is about not issuing a query for obvious junk, not about vocabulary.
  if (!validateExternalKey(event).ok) return 0;

  const enrollments = await prisma.journeyEnrollment.findMany({
    where: { shop, contactEmail, exitReason: "" },
    include: { journey: true },
  });

  let exited = 0;
  for (const e of enrollments) {
    let criteria = [];
    try {
      criteria = JSON.parse(e.journey.exitCriteria || "[]");
    } catch {
      criteria = [];
    }
    if (criteria.includes(event)) {
      await exitEnrollment(e.id, `exit_criteria:${event}`);
      exited++;
    }
  }
  return exited;
}
