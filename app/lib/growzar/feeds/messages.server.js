/**
 * GET /api/v1/growzar/messages (G-RTN5-1): one row per message job, across
 * JourneyJob (email), WhatsappJob and PushJob, as one feed.
 *
 * ids are "<channel>:<job id>" so they cannot collide across tables, and the
 * union is ordered by (updatedAt, id) with the PREFIXED id — so the cursor
 * walks a cluster of rows sharing one timestamp across all three tables
 * without skipping or repeating any. Each branch is bounded by its own
 * (shop, updatedAt) index and LIMIT before the merge.
 *
 * No bodies, subjects or error text. Times a channel has no such step for are
 * null: email has no read or reply, WhatsApp no open, push only sent and
 * clicked.
 *
 * Ids compare and sort with COLLATE "C" on both sides of the cursor, so the
 * order is byte order whatever the database's default collation is.
 */
import { Prisma } from "@prisma/client";
import prisma from "../../../db.server.js";
import { buyerLookup, iso, paginate, payloadCheckoutToken, TOMBSTONE_CAP } from "../feed.server.js";
import { tombstonesSince } from "../tombstones.server.js";

const NULL_TS = Prisma.sql`NULL::timestamp(3)`;

/**
 * Per channel: the table, and the expression for each time column (or null).
 */
const CHANNELS = [
  {
    channel: "email",
    table: Prisma.sql`"JourneyJob"`,
    templateName: Prisma.sql`NULL::text`,
    deliveredAt: Prisma.sql`j."deliveredAt"`,
    openedAt: Prisma.sql`j."openedAt"`,
    readAt: NULL_TS,
    clickedAt: Prisma.sql`j."clickedAt"`,
    repliedAt: NULL_TS,
    failedAt: Prisma.sql`j."failedAt"`,
  },
  {
    channel: "whatsapp",
    table: Prisma.sql`"WhatsappJob"`,
    templateName: Prisma.sql`NULLIF(j."templateName", '')`,
    deliveredAt: Prisma.sql`j."deliveredAt"`,
    openedAt: NULL_TS,
    readAt: Prisma.sql`j."readAt"`,
    clickedAt: Prisma.sql`j."clickedAt"`,
    repliedAt: Prisma.sql`j."repliedAt"`,
    failedAt: Prisma.sql`j."failedAt"`,
  },
  {
    channel: "push",
    table: Prisma.sql`"PushJob"`,
    templateName: Prisma.sql`NULL::text`,
    deliveredAt: NULL_TS,
    openedAt: NULL_TS,
    readAt: NULL_TS,
    clickedAt: Prisma.sql`j."clickedAt"`,
    repliedAt: NULL_TS,
    // PushJob has no failedAt column; a failed push is status "failed".
    failedAt: NULL_TS,
  },
];

// Timestamps are bound as ISO strings and converted to UTC explicitly: the
// columns are timestamp-without-time-zone holding UTC, and a bound Date's
// conversion would otherwise depend on the session's TimeZone.
const utc = (d) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

function branch(c, req, take) {
  const prefixedId = Prisma.sql`(${c.channel} || ':' || j."id") COLLATE "C"`;
  let window = Prisma.empty;
  if (req.after) {
    window = Prisma.sql`AND (j."updatedAt" > ${utc(req.after.at)}
      OR (j."updatedAt" = ${utc(req.after.at)} AND ${prefixedId} > ${req.after.id} COLLATE "C"))`;
  } else if (req.updatedSince) {
    window = Prisma.sql`AND j."updatedAt" >= ${utc(req.updatedSince)}`;
  }
  return Prisma.sql`(
    SELECT ${prefixedId} AS "id", ${c.channel}::text AS "channel", j."updatedAt",
           e."journeyId", j."stepId", j."enrollmentId", ${c.templateName} AS "templateName",
           j."status", j."scheduledFor", j."sentAt",
           ${c.deliveredAt} AS "deliveredAt", ${c.openedAt} AS "openedAt", ${c.readAt} AS "readAt",
           ${c.clickedAt} AS "clickedAt", ${c.repliedAt} AS "repliedAt", ${c.failedAt} AS "failedAt",
           e."contactEmail", e."payload"
      FROM ${c.table} j
      JOIN "JourneyEnrollment" e ON e."id" = j."enrollmentId"
     WHERE j."shop" = ${req.shop} ${window}
     ORDER BY j."updatedAt", ${prefixedId}
     LIMIT ${take}
  )`;
}

export async function readMessages(req) {
  const take = req.limit + 1;
  const rows = await prisma.$queryRaw`
    SELECT * FROM (
      ${branch(CHANNELS[0], req, take)}
      UNION ALL
      ${branch(CHANNELS[1], req, take)}
      UNION ALL
      ${branch(CHANNELS[2], req, take)}
    ) m
    ORDER BY m."updatedAt", m."id" COLLATE "C"
    LIMIT ${take}`;

  const { page, pagination } = paginate(rows, req.limit, (r) => ({ at: r.updatedAt, id: r.id }));
  const buyer = await buyerLookup(req.shop, page.map((r) => r.contactEmail));
  const deleted = await tombstonesSince(req.shop, "messages", req.updatedSince, TOMBSTONE_CAP);
  return {
    data: page.map((m) => ({
      id: m.id,
      channel: m.channel,
      journeyId: m.journeyId,
      stepId: m.stepId,
      enrollmentId: m.enrollmentId,
      templateName: m.templateName ?? null,
      status: m.status,
      scheduledFor: iso(m.scheduledFor),
      sentAt: iso(m.sentAt),
      deliveredAt: iso(m.deliveredAt),
      openedAt: iso(m.openedAt),
      readAt: iso(m.readAt),
      clickedAt: iso(m.clickedAt),
      repliedAt: iso(m.repliedAt),
      failedAt: iso(m.failedAt),
      buyer: buyer(m.contactEmail),
      checkoutToken: payloadCheckoutToken(m.payload),
      updatedAt: iso(m.updatedAt),
    })),
    pagination,
    extra: { deletedMessageIds: deleted.ids, deletedMessageIdsTruncated: deleted.truncated },
  };
}
