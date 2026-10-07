/**
 * GET /api/v1/growzar/enrollments (G-RTN5-3): who entered which journey.
 *
 * Not payload, not contactName — only the checkout token out of the payload,
 * which is what joins a cart flow to its checkout. The buyer comes from the
 * contact (feed.server.js buyerLookup); a deleted contact's rows keep coming,
 * with buyer null.
 *
 * updatedAt is JourneyEnrollment's own (added in this phase), moved by every
 * write to the row and by the Contact trigger when the buyer changes.
 */
import prisma from "../../../db.server.js";
import { buyerLookup, iso, paginate, payloadCheckoutToken, windowWhere, TOMBSTONE_CAP } from "../feed.server.js";
import { tombstonesSince } from "../tombstones.server.js";

export async function readEnrollments(req) {
  const rows = await prisma.journeyEnrollment.findMany({
    where: { shop: req.shop, ...windowWhere(req) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: req.limit + 1,
    select: {
      id: true, journeyId: true, contactEmail: true, payload: true,
      enrolledAt: true, completedAt: true, exitReason: true, updatedAt: true,
    },
  });
  const { page, pagination } = paginate(rows, req.limit, (r) => ({ at: r.updatedAt, id: r.id }));
  const buyer = await buyerLookup(req.shop, page.map((r) => r.contactEmail));
  const deleted = await tombstonesSince(req.shop, "enrollments", req.updatedSince, TOMBSTONE_CAP);
  return {
    data: page.map((e) => ({
      id: e.id,
      journeyId: e.journeyId,
      buyer: buyer(e.contactEmail),
      enrolledAt: iso(e.enrolledAt),
      completedAt: iso(e.completedAt),
      exitReason: e.exitReason || null,
      checkoutToken: payloadCheckoutToken(e.payload),
      updatedAt: iso(e.updatedAt),
    })),
    pagination,
    extra: { deletedEnrollmentIds: deleted.ids, deletedEnrollmentIdsTruncated: deleted.truncated },
  };
}
