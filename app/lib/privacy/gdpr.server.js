/**
 * GDPR / Shopify mandatory-compliance data handling.
 *
 * The three mandatory webhooks (customers/data_request, customers/redact,
 * shop/redact) all need the same thing: an accurate, exhaustive list of every
 * table that holds data for a shopper or a shop. Keeping that list in one place
 * is the point of this module — the previous per-webhook versions had drifted
 * and between them missed eleven tables, including the one holding an encrypted
 * Meta access token.
 *
 * ── Email casing ────────────────────────────────────────────────────────────
 * Addresses are NOT stored consistently. Contact and PopupSignup are normalized
 * to lowercase on write; AbandonedCart takes `payload.email` straight off the
 * Shopify webhook, and EmailSuppression rows written before normalization was
 * centralized can be either. Shopify sends the customer's address in whatever
 * casing the customer typed. So every lookup here is case-insensitive — an
 * exact match would silently skip rows and report a successful erasure that
 * didn't happen.
 */
import prisma from "../../db.server.js";
import { normalizeEmail } from "../contacts/contacts.server.js";
import { deleteLocal, isLocalAsset } from "../media/storage.server.js";

/** Case-insensitive equality filter for an email column. */
function sameEmail(email) {
  return { equals: email, mode: "insensitive" };
}

/**
 * Everything we hold about one shopper, for customers/data_request.
 *
 * Returns a plain serialisable object. Empty collections are kept (rather than
 * omitted) so the export is self-describing: "we checked here and held nothing"
 * is a materially different answer from "we didn't look".
 *
 * @param {string} shop
 * @param {string} rawEmail
 */
export async function collectCustomerData(shop, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!shop || !email) {
    return { shop, email: rawEmail || null, error: "no email supplied" };
  }

  const contact = await prisma.contact.findFirst({
    where: { shop, email: sameEmail(email) },
    include: { tags: { include: { tag: true } } },
  });

  const [
    carts,
    orders,
    suppression,
    signups,
    enrollments,
    pushSubscriptions,
    whatsappSubscription,
    whatsappSuppression,
  ] = await Promise.all([
    prisma.abandonedCart.findMany({ where: { shop, customerEmail: sameEmail(email) } }),
    prisma.order.findMany({
      where: { shop, email: sameEmail(email) },
      orderBy: { processedAt: "desc" },
      select: {
        shopifyOrderId: true, totalPrice: true, currency: true,
        financialStatus: true, processedAt: true, cancelledAt: true,
      },
    }),
    prisma.emailSuppression.findFirst({ where: { shop, email: sameEmail(email) } }),
    prisma.popupSignup.findMany({ where: { shop, email: sameEmail(email) } }),
    prisma.journeyEnrollment.findMany({
      where: { shop, contactEmail: sameEmail(email) },
      include: {
        journey: { select: { name: true, trigger: true } },
        jobs: { select: { scheduledFor: true, status: true, sentAt: true, openedAt: true, clickedAt: true } },
        pushJobs: { select: { scheduledFor: true, status: true, sentAt: true } },
        whatsappJobs: { select: { scheduledFor: true, status: true, sentAt: true, deliveredAt: true, readAt: true } },
      },
    }),
    prisma.pushSubscription.findMany({
      where: { shop, contactEmail: sameEmail(email) },
      // The endpoint is a push-service URL that identifies the browser; include
      // it (it is the shopper's data) but never the crypto keys, which are ours.
      select: { endpoint: true, isActive: true, subscribedAt: true, unsubscribedAt: true },
    }),
    prisma.whatsappSubscription.findFirst({ where: { shop, contactEmail: sameEmail(email) } }),
    contactPhoneSuppression(shop, email),
  ]);

  // Segment membership is keyed by Contact.id, so it only exists if the contact does.
  let segments = [];
  let segmentActivity = [];
  if (contact) {
    const memberships = await prisma.segmentMembership.findMany({
      where: { contactId: contact.id },
      include: { segment: { select: { name: true, kind: true } } },
    });
    segments = memberships.map((m) => ({
      segment: m.segment?.name || null,
      kind: m.segment?.kind || null,
      addedAt: m.addedAt,
    }));
    segmentActivity = await prisma.segmentEntryLog.findMany({
      where: { contactId: contact.id },
      select: { segmentKey: true, enteredAt: true, leftAt: true },
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    shop,
    email,
    contact: contact
      ? {
          email: contact.email,
          name: contact.name,
          phone: contact.phone,
          source: contact.source,
          subscriptionStatus: contact.subscriptionStatus,
          marketingConsentAt: contact.marketingConsentAt,
          whatsappStatus: contact.whatsappStatus,
          whatsappOptInAt: contact.whatsappOptInAt,
          firstSeenAt: contact.firstSeenAt,
          lastSeenAt: contact.lastSeenAt,
          orderCount: contact.orderCount,
          totalSpent: contact.totalSpent,
          firstOrderAt: contact.firstOrderAt,
          lastOrderAt: contact.lastOrderAt,
          customProperties: contact.customProps || {},
          shopifyCustomerId: contact.shopifyCustomerId,
          tags: contact.tags.map((ct) => ct.tag?.name).filter(Boolean),
        }
      : null,
    orders,
    abandonedCarts: carts.map((c) => ({
      abandonedAt: c.abandonedAt,
      totalPrice: c.totalPrice,
      currency: c.currency,
      recoveredAt: c.recoveredAt,
      recoveredRevenue: c.recoveredRevenue,
      lineItems: safeParse(c.lineItemsJson, []),
    })),
    emailSuppression: suppression
      ? { reason: suppression.reason, createdAt: suppression.createdAt }
      : null,
    popupSignups: signups.map((s) => ({
      source: s.source,
      createdAt: s.createdAt,
      confirmedAt: s.confirmedAt,
      discountCode: s.discountCode || null,
    })),
    journeyEnrollments: enrollments.map((e) => ({
      journey: e.journey?.name || null,
      trigger: e.journey?.trigger || null,
      enrolledAt: e.enrolledAt,
      completedAt: e.completedAt,
      exitReason: e.exitReason || null,
      emailsScheduled: e.jobs,
      pushScheduled: e.pushJobs,
      whatsappScheduled: e.whatsappJobs,
    })),
    pushSubscriptions,
    whatsapp: whatsappSubscription
      ? {
          phoneNumber: whatsappSubscription.phoneNumber,
          status: whatsappSubscription.status,
          optInMethod: whatsappSubscription.optInMethod,
          optInAt: whatsappSubscription.optInAt,
          optOutAt: whatsappSubscription.optOutAt,
          confirmedAt: whatsappSubscription.confirmedAt,
        }
      : null,
    whatsappSuppression,
    segments,
    segmentActivity,
  };
}

/** WhatsApp suppression is keyed by phone, which we have to resolve first. */
async function contactPhoneSuppression(shop, email) {
  const contact = await prisma.contact.findFirst({
    where: { shop, email: sameEmail(email) },
    select: { phone: true },
  });
  if (!contact?.phone) return null;
  return prisma.whatsappSuppression.findUnique({
    where: { shop_phoneNumber: { shop, phoneNumber: contact.phone } },
  });
}

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * Erase everything we hold for one shopper.
 *
 * Order matters: Contact.id and Contact.phone are the keys for the segment and
 * WhatsApp tables, so both are captured before the Contact row goes.
 *
 * @param {string} shop
 * @param {string} rawEmail
 * @returns {Promise<{email:string, deleted:Record<string,number>}>}
 */
export async function redactCustomer(shop, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!shop || !email) return { email: rawEmail || "", deleted: {} };

  // Resolve the identifiers the non-email-keyed tables need, before deletion.
  const contact = await prisma.contact.findFirst({
    where: { shop, email: sameEmail(email) },
    select: { id: true, phone: true },
  });

  const deleted = {};
  const count = (key, result) => {
    deleted[key] = result?.count ?? 0;
  };

  // Enrollment deletion cascades JourneyJob, PushJob and WhatsappJob.
  count(
    "journeyEnrollments",
    await prisma.journeyEnrollment.deleteMany({ where: { shop, contactEmail: sameEmail(email) } }),
  );
  count("orders", await prisma.order.deleteMany({ where: { shop, email: sameEmail(email) } }));
  count("abandonedCarts", await prisma.abandonedCart.deleteMany({ where: { shop, customerEmail: sameEmail(email) } }));
  count("emailSuppressions", await prisma.emailSuppression.deleteMany({ where: { shop, email: sameEmail(email) } }));
  count("popupSignups", await prisma.popupSignup.deleteMany({ where: { shop, email: sameEmail(email) } }));
  count("pushSubscriptions", await prisma.pushSubscription.deleteMany({ where: { shop, contactEmail: sameEmail(email) } }));
  count(
    "whatsappSubscriptions",
    await prisma.whatsappSubscription.deleteMany({ where: { shop, contactEmail: sameEmail(email) } }),
  );

  if (contact?.phone) {
    count(
      "whatsappSuppressions",
      await prisma.whatsappSuppression.deleteMany({ where: { shop, phoneNumber: contact.phone } }),
    );
  }

  if (contact?.id) {
    // Neither of these has a foreign key back to Contact, so they survive the
    // Contact delete unless removed explicitly.
    count("segmentMemberships", await prisma.segmentMembership.deleteMany({ where: { contactId: contact.id } }));
    count("segmentEntryLogs", await prisma.segmentEntryLog.deleteMany({ where: { contactId: contact.id } }));
  }

  // Last: the Contact itself, which cascades ContactTag.
  count("contacts", await prisma.contact.deleteMany({ where: { shop, email: sameEmail(email) } }));

  return { email, deleted };
}

/**
 * Erase everything we hold for a shop, 48h after uninstall.
 *
 * Deliberately exhaustive. WhatsappAccount is the one that matters most: it
 * stores the shop's encrypted long-lived Meta system-user token, and retaining
 * credentials past an erasure request is the worst possible version of this bug.
 *
 * @param {string} shop
 * @returns {Promise<Record<string, number>>} rows removed per table
 */
export async function redactShop(shop) {
  if (!shop) return {};

  const deleted = {};
  const run = async (key, promise) => {
    try {
      const result = await promise;
      deleted[key] = result?.count ?? 0;
    } catch (err) {
      // One failing table must not abandon the rest of the erasure.
      deleted[key] = -1;
      console.error(`[gdpr] shop redact failed for ${key} on ${shop}:`, err.message);
    }
  };

  const where = { where: { shop } };

  // Journey cascades JourneyStep → JourneyJob / PushJob / WhatsappJob, and
  // JourneyEnrollment → the same job tables.
  await run("journeys", prisma.journey.deleteMany(where));
  // Segment cascades SegmentMembership. Snapshots and entry logs have no FK.
  await run("segments", prisma.segment.deleteMany(where));
  await run("segmentSnapshots", prisma.segmentSnapshot.deleteMany(where));
  await run("segmentEntryLogs", prisma.segmentEntryLog.deleteMany(where));
  // Contact and Tag both cascade ContactTag.
  await run("contacts", prisma.contact.deleteMany(where));
  await run("tags", prisma.tag.deleteMany(where));
  await run("abandonedCarts", prisma.abandonedCart.deleteMany(where));
  await run("emailSuppressions", prisma.emailSuppression.deleteMany(where));
  await run("popupSignups", prisma.popupSignup.deleteMany(where));
  await run("popupSettings", prisma.popupSettings.deleteMany(where));
  await run("pushSubscriptions", prisma.pushSubscription.deleteMany(where));
  // WhatsappAccount holds the encrypted Meta access token.
  await run("whatsappAccounts", prisma.whatsappAccount.deleteMany(where));
  await run("whatsappTemplates", prisma.whatsappTemplate.deleteMany(where));
  await run("whatsappSubscriptions", prisma.whatsappSubscription.deleteMany(where));
  await run("whatsappSuppressions", prisma.whatsappSuppression.deleteMany(where));
  await run("orders", prisma.order.deleteMany(where));
  // Merchant configuration that is nonetheless shop-scoped and must not
  // outlive the shop.
  await run("contactProperties", prisma.contactPropertyDef.deleteMany(where));
  await run("contactViews", prisma.contactView.deleteMany(where));
  // Delete the bytes before the rows: the row IS the index of what's on disk,
  // so dropping it first would strand every file with no way to find it again.
  await run("mediaFiles", purgeLocalMedia(shop));
  await run("mediaAssets", prisma.mediaAsset.deleteMany(where));
  await run("shopPlans", prisma.shopPlan.deleteMany(where));
  await run("usageCounters", prisma.usageCounter.deleteMany(where));
  await run("shopSettings", prisma.shopSettings.deleteMany(where));
  await run("sessions", prisma.session.deleteMany(where));
  // The tenancy row. Cascades Membership, Invite and AuthSession, so the people
  // who could sign in to this workspace lose that access with it. User rows
  // survive on purpose — a person may belong to other workspaces, and deleting
  // their identity here would take those with it.
  await run("accounts", prisma.account.deleteMany({ where: { key: shop } }));

  return deleted;
}

/**
 * Remove locally stored upload bytes for a workspace.
 *
 * Only ever finds anything for a direct workspace; a Shopify one keeps its
 * files on Shopify's CDN, which Shopify erases on its own schedule.
 *
 * Returns a {count} so it reports through the same `run` helper as a Prisma
 * deleteMany.
 */
async function purgeLocalMedia(shop) {
  const assets = await prisma.mediaAsset.findMany({
    where: { shop },
    select: { id: true, shopifyGid: true },
  });
  let count = 0;
  for (const asset of assets) {
    if (!isLocalAsset(asset)) continue;
    await deleteLocal(asset.id);
    count += 1;
  }
  return { count };
}
