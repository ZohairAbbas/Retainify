/**
 * GET /api/v1/growzar/consent and /consent-events (G-RTN5-6): who may be
 * messaged, on which channel, since when, and every change since deploy.
 *
 * /consent is one row per contact, current state per channel. A deleted
 * contact — soft-deleted by the merchant or erased by GDPR — is not a row but
 * an id in deletedContactIds. A soft delete moves the contact's updatedAt, so
 * it surfaces in the page where the row would have been; an erasure leaves a
 * tombstone.
 *
 * WhatsApp suppression is matched to the contact the way both are stored —
 * the digits, and E.164 — so the two tables agree on one number. A
 * suppression change moves the contact's updatedAt (trigger on
 * WhatsappSuppression).
 *
 * /consent-events is append-only, ordered by (createdAt, id), and createdAt
 * serves as updatedAt.
 */
import prisma from "../../../db.server.js";
import { iso, paginate, windowWhere, TOMBSTONE_CAP } from "../feed.server.js";
import { tombstonesSince } from "../tombstones.server.js";

export async function readConsent(req) {
  const rows = await prisma.contact.findMany({
    where: { shop: req.shop, ...windowWhere(req) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: req.limit + 1,
    select: {
      id: true, email: true, phone: true, phoneE164: true, deletedAt: true,
      subscriptionStatus: true, marketingConsentAt: true,
      whatsappStatus: true, whatsappOptInAt: true, pushEnabled: true, updatedAt: true,
    },
  });
  const { page, pagination } = paginate(rows, req.limit, (r) => ({ at: r.updatedAt, id: r.id }));
  const live = page.filter((c) => !c.deletedAt);

  const [emailSupp, waSupp, erased, pushHistory] = await Promise.all([
    live.length
      ? prisma.emailSuppression.findMany({
          where: { shop: req.shop, email: { in: live.map((c) => c.email) } },
          select: { email: true, reason: true, createdAt: true },
        })
      : [],
    waSuppressionsFor(req.shop, live),
    tombstonesSince(req.shop, "contacts", req.updatedSince, TOMBSTONE_CAP),
    // Contact.pushEnabled is a boolean, so "never" and "not any more" look the
    // same on the row. The history tells them apart, using the same rule as the
    // ConsentEvent trigger.
    live.some((c) => !c.pushEnabled)
      ? prisma.consentEvent.findMany({
          where: {
            shop: req.shop,
            channel: "push",
            to: { in: ["subscribed", "unsubscribed"] },
            contactId: { in: live.filter((c) => !c.pushEnabled).map((c) => c.id) },
          },
          distinct: ["contactId"],
          select: { contactId: true },
        })
      : [],
  ]);
  const hadPush = new Set(pushHistory.map((r) => r.contactId));
  const emailSuppBy = new Map(emailSupp.map((s) => [s.email, s]));

  const softDeleted = page.filter((c) => c.deletedAt).map((c) => c.id);
  const deletedContactIds = [...softDeleted, ...erased.ids];

  return {
    data: live.map((c) => {
      const es = emailSuppBy.get(c.email);
      const ws = waSupp(c);
      return {
        contactId: c.id,
        buyer: { email: c.email, phone: c.phoneE164 || null, phoneRaw: c.phone || null },
        email: {
          state: c.subscriptionStatus,
          consentAt: iso(c.marketingConsentAt),
          suppressed: Boolean(es),
          suppressionReason: es?.reason ?? null,
          suppressedAt: iso(es?.createdAt),
        },
        whatsapp: {
          state: c.whatsappStatus,
          optInAt: iso(c.whatsappOptInAt),
          suppressed: Boolean(ws),
          suppressionReason: ws?.reason ?? null,
          suppressedAt: iso(ws?.createdAt),
        },
        push: { state: c.pushEnabled ? "subscribed" : hadPush.has(c.id) ? "unsubscribed" : "never_opted_in" },
        updatedAt: iso(c.updatedAt),
      };
    }),
    pagination,
    extra: { deletedContactIds, deletedContactIdsTruncated: erased.truncated },
  };
}

/** Suppressions for these contacts, matched on the stored digits or E.164. */
async function waSuppressionsFor(shop, contacts) {
  const digits = new Set();
  for (const c of contacts) {
    if (c.phone) digits.add(c.phone);
    if (c.phoneE164) digits.add(c.phoneE164.slice(1));
  }
  const rows = digits.size
    ? await prisma.whatsappSuppression.findMany({
        where: { shop, phoneNumber: { in: [...digits] } },
        select: { phoneNumber: true, reason: true, createdAt: true },
      })
    : [];
  const by = new Map(rows.map((r) => [r.phoneNumber, r]));
  return (c) => by.get(c.phoneE164 ? c.phoneE164.slice(1) : "") || by.get(c.phone || "") || null;
}

export async function readConsentEvents(req) {
  const rows = await prisma.consentEvent.findMany({
    where: { shop: req.shop, ...windowWhere(req, "createdAt", "id") },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: req.limit + 1,
  });
  const { page, pagination } = paginate(rows, req.limit, (r) => ({ at: r.createdAt, id: r.id }));
  // Events of an erased contact are deleted with it, and their contact appears
  // in /consent's deletedContactIds; the same list is repeated here so this
  // feed can be consumed on its own.
  const erased = await tombstonesSince(req.shop, "contacts", req.updatedSince, TOMBSTONE_CAP);
  return {
    data: page.map((e) => ({
      id: e.id,
      contactId: e.contactId,
      channel: e.channel,
      from: e.from,
      to: e.to,
      reason: e.reason,
      source: e.source,
      createdAt: iso(e.createdAt),
      updatedAt: iso(e.createdAt),
    })),
    pagination,
    extra: { deletedContactIds: erased.ids, deletedContactIdsTruncated: erased.truncated },
  };
}
