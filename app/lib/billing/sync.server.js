/**
 * Reconciles Shopify's subscription truth into our local ShopPlan read-model.
 *
 * Shopify App Pricing owns charging, trials, proration and dunning. We only
 * mirror the resulting subscription so feature gates have something cheap and
 * local to read.
 *
 * Verified against the installed SDK:
 *  - shopifyApp() sets future.unstable_managedPricingSupport = true internally
 *    (shopify-app-react-router/dist/cjs/server/shopify-app.js), which is what
 *    lets billing.check() run WITHOUT a `billing` config block. So
 *    app/shopify.server.js needs no changes.
 *  - billing.check() queries currentAppInstallation.activeSubscriptions, which
 *    is populated for App Pricing plans exactly as for Billing API ones.
 *  - No `applications_billing` scope is needed for this read.
 */
import prisma from "../../db.server.js";
import { planKeyFromHandle, planKeyFromSubscriptionName } from "./plans.js";

/** Re-check Shopify at most this often per shop. */
const SYNC_TTL_MS = 10 * 60 * 1000;

/**
 * Whether to accept TEST subscriptions as valid entitlement.
 *
 * ⚠️ The SDK's billing.check() defaults isTest to TRUE, and its filter is
 * `(isTest || !subscription.test)` — meaning with the default, a test charge
 * would unlock paid features on a live store. We therefore pass an explicit
 * value that defaults to FALSE (production-safe) and must be opted into.
 */
function acceptTestCharges() {
  // eslint-disable-next-line no-undef
  return process.env.SHOPIFY_BILLING_TEST === "true";
}

/**
 * Pull the shop's active subscription from Shopify and write it to ShopPlan.
 *
 * @param {object} billing - the `billing` object from authenticate.admin()
 * @param {string} shop
 * @param {object} [opts]
 * @param {string} [opts.planHandle] - `plan_handle` from the post-approval
 *   redirect. Preferred over display-name matching because handles are stable
 *   across Dashboard renames.
 * @param {boolean} [opts.force] - bypass the TTL (use on the welcome redirect).
 * @returns {Promise<object|null>} the updated ShopPlan row, or null on failure
 */
export async function syncSubscription(billing, shop, opts = {}) {
  const { planHandle = null, force = false } = opts;

  const existing = await prisma.shopPlan.findUnique({ where: { shop } });

  if (
    !force &&
    existing?.lastCheckedAt &&
    Date.now() - existing.lastCheckedAt.getTime() < SYNC_TTL_MS
  ) {
    return existing;
  }

  let result;
  try {
    // No `plans` filter → returns every active subscription. isTest explicit;
    // see acceptTestCharges() above.
    result = await billing.check({ isTest: acceptTestCharges() });
  } catch (err) {
    console.error(`[billing] check failed shop=${shop}`, err);
    // Never downgrade on a transient API failure — keep what we had.
    return existing;
  }

  const subscription = (result?.appSubscriptions || [])[0] || null;

  if (!subscription) {
    return applyNoSubscription(shop, existing);
  }

  // Prefer the stable handle; fall back to display-name matching.
  const resolved =
    planKeyFromHandle(planHandle) ||
    planKeyFromSubscriptionName(subscription.name);

  if (!resolved) {
    // Unknown plan name — almost certainly a Dashboard rename. Keep the shop on
    // its previous plan rather than de-entitling someone who is paying.
    console.error(
      `[billing] unmapped subscription name="${subscription.name}" shop=${shop} — keeping planKey=${existing?.planKey || "free"}`,
    );
  }

  const planKey = resolved || existing?.planKey || "free";

  const data = {
    planKey,
    subscriptionGid: subscription.id || "",
    subscriptionName: subscription.name || "",
    status: (subscription.status || "ACTIVE").toLowerCase(),
    currentPeriodEnd: subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd)
      : null,
    trialEndsAt: trialEnd(subscription),
    lastCheckedAt: new Date(),
  };

  return prisma.shopPlan.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}

/**
 * No active subscription. A comped shop stays comped (that's the whole point of
 * grandfathering); everyone else settles to free.
 */
async function applyNoSubscription(shop, existing) {
  const data = {
    subscriptionGid: "",
    subscriptionName: "",
    status: "expired",
    currentPeriodEnd: null,
    lastCheckedAt: new Date(),
    ...(existing?.isComped ? {} : { planKey: "free" }),
  };

  return prisma.shopPlan.upsert({
    where: { shop },
    create: { shop, planKey: "free", ...data },
    update: data,
  });
}

/** Derive trial end from createdAt + trialDays, when Shopify reports one. */
function trialEnd(subscription) {
  const days = Number(subscription?.trialDays || 0);
  if (!days || !subscription?.createdAt) return null;
  const start = new Date(subscription.createdAt);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Grandfather every currently-installed shop onto a comped plan.
 *
 * Run this ONCE AT CUTOVER, not at the start of the build — the app is publicly
 * listed, so the installed base keeps growing until billing goes live. Running
 * it at cutover closes the cohort at a known set.
 *
 * Idempotent: shops that already have a ShopPlan row are skipped.
 *
 * @param {number} [days] comp window length
 * @returns {Promise<{created:number, skipped:number, until:Date}>}
 */
export async function grandfatherExistingShops(days = 30) {
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const shops = await prisma.shopSettings.findMany({ select: { shop: true } });
  let created = 0;
  let skipped = 0;

  for (const { shop } of shops) {
    const existing = await prisma.shopPlan.findUnique({ where: { shop } });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.shopPlan.create({
      data: {
        shop,
        planKey: "comped",
        isComped: true,
        compedReason: "early adopter — pre-billing install",
        compedUntil: until,
      },
    });
    created++;
  }

  return { created, skipped, until };
}
