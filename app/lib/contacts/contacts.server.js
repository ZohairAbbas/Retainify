import { Prisma } from "@prisma/client";
import prisma from "../../db.server.js";

const SUPPRESSION_STATUSES = new Set(["unsubscribed", "bounced", "complained"]);
const VALID_STATUSES = new Set([
  "subscribed",
  "unsubscribed",
  "bounced",
  "complained",
  "never_opted_in",
]);
// WhatsApp consent is a separate axis from email subscriptionStatus.
const WA_SUPPRESSION_STATUSES = new Set(["unsubscribed", "invalid"]);
const VALID_WA_STATUSES = new Set([
  "subscribed",
  "unsubscribed",
  "invalid",
  "never_opted_in",
]);

/** Normalize a phone to bare E.164 digits (no "+", spaces, or punctuation). */
export function normalizePhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d]/g, "");
  return digits;
}
const VALID_SOURCES = new Set([
  "popup",
  "cart_abandoned",
  "shopify_customer",
  "csv_import",
  "push_only",
  "manual",
]);

export function normalizeEmail(raw) {
  if (!raw) return "";
  return String(raw).trim().toLowerCase();
}

/**
 * Upsert a Contact for `shop`+`email`. Idempotent and safe to call from any
 * write site that already records an email.
 *
 * Rules:
 *   - email is lowercased before write.
 *   - lastSeenAt always advances to now().
 *   - subscriptionStatus is never downgraded out of a suppression state
 *     (unsubscribed/bounced/complained) — suppression wins.
 *   - source is only set when the existing row has source = "manual" or empty
 *     (i.e. real sources beat the placeholder), so the first real touch wins.
 *   - name is overwritten only when a non-empty value is provided.
 *   - a soft-deleted row is only revived when the caller passes revive: true.
 *     Deletion is a deliberate merchant action, so passive writes (webhooks,
 *     Shopify sync) must leave a tombstone deleted; only an explicit re-add or
 *     a fresh opt-in brings it back, and that counts as a new acquisition
 *     (deletedAt cleared, firstSeenAt reset to now).
 *
 * Returns { contact, created, revived }. `created` is a brand-new row;
 * `revived` is a previously soft-deleted row brought back.
 */
export async function upsertContact(input) {
  const email = normalizeEmail(input.email);
  const { shop } = input;
  if (!shop || !email) return { contact: null, created: false, revived: false };

  const name = input.name ? String(input.name).trim() : undefined;
  const source = VALID_SOURCES.has(input.source) ? input.source : undefined;
  const statusInput = VALID_STATUSES.has(input.subscriptionStatus)
    ? input.subscriptionStatus
    : undefined;
  const marketingConsentAt = input.marketingConsentAt
    ? new Date(input.marketingConsentAt)
    : undefined;
  const shopifyCustomerId = input.shopifyCustomerId || undefined;
  const phone = input.phone ? normalizePhone(input.phone) : undefined;
  const whatsappStatusInput = VALID_WA_STATUSES.has(input.whatsappStatus)
    ? input.whatsappStatus
    : undefined;
  const whatsappOptInAt = input.whatsappOptInAt
    ? new Date(input.whatsappOptInAt)
    : undefined;

  const existing = await prisma.contact.findUnique({
    where: { shop_email: { shop, email } },
  });
  const now = new Date();

  if (!existing) {
    const contact = await prisma.contact.create({
      data: {
        shop,
        email,
        name: name || "",
        firstSeenAt: now,
        lastSeenAt: now,
        source: source || "manual",
        subscriptionStatus: statusInput || "never_opted_in",
        marketingConsentAt: marketingConsentAt || null,
        shopifyCustomerId: shopifyCustomerId || null,
        phone: phone || null,
        whatsappStatus: whatsappStatusInput || "never_opted_in",
        whatsappOptInAt: whatsappOptInAt || null,
      },
    });
    return { contact, created: true, revived: false };
  }

  const data = { lastSeenAt: now };

  // The row survives a delete as a tombstone (deletedAt set), and findUnique
  // above matches it regardless — so without this an explicit re-add silently
  // updates the tombstone and stays invisible to every deletedAt: null read.
  const revived = Boolean(existing.deletedAt) && input.revive === true;
  if (revived) {
    data.deletedAt = null;
    data.firstSeenAt = now;
  }

  if (name && !existing.name) data.name = name;

  if (
    source &&
    (existing.source === "manual" || existing.source === "")
  ) {
    data.source = source;
  }

  if (statusInput) {
    const isCurrentlySuppressed = SUPPRESSION_STATUSES.has(existing.subscriptionStatus);
    const isUpgradeToSuppressed = SUPPRESSION_STATUSES.has(statusInput);
    if (isUpgradeToSuppressed || !isCurrentlySuppressed) {
      data.subscriptionStatus = statusInput;
    }
  }

  if (marketingConsentAt && !existing.marketingConsentAt) {
    data.marketingConsentAt = marketingConsentAt;
  }

  if (shopifyCustomerId && !existing.shopifyCustomerId) {
    data.shopifyCustomerId = shopifyCustomerId;
  }

  if (phone && !existing.phone) data.phone = phone;

  if (whatsappStatusInput) {
    // Same suppression-wins rule as email: an unsubscribed/invalid WhatsApp
    // status can't be silently downgraded by a later non-suppressing write.
    const isCurrentlySuppressed = WA_SUPPRESSION_STATUSES.has(existing.whatsappStatus);
    const isUpgradeToSuppressed = WA_SUPPRESSION_STATUSES.has(whatsappStatusInput);
    if (isUpgradeToSuppressed || !isCurrentlySuppressed) {
      data.whatsappStatus = whatsappStatusInput;
    }
  }

  if (whatsappOptInAt && !existing.whatsappOptInAt) {
    data.whatsappOptInAt = whatsappOptInAt;
  }

  const contact = await prisma.contact.update({
    where: { id: existing.id },
    data,
  });
  return { contact, created: false, revived };
}

/**
 * v1 lifecycle computation. Orders data isn't synced yet, so we fall back to:
 *   - firstSeen within 14 days → "new"
 *   - has cart abandons, last one > 90 days ago → "churned"
 *   - has cart abandons, last one > 30 days ago → "at_risk"
 *   - otherwise → "never_purchased"
 *
 * Once Orders sync ships, swap to the rules in segments_contacts_ideas.md
 * (active when ordered ≤30d, at_risk 31–90d, churned >90d).
 */
export function computeLifecycle(contact, stats) {
  const now = Date.now();
  const firstSeen = new Date(contact.firstSeenAt).getTime();
  const daysSinceFirstSeen = (now - firstSeen) / (1000 * 60 * 60 * 24);

  if (daysSinceFirstSeen <= 14) return "new";

  const lastCart = stats?.lastCartAbandonAt
    ? new Date(stats.lastCartAbandonAt).getTime()
    : null;
  if (lastCart) {
    const daysSinceCart = (now - lastCart) / (1000 * 60 * 60 * 24);
    if (daysSinceCart > 90) return "churned";
    if (daysSinceCart > 30) return "at_risk";
  }

  return "never_purchased";
}

/**
 * Per-contact stats computed on read. Aggregates from existing tables
 * (AbandonedCart, JourneyJob, PushJob). Orders / spend are deferred to v2.
 */
export async function getContactStats(shop, email) {
  const lower = normalizeEmail(email);
  const [
    cartAggregate,
    emailSent,
    emailOpened,
    emailClicked,
    pushSent,
    pushClicked,
  ] = await Promise.all([
    prisma.abandonedCart.aggregate({
      where: { shop, customerEmail: lower },
      _count: { _all: true },
      _max: { abandonedAt: true, totalPrice: true },
    }),
    prisma.journeyJob.count({
      where: {
        shop,
        sentAt: { not: null },
        enrollment: { contactEmail: lower },
      },
    }),
    prisma.journeyJob.count({
      where: {
        shop,
        openedAt: { not: null },
        enrollment: { contactEmail: lower },
      },
    }),
    prisma.journeyJob.count({
      where: {
        shop,
        clickedAt: { not: null },
        enrollment: { contactEmail: lower },
      },
    }),
    prisma.pushJob.count({
      where: {
        shop,
        sentAt: { not: null },
        enrollment: { contactEmail: lower },
      },
    }),
    prisma.pushJob.count({
      where: {
        shop,
        status: "done",
        enrollment: { contactEmail: lower },
      },
    }),
  ]);

  return buildStats({
    cartAbandonCount: cartAggregate._count?._all || 0,
    lastCartAbandonAt: cartAggregate._max?.abandonedAt || null,
    lastCartValue: cartAggregate._max?.totalPrice || 0,
    emailsSent: emailSent,
    emailsOpened: emailOpened,
    emailsClicked: emailClicked,
    pushesSent: pushSent,
    pushesClicked: pushClicked,
  });
}

/** Shared stats shape — keeps getContactStats and the batch variant identical. */
function buildStats(parts = {}) {
  const emailsSent = parts.emailsSent || 0;
  const emailsOpened = parts.emailsOpened || 0;
  const emailsClicked = parts.emailsClicked || 0;
  return {
    totalSpent: 0,
    orderCount: 0,
    lastOrderAt: null,
    averageOrderValue: 0,
    cartAbandonCount: parts.cartAbandonCount || 0,
    lastCartAbandonAt: parts.lastCartAbandonAt || null,
    lastCartValue: parts.lastCartValue || 0,
    emailsSent,
    emailsOpened,
    emailsClicked,
    openRate: emailsSent > 0 ? (emailsOpened / emailsSent) * 100 : 0,
    clickRate: emailsSent > 0 ? (emailsClicked / emailsSent) * 100 : 0,
    pushesSent: parts.pushesSent || 0,
    pushesClicked: parts.pushesClicked || 0,
  };
}

export function emptyContactStats() {
  return buildStats();
}

/**
 * Batch version of getContactStats. Same per-contact shape, but computed with
 * three grouped queries instead of six per contact — segment evaluation scans
 * thousands of contacts and the per-contact form was an N+1 (see the JS-eval
 * path in segments/evaluator.server.js).
 *
 * Returns a Map keyed by normalized email. Emails with no activity are present
 * with a zeroed stats object, so callers never need a null check.
 */
export async function getContactStatsBatch(shop, emails) {
  const list = [...new Set((emails || []).map(normalizeEmail).filter(Boolean))];
  const out = new Map(list.map((e) => [e, buildStats()]));
  if (list.length === 0) return out;

  // Past a few hundred emails the IN list costs more than it saves, and callers
  // that big (segment scans) are asking for most of the shop anyway — aggregate
  // shop-wide and let the map lookup drop the rows we didn't ask for.
  const wide = list.length > 200;
  const emailFilter = wide
    ? Prisma.empty
    : Prisma.sql`AND e."contactEmail" IN (${Prisma.join(list)})`;

  const [cartRows, journeyRows, pushRows] = await Promise.all([
    prisma.abandonedCart.groupBy({
      by: ["customerEmail"],
      where: { shop, ...(wide ? {} : { customerEmail: { in: list } }) },
      _count: { _all: true },
      _max: { abandonedAt: true, totalPrice: true },
    }),
    // JourneyJob/PushJob only reach the contact through their enrollment, which
    // Prisma's groupBy cannot traverse — one grouped join each instead.
    prisma.$queryRaw`
      SELECT e."contactEmail" AS email,
             COUNT(*) FILTER (WHERE j."sentAt" IS NOT NULL)    AS sent,
             COUNT(*) FILTER (WHERE j."openedAt" IS NOT NULL)  AS opened,
             COUNT(*) FILTER (WHERE j."clickedAt" IS NOT NULL) AS clicked
        FROM "JourneyJob" j
        JOIN "JourneyEnrollment" e ON e."id" = j."enrollmentId"
       WHERE j."shop" = ${shop} ${emailFilter}
       GROUP BY e."contactEmail"`,
    prisma.$queryRaw`
      SELECT e."contactEmail" AS email,
             COUNT(*) FILTER (WHERE p."sentAt" IS NOT NULL)   AS sent,
             COUNT(*) FILTER (WHERE p."status" = 'done')      AS clicked
        FROM "PushJob" p
        JOIN "JourneyEnrollment" e ON e."id" = p."enrollmentId"
       WHERE p."shop" = ${shop} ${emailFilter}
       GROUP BY e."contactEmail"`,
  ]);

  for (const row of cartRows) {
    const s = out.get(normalizeEmail(row.customerEmail));
    if (!s) continue;
    s.cartAbandonCount = row._count?._all || 0;
    s.lastCartAbandonAt = row._max?.abandonedAt || null;
    s.lastCartValue = row._max?.totalPrice || 0;
  }
  for (const row of journeyRows) {
    const s = out.get(normalizeEmail(row.email));
    if (!s) continue;
    s.emailsSent = Number(row.sent) || 0;
    s.emailsOpened = Number(row.opened) || 0;
    s.emailsClicked = Number(row.clicked) || 0;
    s.openRate = s.emailsSent > 0 ? (s.emailsOpened / s.emailsSent) * 100 : 0;
    s.clickRate = s.emailsSent > 0 ? (s.emailsClicked / s.emailsSent) * 100 : 0;
  }
  for (const row of pushRows) {
    const s = out.get(normalizeEmail(row.email));
    if (!s) continue;
    s.pushesSent = Number(row.sent) || 0;
    s.pushesClicked = Number(row.clicked) || 0;
  }

  return out;
}

/**
 * Headline stats for the top of the contacts list — uses indexed columns only.
 */
export async function summarizeContacts(shop) {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [total, subscribed, unsubscribed, bounced, complained, newThisWeek] =
    await Promise.all([
      prisma.contact.count({ where: { shop, deletedAt: null } }),
      prisma.contact.count({ where: { shop, deletedAt: null, subscriptionStatus: "subscribed" } }),
      prisma.contact.count({ where: { shop, deletedAt: null, subscriptionStatus: "unsubscribed" } }),
      prisma.contact.count({ where: { shop, deletedAt: null, subscriptionStatus: "bounced" } }),
      prisma.contact.count({ where: { shop, deletedAt: null, subscriptionStatus: "complained" } }),
      prisma.contact.count({
        where: { shop, deletedAt: null, firstSeenAt: { gte: oneWeekAgo } },
      }),
    ]);

  return {
    total,
    subscribed,
    unsubscribed: unsubscribed + bounced + complained,
    unsubscribedOnly: unsubscribed,
    bounced,
    complained,
    newThisWeek,
  };
}

/**
 * Cursor-paginated list. Server applies filter chips (status, source, tagId,
 * lifecycle-ish via createdAt). `search` does an OR on email/name (capped 200).
 */
export async function listContacts({
  shop,
  status,
  source,
  tagId,
  search,
  cursor,
  limit = 50,
}) {
  const where = { shop, deletedAt: null };
  if (status && status !== "all") where.subscriptionStatus = status;
  if (source && source !== "all") where.source = source;
  if (tagId && tagId !== "all") {
    where.tags = { some: { tagId } };
  }
  if (search) {
    const q = search.trim();
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }

  const take = search ? Math.min(limit, 200) : limit;

  const rows = await prisma.contact.findMany({
    where,
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
    include: {
      tags: { include: { tag: true } },
    },
  });

  let nextCursor = null;
  if (rows.length > take) {
    const last = rows.pop();
    nextCursor = last.id;
  }
  return { rows, nextCursor };
}

export async function getContactById(shop, id) {
  return prisma.contact.findFirst({
    where: { id, shop, deletedAt: null },
    include: {
      tags: { include: { tag: true } },
    },
  });
}

export async function unsubscribeContact(shop, email, reason = "unsubscribe") {
  const lower = normalizeEmail(email);
  await prisma.emailSuppression.upsert({
    where: { shop_email: { shop, email: lower } },
    create: { shop, email: lower, reason },
    update: { reason },
  });
  const next =
    reason === "bounce" ? "bounced" : reason === "complaint" ? "complained" : "unsubscribed";
  await prisma.contact.updateMany({
    where: { shop, email: lower },
    data: { subscriptionStatus: next },
  });
}

export async function resubscribeContact(shop, email) {
  const lower = normalizeEmail(email);
  await prisma.emailSuppression.deleteMany({ where: { shop, email: lower } });
  await prisma.contact.updateMany({
    where: { shop, email: lower },
    data: { subscriptionStatus: "subscribed" },
  });
}

export async function updateContactName(shop, id, name) {
  await prisma.contact.updateMany({
    where: { id, shop },
    data: { name: String(name || "").trim() },
  });
}

export async function softDeleteContact(shop, idOrEmail) {
  const where = idOrEmail.includes("@")
    ? { shop, email: normalizeEmail(idOrEmail) }
    : { id: idOrEmail, shop };
  await prisma.contact.updateMany({ where, data: { deletedAt: new Date() } });
}

export async function createManualContact(shop, { email, name, tagIds = [] }) {
  const lower = normalizeEmail(email);
  if (!lower) return null;
  const { contact } = await upsertContact({
    shop,
    email: lower,
    name,
    source: "manual",
    subscriptionStatus: "subscribed",
    marketingConsentAt: new Date(),
    revive: true,
  });
  if (contact && tagIds.length) {
    await prisma.contactTag.createMany({
      data: tagIds.map((tagId) => ({ contactId: contact.id, tagId })),
      skipDuplicates: true,
    });
  }
  return contact;
}
