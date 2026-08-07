/**
 * Gate helpers — thin wrappers over entitlements for use in route loaders and
 * actions, so every gate behaves identically.
 *
 * Two shapes:
 *   requireFeature() / requireQuota() — for ACTIONS. Return an error payload to
 *     hand straight back to the client, or null when allowed.
 *   featureState() — for LOADERS. Never blocks; returns display state so a page
 *     can render a locked/upgrade view instead of its normal content.
 *
 * Everything respects shadow mode: while BILLING_ENFORCE is unset, requireX()
 * logs what it *would* have blocked and returns null (allow).
 */
import { checkQuota, getEntitlement, hasFeature } from "./entitlements.server.js";
import { getPlan, PLAN_KEYS, PLANS } from "./plans.js";

/** Human labels for upgrade copy. */
const FEATURE_LABEL = {
  custom_domain: "Custom sending domain",
  whatsapp: "WhatsApp",
  no_branding: "Branding removal",
};

const METRIC_LABEL = {
  emails: "monthly emails",
  contacts: "contacts",
  segments: "segments",
  flows: "flows",
};

/** Cheapest plan that includes `feature` — drives "upgrade to X" copy. */
export function cheapestPlanWith(feature) {
  const key = PLAN_KEYS.find((k) => PLANS[k].features.includes(feature));
  return key ? PLANS[key] : null;
}

/** Cheapest plan whose `metric` limit exceeds `needed`. */
export function cheapestPlanForQuota(metric, needed) {
  const key = PLAN_KEYS.find((k) => {
    const lim = PLANS[k].limits[metric];
    return lim === -1 || lim >= needed;
  });
  return key ? PLANS[key] : null;
}

/**
 * Guard an action behind a plan feature.
 * @returns {Promise<null|{ok:false, blocked:true, reason:string, feature:string,
 *   message:string, upgradeTo:string|null}>} null when allowed
 */
export async function requireFeature(shop, feature) {
  const allowed = await hasFeature(shop, feature);
  if (allowed) return null;

  const ent = await getEntitlement(shop);
  const target = cheapestPlanWith(feature);
  const label = FEATURE_LABEL[feature] || feature;

  if (!ent.enforced) {
    console.warn(
      `[billing:shadow] feature "${feature}" not on plan=${ent.planKey} shop=${shop} — allowed (enforcement off)`,
    );
    return null;
  }

  return {
    ok: false,
    blocked: true,
    reason: "feature_not_in_plan",
    feature,
    message: target
      ? `${label} is available on the ${target.name} plan.`
      : `${label} isn't available on your current plan.`,
    upgradeTo: target?.key || null,
  };
}

/**
 * Guard an action behind a usage limit.
 * @param {string} shop
 * @param {"emails"|"contacts"|"segments"|"flows"} metric
 * @param {number} [additional] units this action would consume
 */
export async function requireQuota(shop, metric, additional = 1) {
  const q = await checkQuota(shop, metric, additional);
  if (!q.exceeded) return null;

  if (!q.shouldBlock) {
    console.warn(
      `[billing:shadow] quota "${metric}" exceeded shop=${shop} used=${q.used} limit=${q.limit} plan=${q.planKey} — allowed (enforcement off or comped)`,
    );
    return null;
  }

  const target = cheapestPlanForQuota(metric, q.used + additional);
  const label = METRIC_LABEL[metric] || metric;

  return {
    ok: false,
    blocked: true,
    reason: "quota_exceeded",
    metric,
    used: q.used,
    limit: q.limit,
    message: target
      ? `You've reached your ${label} limit (${q.limit}). The ${target.name} plan raises it.`
      : `You've reached your ${label} limit (${q.limit}).`,
    upgradeTo: target?.key || null,
  };
}

/**
 * Loader-side display state for a feature. Never blocks — a page uses this to
 * decide whether to render its normal UI or a locked/upgrade panel.
 *
 * `locked` is true only when the feature is genuinely unavailable AND
 * enforcement is on, so shadow mode leaves every page fully usable.
 */
export async function featureState(shop, feature) {
  const ent = await getEntitlement(shop);
  const included = ent.isComped || ent.features.includes(feature);
  const target = cheapestPlanWith(feature);

  return {
    included,
    locked: !included && ent.enforced,
    enforced: ent.enforced,
    planKey: ent.planKey,
    planName: getPlan(ent.planKey).name,
    upgradeTo: target?.key || null,
    upgradeToName: target?.name || null,
    featureLabel: FEATURE_LABEL[feature] || feature,
  };
}

/**
 * Loader-side display state for a usage metric — powers meters and soft banners.
 * `atLimit` is informational; callers decide whether it blocks.
 */
export async function quotaState(shop, metric, additional = 0) {
  const q = await checkQuota(shop, metric, additional);
  const target = q.exceeded
    ? cheapestPlanForQuota(metric, q.used + Math.max(1, additional))
    : null;

  return {
    used: q.used,
    limit: q.limit,
    unlimited: q.unlimited,
    atLimit: q.exceeded,
    locked: q.shouldBlock,
    enforced: q.enforced,
    planKey: q.planKey,
    upgradeTo: target?.key || null,
    upgradeToName: target?.name || null,
  };
}
