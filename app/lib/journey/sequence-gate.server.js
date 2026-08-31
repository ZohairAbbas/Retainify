/**
 * Step ordering for a journey.
 *
 * ── What this fixes ────────────────────────────────────────────────────────
 * Every job for an enrollment is created up front, each with its own
 * scheduledFor, and each is claimed independently when due. Nothing ever
 * related them, so a step that died took no notice of the steps behind it:
 * 7,201 enrollments in this database had step 1 fail permanently and a later
 * step send anyway. In practice that meant "Your first order — 10% off"
 * arriving to people who never received the welcome email it refers back to.
 *
 * A flow is a narrative. Step 3 assumes step 1 landed. Sending step 3 alone is
 * not a partial success, it is a different and worse message than intended.
 *
 * ── The rules ──────────────────────────────────────────────────────────────
 * Only EMAIL steps gate. Email carries the narrative; push and WhatsApp are
 * supplementary and fail for benign reasons — no browser subscription, no
 * WhatsApp opt-in — which must not cancel a perfectly good email sequence. A
 * failed email, however, stops everything scheduled after it, on any channel.
 *
 * A SKIP is not a failure. Steps are marked done without sending all the time:
 * the recipient is suppressed, the channel is switched off, there is no push
 * subscription. Those are deliberate decisions, and gating on them would
 * silently strand journeys for anyone in that state.
 *
 * An earlier step still PENDING means "not yet", not "never" — the later step
 * waits rather than overtaking it. This matters more since retries grew teeth:
 * a transient failure can now hold a step for hours, which is ample time for
 * the next step to fall due and jump the queue.
 */
import prisma from "../../db.server.js";

export const PROCEED = "proceed";
export const WAIT = "wait";
export const CANCEL = "cancel";

/** How long a blocked step waits before looking again. */
export const SEQUENCE_RECHECK_MS = 15 * 60 * 1000;

/**
 * Decide whether a step may send yet.
 *
 * @param {string} enrollmentId
 * @param {number} stepNumber the step being considered
 * @returns {Promise<{ verdict: string, reason: string }>}
 */
export async function checkStepSequence(enrollmentId, stepNumber) {
  if (!enrollmentId || !Number.isFinite(stepNumber)) {
    return { verdict: PROCEED, reason: "no sequence context" };
  }

  // Only email steps before this one. An enrollment belongs to exactly one
  // journey, so enrollmentId already scopes this to the right flow.
  const earlier = await prisma.journeyJob.findMany({
    where: {
      enrollmentId,
      step: { nodeType: "email", stepNumber: { lt: stepNumber } },
    },
    select: { status: true, step: { select: { stepNumber: true } } },
  });

  if (!earlier.length) return { verdict: PROCEED, reason: "no earlier email steps" };

  // A dead step ahead of us means the story this step continues never happened.
  // Cancelled counts too: it is how a closed shop, a stale job, or this very
  // gate retires work, and sending past it would be just as incoherent.
  const dead = earlier.find((j) => j.status === "failed" || j.status === "cancelled");
  if (dead) {
    return {
      verdict: CANCEL,
      reason: `step ${dead.step.stepNumber} ${dead.status} — earlier email never reached the recipient`,
    };
  }

  const inFlight = earlier.find((j) => j.status === "pending" || j.status === "processing");
  if (inFlight) {
    return {
      verdict: WAIT,
      reason: `step ${inFlight.step.stepNumber} still ${inFlight.status} — holding to preserve order`,
    };
  }

  return { verdict: PROCEED, reason: "all earlier email steps settled" };
}
