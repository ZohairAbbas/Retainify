/**
 * The lazy scheduler — walks one enrollment through its flow, one node at a time.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Enrollment used to create every job for a whole flow up front, each with its
 * own absolute scheduledFor. That works only while a flow is a straight line:
 * you cannot pre-schedule a path nobody has chosen yet. A split has to be stood
 * on before it can be answered. That scheduler is gone; this is the only one.
 *
 * So the work is scheduled one node at a time instead. An enrollment carries a
 * cursor (`currentStepId` — the next node to process) and a wake time
 * (`nextRunAt`), and this module is the only thing that moves either.
 *
 * ── The two resting states ─────────────────────────────────────────────────
 * A healthy lazy enrollment is always in exactly one of these:
 *
 *   parked   nextRunAt set, no live job     — waiting out a delay
 *   sending  nextRunAt null, one live job   — waiting for a send to settle
 *
 * Anything else is a stall: an enrollment nobody will ever wake. Nothing
 * reports it, no job fails, the contact simply stops hearing from the merchant.
 * That is why the stall reaper in stuck-jobs.server.js ships alongside this
 * file rather than after it — this codebase has twice been bitten by exactly
 * this shape (1,264 stranded quiet-hours jobs, 129 enrollments left open by
 * non-success terminal paths), and both took far too long to notice.
 *
 * ── Operational note: this is forward-only ─────────────────────────────────
 * There is no second scheduler to fall back to. The pre-branching one — which
 * created every job for a whole flow at enrollment — was retired once its
 * backlog reached zero, and its code is gone.
 *
 * So a bad deploy here is fixed forward, not reverted: rolling back to a build
 * without this module leaves every open enrollment with a cursor nothing knows
 * how to move, and they stop silently rather than failing. That is the reason
 * this file is kept as small as it is, and the reason the stall reaper reports
 * on a schedule rather than on demand.
 *
 * ── Who calls this ─────────────────────────────────────────────────────────
 * Only runEnrollmentAdvanceWorker, on the 60s tick. Send workers never call it
 * directly: when a job settles they set nextRunAt = now via
 * settleEnrollmentIfFinished and the next tick picks it up. That keeps every
 * send worker entirely ignorant of the graph, and leaves one place where the
 * cursor moves.
 */

import prisma from "../../db.server.js";
import { loadGraph, nextStepId, NEXT, YES, NO, BY_CHANCE } from "./graph.server.js";
import { assignArm } from "./ab-assignment.server.js";
import { applyTagAction } from "./tag-action.server.js";
import { evaluateSplit } from "./split-conditions.server.js";

/**
 * How many nodes one advance may cross before giving up.
 *
 * A walk only continues across nodes that schedule nothing — splits, disabled
 * steps, steps whose row has gone. Fifty is far beyond any real flow (splits
 * nest three deep at most), so hitting it means the graph is malformed in a way
 * validateGraph should have caught. Better to stop and be reported by the stall
 * reaper than to spin.
 */
const MAX_ADVANCE_STEPS = 50;

/** Enrollments one worker tick will advance. */
const ADVANCE_BATCH = 200;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Move one enrollment as far through its flow as it can go right now.
 *
 * Returns a short verdict for logging and tests:
 *   "parked"   waiting out a delay
 *   "sending"  a job was created; waiting for it to settle
 *   "settled"  the flow ended
 *   "skipped"  not ours to move (eager, already exited, gone)
 *   "stalled"  gave up — malformed graph
 *
 * @param {string} enrollmentId
 * @returns {Promise<{verdict: string, reason: string, steps: number}>}
 */
export async function advanceEnrollment(enrollmentId) {
  const enrollment = await prisma.journeyEnrollment.findUnique({
    where: { id: enrollmentId },
  });
  if (!enrollment) return done("skipped", "enrollment gone");

  if (enrollment.exitReason) {
    // Exited between the claim and now. Clear the wake time so it is not picked
    // up again, and so the stall reaper does not count it.
    await clearWake(enrollmentId);
    return done("skipped", `already exited (${enrollment.exitReason})`);
  }

  // A lazy enrollment owns at most one outstanding job at a time — that is what
  // makes "the job settled" a reliable signal to move on. The worker's claim
  // already prevents a double walk, but advancing past a send that has not
  // finished would queue the next message while the previous one is still in
  // flight, and the guard belongs next to the thing it protects rather than
  // only in the caller.
  if (await hasLiveJob(enrollmentId)) {
    return done("skipped", "a send is still outstanding");
  }

  const graph = await loadGraph(enrollment.journeyId);
  let cursor = enrollment.currentStepId;
  let crossed = 0;

  while (crossed++ < MAX_ADVANCE_STEPS) {
    if (!cursor) return settle(enrollmentId, "completed");

    let step = graph.steps.get(cursor);

    // The cursor points at a step that is no longer live. Almost always this is
    // a merchant editing the flow: saveDraft archives a step that still has
    // jobs and creates a fresh row in its place, so the id under the cursor
    // stops existing while the step itself very much does.
    //
    // stepKey is what survives that swap, so the contact can be put back on the
    // step they were actually standing on rather than being dropped out of the
    // flow — which is what would have happened to every in-flight contact of
    // every edited flow.
    if (!step) {
      // Only the FIRST cursor can be resolved this way: currentStepKey belongs
      // to the step the enrollment was parked on, not to anything reached
      // later in this same walk. A missing step further along means an edge
      // pointing at nothing, which buildGraph already drops.
      const key = crossed === 1 ? enrollment.currentStepKey : null;
      const resumed = key ? findByStepKey(graph, key) : null;
      if (!resumed) {
        console.warn(
          `[advance] enrollment ${enrollmentId} — step ${cursor} is gone and has no replacement; ending the flow here`,
        );
        return settle(enrollmentId, "completed");
      }
      console.warn(
        `[advance] enrollment ${enrollmentId} — step ${cursor} was replaced by ${resumed.id} (stepKey ${key}); resuming`,
      );
      step = resumed;
      cursor = resumed.id;
    }

    switch (step.nodeType) {
      // ── Wait ───────────────────────────────────────────────────────────
      // Measured from now — the moment the previous step settled — not from
      // the trigger. On a tree that is the only definition that means anything:
      // how long a contact has been in the flow depends on which path they took.
      case "delay": {
        const hours = Number(step.delayHours) || 0;
        const wakeAt = new Date(Date.now() + hours * HOUR_MS);
        await moveCursor(enrollmentId, graph, nextStepId(graph, step.id, NEXT), wakeAt);
        return done("parked", `waiting ${hours}h, until ${wakeAt.toISOString()}`, crossed);
      }

      // ── Exit ───────────────────────────────────────────────────────────
      case "exit":
        return settle(enrollmentId, "completed");

      // ── Split ──────────────────────────────────────────────────────────
      // Two kinds, one shape. A conditional split reads what is true on
      // arrival — waiting for something to become true is the merchant's Wait
      // node placed in front of it. An A/B split assigns by chance instead.
      // Everything after the decision is identical, which is why they are one
      // node type rather than two.
      case "split": {
        let branch;
        let matched = null;
        let reason;

        if (step.splitMode === BY_CHANCE) {
          ({ arm: branch, reason } = assignArm(enrollment, step));
          // matched stays null: there is no condition, so neither true nor
          // false would be an honest record of one.
        } else {
          ({ matched, reason } = await evaluateSplit({
            shop: enrollment.shop,
            enrollment,
            step,
            graph,
          }));
          branch = matched ? YES : NO;
        }

        // Written before the cursor moves, so the decision is on record even
        // if the walk dies immediately after. Re-deciding on a later tick
        // would be free to land the other way.
        await prisma.journeyPathEvent.create({
          data: {
            enrollmentId,
            stepId: step.id,
            stepKey: step.stepKey,
            branch,
            matched,
          },
        });
        console.warn(
          `[advance] enrollment ${enrollmentId} split ${step.stepNumber} → ${branch} (${reason})`,
        );
        cursor = nextStepId(graph, step.id, branch);
        continue;
      }

      // ── Tag ────────────────────────────────────────────────────────────
      // The only node that writes to the contact record. It schedules
      // nothing, so the walk continues in the same pass — stopping here would
      // leave the enrollment with no wake time and no job, which is exactly
      // what the stall reaper exists to catch.
      case "tag": {
        const { ok, action, reason } = await applyTagAction(enrollment, step);
        // Never fails the enrollment. A missing label does not make the
        // remaining messages wrong, and ending a flow over one would turn a
        // bookkeeping loss into a contact who silently stops hearing from the
        // merchant. Contrast a failed email, which does end the flow.
        if (!ok) {
          console.warn(
            `[advance] enrollment ${enrollmentId} step ${step.stepNumber} — ${action} skipped: ${reason}`,
          );
        }
        cursor = nextStepId(graph, step.id, NEXT);
        continue;
      }

      // ── Sends ──────────────────────────────────────────────────────────
      case "email":
      case "push":
      case "whatsapp": {
        // A disabled step is a draft the merchant is parking. It produces no
        // job, so walking straight past it is the only way the flow continues.
        if (step.isEnabled === false) {
          cursor = nextStepId(graph, step.id, NEXT);
          continue;
        }
        // Cursor first, job second. If this crashes between the two the
        // contact loses one message; the other order would send them two.
        await moveCursor(enrollmentId, graph, nextStepId(graph, step.id, NEXT), null);
        await createJobFor(enrollment, step);
        return done("sending", `queued ${step.nodeType} step ${step.stepNumber}`, crossed);
      }

      // An unknown node type is a step from a newer version of the app than
      // this worker. Stepping over it is the only safe reading: it is certainly
      // not a send, and stopping the flow would punish the contact for a
      // deploy ordering problem.
      default:
        console.warn(
          `[advance] enrollment ${enrollmentId} — unknown node type "${step.nodeType}" at step ${step.stepNumber}; skipping`,
        );
        cursor = nextStepId(graph, step.id, NEXT);
        continue;
    }
  }

  // Only reachable on a graph that walks in circles, which validateGraph
  // rejects at publish. Left parked with no wake time so the stall reaper
  // surfaces it rather than this spinning every minute.
  console.error(
    `[advance] enrollment ${enrollmentId} crossed ${MAX_ADVANCE_STEPS} nodes without settling — giving up (malformed graph?)`,
  );
  await clearWake(enrollmentId);
  return done("stalled", "exceeded step budget", MAX_ADVANCE_STEPS);
}

/**
 * Advance every enrollment that is due.
 *
 * Claims each one by taking its wake time, the same conditional-update pattern
 * the job queues use: two app instances tick the same 60s interval, and without
 * this both would walk the same enrollment and create the same job twice.
 */
export async function runEnrollmentAdvanceWorker() {
  const now = new Date();
  // Deliberately NOT filtered on schedulingMode. Only this module ever sets
  // nextRunAt, so the filter would have excluded nothing — while quietly
  // creating a way for an enrollment to be skipped forever if that column ever
  // held anything unexpected. A worker that silently ignores rows is the exact
  // failure shape the stall reaper exists to catch; better not to build one.
  const due = await prisma.journeyEnrollment.findMany({
    where: {
      exitReason: "",
      nextRunAt: { lte: now, not: null },
    },
    orderBy: { nextRunAt: "asc" },
    take: ADVANCE_BATCH,
    select: { id: true },
  });
  if (!due.length) return { claimed: 0 };

  let claimed = 0;
  for (const { id } of due) {
    // Taking nextRunAt IS the claim. A crash after this leaves the enrollment
    // with no wake time and no live job, which is precisely what the stall
    // reaper looks for.
    const { count } = await prisma.journeyEnrollment.updateMany({
      where: { id, nextRunAt: { lte: now, not: null } },
      data: { nextRunAt: null },
    });
    if (!count) continue;
    claimed++;
    try {
      await advanceEnrollment(id);
    } catch (err) {
      console.error(`[advance] enrollment ${id} threw:`, err);
    }
  }
  return { claimed };
}

/**
 * Put a contact onto the first node of a flow.
 *
 * Called by enrollContact once every entry check has passed. Deliberately
 * creates no jobs: the first tick of the advance worker does that, through the
 * same walk every later step goes through, so there is exactly one code path
 * that decides what a flow sends.
 *
 * @returns {Promise<object>} the enrollment
 */
export async function createLazyEnrollment({
  journey,
  contactEmail,
  contactName,
  payloadObj,
  rootStepId,
  rootStepKey,
}) {
  return prisma.journeyEnrollment.create({
    data: {
      shop: journey.shop,
      journeyId: journey.id,
      contactEmail,
      contactName: contactName || "",
      payload: JSON.stringify(payloadObj || {}),
      schedulingMode: "lazy",
      currentStepId: rootStepId,
      currentStepKey: rootStepKey || null,
      // Due immediately. The first step of a flow is sent as soon as the worker
      // gets to it; any wait the merchant wanted is a Wait node in front of it.
      nextRunAt: new Date(),
    },
  });
}

// ── internals ──────────────────────────────────────────────────────────────

/**
 * The live step carrying this stepKey, if the flow still has one.
 *
 * Only steps in the graph are candidates, so this can never put a contact back
 * onto a step the merchant genuinely deleted — in that case the flow ends,
 * which is the honest reading of "the step you were on no longer exists".
 */
function findByStepKey(graph, stepKey) {
  if (!stepKey) return null;
  for (const step of graph.steps.values()) {
    if (step.stepKey === stepKey) return step;
  }
  return null;
}

/**
 * Point the cursor at a step, carrying its stepKey with it.
 *
 * The key is what makes the cursor survive a merchant editing the flow, so the
 * two are always written together — never currentStepId on its own.
 */
async function moveCursor(enrollmentId, graph, stepId, nextRunAt) {
  await prisma.journeyEnrollment.update({
    where: { id: enrollmentId },
    data: {
      currentStepId: stepId,
      currentStepKey: stepId ? graph.steps.get(stepId)?.stepKey ?? null : null,
      nextRunAt,
    },
  });
}

/** Does this enrollment still owe an outcome on any queue? */
async function hasLiveJob(enrollmentId) {
  const live = { enrollmentId, status: { in: ["pending", "processing"] } };
  const [emails, pushes, whatsapps] = await Promise.all([
    prisma.journeyJob.count({ where: live }),
    prisma.pushJob.count({ where: live }),
    prisma.whatsappJob.count({ where: live }),
  ]);
  return emails + pushes + whatsapps > 0;
}

/** Queue exactly one send for this step. */
async function createJobFor(enrollment, step) {
  const row = {
    shop: enrollment.shop,
    enrollmentId: enrollment.id,
    stepId: step.id,
    // Now, not now + delayHours. Under lazy scheduling every wait is a Wait
    // node the walk has already served; delayHours on a send step is a leftover
    // of the cumulative-from-trigger model and must not be applied a second
    // time. Reading it here would re-serve the whole flow's waits at every step.
    scheduledFor: new Date(),
    status: "pending",
  };
  if (step.nodeType === "email") return prisma.journeyJob.create({ data: row });
  if (step.nodeType === "push") return prisma.pushJob.create({ data: row });
  return prisma.whatsappJob.create({ data: row });
}

async function settle(enrollmentId, reason) {
  // Guarded on exitReason "" for the same reason settleEnrollmentIfFinished is:
  // an enrollment already closed for a real cause — exit criteria, an
  // unsubscribe, a shop shutting down — keeps that cause.
  await prisma.journeyEnrollment.updateMany({
    where: { id: enrollmentId, exitReason: "" },
    data: { exitReason: reason, completedAt: new Date(), nextRunAt: null, currentStepId: null, currentStepKey: null },
  });
  return done("settled", reason);
}

async function clearWake(enrollmentId) {
  await prisma.journeyEnrollment.updateMany({
    where: { id: enrollmentId },
    data: { nextRunAt: null },
  });
}

function done(verdict, reason, steps = 0) {
  return { verdict, reason, steps };
}

export { MAX_ADVANCE_STEPS, ADVANCE_BATCH, NEXT, YES, NO };
