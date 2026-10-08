/**
 * GET /api/v1/growzar/journeys (G-RTN5-2): flows and campaigns, no content.
 *
 * kind: a campaign is a Journey with trigger "broadcast" — the app's one-off
 * send, which reuses the Journey model (see the schema comment on its
 * broadcast fields). Every other trigger is a flow.
 *
 * Every field returned is a Journey column, so Journey.updatedAt moves with
 * all of them. Flows are archived, never deleted, by the merchant; the only
 * hard delete is shop erasure, after which the feed answers 410.
 */
import prisma from "../../../db.server.js";
import { iso, paginate, windowWhere, TOMBSTONE_CAP } from "../feed.server.js";
import { tombstonesSince } from "../tombstones.server.js";

export async function readJourneys(req) {
  const rows = await prisma.journey.findMany({
    where: { shop: req.shop, ...windowWhere(req) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: req.limit + 1,
    select: {
      id: true, name: true, trigger: true, triggerApp: true, triggerEvent: true,
      status: true, publishedAt: true, archivedAt: true, scheduledFor: true,
      dispatchedAt: true, recipientCount: true, createdAt: true, updatedAt: true,
    },
  });
  const { page, pagination } = paginate(rows, req.limit, (r) => ({ at: r.updatedAt, id: r.id }));
  const deleted = await tombstonesSince(req.shop, "journeys", req.updatedSince, TOMBSTONE_CAP);
  return {
    data: page.map(toJourneyRow),
    pagination,
    extra: { deletedJourneyIds: deleted.ids, deletedJourneyIdsTruncated: deleted.truncated },
  };
}

export function toJourneyRow(j) {
  const campaign = j.trigger === "broadcast";
  return {
    id: j.id,
    name: j.name,
    kind: campaign ? "campaign" : "flow",
    trigger: j.trigger,
    triggerApp: j.triggerApp ?? null,
    triggerEvent: j.triggerEvent ?? null,
    status: j.status,
    publishedAt: iso(j.publishedAt),
    archivedAt: iso(j.archivedAt),
    scheduledFor: campaign ? iso(j.scheduledFor) : null,
    dispatchedAt: campaign ? iso(j.dispatchedAt) : null,
    recipientCount: campaign ? j.recipientCount : null,
    createdAt: iso(j.createdAt),
    updatedAt: iso(j.updatedAt),
  };
}
