/**
 * Broadcasts — one-off campaign sends.
 *
 * A broadcast is a Journey with `trigger = "broadcast"` and a single send step —
 * email or WhatsApp. Publishing it schedules a send; the dispatcher below
 * resolves the audience at send time and enrolls everyone once. From there the
 * ordinary channel worker takes over, so suppression, quiet hours, quota,
 * unsubscribe headers, idempotency and per-recipient analytics all apply
 * unchanged. The dispatcher only ENROLLS — it has never sent anything itself,
 * which is why adding a second channel needed no change to the send path.
 *
 * ── The audience is channel-specific, and must be ────────────────────────────
 * Email consent and WhatsApp consent are unrelated: a contact can be
 * unsubscribed from email and opted in to WhatsApp, or the reverse. So each
 * channel resolves its own audience against its own consent record and its own
 * suppression list. Getting this wrong in the WhatsApp direction is not a
 * miscount — it is messaging someone who told Meta to stop.
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
import { toE164 } from "../contacts/contacts.server.js";
import { evaluateSegment } from "../segments/evaluator.server.js";
import { getSystemSegmentById, isSystemSegmentId } from "../segments/systemSegments.server.js";
import { checkShopHealth, SHOP_LIVE, SHOP_UNKNOWN } from "../shopify/shop-health.server.js";

/** Enrol in batches so a large list doesn't hold one long transaction. */
const ENROLL_CHUNK = 200;

const CONTACT_FIELDS = {
  id: true, email: true, name: true, phone: true, whatsappStatus: true,
};

/**
 * Contacts a broadcast should reach on a given channel.
 *
 * `segmentKey` null means every marketable contact. Unsubscribed and suppressed
 * contacts are excluded here as well as in the worker — the worker check is the
 * backstop, but filtering up front keeps the recipient count honest, which is
 * the number shown to the merchant before they press send.
 *
 * @param {string} shop
 * @param {string|null} segmentKey
 * @param {"email"|"whatsapp"} [channel]
 */
export async function resolveAudience(shop, segmentKey, channel = "email") {
  const contacts = !segmentKey
    ? await prisma.contact.findMany({
        where: { shop, deletedAt: null, ...consentWhere(channel) },
        select: CONTACT_FIELDS,
      })
    : await resolveSegmentAudience(shop, segmentKey, channel);

  return channel === "whatsapp"
    ? filterWhatsappAudience(shop, contacts)
    : excludeSuppressed(shop, contacts);
}

/**
 * The consent column each channel filters on, applied in SQL.
 *
 * Email uses `subscriptionStatus`. WhatsApp deliberately does NOT — that column
 * records an email preference, and excluding an email-unsubscribed contact from
 * a WhatsApp send would drop people who explicitly opted in to WhatsApp. Its
 * real consent check needs the subscription row and the shop's opt-in mode, so
 * it happens in filterWhatsappAudience below; here it only removes the two
 * states that are never sendable on any terms.
 */
function consentWhere(channel) {
  return channel === "whatsapp"
    ? { whatsappStatus: { notIn: ["unsubscribed", "invalid"] } }
    : { subscriptionStatus: "subscribed" };
}

async function resolveSegmentAudience(shop, segmentKey, channel) {
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
      ...consentWhere(channel),
    },
    select: CONTACT_FIELDS,
  });
}

/**
 * Narrow an audience to the people a WhatsApp send would actually reach.
 *
 * This mirrors processWhatsappJob's recipient resolution exactly, and has to:
 * the worker decides per job whether a contact is reachable, so any rule here
 * that is looser produces a recipient count larger than the number of messages
 * that arrive — "sent to 4,000" and 300 delivered — and any rule that is
 * tighter hides people the worker will happily message.
 *
 * The order is the worker's order: a confirmed opt-in wins; failing that, and
 * only when the shop has turned the opt-in requirement off, the contact's own
 * phone; then a format check; then suppression, which is absolute either way.
 */
async function filterWhatsappAudience(shop, contacts) {
  if (contacts.length === 0) return contacts;

  const [settings, subs, suppressions] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop }, select: { whatsappRequireOptIn: true } }),
    prisma.whatsappSubscription.findMany({
      where: { shop, status: "subscribed", contactEmail: { in: contacts.map((c) => c.email) } },
      select: { contactEmail: true, phoneNumber: true, confirmedAt: true },
    }),
    prisma.whatsappSuppression.findMany({ where: { shop }, select: { phoneNumber: true } }),
  ]);

  const requireOptIn = settings?.whatsappRequireOptIn !== false;
  const blocked = new Set(suppressions.map((r) => r.phoneNumber));
  // Only a CONFIRMED opt-in counts as one — the worker reads confirmedAt, not
  // status, so a subscribed row without it is not sendable.
  const confirmed = new Map(
    subs
      .filter((sub) => sub.confirmedAt && sub.contactEmail)
      .map((sub) => [sub.contactEmail.toLowerCase(), sub.phoneNumber]),
  );

  return contacts.filter((contact) => {
    let phone = confirmed.get(String(contact.email || "").toLowerCase()) || "";
    if (!phone && !requireOptIn) phone = contact.phone || "";
    if (!phone) return false;
    const shape = toE164(phone);
    if (!shape.ok) return false;
    return !blocked.has(shape.phone);
  });
}

/**
 * Confirmed WhatsApp subscribers this shop cannot enrol in anything.
 *
 * Enrollment is keyed on a contact email throughout — JourneyEnrollment stores
 * one, and every channel worker resolves its recipient from it — so a WhatsApp
 * opt-in with no email address, or one whose address matches no contact record,
 * cannot be reached by a campaign however valid its consent is. The popup is
 * currently the only opt-in path and it requires an email, so this is zero
 * today; it stops being zero the moment click-to-WhatsApp or a CSV import
 * lands. Surfaced rather than silently dropped, because a merchant comparing
 * their subscriber count to a campaign's audience deserves the difference
 * explained.
 *
 * @returns {Promise<number>}
 */
export async function countUnreachableWhatsappSubscribers(shop) {
  const subs = await prisma.whatsappSubscription.findMany({
    where: { shop, status: "subscribed", confirmedAt: { not: null } },
    select: { contactEmail: true },
  });
  if (subs.length === 0) return 0;

  const withEmail = subs.filter((sub) => sub.contactEmail);
  const orphans = subs.length - withEmail.length;
  if (withEmail.length === 0) return orphans;

  const known = await prisma.contact.findMany({
    where: { shop, deletedAt: null, email: { in: withEmail.map((sub) => sub.contactEmail) } },
    select: { email: true },
  });
  const haveContact = new Set(known.map((c) => c.email.toLowerCase()));
  return (
    orphans +
    withEmail.filter((sub) => !haveContact.has(sub.contactEmail.toLowerCase())).length
  );
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
export async function previewAudienceCount(shop, segmentKey, channel = "email") {
  const audience = await resolveAudience(shop, segmentKey, channel);
  return audience.length;
}

/**
 * The channel a broadcast sends on — the node type of its single step.
 *
 * Stored on the step rather than the journey because that is where it already
 * lives for every other kind of flow, and duplicating it onto Journey would
 * create two answers that can disagree.
 *
 * @returns {Promise<"email"|"whatsapp">}
 */
export async function broadcastChannel(journeyId) {
  const step = await prisma.journeyStep.findFirst({
    where: { journeyId, isArchived: false },
    orderBy: { stepNumber: "asc" },
    select: { nodeType: true },
  });
  return step?.nodeType === "whatsapp" ? "whatsapp" : "email";
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
    const channel = await broadcastChannel(journeyId);
    audience = await resolveAudience(journey.shop, journey.triggerSegmentKey, channel);
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
