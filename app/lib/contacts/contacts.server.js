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
 * Lifecycle stage for a contact.
 *
 * Measures ENGAGEMENT RECENCY, not purchase history. The previous version was
 * written against order data that is not ingested anywhere: it had no branch
 * that could return "active", and fell through to "never_purchased" for anyone
 * past 14 days who had not abandoned a cart. That labelled a shop's best repeat
 * customers "Never purchased" on the contacts table, the profile header and the
 * lifecycle diagram — and made the "Active" segment filter match nobody, ever.
 *
 * Signals: when we first saw them, when we last saw them (any touchpoint —
 * popup, checkout, sync, push), when they last abandoned a cart, and when they
 * last ordered. Purchase recency is the strongest of these, which is what the
 * original order-based design was reaching for; it just had no order data to
 * read.
 *
 * @param {{ firstSeenAt: Date|string, lastSeenAt?: Date|string, lastOrderAt?: Date|string|null }} contact
 * @param {{ lastCartAbandonAt?: Date|string|null }} [stats]
 * @returns {"new"|"active"|"at_risk"|"churned"}
 */
export function computeLifecycle(contact, stats) {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const firstSeen = new Date(contact.firstSeenAt).getTime();
  if (Number.isFinite(firstSeen) && (now - firstSeen) / DAY <= 14) return "new";

  const signals = [contact.lastSeenAt, contact.lastOrderAt, stats?.lastCartAbandonAt]
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => Number.isFinite(t));

  // No usable timestamp at all — treat as long-dormant rather than inventing a
  // more flattering stage.
  if (!signals.length) return "churned";

  const daysSinceActivity = (now - Math.max(...signals)) / DAY;
  if (daysSinceActivity <= 30) return "active";
  if (daysSinceActivity <= 90) return "at_risk";
  return "churned";
}

/**
 * Per-contact stats computed on read. Cart figures are aggregated from
 * AbandonedCart and push figures from PushJob; purchase and email engagement
 * are read off the Contact row, where lib/orders and lib/contacts/engagement
 * maintain them.
 *
 * Engagement used to be counted here with three JourneyJob queries of its own.
 * It is read rather than recounted now so that this function and the segment
 * evaluator cannot produce different numbers for the same contact — an open
 * rate on the contact page that disagreed with the segment the contact did or
 * didn't land in would be indistinguishable from a bug in either one.
 */
export async function getContactStats(shop, email) {
  const lower = normalizeEmail(email);
  const [
    cartAggregate,
    pushSent,
    pushClicked,
  ] = await Promise.all([
    prisma.abandonedCart.aggregate({
      where: { shop, customerEmail: lower },
      _count: { _all: true },
      _max: { abandonedAt: true, totalPrice: true },
    }),
    prisma.pushJob.count({
      where: {
        shop,
        sentAt: { not: null },
        enrollment: { contactEmail: lower },
      },
    }),
    // Real clicks, recorded by /track/push-click. This used to count
    // status === "done" — the number of pushes SENT — and so reported a 100%
    // click-through rate for every contact who had received one.
    prisma.pushJob.count({
      where: {
        shop,
        clickedAt: { not: null },
        enrollment: { contactEmail: lower },
      },
    }),
  ]);

  // Purchase and engagement facts live on the Contact row itself (maintained by
  // lib/orders and lib/contacts/engagement), so they cost one lookup rather
  // than an aggregate per figure.
  const contactRow = await prisma.contact.findUnique({
    where: { shop_email: { shop, email: lower } },
    select: {
      orderCount: true, totalSpent: true, lastOrderAt: true,
      emailsSent: true, emailsOpened: true, emailsClicked: true,
      emailsClickTracked: true, openRate: true, clickRate: true,
      lastEmailOpenedAt: true, pushEnabled: true,
    },
  });

  return buildStats({
    orderCount: contactRow?.orderCount || 0,
    totalSpent: contactRow?.totalSpent || 0,
    lastOrderAt: contactRow?.lastOrderAt || null,
    cartAbandonCount: cartAggregate._count?._all || 0,
    lastCartAbandonAt: cartAggregate._max?.abandonedAt || null,
    lastCartValue: cartAggregate._max?.totalPrice || 0,
    emailsSent: contactRow?.emailsSent || 0,
    emailsOpened: contactRow?.emailsOpened || 0,
    emailsClicked: contactRow?.emailsClicked || 0,
    emailsClickTracked: contactRow?.emailsClickTracked || 0,
    openRate: contactRow?.openRate || 0,
    clickRate: contactRow?.clickRate || 0,
    lastEmailOpenedAt: contactRow?.lastEmailOpenedAt || null,
    pushEnabled: Boolean(contactRow?.pushEnabled),
    pushesSent: pushSent,
    pushesClicked: pushClicked,
  });
}

/** Shared stats shape — keeps getContactStats and the batch variant identical. */
function buildStats(parts = {}) {
  const orderCount = parts.orderCount || 0;
  return {
    // Real figures now, from the aggregates lib/orders maintains on Contact.
    // These were hardcoded to zero while no order data existed.
    totalSpent: parts.totalSpent || 0,
    orderCount,
    lastOrderAt: parts.lastOrderAt || null,
    aov: orderCount ? (parts.totalSpent || 0) / orderCount : 0,
    cartAbandonCount: parts.cartAbandonCount || 0,
    lastCartAbandonAt: parts.lastCartAbandonAt || null,
    lastCartValue: parts.lastCartValue || 0,
    // Passed through rather than recomputed. The rates are stored alongside
    // their inputs precisely so there is one definition of them, held in
    // lib/contacts/engagement.server.js — recomputing here would quietly
    // reintroduce a second, with different denominators.
    emailsSent: parts.emailsSent || 0,
    emailsOpened: parts.emailsOpened || 0,
    emailsClicked: parts.emailsClicked || 0,
    emailsClickTracked: parts.emailsClickTracked || 0,
    openRate: parts.openRate || 0,
    clickRate: parts.clickRate || 0,
    lastEmailOpenedAt: parts.lastEmailOpenedAt || null,
    pushEnabled: Boolean(parts.pushEnabled),
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
 * path in segments/evaluator.server.js). The JourneyJob join that used to be
 * the most expensive of them is gone entirely: email engagement is columns on
 * Contact now, and comes back with the purchase facts in the same query.
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

  const [cartRows, pushRows] = await Promise.all([
    prisma.abandonedCart.groupBy({
      by: ["customerEmail"],
      where: { shop, ...(wide ? {} : { customerEmail: { in: list } }) },
      _count: { _all: true },
      _max: { abandonedAt: true, totalPrice: true },
    }),
    // PushJob only reaches the contact through its enrollment, which Prisma's
    // groupBy cannot traverse — a grouped join instead. Email engagement used
    // to need the same treatment; it is read off Contact below now.
    prisma.$queryRaw`
      SELECT e."contactEmail" AS email,
             COUNT(*) FILTER (WHERE p."sentAt" IS NOT NULL)    AS sent,
             COUNT(*) FILTER (WHERE p."clickedAt" IS NOT NULL) AS clicked
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
  for (const row of pushRows) {
    const s = out.get(normalizeEmail(row.email));
    if (!s) continue;
    s.pushesSent = Number(row.sent) || 0;
    s.pushesClicked = Number(row.clicked) || 0;
  }

  // Purchase and email engagement facts, straight off the Contact rows — one
  // query for the batch. The engagement figures were a grouped join over
  // JourneyJob until they became columns; reading them here rather than
  // recomputing keeps this function and the segment evaluator on one set of
  // numbers, which is the only way the contact page and a segment count can be
  // guaranteed to agree.
  const contactRows = await prisma.contact.findMany({
    where: { shop, email: { in: list } },
    select: {
      email: true, orderCount: true, totalSpent: true, lastOrderAt: true,
      emailsSent: true, emailsOpened: true, emailsClicked: true,
      emailsClickTracked: true, openRate: true, clickRate: true,
      lastEmailOpenedAt: true, pushEnabled: true,
    },
  });
  for (const row of contactRows) {
    const s = out.get(row.email);
    if (!s) continue;
    s.orderCount = row.orderCount || 0;
    s.totalSpent = row.totalSpent || 0;
    s.lastOrderAt = row.lastOrderAt || null;
    s.aov = s.orderCount ? s.totalSpent / s.orderCount : 0;
    s.emailsSent = row.emailsSent || 0;
    s.emailsOpened = row.emailsOpened || 0;
    s.emailsClicked = row.emailsClicked || 0;
    s.emailsClickTracked = row.emailsClickTracked || 0;
    s.openRate = row.openRate || 0;
    s.clickRate = row.clickRate || 0;
    s.lastEmailOpenedAt = row.lastEmailOpenedAt || null;
    s.pushEnabled = Boolean(row.pushEnabled);
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
 * Also returns filteredTotal (count of ALL rows matching the filter, not just
 * the current page) so the UI can show "Showing X of Y" accurately.
 */
/**
 * The Prisma filter behind the contacts list.
 *
 * Extracted because three call sites need to agree on it — the list itself, the
 * "select all matching filter" bulk actions, and the CSV export. Three separate
 * copies is how an export quietly stops matching the rows on screen.
 */
export function buildContactWhere({ shop, status, source, tagId, search }) {
  const where = { shop, deletedAt: null };
  if (status && status !== "all") where.subscriptionStatus = status;
  if (source && source !== "all") where.source = source;
  if (tagId && tagId !== "all") where.tags = { some: { tagId } };
  if (search) {
    const q = String(search).trim();
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function listContacts({
  shop,
  status,
  source,
  tagId,
  search,
  cursor,
  limit = 50,
}) {
  const where = buildContactWhere({ shop, status, source, tagId, search });

  const take = search ? Math.min(limit, 200) : limit;

  const [rows, filteredTotal] = await Promise.all([
    prisma.contact.findMany({
      where,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      include: {
        tags: { include: { tag: true } },
      },
    }),
    prisma.contact.count({ where }),
  ]);

  let nextCursor = null;
  if (rows.length > take) {
    const last = rows.pop();
    nextCursor = last.id;
  }
  return { rows, nextCursor, filteredTotal };
}

/**
 * Returns all contact IDs (and emails) matching the given filters — used for
 * server-side "select all filtered" bulk actions.
 */
export async function listAllContactIds({ shop, status, source, tagId, search }) {
  return prisma.contact.findMany({
    where: buildContactWhere({ shop, status, source, tagId, search }),
    select: { id: true, email: true },
    orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
  });
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

/**
 * Suppress and mark unsubscribed in bulk.
 *
 * Chunked set-based writes rather than one round trip per contact: the caller
 * can be acting on an entire filtered list, and a per-row loop there is tens of
 * thousands of sequential queries inside one request.
 *
 * @param {string} shop
 * @param {string[]} emails
 * @returns {Promise<number>} contacts affected
 */
export async function bulkUnsubscribe(shop, emails) {
  const unique = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (!unique.length) return 0;

  // Chunked to keep each statement's parameter list within Postgres' limits.
  const CHUNK = 1000;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    await prisma.$transaction([
      // createMany + skipDuplicates is the set-based equivalent of upserting
      // each suppression; rows that already exist keep their original reason
      // and createdAt, which is what we want for an unsubscribe.
      prisma.emailSuppression.createMany({
        data: slice.map((email) => ({ shop, email, reason: "unsubscribe" })),
        skipDuplicates: true,
      }),
      prisma.contact.updateMany({
        where: { shop, email: { in: slice } },
        data: { subscriptionStatus: "unsubscribed" },
      }),
    ]);
  }
  return unique.length;
}

/**
 * Soft-delete many contacts at once.
 *
 * @param {string} shop
 * @param {string[]} ids
 * @returns {Promise<number>} contacts affected
 */
export async function bulkSoftDelete(shop, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return 0;

  const CHUNK = 1000;
  let total = 0;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { count } = await prisma.contact.updateMany({
      where: { shop, id: { in: unique.slice(i, i + CHUNK) } },
      data: { deletedAt: new Date() },
    });
    total += count;
  }
  return total;
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
