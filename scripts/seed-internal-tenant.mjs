#!/usr/bin/env node
/**
 * Seed the reserved workspace that Growzar's internal lifecycle messaging runs
 * in. See docs/internal-messaging.md and app/lib/internal/tenant.js.
 *
 * What it creates, all idempotently — a re-run repairs a partial seed and
 * overwrites nothing a human has since edited:
 *
 *   Account       the workspace itself, kind "direct" so shop-health treats it
 *                 as storeless rather than uninstalled (shop-health.server.js)
 *   ShopSettings  WITHOUT this row the email worker marks every internal job
 *                 `done` without sending — a silent, total failure
 *                 (journey-worker.server.js, the `if (!settings)` branch)
 *   ShopPlan      comped, so checkQuota never blocks internal sends once
 *                 BILLING_ENFORCE is turned on (entitlements.server.js)
 *   Membership    console access for an existing user, with --owner-email
 *
 * Console access deliberately attaches to an EXISTING user rather than creating
 * one: a script that mints an admin login would have to invent a password, and
 * a weak credential on a workspace that can message every Growzar merchant is
 * not worth the convenience. Sign up normally at /signup first, then pass that
 * address here.
 *
 * The sending domain is NOT set up here. Register it through the app so the
 * Resend slot accounting in app/lib/email/domain-slots.server.js stays honest —
 * see --help output for the ordering.
 *
 * Usage:
 *   node scripts/seed-internal-tenant.mjs --dry-run
 *   node scripts/seed-internal-tenant.mjs --owner-email you@growzar.com
 *   node scripts/seed-internal-tenant.mjs --owner-email you@growzar.com \
 *     --sender-email hello@notifications.growzar.com --timezone Asia/Karachi
 */
import prisma from "../app/db.server.js";
import {
  INTERNAL_SHOP,
  INTERNAL_WORKSPACE_NAME,
} from "../app/lib/internal/tenant.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dryRun = process.argv.includes("--dry-run");
const ownerEmail = String(arg("owner-email", "")).trim().toLowerCase();
const senderEmail = String(arg("sender-email", "")).trim().toLowerCase();
const websiteUrl = String(arg("website-url", "https://growzar.com")).trim();
const timezone = String(arg("timezone", "UTC")).trim();

const steps = [];
function plan(label, fn) {
  steps.push({ label, fn });
}

async function main() {
  const [account, settings, shopPlan, owner] = await Promise.all([
    prisma.account.findUnique({ where: { key: INTERNAL_SHOP } }),
    prisma.shopSettings.findUnique({ where: { shop: INTERNAL_SHOP } }),
    prisma.shopPlan.findUnique({ where: { shop: INTERNAL_SHOP } }),
    ownerEmail
      ? prisma.user.findUnique({ where: { email: ownerEmail } })
      : Promise.resolve(null),
  ]);

  if (ownerEmail && !owner) {
    console.error(
      `No user with the address ${ownerEmail}.\n` +
        `Sign up at /signup with it first, then re-run — this script attaches ` +
        `console access to an existing login rather than creating one.`,
    );
    process.exitCode = 1;
    return;
  }

  // ── Account ──────────────────────────────────────────────────────────────
  if (!account) {
    plan(`create Account "${INTERNAL_SHOP}" (kind: direct)`, () =>
      prisma.account.create({
        data: {
          key: INTERNAL_SHOP,
          name: INTERNAL_WORKSPACE_NAME,
          kind: "direct",
        },
      }),
    );
  } else if (account.kind !== "direct") {
    // Left alone rather than corrected: kind drives the shop-health branch, and
    // silently rewriting it would change how a live workspace is probed.
    console.warn(
      `Account "${INTERNAL_SHOP}" exists with kind="${account.kind}", expected "direct". ` +
        `Not changing it — shop-health branches on this field. Fix it deliberately if wrong.`,
    );
  }

  // ── ShopSettings ─────────────────────────────────────────────────────────
  // The one row whose absence fails silently, so it is created with everything
  // the send path reads. An existing row is left as-is: whoever edited it in
  // the console meant it.
  if (!settings) {
    plan("create ShopSettings (sender, timezone, quiet hours, active)", () =>
      prisma.shopSettings.create({
        data: {
          shop: INTERNAL_SHOP,
          senderName: INTERNAL_WORKSPACE_NAME,
          senderEmail,
          replyTo: ownerEmail || senderEmail,
          websiteUrl,
          storeTimezone: timezone,
          // Onboarding is a Shopify-install concept; mark it finished so the
          // console does not prompt for steps that cannot be completed here.
          onboardingStep: 2,
          isActive: true,
        },
      }),
    );
  } else {
    console.log("ShopSettings already exists — left untouched.");
  }

  // ── ShopPlan ─────────────────────────────────────────────────────────────
  if (!shopPlan) {
    plan("create ShopPlan (comped, no expiry)", () =>
      prisma.shopPlan.create({
        data: {
          shop: INTERNAL_SHOP,
          planKey: "comped",
          isComped: true,
          compedReason: "Growzar internal messaging tenant",
          // No compedUntil: an expiring comp would start blocking internal
          // sends on a date nobody is watching for.
          compedUntil: null,
        },
      }),
    );
  } else if (!shopPlan.isComped) {
    plan("mark ShopPlan comped", () =>
      prisma.shopPlan.update({
        where: { shop: INTERNAL_SHOP },
        data: { isComped: true, compedUntil: null },
      }),
    );
  }

  // ── Membership ───────────────────────────────────────────────────────────
  if (owner) {
    const target = account || (await prisma.account.findUnique({ where: { key: INTERNAL_SHOP } }));
    const existing = target
      ? await prisma.membership.findUnique({
          where: { userId_accountId: { userId: owner.id, accountId: target.id } },
        })
      : null;

    if (!existing) {
      plan(`grant ${ownerEmail} owner access`, async () => {
        // Resolved at run time: on a first seed the Account does not exist yet
        // when the plan is built.
        const acct = await prisma.account.findUnique({ where: { key: INTERNAL_SHOP } });
        return prisma.membership.create({
          data: { userId: owner.id, accountId: acct.id, role: "owner" },
        });
      });
    } else {
      console.log(`${ownerEmail} already has access (role: ${existing.role}).`);
    }
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  if (!steps.length) {
    console.log("\nNothing to do — the internal tenant is already seeded.");
    reportNextSteps(settings);
    return;
  }

  console.log(`\n${dryRun ? "Would apply" : "Applying"} ${steps.length} change(s):`);
  for (const s of steps) console.log("  - " + s.label);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  for (const s of steps) await s.fn();
  console.log("\nDone.");
  reportNextSteps(settings);
}

function reportNextSteps(settings) {
  const done = settings?.domainVerified;
  console.log("\nNext:");
  if (!done) {
    console.log(
      "  1. Sign in to the workspace and verify the internal sending domain in\n" +
        "     Settings. Until it is verified, resolveFrom() falls back to the SHARED\n" +
        "     domain every unverified merchant sends from, and internal bounces would\n" +
        "     damage their deliverability too.",
    );
  }
  console.log("  2. Build and publish a flow with trigger \"api_event\" and a journeyKey.");
  console.log("  3. Set INTERNAL_APP_SECRET_<APP> for each calling app.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
