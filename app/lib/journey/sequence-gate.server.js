/**
 * Step ordering for a journey.
 *
 * ── What this fixes ────────────────────────────────────────────────────────
 * Under the eager scheduler every job for an enrollment was created up front,
 * each with its own scheduledFor, and each claimed independently when due.
 * Nothing ever related them, so a step that died took no notice of the steps
 * behind it: 7,201 enrollments in this database had step 1 fail permanently
 * and a later step send anyway. In practice that meant "Your first order — 10%
 * off" arriving to people who never received the welcome email it refers back
 * to.
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
 * waits rather than overtaking it.
 *
 * ── "Earlier" means two different things ───────────────────────────────────
 * Which steps count as before this one depends on how the enrollment was
 * scheduled, and both answers have to work at once while the eager backlog
 * drains.
 *
 *   eager   every job existed from the start, on one straight line, so
 *           "earlier" is stepNumber < mine. Untouched, deliberately: these
 *           enrollments were created under that model and must finish under it.
 *
 *   lazy    the flow is a tree and stepNumber is a preorder position, so a
 *           lower number can sit on a branch this contact never took. "Earlier"
 *           has to mean MY ANCESTORS — the steps on the one path that reaches
 *           me. Because branches never merge, that path is unique and needs no
 *           record of what the contact did.
 *
 * The lazy path is close to redundant by construction: a job is only created
 * once the previous step settled, and a permanently failed email already ends
 * the enrollment before the next step is scheduled. It stays because "the
 * design says this cannot happen" is exactly the reasoning that produced the
 * 7,201 broken sequences, and because the cancel paths (a dead shop, a stale
 * job, this gate itself) can still retire a step out from under a successor.
 */
import prisma from "../../db.server.js";
import { loadGraph, sendableAncestors } from "./graph.server.js";

export const PROCEED = "proceed";
export const WAIT = "wait";
export const CANCEL = "cancel";

/** How long a blocked step waits before looking again. */
export const SEQUENCE_RECHECK_MS = 15 * 60 * 1000;

/**
 * Decide whether a step may send yet.
 *
 * @param {{id: string, schedulingMode?: string, journeyId?: string}} enrollment
 * @param {{id: string, stepNumber: number, stepKey?: string}} step the step being considered
 * @returns {Promise<{ verdict: string, reason: string }>}
 */
export async function checkStepSequence(enrollment, step) {
  const enrollmentId = enrollment?.id;
  if (!enrollmentId || !step) {
    return { verdict: PROCEED, reason: "no sequence context" };
  }

  const earlier =
    enrollment.schedulingMode === "lazy"
      ? await earlierByAncestry(enrollment, step)
      : await earlierByNumber(enrollmentId, step.stepNumber);

  if (earlier === null) {
    // Ancestry could not be resolved — see earlierByAncestry. Proceeding is the
    // right call: the job was legitimately scheduled, and "I cannot tell" is
    // not evidence that anything died. Only positive evidence cancels.
    return { verdict: PROCEED, reason: "sequence could not be resolved — allowing" };
  }
  if (!earlier.length) return { verdict: PROCEED, reason: "no earlier email steps" };

  // A dead step ahead of us means the story this step continues never happened.
  // Cancelled counts too: it is how a closed shop, a stale job, or this very
  // gate retires work, and sending past it would be just as incoherent.
  const dead = earlier.find((j) => j.status === "failed" || j.status === "cancelled");
  if (dead) {
    return {
      verdict: CANCEL,
      reason: `step ${dead.stepNumber} ${dead.status} — earlier email never reached the recipient`,
    };
  }

  const inFlight = earlier.find((j) => j.status === "pending" || j.status === "processing");
  if (inFlight) {
    return {
      verdict: WAIT,
      reason: `step ${inFlight.stepNumber} still ${inFlight.status} — holding to preserve order`,
    };
  }

  return { verdict: PROCEED, reason: "all earlier email steps settled" };
}

/**
 * Eager: every email step with a lower number, however the flow is shaped.
 *
 * An enrollment belongs to exactly one journey, so enrollmentId already scopes
 * this to the right flow.
 */
async function earlierByNumber(enrollmentId, stepNumber) {
  if (!Number.isFinite(stepNumber)) return null;
  const rows = await prisma.journeyJob.findMany({
    where: {
      enrollmentId,
      step: { nodeType: "email", stepNumber: { lt: stepNumber } },
    },
    select: { status: true, step: { select: { stepNumber: true } } },
  });
  return rows.map((r) => ({ status: r.status, stepNumber: r.step.stepNumber }));
}

/**
 * Lazy: the enabled email steps on the path that reaches this one.
 *
 * Matched on stepKey rather than stepId. The ancestors come from the live
 * graph, but a job may hang off an ARCHIVED step — saveDraft archives any step
 * that still has jobs and puts a fresh row in its place — and the archived row
 * shares its key with the replacement. Matching on id alone would silently find
 * no earlier jobs for every flow the merchant has edited since it started
 * sending, quietly disabling the gate exactly where it is most needed.
 *
 * Returns null when the step is not in the graph at all, which means the
 * merchant deleted it outright and there is no path to walk back along.
 */
async function earlierByAncestry(enrollment, step) {
  if (!enrollment.journeyId) return null;
  const graph = await loadGraph(enrollment.journeyId);

  // Resolve the step's live identity. The job may point at an archived row.
  let node = graph.steps.get(step.id);
  if (!node && step.stepKey) {
    for (const candidate of graph.steps.values()) {
      if (candidate.stepKey === step.stepKey) {
        node = candidate;
        break;
      }
    }
  }
  if (!node) return null;

  const ancestors = sendableAncestors(graph, node.id, ["email"]);
  if (!ancestors.length) return [];

  const keys = ancestors.map((a) => a.stepKey);
  const rows = await prisma.journeyJob.findMany({
    where: { enrollmentId: enrollment.id, step: { stepKey: { in: keys } } },
    select: { status: true, step: { select: { stepNumber: true, stepKey: true } } },
  });
  return rows.map((r) => ({ status: r.status, stepNumber: r.step.stepNumber }));
}
