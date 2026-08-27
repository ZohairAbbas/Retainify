/**
 * Per-recipient CSV export for one campaign.
 *
 * One row per message sent, carrying that recipient's own open and click
 * timestamps — the level of detail a merchant needs to build a suppression
 * list, feed a re-engagement segment, or reconcile against another system.
 *
 * Streamed in batches rather than assembled in memory: an export is precisely
 * the operation most likely to run against a campaign with a very large
 * audience, and buffering that to build one string is how the process dies.
 */
import { requireAccount } from "../lib/auth/require.server.js";
import prisma from "../db.server.js";
import {
  iterateCampaignRecipients,
  resolveRange,
} from "../lib/analytics/campaign.server.js";
import { csvDate, csvStreamResponse, sanitizeFilename } from "../lib/export/csv.server.js";

const FILTERS = new Set(["all", "opened", "clicked", "unopened"]);

export const loader = async ({ request, params }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const { id } = params;

  // Scope the lookup to the shop — the journey id comes from the URL, so this
  // is what stops one merchant exporting another's campaign.
  const journey = await prisma.journey.findFirst({
    where: { id, shop },
    select: { id: true, name: true },
  });
  if (!journey) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const days = resolveRange(url.searchParams.get("range"));
  const filterParam = url.searchParams.get("filter") || "all";
  const filter = FILTERS.has(filterParam) ? filterParam : "all";

  const slug = journey.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const stamp = new Date().toISOString().slice(0, 10);

  return csvStreamResponse({
    filename: sanitizeFilename(`${slug || "campaign"}-recipients-${stamp}.csv`),
    headers: [
      "Email",
      "Name",
      "Step",
      "Step number",
      "Channel",
      "Enrolled at",
      "Sent at",
      "Opened at",
      "Clicked at",
      "Opened",
      "Clicked",
      "Status",
      "Error",
    ],
    batches: iterateCampaignRecipients({ shop, journeyId: id, days, filter }),
    toRow: (r) => [
      r.email,
      r.name,
      r.step,
      r.stepNumber,
      r.channel,
      csvDate(r.enrolledAt),
      csvDate(r.sentAt),
      csvDate(r.openedAt),
      csvDate(r.clickedAt),
      r.openedAt ? "yes" : "no",
      r.clickedAt ? "yes" : "no",
      r.status,
      r.error,
    ],
  });
};
