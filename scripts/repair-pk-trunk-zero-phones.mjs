/**
 * One-off repair: Pakistani numbers stored with a trunk zero after the country code.
 *
 * toE164 used to accept +92 0300 1234567 — the leading-zero rejection only
 * looked at position 0, so a trunk zero sitting AFTER the country code passed as
 * a 13-digit number. Those rows were stored as subscribers, sent, rejected by
 * Meta with a permanent-failure code, and then permanently suppressed: a
 * WhatsappSuppression row, the subscription flipped to "invalid", and
 * Contact.whatsappStatus set to "invalid". The buyer became unreachable on
 * WhatsApp forever because of a formatting error.
 *
 * The fix in toE164 stops new rows being written this way. This repairs the ones
 * already stored, and undoes suppressions that were never the buyer's fault.
 *
 * ── What it will not do ────────────────────────────────────────────────────
 * Re-subscribe anyone who genuinely opted out. A STOP suppression or an
 * optOutAt timestamp is a decision the buyer made, and it survives this script
 * untouched — the phone is still corrected, but consent is left exactly as it
 * stands. Only reason="invalid" suppressions are removed, and only for numbers
 * whose stored shape explains the rejection.
 *
 * ── Merges ─────────────────────────────────────────────────────────────────
 * WhatsappSubscription and WhatsappSuppression are both unique on
 * [shop, phoneNumber], so a broken row whose corrected number ALREADY exists for
 * that shop cannot simply be rewritten. Those are merged, never duplicated, and
 * the merge is deliberately conservative: the surviving row keeps the stronger
 * signal (a real confirmation, the earlier opt-in, any opt-out on either side).
 *
 * Contact is keyed [shop, email], so Contact.phone is a plain column — correcting
 * it can never collide.
 *
 * Usage:
 *   node --env-file=.env scripts/repair-pk-trunk-zero-phones.mjs            # dry run (default)
 *   node --env-file=.env scripts/repair-pk-trunk-zero-phones.mjs --apply
 *   node --env-file=.env scripts/repair-pk-trunk-zero-phones.mjs --shop=x.myshopify.com --apply
 *
 * Output is counts per shop only. No phone numbers are printed in either mode.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Dry run is the default: --apply must be asked for explicitly, so a mistyped
// flag reports instead of writing.
const APPLY = process.argv.includes("--apply");

/**
 * Optional --shop=<key>: repair one workspace instead of every one.
 *
 * Operationally this lets a big shop be repaired and checked on its own before
 * the rest follow. It is also what makes the tests hermetic — without it the
 * script rewrites every matching row in the database, including fixtures other
 * test files are using concurrently.
 */
const SHOP_ARG = process.argv.find((a) => a.startsWith("--shop="));
const ONLY_SHOP = SHOP_ARG ? SHOP_ARG.slice("--shop=".length) : null;

/** Literal for interpolation. Shop keys are Shopify domains or generated slugs. */
function shopClause(column = "shop") {
  if (!ONLY_SHOP) return "";
  if (!/^[A-Za-z0-9._-]+$/.test(ONLY_SHOP)) {
    throw new Error(`refusing to run: --shop=${ONLY_SHOP} is not a plain shop key`);
  }
  return ` and "${column}" = '${ONLY_SHOP}'`;
}

/**
 * The one unambiguous broken shape: 92 + trunk 0 + 10 digits.
 *
 * Applied in SQL rather than in JS so the scan stays in the database — the
 * tables are large and only a tiny fraction of rows match. Kept identical to
 * isRepairableFormat() in contacts.server.js: if one widens, so must the other,
 * or the worker will decline to suppress numbers this script never repairs.
 */
const BROKEN_SQL = "^920[0-9]{10}$";

/** 9203001234567 -> 923001234567. Assumes the row already matched BROKEN_SQL. */
function repair(phone) {
  return "92" + phone.slice(-10);
}

/** Counts keyed by shop, so the report can stay free of phone numbers. */
function tally() {
  const map = new Map();
  return {
    add(shop, key, n = 1) {
      if (!map.has(shop)) map.set(shop, {});
      const row = map.get(shop);
      row[key] = (row[key] || 0) + n;
    },
    get map() {
      return map;
    },
  };
}

async function main() {
  console.log(APPLY ? "APPLYING CHANGES\n" : "DRY RUN — no writes\n");

  const counts = tally();

  // ── Subscriptions ─────────────────────────────────────────────────────────
  const subs = await prisma.$queryRawUnsafe(`
    select id, shop, "phoneNumber", "contactEmail", status, "confirmedAt", "optInAt", "optOutAt"
    from "WhatsappSubscription"
    where "phoneNumber" ~ '${BROKEN_SQL}'${shopClause()}
    order by shop
  `);

  for (const sub of subs) {
    const fixed = repair(sub.phoneNumber);
    counts.add(sub.shop, "subscriptions");

    const existing = await prisma.whatsappSubscription.findUnique({
      where: { shop_phoneNumber: { shop: sub.shop, phoneNumber: fixed } },
    });

    // A genuine opt-out on the broken row is still an opt-out. The number gets
    // corrected so future lookups find it, but it stays unsubscribed.
    const optedOut = !!sub.optOutAt || sub.status === "unsubscribed";
    if (optedOut) counts.add(sub.shop, "subs_opted_out_left_alone");

    if (!existing) {
      // No collision — a straight rewrite. "invalid" becomes subscribed again
      // only when the invalidity was our formatting error and the buyer never
      // opted out; that is the entire point of the repair.
      const restore = sub.status === "invalid" && !optedOut;
      if (restore) counts.add(sub.shop, "subs_restored");
      if (APPLY) {
        await prisma.whatsappSubscription.update({
          where: { id: sub.id },
          data: {
            phoneNumber: fixed,
            ...(restore ? { status: "subscribed" } : {}),
          },
        });
      }
      continue;
    }

    // Collision: the corrected number already exists for this shop. Keep the
    // existing row and fold the broken one into it, preferring the stronger
    // signal on each field, then delete the duplicate.
    counts.add(sub.shop, "subs_merged");
    const mergedOptOut = existing.optOutAt || sub.optOutAt || null;
    const mergedStatus = mergedOptOut
      ? "unsubscribed"
      : existing.status === "subscribed" || sub.status === "subscribed"
        ? "subscribed"
        : existing.status === "invalid" && sub.status === "invalid"
          ? "subscribed" // both invalid only because of the formatting error
          : existing.status;
    if (mergedStatus === "subscribed" && existing.status !== "subscribed") {
      counts.add(sub.shop, "subs_restored");
    }

    if (APPLY) {
      await prisma.whatsappSubscription.update({
        where: { id: existing.id },
        data: {
          status: mergedStatus,
          confirmedAt: existing.confirmedAt || sub.confirmedAt || null,
          contactEmail: existing.contactEmail || sub.contactEmail || null,
          optInAt: earlier(existing.optInAt, sub.optInAt),
          optOutAt: mergedOptOut,
        },
      });
      await prisma.whatsappSubscription.delete({ where: { id: sub.id } });
    }
  }

  // ── Suppressions ──────────────────────────────────────────────────────────
  const supps = await prisma.$queryRawUnsafe(`
    select id, shop, "phoneNumber", reason
    from "WhatsappSuppression"
    where "phoneNumber" ~ '${BROKEN_SQL}'${shopClause()}
    order by shop
  `);

  for (const supp of supps) {
    const fixed = repair(supp.phoneNumber);
    counts.add(supp.shop, "suppressions");

    // Only "invalid" is ours to undo. opt_out and blocked are the buyer's or
    // Meta's decision and are carried across to the corrected number intact,
    // so correcting the format can never resurrect a silenced recipient.
    if (supp.reason !== "invalid") {
      counts.add(supp.shop, "supp_kept_real_optout");
      const clash = await prisma.whatsappSuppression.findUnique({
        where: { shop_phoneNumber: { shop: supp.shop, phoneNumber: fixed } },
      });
      if (APPLY) {
        if (clash) {
          await prisma.whatsappSuppression.delete({ where: { id: supp.id } });
        } else {
          await prisma.whatsappSuppression.update({
            where: { id: supp.id },
            data: { phoneNumber: fixed },
          });
        }
      }
      continue;
    }

    counts.add(supp.shop, "supp_invalid_removed");
    if (APPLY) await prisma.whatsappSuppression.delete({ where: { id: supp.id } });
  }

  // ── Contacts ──────────────────────────────────────────────────────────────
  // Contact is keyed [shop, email], so phone is a plain column and a rewrite
  // cannot collide. whatsappStatus is restored only when the contact has no
  // surviving suppression and no opted-out subscription on the corrected number.
  const contacts = await prisma.$queryRawUnsafe(`
    select id, shop, email, phone, "whatsappStatus"
    from "Contact"
    where phone ~ '${BROKEN_SQL}'${shopClause()}
    order by shop
  `);

  for (const contact of contacts) {
    const fixed = repair(contact.phone);
    counts.add(contact.shop, "contacts");

    let restore = contact.whatsappStatus === "invalid";
    if (restore) {
      // Re-check against the post-repair world: anything that legitimately
      // silences this number must win over the restore.
      const [stillSuppressed, optedOutSub] = await Promise.all([
        prisma.whatsappSuppression.findUnique({
          where: { shop_phoneNumber: { shop: contact.shop, phoneNumber: fixed } },
        }),
        prisma.whatsappSubscription.findFirst({
          where: {
            shop: contact.shop,
            phoneNumber: fixed,
            OR: [{ optOutAt: { not: null } }, { status: "unsubscribed" }],
          },
        }),
      ]);
      if (stillSuppressed || optedOutSub) {
        restore = false;
        counts.add(contact.shop, "contacts_left_silenced");
      }
    }
    if (restore) counts.add(contact.shop, "contacts_restored");

    if (APPLY) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          phone: fixed,
          ...(restore ? { whatsappStatus: "subscribed" } : {}),
        },
      });
    }
  }

  report(counts.map);
  console.log(
    APPLY ? "\nApplied." : "\nDry run complete — nothing written. Re-run with --apply to write.",
  );
}

/** Earliest non-null of two dates — the opt-in we can actually evidence. */
function earlier(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a < b ? a : b;
}

function report(map) {
  if (!map.size) {
    console.log("No rows match the broken format. Nothing to do.");
    return;
  }
  const keys = [
    "subscriptions",
    "subs_restored",
    "subs_merged",
    "subs_opted_out_left_alone",
    "suppressions",
    "supp_invalid_removed",
    "supp_kept_real_optout",
    "contacts",
    "contacts_restored",
    "contacts_left_silenced",
  ];
  for (const [shop, row] of [...map.entries()].sort()) {
    const parts = keys.filter((k) => row[k]).map((k) => `${k}=${row[k]}`);
    console.log(`${shop.padEnd(40)} ${parts.join("  ")}`);
  }
  const totals = {};
  for (const row of map.values()) {
    for (const k of keys) if (row[k]) totals[k] = (totals[k] || 0) + row[k];
  }
  console.log(
    `\nTOTAL (${map.size} shop${map.size === 1 ? "" : "s"})`.padEnd(41) +
      " " +
      keys
        .filter((k) => totals[k])
        .map((k) => `${k}=${totals[k]}`)
        .join("  "),
  );
}

main()
  .catch((err) => {
    console.error("repair failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
