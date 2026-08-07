/**
 * Entitlement layer — the single seam every feature gate reads.
 *
 * Nothing outside this module should look at ShopPlan or UsageCounter directly.
 * Gates call hasFeature()/checkQuota(); the send paths call incrementUsage().
 *
 * SHADOW MODE: while BILLING_ENFORCE is not "true", checkQuota() and
 * hasFeature() still compute the real answer but report `enforced: false`, so
 * callers can log what *would* have been blocked without blocking anyone. Usage
 * counting runs regardless — that's the data we need to size the caps.
 */
import prisma from "../../db.server.js";
import { COMPED_PLAN_KEY, getPlan, isUnlimited } from "./plans.js";

/**
 * Master switch. Gates compute their verdict either way; this only decides
 * whether callers should act on it. Defaults OFF so shipping the layer can
 * never break a merchant before we've reviewed shadow-mode data.
 */
export function isEnforcementOn() {
  // eslint-disable-next-line no-undef
  return process.env.BILLING_ENFORCE === "true";
}

/** UTC month start for a date — the usage period boundary. */
export function periodStartFor(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

/**
 * Resolve a shop's effective entitlement.
 *
 * Comp expiry is evaluated HERE, at read time, rather than by a batch job — so
 * there's no window in which an elapsed comp still grants access. A comped row
 * whose compedUntil has passed falls back to whatever planKey it actually holds.
 *
 * @param {string} shop
 * @returns {Promise<{planKey:string, plan:object, limits:object, features:string[],
 *   isComped:boolean, compExpired:boolean, compedUntil:Date|null, status:string,
 *   enforced:boolean}>}
 */
export async function getEntitlement(shop) {
  const row = await prisma.shopPlan.findUnique({ where: { shop } });

  // No row = never synced. Treat as free; sync.server.js will create one.
  const planKey = row?.planKey || "free";
  const now = new Date();

  const compActive =
    !!row?.isComped && (!row.compedUntil || row.compedUntil > now);
  const compExpired = !!row?.isComped && !!row.compedUntil && row.compedUntil <= now;

  // A comped shop resolves to the top tier. An EXPIRED comp falls back to the
  // stored planKey — which for our grandfathered cohort is "comped" itself, so
  // normalise that to free rather than silently granting Growth forever.
  const effectiveKey = compActive
    ? COMPED_PLAN_KEY
    : planKey === COMPED_PLAN_KEY
      ? "free"
      : planKey;

  const plan = getPlan(effectiveKey);

  return {
    planKey: effectiveKey,
    plan,
    limits: plan.limits,
    features: plan.features,
    isComped: compActive,
    compExpired,
    compedUntil: row?.compedUntil || null,
    status: row?.status || "active",
    enforced: isEnforcementOn(),
  };
}

/**
 * Whether a shop's plan includes a feature flag ("custom_domain", "whatsapp",
 * "no_branding").
 *
 * NOTE for custom_domain: this grants ELIGIBILITY only. The account-wide 10-slot
 * Resend cap still applies on top — see canUseDomainSlot() in
 * ../email/domain-slots.server.js. The two failures need different merchant
 * messages ("upgrade to Starter" vs "at capacity"), so check them separately.
 *
 * @param {string} shop
 * @param {string} feature
 */
export async function hasFeature(shop, feature) {
  const ent = await getEntitlement(shop);
  // Comped shops get everything for the duration of their window.
  if (ent.isComped) return true;
  return ent.features.includes(feature);
}

/**
 * Read a usage counter against its limit.
 *
 * `exceeded` is the raw verdict (would this be over the cap?). `shouldBlock` is
 * the actionable one — it's only true when enforcement is on AND the shop isn't
 * comped. Callers should branch on `shouldBlock` and log on `exceeded`.
 *
 * @param {string} shop
 * @param {"emails"|"contacts"|"segments"|"flows"} metric
 * @param {number} [additional] units about to be consumed, counted toward the cap
 */
export async function checkQuota(shop, metric, additional = 0) {
  const ent = await getEntitlement(shop);
  const limit = ent.limits[metric];

  const used = await currentUsage(shop, metric);
  const projected = used + additional;

  const unlimited = isUnlimited(limit);
  const exceeded = !unlimited && projected > limit;

  return {
    metric,
    used,
    limit,
    unlimited,
    remaining: unlimited ? Infinity : Math.max(0, limit - used),
    exceeded,
    // Comped shops never block, and nothing blocks while in shadow mode.
    shouldBlock: exceeded && ent.enforced && !ent.isComped,
    planKey: ent.planKey,
    enforced: ent.enforced,
  };
}

/**
 * Current usage for a metric. Send metrics come from the period counter;
 * resource metrics (contacts/segments/flows) are counted live so they can't
 * drift from reality.
 * @param {string} shop
 * @param {string} metric
 */
export async function currentUsage(shop, metric) {
  if (metric === "emails") {
    const row = await prisma.usageCounter.findUnique({
      where: { shop_periodStart: { shop, periodStart: periodStartFor() } },
    });
    return row?.emailsSent || 0;
  }

  if (metric === "contacts") {
    // Billable contacts: live, subscribed, not soft-deleted. Unsubscribed and
    // bounced addresses are deliberately NOT billable.
    return prisma.contact.count({
      where: { shop, deletedAt: null, subscriptionStatus: "subscribed" },
    });
  }

  if (metric === "segments") {
    return prisma.segment.count({ where: { shop, deletedAt: null } });
  }

  if (metric === "flows") {
    return prisma.journey.count({ where: { shop, archivedAt: null } });
  }

  return 0;
}

const USAGE_FIELD = {
  emails: "emailsSent",
  push: "pushSent",
  whatsapp: "whatsappSent",
};

/**
 * Atomically increment a send counter for the current period.
 *
 * Called AFTER a successful send, so a failed send never burns quota. Never
 * throws — a counter failure must not take down the send path, so errors are
 * swallowed and logged. Under-counting is strictly better than dropping mail.
 *
 * @param {string} shop
 * @param {"emails"|"push"|"whatsapp"} metric
 * @param {number} [n]
 */
export async function incrementUsage(shop, metric, n = 1) {
  const field = USAGE_FIELD[metric];
  if (!field || !shop || n <= 0) return;

  const periodStart = periodStartFor();
  try {
    await prisma.usageCounter.upsert({
      where: { shop_periodStart: { shop, periodStart } },
      create: { shop, periodStart, [field]: n },
      update: { [field]: { increment: n } },
    });
  } catch (err) {
    console.error(`[billing] usage increment failed shop=${shop} metric=${metric}`, err);
  }
}

/**
 * Usage summary for the dashboard / plans page meter.
 * @param {string} shop
 */
export async function getUsageSummary(shop) {
  const ent = await getEntitlement(shop);
  const [emails, contacts] = await Promise.all([
    checkQuota(shop, "emails"),
    checkQuota(shop, "contacts"),
  ]);
  return { entitlement: ent, emails, contacts };
}
