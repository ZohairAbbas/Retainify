import prisma from "../../db.server.js";

const SUPPRESSION_REASON_TO_STATUS = {
  unsubscribe: "unsubscribed",
  bounce: "bounced",
  complaint: "complained",
};

/**
 * One-time roll-up of every email-bearing row in this shop into the Contact
 * table. Idempotent — guarded by ShopSettings.contactsBackfilledAt.
 *
 * Insertion priority (highest wins for `source` and `subscriptionStatus`):
 *   1. PopupSignup (subscribed if confirmed, else never_opted_in)
 *   2. AbandonedCart (source = cart_abandoned)
 *   3. PushSubscription (source = push_only)
 *   4. JourneyEnrollment (source falls back to manual placeholder)
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
  if (settings?.contactsBackfilledAt) {
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

  // 4. JourneyEnrollment — placeholder source; only inserts emails not yet seen.
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
      'manual',
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
    update: { contactsBackfilledAt: new Date() },
    create: { shop, contactsBackfilledAt: new Date() },
  });

  const after = await prisma.contact.count({ where: { shop } });
  return { didRun: true, added: after - before };
}
