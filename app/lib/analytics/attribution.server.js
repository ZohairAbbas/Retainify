/**
 * Revenue attribution for flows.
 *
 * Answers one question: of the money this store took, how much followed a click
 * on something a flow sent? Single owner of that rule, so the dashboard, the
 * flow report and the flows list cannot drift apart the way the two previous
 * revenue queries did.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 * A *touch* is a click, not a send and not an open. A send proves only that we
 * mailed someone; crediting every subsequent order to it attributes the store's
 * organic revenue to whichever flow happened to have the widest reach. A click
 * is the recipient coming back to the store through our message, which is the
 * weakest evidence that still means something.
 *
 * An order is credited to the LAST touch within ATTRIBUTION_WINDOW_DAYS before
 * it, and to that touch only. Winner-takes-all is what makes the per-flow
 * figures sum to the shop total: split or multi-touch credit either double
 * counts (every flow claims the same order) or produces fractional currency
 * nobody can reconcile against Shopify.
 *
 * Cancelled, refunded and voided orders are excluded, matching how
 * lib/orders/orders.server.js already computes Contact lifetime value. A refund
 * should take the revenue back out of the report, not leave a flow permanently
 * credited for a sale that unwound.
 *
 * ── Why `tracked` exists ────────────────────────────────────────────────────
 * Clicks are only measurable when the sending domain rewrites links, which the
 * shared fallback domain currently does not do. Every send in the system before
 * 2026-09-01 has clickedAt null for that reason and not because recipients were
 * uninterested. Reporting those windows as zero revenue would be a confident
 * lie in the one place merchants are least able to check it.
 *
 * So `tracked` is false whenever a window contains sends but no measurable
 * ones, and `revenue` comes back null rather than 0. Callers must render that
 * as an absence. Same honest-or-absent principle campaign.server.js already
 * applies to delivery rates.
 *
 * ── Known simplification ────────────────────────────────────────────────────
 * A shop selling in several currencies gets the dominant one, with `mixed` set
 * so the UI can say so. Summing across currencies needs FX rates at order time,
 * which we do not capture.
 */
import prisma from "../../db.server.js";

/**
 * How long after a click an order still counts as caused by it.
 *
 * Seven days is deliberately conservative. It comfortably covers the cart
 * rescue and welcome cases, where intent is already high and conversion happens
 * within days, without reaching so far that ordinary repeat custom starts
 * landing in the report.
 */
export const ATTRIBUTION_WINDOW_DAYS = 7;

/** Order states that must not count toward attributed revenue. */
const EXCLUDED_STATUSES = ["refunded", "voided"];

/**
 * Orders joined to the single click that earned them.
 *
 * The LATERAL subquery is what makes this last-touch: for each order it picks
 * the one most recent qualifying click, so an order appears exactly once no
 * matter how many flows touched the buyer or how many messages a flow sent.
 *
 * Email clicks are gated on clickTracked: a click cannot be recorded on an
 * untracked send, but the flag also keeps a stray event from a misconfigured
 * period out of the touch set entirely. Push and WhatsApp need no such gate —
 * both clicks are recorded by our own redirects (track.push-click.jsx and
 * w.$token.jsx), so a row exists only when the tap actually reached us.
 *
 * WhatsApp participates only for templates created in Retainify, whose URL
 * buttons carry that redirect. One synced from Meta links straight to the
 * merchant, so no tap is ever observed and it contributes nothing here — the
 * WhatsApp settings page says so rather than leaving it looking broken.
 *
 * Emails are lowered on both sides. Order.email is normalised on write by
 * orders.server.js, but JourneyEnrollment.contactEmail is not, and matching
 * them case-sensitively silently dropped real matches.
 *
 * ── Why the shape looks like this ───────────────────────────────────────────
 * The obvious form — build one `touches` CTE for the whole shop, then filter it
 * per order — makes the planner drive from the click window: for every order it
 * scanned every click in the surrounding 7 days and only then checked whose
 * they were. On the reference store that meant 328,859 enrollment lookups and
 * 1.1 seconds, on 3,355 sends and 1,737 orders. It gets worse linearly with
 * both.
 *
 * Pushing the email predicate inside the LATERAL lets each order start from its
 * own buyer — one index hit — and walk only that buyer's clicks. Same result,
 * 31ms. The three indexes it needs are created in the migration alongside the
 * clickTracked column; the JourneyEnrollment one is on lower("contactEmail")
 * and so has no Prisma schema equivalent.
 */
const ATTRIBUTED_ORDERS = `
  SELECT o.id            AS order_id,
         o."totalPrice"  AS total_price,
         o.currency      AS currency,
         t.journey_id    AS journey_id,
         t.step_id       AS step_id
    FROM "Order" o
    JOIN LATERAL (
      SELECT * FROM (
        SELECT e."journeyId" AS journey_id, j."stepId" AS step_id, j."clickedAt" AS at
          FROM "JourneyEnrollment" e
          JOIN "JourneyJob" j ON j."enrollmentId" = e.id
         WHERE e.shop = o.shop
           AND lower(e."contactEmail") = lower(o.email)
           AND j."clickedAt" IS NOT NULL
           AND j."clickTracked"
           AND j."clickedAt" <= o."processedAt"
           AND j."clickedAt" >  o."processedAt" - ($3 || ' days')::interval
        UNION ALL
        SELECT e."journeyId", p."stepId", p."clickedAt"
          FROM "JourneyEnrollment" e
          JOIN "PushJob" p ON p."enrollmentId" = e.id
         WHERE e.shop = o.shop
           AND lower(e."contactEmail") = lower(o.email)
           AND p."clickedAt" IS NOT NULL
           AND p."clickedAt" <= o."processedAt"
           AND p."clickedAt" >  o."processedAt" - ($3 || ' days')::interval
        UNION ALL
        SELECT e."journeyId", w."stepId", w."clickedAt"
          FROM "JourneyEnrollment" e
          JOIN "WhatsappJob" w ON w."enrollmentId" = e.id
         WHERE e.shop = o.shop
           AND lower(e."contactEmail") = lower(o.email)
           AND w."clickedAt" IS NOT NULL
           AND w."clickedAt" <= o."processedAt"
           AND w."clickedAt" >  o."processedAt" - ($3 || ' days')::interval
      ) u
      ORDER BY u.at DESC
      LIMIT 1
    ) t ON true
   WHERE o.shop = $1
     AND o."processedAt" >= $2
     AND o."cancelledAt" IS NULL
     AND o."financialStatus" <> ALL ($4)
`;

/**
 * Whether the sends in this window could report revenue at all.
 *
 * Three states, and the difference between the last two is the whole point:
 *   - sent = 0        → nothing to report; not an error, just an empty flow
 *   - sent > 0, tracked = 0 → we cannot tell; revenue must be null
 *   - tracked > 0     → a real figure, even if that figure is zero
 *
 * @returns {Promise<boolean>} false only in the middle case
 */
async function windowIsTracked(shop, since, journeyIds = null) {
  const where = {
    shop,
    sentAt: { gte: since, not: null },
    ...(journeyIds ? { step: { journeyId: { in: journeyIds } } } : {}),
  };
  const [sent, tracked] = await Promise.all([
    prisma.journeyJob.count({ where }),
    prisma.journeyJob.count({ where: { ...where, clickTracked: true } }),
  ]);
  // No sends at all is a legitimately empty report, not an unmeasurable one.
  if (sent === 0) return true;
  return tracked > 0;
}

/**
 * Collapse per-currency rows into one figure.
 *
 * Picks the currency carrying the most revenue rather than the most orders — a
 * shop's reporting currency is the one the money is in, and a long tail of
 * small foreign orders should not rename the total.
 */
function foldCurrency(rows) {
  if (!rows.length) return { revenue: 0, orders: 0, currency: "", mixed: false };

  const byCurrency = new Map();
  for (const r of rows) {
    const code = r.currency || "";
    const acc = byCurrency.get(code) || { revenue: 0, orders: 0 };
    acc.revenue += Number(r.revenue) || 0;
    acc.orders += Number(r.orders) || 0;
    byCurrency.set(code, acc);
  }

  let winner = "";
  let best = -1;
  for (const [code, acc] of byCurrency) {
    if (acc.revenue > best) {
      best = acc.revenue;
      winner = code;
    }
  }
  const top = byCurrency.get(winner);
  return {
    revenue: round2(top.revenue),
    orders: top.orders,
    currency: winner,
    mixed: byCurrency.size > 1,
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** The shape every caller gets when the window carried no measurable sends. */
function untracked() {
  return { revenue: null, orders: null, currency: "", mixed: false, tracked: false };
}

/**
 * Attributed revenue for one flow.
 *
 * @param {string} shop
 * @param {string} journeyId
 * @param {Date} since
 * @returns {Promise<{revenue: number|null, orders: number|null, currency: string,
 *                    mixed: boolean, tracked: boolean}>}
 */
export async function getFlowAttribution(shop, journeyId, since) {
  if (!(await windowIsTracked(shop, since, [journeyId]))) return untracked();

  const rows = await prisma.$queryRawUnsafe(
    `SELECT currency,
            SUM(total_price)::float8 AS revenue,
            COUNT(*)::int            AS orders
       FROM (${ATTRIBUTED_ORDERS}) a
      WHERE a.journey_id = $5
      GROUP BY currency`,
    shop,
    since,
    String(ATTRIBUTION_WINDOW_DAYS),
    EXCLUDED_STATUSES,
    journeyId,
  );

  return { ...foldCurrency(rows), tracked: true };
}

/**
 * Attributed revenue per step of one flow, so a merchant can see which message
 * earned the money rather than only that the flow did.
 *
 * @returns {Promise<Map<string, {revenue: number, orders: number, currency: string}>>}
 *          Empty map when the window is untracked — callers already hold the
 *          flow-level `tracked` flag and render the absence once, at the top.
 */
export async function getStepAttribution(shop, journeyId, since) {
  if (!(await windowIsTracked(shop, since, [journeyId]))) return new Map();

  const rows = await prisma.$queryRawUnsafe(
    `SELECT step_id, currency,
            SUM(total_price)::float8 AS revenue,
            COUNT(*)::int            AS orders
       FROM (${ATTRIBUTED_ORDERS}) a
      WHERE a.journey_id = $5
      GROUP BY step_id, currency`,
    shop,
    since,
    String(ATTRIBUTION_WINDOW_DAYS),
    EXCLUDED_STATUSES,
    journeyId,
  );

  return groupAndFold(rows, "step_id");
}

/**
 * Group per-currency rows by a key column and fold each group.
 *
 * One key can hold rows in several currencies; folding each group the same way
 * the totals are folded keeps a row consistent with the figure above it.
 */
function groupAndFold(rows, keyColumn) {
  const grouped = new Map();
  for (const r of rows) {
    const list = grouped.get(r[keyColumn]) || [];
    list.push(r);
    grouped.set(r[keyColumn], list);
  }
  const out = new Map();
  for (const [key, list] of grouped) out.set(key, foldCurrency(list));
  return out;
}

/**
 * Attributed revenue across every flow in a shop — the dashboard headline.
 *
 * Replaces the cart-only recovered-revenue figure, which could not report a
 * penny for welcome, win-back, post-purchase or broadcast flows.
 *
 * @param {{ journeyId?: string|null }} [opts] scopes to one flow, for the
 *        dashboard's campaign selector.
 */
export async function getShopAttribution(shop, since, { journeyId = null } = {}) {
  const journeys = await prisma.journey.findMany({
    where: { shop, ...(journeyId ? { id: journeyId } : {}) },
    select: { id: true },
  });
  const ids = journeys.map((j) => j.id);
  if (!ids.length) return { revenue: 0, orders: 0, currency: "", mixed: false, tracked: true };

  if (!(await windowIsTracked(shop, since, ids))) return untracked();

  const rows = await prisma.$queryRawUnsafe(
    `SELECT currency,
            SUM(total_price)::float8 AS revenue,
            COUNT(*)::int            AS orders
       FROM (${ATTRIBUTED_ORDERS}) a
      WHERE a.journey_id = ANY($5)
      GROUP BY currency`,
    shop,
    since,
    String(ATTRIBUTION_WINDOW_DAYS),
    EXCLUDED_STATUSES,
    ids,
  );

  return { ...foldCurrency(rows), tracked: true };
}

/**
 * Attributed revenue for many flows at once — the flows list, which would
 * otherwise issue one query per row.
 *
 * @returns {Promise<Map<string, {revenue: number, orders: number, currency: string}>>}
 */
export async function getFlowAttributionBatch(shop, journeyIds, since) {
  if (!journeyIds?.length) return new Map();
  if (!(await windowIsTracked(shop, since, journeyIds))) return new Map();

  const rows = await prisma.$queryRawUnsafe(
    `SELECT journey_id, currency,
            SUM(total_price)::float8 AS revenue,
            COUNT(*)::int            AS orders
       FROM (${ATTRIBUTED_ORDERS}) a
      WHERE a.journey_id = ANY($5)
      GROUP BY journey_id, currency`,
    shop,
    since,
    String(ATTRIBUTION_WINDOW_DAYS),
    EXCLUDED_STATUSES,
    journeyIds,
  );

  return groupAndFold(rows, "journey_id");
}

/**
 * Whether a shop has any measurable click tracking at all.
 *
 * Lets a surface explain the absence once ("connect a sending domain to measure
 * revenue") instead of repeating a dash on every row.
 */
export async function shopHasClickTracking(shop) {
  const n = await prisma.journeyJob.count({ where: { shop, clickTracked: true } });
  return n > 0;
}
