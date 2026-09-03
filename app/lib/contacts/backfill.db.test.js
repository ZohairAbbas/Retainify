/**
 * Contact backfill: enrollment provenance and the versioned re-run.
 *
 * Run: npm test   (or: node --test app/lib/contacts/backfill.db.test.js)
 *
 * ── Why this needs a database ──────────────────────────────────────────────
 * The roll-up is five raw SQL statements. Its whole contract — deterministic
 * ids, ON CONFLICT widening rather than overwriting, priority between sources —
 * lives in Postgres, not in the JavaScript around it, so there is nothing here
 * a mocked prisma could check. The two things that can go wrong are both
 * SQL-shaped:
 *
 *   1. The enrollment insert overwriting a stronger source it should lose to.
 *   2. The revision-2 repair relabelling contacts a merchant added by hand.
 *      Those are indistinguishable from enrollment-derived rows by `source`
 *      alone — both said "manual" — and are told apart only by the id the
 *      backfill mints. A test that cannot see real ids cannot see the bug.
 */
import test from "node:test";
import assert from "node:assert/strict";

import prisma from "../../db.server.js";
import { runContactsBackfillIfNeeded, BACKFILL_VERSION } from "./backfill.server.js";

const SHOP = "__test__contact-backfill.myshopify.com";
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);

/** The id the enrollment insert mints, mirroring the SQL's md5 expression. */
async function enrollmentId(email) {
  const rows = await prisma.$queryRaw`
    SELECT 'c_' || md5(${SHOP} || '|enroll|' || ${email}) AS id
  `;
  return rows[0].id;
}

async function wipe() {
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
  await prisma.journeyEnrollment.deleteMany({ where: { shop: SHOP } });
  await prisma.journey.deleteMany({ where: { shop: SHOP } });
  await prisma.popupSignup.deleteMany({ where: { shop: SHOP } });
  await prisma.shopSettings.deleteMany({ where: { shop: SHOP } });
}

/** Fixtures: one address known only from an enrollment, one also from a popup. */
async function seed() {
  const journey = await prisma.journey.create({
    data: { shop: SHOP, name: "Backfill fixture", trigger: "cart_abandoned" },
  });
  await prisma.journeyEnrollment.createMany({
    data: [
      {
        shop: SHOP,
        journeyId: journey.id,
        contactEmail: "enrolled-only@example.com",
        contactName: "Enrolled Only",
        enrolledAt: ago(30),
      },
      // Mixed case on purpose: every source lowercases before write, so this
      // must land on the same row as the lowercase address, not a second one.
      {
        shop: SHOP,
        journeyId: journey.id,
        contactEmail: "Popup-Too@example.com",
        enrolledAt: ago(10),
      },
    ],
  });
  await prisma.popupSignup.create({
    data: {
      shop: SHOP,
      email: "popup-too@example.com",
      confirmedAt: ago(50),
      createdAt: ago(50),
    },
  });
}

test.before(async () => {
  await wipe();
  await seed();
});

test.after(async () => {
  await wipe();
  await prisma.$disconnect();
});

test("an address known only from an enrollment is labelled as one, not as manual", async () => {
  const result = await runContactsBackfillIfNeeded(SHOP);
  assert.equal(result.didRun, true);

  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop: SHOP, email: "enrolled-only@example.com" } },
  });
  assert.ok(contact, "the enrollment should have produced a contact");
  assert.equal(contact.source, "journey_enrollment");
  assert.equal(contact.name, "Enrolled Only");
  // An enrollment is not consent.
  assert.equal(contact.subscriptionStatus, "never_opted_in");
});

test("a stronger source keeps its provenance, and the enrollment only widens dates", async () => {
  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop: SHOP, email: "popup-too@example.com" } },
  });
  assert.equal(contact.source, "popup");
  assert.equal(contact.subscriptionStatus, "subscribed");
  // firstSeenAt from the popup (50d), lastSeenAt from the enrollment (10d).
  assert.ok(contact.firstSeenAt < ago(40), "firstSeenAt should widen to the popup");
  assert.ok(contact.lastSeenAt > ago(20), "lastSeenAt should widen to the enrollment");
});

test("the backfill records its version and no-ops on a second call", async () => {
  const settings = await prisma.shopSettings.findUnique({ where: { shop: SHOP } });
  assert.equal(settings.contactsBackfillVersion, BACKFILL_VERSION);
  assert.ok(settings.contactsBackfilledAt);

  const again = await runContactsBackfillIfNeeded(SHOP);
  assert.equal(again.didRun, false);
  assert.equal(again.added, 0);
});

test("a re-run repairs revision-1 rows without touching hand-added contacts", async () => {
  // Put the shop back the way revision 1 left it: enrollment-derived rows
  // labelled "manual", and the version behind.
  await prisma.contact.update({
    where: { shop_email: { shop: SHOP, email: "enrolled-only@example.com" } },
    data: { source: "manual", id: await enrollmentId("enrolled-only@example.com") },
  });
  // A genuinely hand-added contact who is also enrolled — the false positive a
  // source-only repair would produce. Its id is a cuid, not the minted one.
  const handAdded = await prisma.contact.create({
    data: {
      shop: SHOP,
      email: "by-hand@example.com",
      source: "manual",
      subscriptionStatus: "subscribed",
    },
  });
  const journey = await prisma.journey.findFirst({ where: { shop: SHOP } });
  await prisma.journeyEnrollment.create({
    data: {
      shop: SHOP,
      journeyId: journey.id,
      contactEmail: "by-hand@example.com",
      enrolledAt: ago(1),
    },
  });
  await prisma.shopSettings.update({
    where: { shop: SHOP },
    data: { contactsBackfillVersion: 1 },
  });

  const result = await runContactsBackfillIfNeeded(SHOP);
  assert.equal(result.didRun, true, "a lower version must re-run");

  const repaired = await prisma.contact.findUnique({
    where: { shop_email: { shop: SHOP, email: "enrolled-only@example.com" } },
  });
  assert.equal(repaired.source, "journey_enrollment");

  const untouched = await prisma.contact.findUnique({ where: { id: handAdded.id } });
  assert.equal(untouched.source, "manual", "a hand-added contact must not be relabelled");
});
