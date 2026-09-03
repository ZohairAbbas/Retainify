import prisma from "../../db.server.js";

const SUPPRESSION_REASON_TO_STATUS = {
  unsubscribe: "unsubscribed",
  bounce: "bounced",
  complaint: "complained",
};

/**
 * Which revision of this roll-up the table reflects. Bump it whenever the
 * routine's output changes, and every shop re-runs on its next contacts load
 * instead of only the shops that install afterwards.
 *
 * 1 — original: enrollment-derived contacts were written as source "manual".
 * 2 — enrollment-derived contacts carry source "journey_enrollment", and rows
 *     the previous revision mislabelled are repaired.
 */
export const BACKFILL_VERSION = 2;

/**
 * Roll-up of every email-bearing row in this shop into the Contact table.
 * Idempotent — deterministic ids and ON CONFLICT widening mean a second run
 * over unchanged data is a no-op — and guarded by
 * ShopSettings.contactsBackfillVersion so it runs once per revision.
 *
 * Insertion priority (highest wins for `source` and `subscriptionStatus`):
 *   1. PopupSignup (subscribed if confirmed, else never_opted_in)
 *   2. AbandonedCart (source = cart_abandoned)
 *   3. PushSubscription (source = push_only)
 *   4. JourneyEnrollment (source = journey_enrollment)
 *   5. EmailSuppression (overlays subscription status: unsubscribed/bounced/complained)
 *
 * Email is lowercased everywhere. lastSeenAt always widens to MAX, firstSeenAt
 * widens to MIN.
 *
 * Returns { didRun: boolean, added: number } so the route can show the unify
 * banner the first time.
 */
export async function runContactsBackfillIfNeeded(shop) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if ((settings?.contactsBackfillVersion ?? 0) >= BACKFILL_VERSION) {
    return { didRun: false, added: 0 };
  }

  const before = await prisma.contact.count({ where: { shop } });

  // Each insert is a single CTE: derive distinct lowercased emails from one
  // source table, then ON CONFLICT widen lastSeenAt + name only (never
  // overwrite source/status downward).

  // 1. PopupSignup
  await prisma.$executeRaw`
    INSERT INTO "Contact" (
      "id", "shop", "email", "name", "firstSeenAt", "lastSeenAt", "source",
      "subscriptionStatus", "marketingConsentAt", "createdAt", "updatedAt"
    )
    SELECT
      'c_' || md5(${shop} || '|popup|' || LOWER(email)),
      ${shop},
      LOWER(email),
      '',
      MIN("createdAt"),
      MAX("createdAt"),
      'popup',
      CASE WHEN BOOL_OR("confirmedAt" IS NOT NULL) THEN 'subscribed' ELSE 'never_opted_in' END,
      MAX("confirmedAt"),
      NOW(),
      NOW()
    FROM "PopupSignup"
    WHERE shop = ${shop} AND email IS NOT NULL AND email <> ''
    GROUP BY LOWER(email)
    ON CONFLICT ("shop", "email") DO UPDATE SET
      "lastSeenAt" = GREATEST("Contact"."lastSeenAt", EXCLUDED."lastSeenAt"),
      "firstSeenAt" = LEAST("Contact"."firstSeenAt", EXCLUDED."firstSeenAt"),
      "marketingConsentAt" = COALESCE("Contact"."marketingConsentAt", EXCLUDED."marketingConsentAt")
  `;

  // 2. AbandonedCart
  await prisma.$executeRaw`
    INSERT INTO "Contact" (
      "id", "shop", "email", "name", "firstSeenAt", "lastSeenAt", "source",
      "subscriptionStatus", "createdAt", "updatedAt"
    )
    SELECT
      'c_' || md5(${shop} || '|cart|' || LOWER("customerEmail")),
      ${shop},
      LOWER("customerEmail"),
      COALESCE(MAX("customerName"), ''),
      MIN("abandonedAt"),
      MAX("abandonedAt"),
      'cart_abandoned',
      'never_opted_in',
      NOW(),
      NOW()
    FROM "AbandonedCart"
    WHERE shop = ${shop} AND "customerEmail" IS NOT NULL AND "customerEmail" <> ''
    GROUP BY LOWER("customerEmail")
    ON CONFLICT ("shop", "email") DO UPDATE SET
      "lastSeenAt" = GREATEST("Contact"."lastSeenAt", EXCLUDED."lastSeenAt"),
      "firstSeenAt" = LEAST("Contact"."firstSeenAt", EXCLUDED."firstSeenAt"),
      "name" = CASE WHEN "Contact"."name" = '' THEN EXCLUDED."name" ELSE "Contact"."name" END
  `;

  // 3. PushSubscription
  await prisma.$executeRaw`
    INSERT INTO "Contact" (
      "id", "shop", "email", "name", "firstSeenAt", "lastSeenAt", "source",
      "subscriptionStatus", "createdAt", "updatedAt"
    )
    SELECT
      'c_' || md5(${shop} || '|push|' || LOWER("contactEmail")),
      ${shop},
      LOWER("contactEmail"),
      '',
      MIN("subscribedAt"),
      MAX(COALESCE("unsubscribedAt", "subscribedAt")),
      'push_only',
      'never_opted_in',
      NOW(),
      NOW()
    FROM "PushSubscription"
    WHERE shop = ${shop} AND "contactEmail" IS NOT NULL AND "contactEmail" <> ''
    GROUP BY LOWER("contactEmail")
    ON CONFLICT ("shop", "email") DO UPDATE SET
      "lastSeenAt" = GREATEST("Contact"."lastSeenAt", EXCLUDED."lastSeenAt"),
      "firstSeenAt" = LEAST("Contact"."firstSeenAt", EXCLUDED."firstSeenAt")
  `;

  // 4. JourneyEnrollment — everyone a flow has ever run against.
  //
  // Runs last of the four inserts because being enrolled says the least about
  // where someone came from: an enrollment can originate from a popup signup, a
  // cart, a segment, or a merchant enrolling a list by hand. So it only fills
  // the gaps the three stronger sources left, and widens dates on the rest.
  //
  // The source it writes is "journey_enrollment" rather than the "manual"
  // placeholder it used to. Both are weak — upsertContact treats either as
  // overwritable, so a later real touch still wins (see PLACEHOLDER_SOURCES
  // there) — but "Added manually" was an outright false statement to a merchant
  // reading the contacts list or filtering a segment by source.
  //
  // subscriptionStatus stays never_opted_in: an enrollment is not consent, and
  // step 5 overlays any suppression on top.
  await prisma.$executeRaw`
    INSERT INTO "Contact" (
      "id", "shop", "email", "name", "firstSeenAt", "lastSeenAt", "source",
      "subscriptionStatus", "createdAt", "updatedAt"
    )
    SELECT
      'c_' || md5(${shop} || '|enroll|' || LOWER("contactEmail")),
      ${shop},
      LOWER("contactEmail"),
      COALESCE(MAX("contactName"), ''),
      MIN("enrolledAt"),
      MAX("enrolledAt"),
      'journey_enrollment',
      'never_opted_in',
      NOW(),
      NOW()
    FROM "JourneyEnrollment"
    WHERE shop = ${shop} AND "contactEmail" IS NOT NULL AND "contactEmail" <> ''
    GROUP BY LOWER("contactEmail")
    ON CONFLICT ("shop", "email") DO UPDATE SET
      "lastSeenAt" = GREATEST("Contact"."lastSeenAt", EXCLUDED."lastSeenAt"),
      "firstSeenAt" = LEAST("Contact"."firstSeenAt", EXCLUDED."firstSeenAt"),
      "name" = CASE WHEN "Contact"."name" = '' THEN EXCLUDED."name" ELSE "Contact"."name" END
  `;

  // 4b. Repair rows the previous revision labelled "manual".
  //
  // The insert above cannot fix them itself: ON CONFLICT deliberately never
  // touches `source`, so a row already sitting there keeps whatever it has.
  //
  // Relabelling every "manual" contact that happens to have an enrollment would
  // catch genuine hand-added contacts, who get enrolled in flows like anyone
  // else. The id is what separates them: only the enrollment insert mints
  // 'c_' || md5(shop|enroll|email), while a contact added by hand carries a
  // cuid. So this matches exactly the rows revision 1 wrote and nothing else.
  await prisma.$executeRaw`
    UPDATE "Contact"
    SET "source" = 'journey_enrollment', "updatedAt" = NOW()
    WHERE "shop" = ${shop}
      AND "source" = 'manual'
      AND "id" = 'c_' || md5(${shop} || '|enroll|' || "email")
  `;

  // 5. EmailSuppression — overlay subscriptionStatus on whatever's there.
  const suppressions = await prisma.emailSuppression.findMany({
    where: { shop },
    select: { email: true, reason: true },
  });
  for (const sup of suppressions) {
    const status = SUPPRESSION_REASON_TO_STATUS[sup.reason] || "unsubscribed";
    const email = sup.email.trim().toLowerCase();
    await prisma.contact.updateMany({
      where: { shop, email },
      data: { subscriptionStatus: status },
    });
  }

  await prisma.shopSettings.upsert({
    where: { shop },
    update: { contactsBackfilledAt: new Date(), contactsBackfillVersion: BACKFILL_VERSION },
    create: {
      shop,
      contactsBackfilledAt: new Date(),
      contactsBackfillVersion: BACKFILL_VERSION,
    },
  });

  const after = await prisma.contact.count({ where: { shop } });
  return { didRun: true, added: after - before };
}
