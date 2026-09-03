/**
 * Tests for A/B arm assignment.
 *
 * Run: npm test — pure functions, no database needed.
 *
 * The whole reason assignment is a hash rather than a coin flip is that a hash
 * can be asserted. These are the assertions: that the division actually
 * matches the weight the merchant set, that two tests in one flow divide
 * independently, and that a running test is not reshuffled by an edit.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { assignArm, bucketFor, clampWeight } from "./ab-assignment.server.js";
import { ARM_A, ARM_B } from "./graph.server.js";

/** A population big enough for the proportions to settle. */
const POPULATION = 20000;
const enrollments = Array.from({ length: POPULATION }, (_, i) => ({ id: `enr_${i}` }));

const share = (step) => {
  let a = 0;
  for (const e of enrollments) if (assignArm(e, step).arm === ARM_A) a++;
  return (a / POPULATION) * 100;
};

const step = (over = {}) => ({ stepKey: "sk_test", splitWeight: 50, ...over });

// ── Distribution ───────────────────────────────────────────────────────────

test("an even split divides the audience evenly", () => {
  const pct = share(step({ splitWeight: 50 }));
  assert.ok(Math.abs(pct - 50) < 1.5, `expected ~50%, got ${pct.toFixed(2)}%`);
});

test("the merchant's ratio is the ratio they get", () => {
  // The point of an adjustable weight: trying something risky on a small
  // slice. If 10% silently meant 30%, that safety would be fiction.
  for (const w of [10, 25, 75, 90]) {
    const pct = share(step({ splitWeight: w }));
    assert.ok(Math.abs(pct - w) < 1.5, `weight ${w}% produced ${pct.toFixed(2)}%`);
  }
});

test("a 1% arm is genuinely tiny, not rounded away", () => {
  const pct = share(step({ splitWeight: 1 }));
  assert.ok(pct > 0.4 && pct < 1.8, `expected ~1%, got ${pct.toFixed(2)}%`);
});

// ── Stability ──────────────────────────────────────────────────────────────

test("the same enrollment always lands in the same arm", () => {
  const s = step();
  const first = assignArm({ id: "enr_42" }, s).arm;
  for (let i = 0; i < 50; i++) {
    assert.equal(assignArm({ id: "enr_42" }, s).arm, first);
  }
});

test("two tests in one flow divide the audience independently", () => {
  // Hashing on the enrollment alone would put every contact in the same
  // relative position at both splits, so the second test would be measuring
  // the first one's arm rather than its own variants.
  const one = step({ stepKey: "sk_first" });
  const two = step({ stepKey: "sk_second" });
  let agree = 0;
  for (const e of enrollments) {
    if (assignArm(e, one).arm === assignArm(e, two).arm) agree++;
  }
  const pct = (agree / POPULATION) * 100;
  assert.ok(Math.abs(pct - 50) < 2, `arms agreed ${pct.toFixed(1)}% of the time — not independent`);
});

test("assignment keys on stepKey, so editing a flow does not reshuffle a running test", () => {
  // saveDraft recreates every step row on each save. Keying on the id would
  // re-divide contacts mid-flight, and the two halves of the result would have
  // been split on different lines.
  const before = assignArm({ id: "enr_7" }, { stepKey: "sk_stable", splitWeight: 50 });
  const after = assignArm({ id: "enr_7" }, { stepKey: "sk_stable", splitWeight: 50 });
  assert.equal(before.arm, after.arm);
  assert.equal(before.bucket, after.bucket);
});

// ── Bad input ──────────────────────────────────────────────────────────────

test("a weight outside 1–99 is clamped rather than trusted", () => {
  // validateGraph blocks publishing one, so reaching here means the flow was
  // published before that rule or edited around it. A 0% arm would let the
  // report declare a winner from a sample of nobody.
  assert.equal(clampWeight(0), 1);
  assert.equal(clampWeight(100), 99);
  assert.equal(clampWeight(-40), 1);
  assert.equal(clampWeight(undefined), 50);
  assert.equal(clampWeight("70"), 70);
  assert.equal(clampWeight(33.6), 34);

  // And both arms still receive people.
  assert.ok(share(step({ splitWeight: 0 })) > 0.4);
  assert.ok(share(step({ splitWeight: 100 })) < 99.6);
});

test("every assignment is one of the two arms, and says why", () => {
  const { arm, bucket, reason } = assignArm({ id: "enr_1" }, step({ splitWeight: 70 }));
  assert.ok(arm === ARM_A || arm === ARM_B);
  assert.ok(Number.isInteger(bucket) && bucket >= 0 && bucket < 10000);
  assert.match(reason, /bucket \d+\/10000 against 70%/);
});

test("buckets are integers spread across the range", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(bucketFor(`e${i}`, "sk") % 10);
  assert.equal(seen.size, 10, "the low digit should cover every value");
});
