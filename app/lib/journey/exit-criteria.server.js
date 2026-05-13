/**
 * Exit-criteria evaluator.
 *
 * Called from webhooks when an event occurs (order placed, customer unsubscribed,
 * cart recovered). Scans active enrollments for the shop+email and exits any whose
 * journey lists the event in its exitCriteria JSON array.
 */
import prisma from "../../db.server.js";
import { exitEnrollment } from "./journey-queue.server.js";

const KNOWN_EVENTS = new Set(["order_placed", "unsubscribed", "cart_recovered"]);

export async function evaluateExitCriteria(shop, contactEmail, event) {
  if (!shop || !contactEmail || !KNOWN_EVENTS.has(event)) return 0;

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
