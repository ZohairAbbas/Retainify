/**
 * Broadcasts — one-off campaign sends.
 *
 * A broadcast is a Journey with `trigger = "broadcast"` and a single email step.
 * Publishing it schedules a send; the dispatcher below resolves the audience at
 * send time and enrolls everyone once. From there the ordinary journey worker
 * takes over, so suppression, quiet hours, quota, unsubscribe headers,
 * idempotency and per-recipient analytics all apply unchanged.
 *
 * ── Exactly-once is the whole problem ───────────────────────────────────────
 * An automation that double-enrolls sends one extra email to one person. A
 * broadcast that double-dispatches sends a duplicate to the entire list, and
 * there is no recall. So the dispatcher CLAIMS a broadcast with a conditional
 * update — `dispatchedAt: null` in the WHERE — before it enrolls anybody.
 * Postgres makes that atomic, so a second worker tick, or a second app
 * instance, updates zero rows and does nothing.
 */
import prisma from "../../db.server.js";
import { enrollContact } from "./journey-queue.server.js";
import { evaluateSegment } from "../segments/evaluator.server.js";
import { getSystemSegmentById, isSystemSegmentId } from "../segments/systemSegments.server.js";
import { checkShopHealth, SHOP_LIVE, SHOP_UNKNOWN } from "../shopify/shop-health.server.js";

/** Enrol in batches so a large list doesn't hold one long transaction. */
const ENROLL_CHUNK = 200;

/**
 * Contacts a broadcast should reach.
 *
 * `segmentKey` null means every marketable contact. Suppressed and unsubscribed
 * contacts are excluded here as well as in the worker — the worker check is the
 * backstop, but filtering up front keeps the recipient count honest, which is
 * the number shown to the merchant before they press send.
 *
 * @param {string} shop
 * @param {string|null} segmentKey
 */
export async function resolveAudience(shop, segmentKey) {
  const contacts = !segmentKey
    ? await prisma.contact.findMany({
        where: { shop, deletedAt: null, subscriptionStatus: "subscribed" },
        select: { id: true, email: true, name: true },
      })
    : await resolveSegmentAudience(shop, segmentKey);

  return excludeSuppressed(shop, contacts);
}

async function resolveSegmentAudience(shop, segmentKey) {
  const segment = isSystemSegmentId(segmentKey)
    ? { ...getSystemSegmentById(segmentKey), shop }
    : await prisma.segment.findFirst({ where: { id: segmentKey, shop, deletedAt: null } });

  if (!segment) return [];

  const { matchedIds = [] } = await evaluateSegment(shop, segment, {
    sampleSize: 0,
    returnIds: true,
  });
  if (!matchedIds.length) return [];

  // A segment can match contacts who are unsubscribed — segments are for
  // browsing as much as sending — so marketability is filtered here.
  return prisma.contact.findMany({
    where: {
      id: { in: matchedIds },
      shop,
      deletedAt: null,
      subscriptionStatus: "subscribed",
    },
    select: { id: true, email: true, name: true },
  });
}

/**
 * Drop anyone on the suppression list.
 *
 * subscriptionStatus and EmailSuppression are genuinely different things: the
 * first is the contact's own preference, the second is a hard block we hold
 * (a bounce, a spam complaint, a manual entry). A contact can be "subscribed"
 * and suppressed at once, and that combination is exactly what this catches.
 *
 * The worker checks suppression again before every send, so nothing suppressed
 * has ever been delivered. What this fixes is upstream of that: the recipient
 * count the merchant is shown before pressing send, which was counting people
 * who would then be silently dropped — and the pile of jobs created only to be
 * discarded one by one.
 *
 * Fetches the shop's suppression list once and filters in memory rather than
 * issuing a NOT IN over every contact id: the suppression list is the smaller
 * set by a wide margin, and this stays one query regardless of audience size.
 */
async function excludeSuppressed(shop, contacts) {
  if (contacts.length === 0) return contacts;

  const rows = await prisma.emailSuppression.findMany({
    where: { shop },
    select: { email: true },
  });
  if (rows.length === 0) return contacts;

  const blocked = new Set(rows.map((r) => String(r.email || "").trim().toLowerCase()));
  return contacts.filter((c) => !blocked.has(String(c.email || "").trim().toLowerCase()));
}

/** How many people a broadcast would reach right now, for the confirm dialog. */
export async function previewAudienceCount(shop, segmentKey) {
  const audience = await resolveAudience(shop, segmentKey);
  return audience.length;
}

/**
 * Dispatch one broadcast: claim it, resolve the audience, enrol everyone.
 *
 * @param {string} journeyId
 * @returns {Promise<{ok:boolean, enrolled?:number, reason?:string}>}
 */
export async function dispatchBroadcast(journeyId) {
  // Claim first. The `dispatchedAt: null` predicate is the exactly-once
  // guarantee — whoever wins this update owns the send.
  const claim = await prisma.journey.updateMany({
    where: {
      id: journeyId,
      trigger: "broadcast",
      status: "published",
      dispatchedAt: null,
    },
    data: { dispatchedAt: new Date() },
  });
  if (claim.count === 0) {
    return { ok: false, reason: "already dispatched or not sendable" };
  }

  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  if (!journey) return { ok: false, reason: "vanished after claim" };

  let audience = [];
  try {
    audience = await resolveAudience(journey.shop, journey.triggerSegmentKey);
  } catch (err) {
    console.error(`[broadcast] audience resolution failed for ${journeyId}:`, err.message);
    // Release the claim so a retry is possible — an audience that failed to
    // resolve has enrolled nobody, so this cannot cause a double send.
    await prisma.journey.update({ where: { id: journeyId }, data: { dispatchedAt: null } });
    return { ok: false, reason: err.message };
  }

  let enrolled = 0;
  for (let i = 0; i < audience.length; i += ENROLL_CHUNK) {
    const chunk = audience.slice(i, i + ENROLL_CHUNK);
    for (const contact of chunk) {
      const result = await enrollContact(journey.id, contact.email, contact.name || "", {
        source: "broadcast",
      }).catch((err) => {
        console.error(`[broadcast] enroll failed for ${contact.email}:`, err.message);
        return null;
      });
      if (result) enrolled++;
    }
  }

  await prisma.journey.update({
    where: { id: journeyId },
    data: { recipientCount: enrolled },
  });

  console.log(`[broadcast] ${journeyId} dispatched to ${enrolled} of ${audience.length} contacts`);
  return { ok: true, enrolled };
}

/**
 * Worker tick: dispatch every broadcast whose time has come.
 *
 * Runs alongside the other queue workers. Cheap when idle — one indexed query
 * that returns nothing.
 */
export async function runBroadcastWorker() {
  const due = await prisma.journey.findMany({
    where: {
      trigger: "broadcast",
      status: "published",
      dispatchedAt: null,
      archivedAt: null,
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }],
    },
    select: { id: true, shop: true },
    take: 5, // a broadcast can be large; don't start five thousand enrolments at once
  });
  if (!due.length) return;

  // Never send for a shop that has gone away, same rule as every other worker.
  // A broadcast is the worst place to get this wrong: one dispatch enrolls the
  // shop's entire contact list at once.
  for (const j of due) {
    const health = await checkShopHealth(j.shop);
    if (health === SHOP_UNKNOWN) {
      // Leave it due; a later tick retries once Shopify answers.
      console.warn(`[broadcast] ${j.id} held — ${j.shop} health unknown`);
      continue;
    }
    if (health !== SHOP_LIVE) {
      await prisma.journey.update({
        where: { id: j.id },
        data: { status: "paused", dispatchedAt: new Date() },
      });
      console.warn(`[broadcast] ${j.id} cancelled — ${j.shop} is ${health}`);
      continue;
    }
    try {
      await dispatchBroadcast(j.id);
    } catch (err) {
      console.error(`[broadcast] ${j.id} threw:`, err);
    }
  }
}
