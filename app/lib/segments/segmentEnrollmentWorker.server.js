// Segment enrollment worker.
//
// Drives the `segment_entered` flow trigger. Runs on the existing 60s tick
// in app/entry.server.jsx. To stay bounded under load:
//
//   1. Each tick handles at most BUDGET_PER_TICK flows, chosen by round
//      robin via Journey.lastEnrollmentAt ASC NULLS FIRST.
//   2. Before evaluating, we compute a cheap inputHash from a handful of
//      shop-level MAX/COUNT queries. If the hash matches the last run, we
//      skip evaluation entirely and just bump lastEnrollmentAt — the
//      expensive evaluateSegment call only happens when *something* in the
//      shop's data actually changed.
//   3. evaluateSegment is already capped at 5,000 contacts (Phase 1).
//
// Static segments don't wait for this worker — addStaticMember /
// removeStaticMember in segments.server.js call the helpers
// `enrollContactsIntoSegmentFlows` / `exitContactsFromSegmentFlows`
// synchronously so the merchant sees instant feedback.

import crypto from "node:crypto";
import prisma from "../../db.server.js";
import { enrollContact, exitEnrollment } from "../journey/journey-queue.server.js";
import { evaluateSegment } from "./evaluator.server.js";
import { getSystemSegmentById, isSystemSegmentId } from "./systemSegments.server.js";

const BUDGET_PER_TICK = 3;

// ── Helpers ────────────────────────────────────────────────────────────

async function resolveSegment(shop, segmentKey) {
  if (!segmentKey) return null;
  if (isSystemSegmentId(segmentKey)) {
    return { ...getSystemSegmentById(segmentKey), shop };
  }
  return prisma.segment.findFirst({
    where: { id: segmentKey, shop, deletedAt: null },
  });
}

// Cheap fingerprint of the inputs that could change a segment's match set.
// If this is identical to the last run, evaluation is guaranteed to produce
// the same result, so we skip it.
async function computeInputHash(shop, segmentKey) {
  const [contactMax, membershipCount, recentCarts, recentJobs] = await Promise.all([
    prisma.contact.aggregate({
      where: { shop, deletedAt: null },
      _max: { updatedAt: true },
    }),
    isSystemSegmentId(segmentKey)
      ? 0
      : prisma.segmentMembership.count({ where: { segmentId: segmentKey } }),
    prisma.abandonedCart.count({
      where: { shop, abandonedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    prisma.journeyJob.count({
      where: { shop, updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);
  const parts = [
    segmentKey,
    contactMax._max?.updatedAt?.toISOString() || "0",
    String(membershipCount),
    String(recentCarts),
    String(recentJobs),
  ];
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex");
}

function parseExitCriteria(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_e) {
    return [];
  }
}

// Map contactIds → contacts (with email/name) for the journey-queue helper,
// which keys on email. Falls back to skipping ids whose Contact row is gone
// or soft-deleted.
async function resolveContacts(shop, contactIds) {
  if (!contactIds.length) return [];
  return prisma.contact.findMany({
    where: { id: { in: contactIds }, shop, deletedAt: null },
    select: { id: true, email: true, name: true },
  });
}

// ── Public worker entrypoints ───────────────────────────────────────────

/**
 * Called by the 60s tick. Picks up to BUDGET_PER_TICK stalest published
 * segment-triggered flows and re-evaluates their membership.
 */
export async function runSegmentEnrollmentWorker() {
  const flows = await prisma.journey.findMany({
    where: {
      trigger: "segment_entered",
      status: "published",
      archivedAt: null,
      triggerSegmentKey: { not: null },
    },
    orderBy: [{ lastEnrollmentAt: { sort: "asc", nulls: "first" } }],
    take: BUDGET_PER_TICK,
  });

  for (const flow of flows) {
    try {
      await processFlow(flow);
    } catch (e) {
      console.error(`[segment-enrollment] flow ${flow.id} failed:`, e);
    }
  }
}

async function processFlow(flow) {
  const { shop, triggerSegmentKey: segmentKey } = flow;
  const segment = await resolveSegment(shop, segmentKey);
  if (!segment) {
    // Segment was deleted out from under the flow — pause it.
    await prisma.journey.update({
      where: { id: flow.id },
      data: { status: "paused", lastEnrollmentAt: new Date() },
    });
    return;
  }

  const inputHash = await computeInputHash(shop, segmentKey);
  if (inputHash === flow.lastEnrollmentHash) {
    await prisma.journey.update({
      where: { id: flow.id },
      data: { lastEnrollmentAt: new Date() },
    });
    return;
  }

  const { matchedIds = [] } = await evaluateSegment(shop, segment, {
    sampleSize: 0,
    returnIds: true,
  });
  const current = new Set(matchedIds);

  // Previous-set proxy: open SegmentEntryLog rows for this segmentKey.
  const openLogs = await prisma.segmentEntryLog.findMany({
    where: { shop, segmentKey, leftAt: null },
    select: { id: true, contactId: true },
  });
  const previous = new Set(openLogs.map((l) => l.contactId));

  const entered = [...current].filter((id) => !previous.has(id));
  const left = [...previous].filter((id) => !current.has(id));

  // Apply entered side: write logs and enroll.
  if (entered.length) {
    const contacts = await resolveContacts(shop, entered);
    const now = new Date();
    if (contacts.length) {
      await prisma.segmentEntryLog.createMany({
        data: contacts.map((c) => ({
          shop, segmentKey, contactId: c.id, enteredAt: now,
        })),
      });
    }
    for (const c of contacts) {
      try {
        await enrollContact(flow.id, c.email, c.name || "", { source: "segment", segmentKey });
      } catch (e) {
        console.error(`[segment-enrollment] enroll ${c.email} → ${flow.id} failed:`, e);
      }
    }
  }

  // Apply left side: close logs, run leaves_trigger_segment exit if set.
  if (left.length) {
    const closeIds = openLogs.filter((l) => left.includes(l.contactId)).map((l) => l.id);
    if (closeIds.length) {
      await prisma.segmentEntryLog.updateMany({
        where: { id: { in: closeIds } },
        data: { leftAt: new Date() },
      });
    }
    const exitCriteria = parseExitCriteria(flow.exitCriteria);
    if (exitCriteria.includes("leaves_trigger_segment")) {
      const contacts = await resolveContacts(shop, left);
      const emails = contacts.map((c) => c.email);
      if (emails.length) {
        const enrollments = await prisma.journeyEnrollment.findMany({
          where: {
            journeyId: flow.id,
            contactEmail: { in: emails },
            completedAt: null,
          },
          select: { id: true },
        });
        for (const e of enrollments) {
          await exitEnrollment(e.id, "left_segment");
        }
      }
    }
  }

  // joins_segment:<key> exit criteria — check active enrollments against any
  // segment they may have just newly joined. Bounded to flows in this tick
  // so cost stays predictable.
  await applyJoinsSegmentExits(flow);

  await prisma.journey.update({
    where: { id: flow.id },
    data: { lastEnrollmentAt: new Date(), lastEnrollmentHash: inputHash },
  });
}

// For each active enrollment in `flow`, exit it if the contact newly matches
// any segment named in a `joins_segment:<key>` exit criterion.
async function applyJoinsSegmentExits(flow) {
  const exitCriteria = parseExitCriteria(flow.exitCriteria);
  const joinsKeys = exitCriteria
    .filter((c) => typeof c === "string" && c.startsWith("joins_segment:"))
    .map((c) => c.slice("joins_segment:".length));
  if (!joinsKeys.length) return;

  const active = await prisma.journeyEnrollment.findMany({
    where: { journeyId: flow.id, completedAt: null },
    select: { id: true, contactEmail: true },
  });
  if (!active.length) return;

  // Resolve emails to contact ids once.
  const contacts = await prisma.contact.findMany({
    where: {
      shop: flow.shop,
      email: { in: active.map((a) => a.contactEmail) },
      deletedAt: null,
    },
    select: { id: true, email: true },
  });
  const emailToId = Object.fromEntries(contacts.map((c) => [c.email, c.id]));

  for (const key of joinsKeys) {
    const seg = await resolveSegment(flow.shop, key);
    if (!seg) continue;
    const { matchedIds = [] } = await evaluateSegment(flow.shop, seg, {
      sampleSize: 0,
      returnIds: true,
    });
    const matchSet = new Set(matchedIds);
    for (const e of active) {
      const cid = emailToId[e.contactEmail];
      if (cid && matchSet.has(cid)) {
        try {
          await exitEnrollment(e.id, `joined_segment:${key}`);
        } catch (err) {
          console.error(`[segment-enrollment] joins_segment exit failed:`, err);
        }
      }
    }
  }
}

// ── Publish-time baseline (called from journey-lifecycle.server.js) ─────

/**
 * Establish a flow's starting position against its trigger segment at publish
 * time, and optionally enroll the members already sitting in that segment.
 *
 * This exists because SegmentEntryLog is keyed on (shop, segmentKey) only —
 * it records "who is in the segment", not "who has this flow seen". Without a
 * baseline written at publish, the first processFlow tick computes
 * `entered = current − previous` against whatever logs happen to exist, which
 * breaks in both directions:
 *
 *   - Logs already open (segment populated before publish) → entered is empty
 *     and the flow silently onboards nobody, ever.
 *   - No logs at all (a dynamic segment the worker has never evaluated) →
 *     entered is the *entire* match set and publishing blasts everyone.
 *
 * Seeding open log rows for the current match set pins the baseline so the
 * first tick is a no-op either way, and makes enrolling existing members an
 * explicit choice rather than an accident of timing.
 *
 * Safe to call for non-segment flows — it no-ops.
 */
export async function seedSegmentBaselineForFlow(flow, { enrollExisting = false } = {}) {
  if (flow?.trigger !== "segment_entered" || !flow.triggerSegmentKey) return { seeded: 0, enrolled: 0 };
  const { shop, triggerSegmentKey: segmentKey } = flow;

  const segment = await resolveSegment(shop, segmentKey);
  if (!segment) return { seeded: 0, enrolled: 0 };

  const { matchedIds = [] } = await evaluateSegment(shop, segment, {
    sampleSize: 0,
    returnIds: true,
  });
  if (!matchedIds.length) {
    // Still record the hash so the first tick doesn't re-evaluate needlessly.
    await prisma.journey.update({
      where: { id: flow.id },
      data: {
        lastEnrollmentAt: new Date(),
        lastEnrollmentHash: await computeInputHash(shop, segmentKey),
      },
    });
    return { seeded: 0, enrolled: 0 };
  }

  // Only seed contacts that don't already have an open log row — a segment
  // shared by several flows will already have most of them.
  const openLogs = await prisma.segmentEntryLog.findMany({
    where: { shop, segmentKey, leftAt: null, contactId: { in: matchedIds } },
    select: { contactId: true },
  });
  const alreadyLogged = new Set(openLogs.map((l) => l.contactId));
  const toSeed = matchedIds.filter((id) => !alreadyLogged.has(id));

  if (toSeed.length) {
    const now = new Date();
    await prisma.segmentEntryLog.createMany({
      data: toSeed.map((contactId) => ({ shop, segmentKey, contactId, enteredAt: now })),
    });
  }

  let enrolled = 0;
  if (enrollExisting) {
    const contacts = await resolveContacts(shop, matchedIds);
    for (const c of contacts) {
      try {
        await enrollContact(flow.id, c.email, c.name || "", {
          source: "segment_backfill",
          segmentKey,
        });
        enrolled += 1;
      } catch (e) {
        console.error(`[segment-enrollment] backfill ${c.email} → ${flow.id} failed:`, e);
      }
    }
  }

  // Pin the hash last, so the next tick skips straight past this flow.
  await prisma.journey.update({
    where: { id: flow.id },
    data: {
      lastEnrollmentAt: new Date(),
      lastEnrollmentHash: await computeInputHash(shop, segmentKey),
    },
  });

  console.log(
    `[segment-enrollment] baseline for flow ${flow.id}: ${matchedIds.length} in segment, ` +
      `${toSeed.length} newly logged, ${enrolled} enrolled (backfill=${enrollExisting})`,
  );
  return { seeded: toSeed.length, enrolled, inSegment: matchedIds.length };
}

// ── Static-segment fast paths (called from segments.server.js) ──────────

/**
 * Synchronously enroll contacts into all published flows triggered on the
 * given segment. Used when a contact is added to a static segment so the
 * merchant doesn't have to wait for the next 60s tick.
 */
export async function enrollContactsIntoSegmentFlows(shop, segmentKey, contactIds) {
  if (!contactIds?.length) return;
  const flows = await prisma.journey.findMany({
    where: {
      shop,
      trigger: "segment_entered",
      status: "published",
      archivedAt: null,
      triggerSegmentKey: segmentKey,
    },
  });
  if (!flows.length) return;
  const contacts = await resolveContacts(shop, contactIds);
  for (const flow of flows) {
    for (const c of contacts) {
      try {
        await enrollContact(flow.id, c.email, c.name || "", { source: "segment", segmentKey });
      } catch (e) {
        console.error(`[segment-enrollment] static enroll ${c.email} failed:`, e);
      }
    }
  }
}

/**
 * Synchronously honour `leaves_trigger_segment` exit criterion when a
 * contact is removed from a static segment.
 */
export async function exitContactsFromSegmentFlows(shop, segmentKey, contactIds) {
  if (!contactIds?.length) return;
  const flows = await prisma.journey.findMany({
    where: {
      shop,
      trigger: "segment_entered",
      status: "published",
      archivedAt: null,
      triggerSegmentKey: segmentKey,
    },
    select: { id: true, exitCriteria: true },
  });
  if (!flows.length) return;
  const contacts = await resolveContacts(shop, contactIds);
  const emails = contacts.map((c) => c.email);
  if (!emails.length) return;
  for (const flow of flows) {
    if (!parseExitCriteria(flow.exitCriteria).includes("leaves_trigger_segment")) continue;
    const enrollments = await prisma.journeyEnrollment.findMany({
      where: {
        journeyId: flow.id,
        contactEmail: { in: emails },
        completedAt: null,
      },
      select: { id: true },
    });
    for (const e of enrollments) {
      try {
        await exitEnrollment(e.id, "left_segment");
      } catch (err) {
        console.error(`[segment-enrollment] static exit failed:`, err);
      }
    }
  }
}
