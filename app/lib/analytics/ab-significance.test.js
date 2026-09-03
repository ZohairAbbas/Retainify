/**
 * Tests for A/B significance.
 *
 * Run: npm test — pure functions, no database needed.
 *
 * The failure this guards against is a report that reads as authoritative
 * before it has any right to. Most of what follows checks that the verdict
 * says "not yet" in situations where the raw percentages look decisive.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  abVerdict,
  normalCdf,
  twoTailedP,
  proportionTest,
  meansTest,
  rateFor,
  MIN_PER_ARM,
  NOT_ENOUGH,
  NO_DIFFERENCE,
  SIGNIFICANT,
} from "./ab-significance.server.js";

/** An arm rollup, as getCampaignAbBreakdown produces. */
const arm = (recipients, over = {}) => ({
  recipients,
  opened: 0,
  clicked: 0,
  orders: 0,
  revenuePerRecipient: 0,
  revenueVariance: 0,
  ...over,
});

// ── The maths ──────────────────────────────────────────────────────────────

test("normalCdf matches known values", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-3);
  assert.ok(Math.abs(normalCdf(2.576) - 0.995) < 1e-3);
});

test("a z of 1.96 is the 5% two-tailed threshold", () => {
  assert.ok(Math.abs(twoTailedP(1.96) - 0.05) < 2e-3);
  assert.ok(twoTailedP(3) < 0.01);
  assert.ok(twoTailedP(0.5) > 0.5);
});

test("proportionTest refuses when the normal approximation doesn't hold", () => {
  // Fewer than five events either way. A 100% vs 0% result on four recipients
  // is not evidence, and returning a confident p-value for it would be worse
  // than returning nothing.
  assert.equal(proportionTest({ aSuccess: 2, aTotal: 4, bSuccess: 0, bTotal: 4 }), null);
  assert.equal(proportionTest({ aSuccess: 400, aTotal: 400, bSuccess: 399, bTotal: 400 }), null);
  assert.ok(proportionTest({ aSuccess: 40, aTotal: 400, bSuccess: 60, bTotal: 400 }));
});

test("meansTest refuses when both arms are flat", () => {
  // Every recipient spent the same, usually nothing. Zero variance would make
  // any gap look infinitely certain.
  assert.equal(meansTest({ aMean: 0, aVar: 0, aN: 500, bMean: 0, bVar: 0, bN: 500 }), null);
  assert.equal(meansTest({ aMean: 5, aVar: 4, aN: 1, bMean: 3, bVar: 4, bN: 500 }), null);
  assert.ok(meansTest({ aMean: 12, aVar: 400, aN: 500, bMean: 8, bVar: 380, bN: 500 }));
});

// ── The gate ───────────────────────────────────────────────────────────────

test("a small sample gets no verdict, however dramatic the gap", () => {
  // 40% vs 10% on twenty people each. The percentages look decisive; they are
  // not, and this is exactly where a merchant would act on noise.
  const v = abVerdict("click", arm(20, { clicked: 8 }), arm(20, { clicked: 2 }));
  assert.equal(v.state, NOT_ENOUGH);
  assert.equal(v.leader, null, "no winner may be named");
  assert.match(v.message, /Not enough data yet/);
});

test("the gate names how many more contacts are needed", () => {
  const v = abVerdict("click", arm(60, { clicked: 10 }), arm(90, { clicked: 20 }));
  assert.equal(v.state, NOT_ENOUGH);
  assert.match(v.message, new RegExp(`${MIN_PER_ARM - 60} more contacts`));
});

test("enough recipients but almost no responses still gets no verdict", () => {
  const v = abVerdict("order", arm(500, { orders: 1 }), arm(500, { orders: 4 }));
  assert.equal(v.state, NOT_ENOUGH);
  assert.match(v.message, /Not enough responses/);
});

test("a test that has not run at all says so", () => {
  assert.equal(abVerdict("click", null, null).state, NOT_ENOUGH);
  assert.equal(abVerdict("click", arm(0), arm(0)).state, NOT_ENOUGH);
});

// ── Real verdicts ──────────────────────────────────────────────────────────

test("a genuine difference at a real sample is called", () => {
  // 8% vs 14% on a thousand each — comfortably beyond chance.
  const v = abVerdict("click", arm(1000, { clicked: 80 }), arm(1000, { clicked: 140 }));
  assert.equal(v.state, SIGNIFICANT);
  assert.equal(v.leader, "b");
  assert.ok(v.p < 0.05);
  assert.match(v.message, /B is ahead on click rate by 75%/);
  assert.match(v.message, /confident this isn't chance/);
});

test("a near-identical pair is called a draw, not a narrow win", () => {
  const v = abVerdict("click", arm(1000, { clicked: 100 }), arm(1000, { clicked: 104 }));
  assert.equal(v.state, NO_DIFFERENCE);
  assert.equal(v.leader, null, "a draw must not name a leader");
  assert.match(v.message, /No clear winner/);
});

test("the arm that is ahead is the one reported", () => {
  const aWins = abVerdict("open", arm(800, { opened: 300 }), arm(800, { opened: 180 }));
  assert.equal(aWins.state, SIGNIFICANT);
  assert.equal(aWins.leader, "a");
  assert.match(aWins.message, /^A is ahead on open rate/);
});

test("lift is omitted rather than printed as infinite", () => {
  // The trailing arm scored nothing at all. "Infinitely better" is not a
  // number a merchant can act on.
  const v = abVerdict("order", arm(600, { orders: 30 }), arm(600, { orders: 0 }));
  if (v.state === SIGNIFICANT) {
    assert.equal(v.lift, null);
    assert.ok(!/by \d+%/.test(v.message), v.message);
  }
});

// ── Revenue ────────────────────────────────────────────────────────────────

test("revenue uses a means test and respects its variance", () => {
  // Same means, but wildly spread — a couple of large orders could explain it.
  const noisy = abVerdict(
    "revenue",
    arm(400, { revenuePerRecipient: 30, revenueVariance: 90000 }),
    arm(400, { revenuePerRecipient: 20, revenueVariance: 90000 }),
  );
  assert.equal(noisy.state, NO_DIFFERENCE, noisy.message);

  // Same gap, tight spread — now it means something.
  const tight = abVerdict(
    "revenue",
    arm(400, { revenuePerRecipient: 30, revenueVariance: 400 }),
    arm(400, { revenuePerRecipient: 20, revenueVariance: 400 }),
  );
  assert.equal(tight.state, SIGNIFICANT, tight.message);
  assert.equal(tight.leader, "a");
});

test("a flow where nobody bought reports no difference, not a winner", () => {
  const v = abVerdict(
    "revenue",
    arm(500, { revenuePerRecipient: 0, revenueVariance: 0 }),
    arm(500, { revenuePerRecipient: 0, revenueVariance: 0 }),
  );
  assert.equal(v.state, NOT_ENOUGH);
  assert.match(v.message, /Not enough orders/);
});

// ── Metric selection ───────────────────────────────────────────────────────

test("rateFor reads the metric the merchant chose", () => {
  const a = arm(200, { opened: 50, clicked: 20, orders: 10, revenuePerRecipient: 7.5 });
  assert.equal(rateFor("open", a), 25);
  assert.equal(rateFor("click", a), 10);
  assert.equal(rateFor("order", a), 5);
  assert.equal(rateFor("revenue", a), 7.5);
  assert.equal(rateFor("click", arm(0)), 0, "no recipients is zero, not a division by zero");
});

test("the same arms can win on one metric and draw on another", () => {
  // Why the metric is chosen per test rather than fixed: a variant can pull
  // more clicks without shifting orders at all.
  const a = arm(1000, { clicked: 80, orders: 40 });
  const b = arm(1000, { clicked: 140, orders: 44 });
  assert.equal(abVerdict("click", a, b).state, SIGNIFICANT);
  assert.equal(abVerdict("order", a, b).state, NO_DIFFERENCE);
});
