/**
 * Deciding whether one arm of an A/B test actually beat the other.
 *
 * ── Why this exists rather than just showing the numbers ───────────────────
 * A table reading "A 8.2%, B 11.7%" looks conclusive at every sample size. At
 * forty recipients an apparent 40% lift is noise more often than not, and a
 * merchant who switches their welcome email on it has made their flow worse
 * while believing the opposite. The report is what turns a difference into a
 * decision, so it has to say when there isn't one yet.
 *
 * That is the same failure the analytics work kept finding: a number rendered
 * with the authority of a measurement when nothing was actually measured.
 *
 * ── The tests used ─────────────────────────────────────────────────────────
 * Open, click and order rates are proportions — a two-proportion z-test.
 * Revenue per recipient is a mean, so it needs a difference-of-means test;
 * Welch's, because the two arms have no reason to share a variance.
 *
 * Both use the normal approximation for the p-value. For Welch's that is
 * strictly a large-sample approximation to the t-distribution, which is why
 * the gate below insists on a real sample before any verdict is given: at the
 * sizes that pass it, the difference between t and z is far smaller than the
 * error in pretending revenue is normally distributed at all.
 *
 * ── Revenue is the shakiest of the four ────────────────────────────────────
 * Order revenue is heavily skewed — most recipients spend nothing, a few spend
 * a lot — so a single large order can move an arm's mean more than the variant
 * did. The test accounts for that through the variance, which is why the
 * verdict on revenue is usually "not enough data yet" for far longer than on
 * clicks. That is the honest answer, not a defect.
 */

/** Recipients each arm needs before any verdict is offered. */
export const MIN_PER_ARM = 100;

/**
 * For a proportion, the normal approximation needs a few events either way.
 * The usual rule of thumb is five successes and five failures per arm.
 */
const MIN_EVENTS = 5;

/** Two-tailed p-value below this reads as a real difference. */
export const ALPHA = 0.05;

export const NOT_ENOUGH = "not_enough";
export const NO_DIFFERENCE = "no_difference";
export const SIGNIFICANT = "significant";

/** Metrics that are proportions of recipients. */
const PROPORTION_METRICS = { open: "opened", click: "clicked", order: "orders" };

/**
 * Standard normal CDF.
 *
 * Abramowitz & Stegun 7.1.26 for erf — accurate to about 1.5e-7, which is
 * several orders of magnitude tighter than anything this decision needs.
 */
export function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** Two-tailed p-value for a z score. */
export function twoTailedP(z) {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/**
 * Two-proportion z-test.
 *
 * @returns {{z: number, p: number}|null} null when the normal approximation
 *          does not hold — which is a "we cannot say", not a "no difference".
 */
export function proportionTest({ aSuccess, aTotal, bSuccess, bTotal }) {
  if (aTotal < 1 || bTotal < 1) return null;
  const aFail = aTotal - aSuccess;
  const bFail = bTotal - bSuccess;
  if (aSuccess < MIN_EVENTS || bSuccess < MIN_EVENTS) return null;
  if (aFail < MIN_EVENTS || bFail < MIN_EVENTS) return null;

  const p1 = aSuccess / aTotal;
  const p2 = bSuccess / bTotal;
  // Pooled proportion: under the null hypothesis both arms share one rate, so
  // the standard error is estimated from the combined sample.
  const pooled = (aSuccess + bSuccess) / (aTotal + bTotal);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / aTotal + 1 / bTotal));
  if (!se) return null;
  const z = (p1 - p2) / se;
  return { z, p: twoTailedP(z) };
}

/**
 * Welch's test for a difference of means, normal approximation.
 *
 * @param {{aMean, aVar, aN, bMean, bVar, bN}} input sample variances
 * @returns {{z: number, p: number}|null}
 */
export function meansTest({ aMean, aVar, aN, bMean, bVar, bN }) {
  if (aN < 2 || bN < 2) return null;
  const se = Math.sqrt(aVar / aN + bVar / bN);
  // Both arms flat — every recipient spent exactly the same, usually zero.
  // There is no difference to detect rather than an infinitely certain one.
  if (!se || !Number.isFinite(se)) return null;
  const z = (aMean - bMean) / se;
  if (!Number.isFinite(z)) return null;
  return { z, p: twoTailedP(z) };
}

/**
 * The verdict shown beside an A/B test's numbers.
 *
 * @param {string} metric one of open | click | order | revenue
 * @param {object} a arm A's rollup — see getCampaignAbBreakdown
 * @param {object} b arm B's rollup
 * @returns {{state, leader, lift, p, confidence, message}}
 */
export function abVerdict(metric, a, b) {
  const notEnough = (why) => ({
    state: NOT_ENOUGH,
    leader: null,
    lift: null,
    p: null,
    confidence: null,
    message: why,
  });

  if (!a || !b) return notEnough("This test hasn't run yet.");

  // Recipients, not sends: an arm's numbers cover its whole branch, which may
  // send more than one message to the same person.
  if (a.recipients < MIN_PER_ARM || b.recipients < MIN_PER_ARM) {
    const short = Math.max(0, MIN_PER_ARM - Math.min(a.recipients, b.recipients));
    return notEnough(
      `Not enough data yet — about ${short} more ${short === 1 ? "contact" : "contacts"} needed on the smaller side.`,
    );
  }

  const result =
    metric === "revenue"
      ? meansTest({
          aMean: a.revenuePerRecipient,
          aVar: a.revenueVariance,
          aN: a.recipients,
          bMean: b.revenuePerRecipient,
          bVar: b.revenueVariance,
          bN: b.recipients,
        })
      : proportionTest({
          aSuccess: a[PROPORTION_METRICS[metric]] || 0,
          aTotal: a.recipients,
          bSuccess: b[PROPORTION_METRICS[metric]] || 0,
          bTotal: b.recipients,
        });

  if (!result) {
    return notEnough(
      metric === "revenue"
        ? "Not enough orders yet to compare revenue."
        : "Not enough responses yet to compare — a handful either way is still noise.",
    );
  }

  const aRate = rateFor(metric, a);
  const bRate = rateFor(metric, b);
  const leader = aRate >= bRate ? "a" : "b";
  const winner = leader === "a" ? aRate : bRate;
  const loser = leader === "a" ? bRate : aRate;
  // Relative lift. Null when the trailing arm scored nothing — "infinitely
  // better" is not a useful thing to print.
  const lift = loser > 0 ? ((winner - loser) / loser) * 100 : null;
  const confidence = Math.round((1 - result.p) * 1000) / 10;

  if (result.p >= ALPHA) {
    return {
      state: NO_DIFFERENCE,
      leader: null,
      lift: null,
      p: result.p,
      confidence,
      message: `No clear winner. The gap so far is within what chance would produce — ${confidence}% confidence, and ${Math.round(ALPHA * 100)}% or better is the bar.`,
    };
  }

  return {
    state: SIGNIFICANT,
    leader,
    lift,
    p: result.p,
    confidence,
    message:
      `${leader.toUpperCase()} is ahead on ${METRIC_LABEL[metric]}` +
      (lift === null ? "" : ` by ${lift.toFixed(0)}%`) +
      ` — ${confidence >= 99.9 ? "over 99.9" : confidence}% confident this isn't chance.`,
  };
}

export const METRIC_LABEL = {
  open: "open rate",
  click: "click rate",
  order: "order rate",
  revenue: "revenue per recipient",
};

/** The number the verdict is judged on, for one arm. */
export function rateFor(metric, arm) {
  if (!arm || !arm.recipients) return 0;
  if (metric === "revenue") return arm.revenuePerRecipient;
  const successes = arm[PROPORTION_METRICS[metric]] || 0;
  return (successes / arm.recipients) * 100;
}
