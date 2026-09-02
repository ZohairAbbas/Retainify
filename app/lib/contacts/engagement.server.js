/**
 * Per-contact engagement aggregates.
 *
 * ── Why these are denormalized ──────────────────────────────────────────────
 * Open rate, click rate and last-email-opened were offered in the segment field
 * picker and then greyed out with a "Soon" pill. The data was never the problem
 * — getContactStatsBatch has computed the rates all along — but it computed
 * them with a grouped join over JourneyJob, and a join is something the segment
 * evaluator can only run inside its 5,000-contact JS scan. So the standard
 * re-engagement segment, "everyone who hasn't opened anything in 90 days", was
 * a field a merchant could see, click, and not use.
 *
 * Rolled onto Contact they are ordinary indexed columns: the rule compiles to a
 * Prisma WHERE and the count is exact at any audience size. This is the same
 * move, for the same reason, as the purchase aggregates in lib/orders — see the
 * comment at the top of orders.server.js.
 *
 * ── Recompute, never increment ──────────────────────────────────────────────
 * Every function here recomputes a contact's figures from JourneyJob in full.
 * Increments drift the instant a webhook is retried, a job is re-sent, or the
 * reconciliation sweep overlaps a live event — and all three happen. A full
 * recompute is one grouped query and cannot drift by construction.
 *
 * ── The two denominators are not the same number ────────────────────────────
 * `emailsSent` counts sends the provider accepted and did not later report as
 * failed, so a bounce doesn't sit in an open-rate denominator forever.
 *
 * `emailsClickTracked` counts only sends whose domain had click tracking
 * active. A send with clickTracked false CANNOT record a click, so leaving it
 * in the denominator reports a measurement gap as a 0% click rate — the exact
 * failure the clickTracked column was added to prevent. Every send made before
 * click tracking shipped is in that state, so for many existing contacts this
 * is zero, and a clickRate rule declines to match them at all rather than
 * claiming they never click.
 */
import { Prisma } from "@prisma/client";
import prisma from "../../db.server.js";
import { normalizeEmail } from "./contacts.server.js";

/** The zeroed row for a contact with no send history at all. */
function emptyRollup() {
  return {
    emailsSent: 0,
    emailsOpened: 0,
    emailsClicked: 0,
    emailsClickTracked: 0,
    openRate: 0,
    clickRate: 0,
    lastEmailOpenedAt: null,
  };
}

function rateOf(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

/** Turn one grouped JourneyJob row into the column values it implies. */
function rollupFromRow(row) {
  const emailsSent = Number(row?.sent) || 0;
  const emailsOpened = Number(row?.opened) || 0;
  const emailsClicked = Number(row?.clicked) || 0;
  const emailsClickTracked = Number(row?.click_tracked) || 0;
  return {
    emailsSent,
    emailsOpened,
    emailsClicked,
    emailsClickTracked,
    openRate: rateOf(emailsOpened, emailsSent),
    clickRate: rateOf(emailsClicked, emailsClickTracked),
    lastEmailOpenedAt: row?.last_opened || null,
  };
}

/**
 * Recompute the email engagement columns for several contacts at once.
 *
 * One grouped query plus one update per contact, rather than the query per
 * contact the single-contact form would cost — the reconciliation sweep runs
 * this over every address touched since its last pass.
 *
 * @param {string} shop
 * @param {string[]} emails
 * @returns {Promise<number>} how many contacts were written
 */
export async function recalcManyContactEmailStats(shop, emails) {
  const list = [...new Set((emails || []).map(normalizeEmail).filter(Boolean))];
  if (!shop || list.length === 0) return 0;

  // JourneyJob reaches a contact only through its enrollment, which Prisma's
  // groupBy cannot traverse — one grouped join instead.
  const rows = await prisma.$queryRaw`
    SELECT e."contactEmail" AS email,
           COUNT(*) FILTER (WHERE j."sentAt" IS NOT NULL
                              AND j."failedAt" IS NULL)      AS sent,
           COUNT(*) FILTER (WHERE j."openedAt" IS NOT NULL)  AS opened,
           COUNT(*) FILTER (WHERE j."clickedAt" IS NOT NULL) AS clicked,
           COUNT(*) FILTER (WHERE j."sentAt" IS NOT NULL
                              AND j."failedAt" IS NULL
                              AND j."clickTracked")          AS click_tracked,
           MAX(j."openedAt")                                 AS last_opened
      FROM "JourneyJob" j
      JOIN "JourneyEnrollment" e ON e."id" = j."enrollmentId"
     WHERE j."shop" = ${shop}
       AND e."contactEmail" IN (${Prisma.join(list)})
     GROUP BY e."contactEmail"`;

  const byEmail = new Map(rows.map((r) => [normalizeEmail(r.email), r]));

  for (const email of list) {
    const row = byEmail.get(email);
    await prisma.contact.updateMany({
      where: { shop, email },
      // An address with no surviving jobs resets to zero rather than keeping a
      // stale figure — that is the enrollment-deleted case, and the same
      // reasoning as the refund reset in recalcManyContactOrderStats.
      data: row ? rollupFromRow(row) : emptyRollup(),
    });
  }
  return list.length;
}

/**
 * Recompute one contact's email engagement columns.
 *
 * Called from the send path and from the open/click webhooks, so it runs once
 * per email event. That is one grouped query against an indexed enrollment
 * join — cheap enough to sit on those paths, and it keeps a segment current
 * with the open that just happened rather than with the last sweep.
 *
 * @param {string} shop
 * @param {string} rawEmail
 */
export async function recalcContactEmailStats(shop, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!shop || !email) return null;
  await recalcManyContactEmailStats(shop, [email]);
  return email;
}

/**
 * Recompute whether a contact has any live browser push subscription.
 *
 * PushSubscription is joined to a contact by email string, not a foreign key,
 * so `pushEnabled` cannot be a relation traversal in a where clause — it has to
 * be a column. Called wherever a subscription's isActive changes: the subscribe
 * and unsubscribe routes, and the push worker when a provider reports an
 * endpoint gone.
 *
 * @param {string} shop
 * @param {string} rawEmail
 */
export async function recalcContactPushEnabled(shop, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!shop || !email) return null;

  const active = await prisma.pushSubscription.count({
    where: { shop, contactEmail: email, isActive: true },
  });
  const pushEnabled = active > 0;
  await prisma.contact.updateMany({ where: { shop, email }, data: { pushEnabled } });
  return pushEnabled;
}
