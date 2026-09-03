/**
 * Assigning an enrollment to one arm of an A/B split.
 *
 * ── Deterministic, not random ──────────────────────────────────────────────
 * The arm is a hash of (enrollmentId, stepKey) rather than a coin flip. Both
 * would be stable in practice — the choice is written to JourneyPathEvent the
 * first time and never re-rolled — so stability is not the reason.
 *
 * The reasons are that a hash can be TESTED and that its distribution is a
 * property rather than a hope. With Math.random() a test can only assert
 * "roughly half", which means the ratio logic itself — the part a merchant
 * relies on when they send 10% down a risky variant — would go effectively
 * unverified. With a hash, an exact division over a fixed set of ids is an
 * assertion.
 *
 * ── Why the stepKey is in the hash ─────────────────────────────────────────
 * Two tests in one flow must divide the audience independently. Hashing on the
 * enrollment alone would put every contact in the same relative position at
 * both splits: everyone in arm A of the first test would land in arm A of the
 * second, and the second test would be measuring the first one's arm.
 *
 * stepKey rather than stepId because a merchant editing the flow recreates
 * every step row. Keying on the id would reshuffle a running test mid-flight,
 * so contacts enrolled before the edit and after it would be split on
 * different lines and the totals would mean nothing.
 *
 * ── Why the enrollment and not the contact ─────────────────────────────────
 * Each run through a flow is an independent trial. A contact who re-enters an
 * abandoned-cart flow weekly would, under contact-level assignment, land in
 * the same arm every time — so their personal responsiveness would be baked
 * into that arm's result, repeatedly. Enrollment-level assignment means one
 * person can see both variants across separate runs, which is a smaller
 * distortion than one person counting ten times on one side.
 */

import { createHash } from "node:crypto";

import { ARM_A, ARM_B } from "./graph.server.js";

/** Resolution of the hash. 10,000 buckets makes a 0.01% weight expressible. */
const BUCKETS = 10000;

/**
 * Which bucket, 0 to BUCKETS-1, this enrollment falls in for this split.
 *
 * SHA-1 over the two ids, first 52 bits taken as an integer. Not a security
 * boundary — any well-distributed hash would do — but a named one beats an
 * ad-hoc string fold that nobody can reason about the uniformity of.
 *
 * @param {string} enrollmentId
 * @param {string} stepKey
 * @returns {number}
 */
export function bucketFor(enrollmentId, stepKey) {
  const digest = createHash("sha1")
    .update(`${enrollmentId}:${stepKey}`)
    .digest("hex")
    .slice(0, 13); // 52 bits — inside Number.MAX_SAFE_INTEGER
  return parseInt(digest, 16) % BUCKETS;
}

/**
 * The arm this enrollment takes at this split.
 *
 * @param {{ id: string }} enrollment
 * @param {{ stepKey: string, splitWeight: number }} step
 * @returns {{ arm: string, bucket: number, reason: string }}
 */
export function assignArm(enrollment, step) {
  // Clamped rather than trusted. validateGraph blocks publishing a weight
  // outside 1–99, so reaching here with one means the flow was published
  // before that rule existed or edited around it — and a 0% arm would make
  // the report claim a winner from a sample of nobody.
  const weight = clampWeight(step.splitWeight);
  const bucket = bucketFor(enrollment.id, step.stepKey);
  const arm = bucket < (weight / 100) * BUCKETS ? ARM_A : ARM_B;
  return {
    arm,
    bucket,
    reason: `bucket ${bucket}/${BUCKETS} against ${weight}% → ${arm.toUpperCase()}`,
  };
}

/** A usable split percentage: a whole number between 1 and 99. */
export function clampWeight(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 50;
  return Math.min(99, Math.max(1, n));
}
