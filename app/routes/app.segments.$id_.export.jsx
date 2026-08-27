/**
 * Segment member CSV export.
 *
 * Replaces the disabled "Export CSV · Soon" buttons on the segments list and
 * segment detail pages. Works for both kinds: static segments resolve from
 * their membership rows, dynamic ones are evaluated live, so an export always
 * reflects the segment as it stands right now rather than a stale snapshot.
 */
import { requireAccount } from "../lib/auth/require.server.js";
import prisma from "../db.server.js";
import { evaluateSegment } from "../lib/segments/evaluator.server.js";
import { getSegmentById } from "../lib/segments/segments.server.js";
import {
  getSystemSegmentById,
  isSystemSegmentId,
} from "../lib/segments/systemSegments.server.js";
import { csvDate, csvStreamResponse, sanitizeFilename } from "../lib/export/csv.server.js";

const BATCH = 500;

export const loader = async ({ request, params }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const id = params.id;

  const segment = isSystemSegmentId(id)
    ? { ...getSystemSegmentById(id), shop }
    : await getSegmentById(shop, id);
  if (!segment) throw new Response("Not found", { status: 404 });

  // returnIds gives us the full matched set rather than the preview sample the
  // detail page uses.
  const { matchedIds = [] } = await evaluateSegment(shop, segment, {
    sampleSize: 0,
    returnIds: true,
  });

  // Hydrate in pages so a large segment never sits in memory whole.
  async function* batches() {
    for (let i = 0; i < matchedIds.length; i += BATCH) {
      const rows = await prisma.contact.findMany({
        where: { id: { in: matchedIds.slice(i, i + BATCH) }, shop, deletedAt: null },
        include: { tags: { include: { tag: { select: { name: true } } } } },
        orderBy: { id: "asc" },
      });
      if (rows.length) yield rows;
    }
  }

  const slug = String(segment.name || "segment")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const stamp = new Date().toISOString().slice(0, 10);

  return csvStreamResponse({
    filename: sanitizeFilename(`${slug || "segment"}-members-${stamp}.csv`),
    headers: [
      "Email",
      "Name",
      "Phone",
      "Subscription status",
      "Marketing consent at",
      "Source",
      "Tags",
      "Orders",
      "Total spent",
      "Last order",
      "First seen",
      "Last seen",
    ],
    batches: batches(),
    toRow: (c) => [
      c.email,
      c.name,
      c.phone || "",
      c.subscriptionStatus,
      csvDate(c.marketingConsentAt),
      c.source,
      c.tags.map((ct) => ct.tag?.name).filter(Boolean).join("; "),
      c.orderCount,
      c.totalSpent,
      csvDate(c.lastOrderAt),
      csvDate(c.firstSeenAt),
      csvDate(c.lastSeenAt),
    ],
  });
};
