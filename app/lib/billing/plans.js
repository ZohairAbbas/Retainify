/**
 * Plan/tier definitions — the single source of truth for limits and features.
 *
 * Shared with the UI (no `.server` suffix) so the plans page renders from the
 * same table the gates enforce. Keep it serialisable: `Infinity` survives the
 * loader boundary as `null` in JSON, so use UNLIMITED and the helpers below
 * rather than comparing against Infinity directly on the client.
 *
 * IMPORTANT — these must stay in sync with the plans configured in the Shopify
 * Partner Dashboard (Distribution → Manage listing → Pricing content). Shopify
 * owns pricing and charging; this table only mirrors it for gating and display.
 * `handle` must match the Dashboard plan handle exactly — it arrives back as the
 * `plan_handle` URL parameter after a merchant approves a charge.
 */

/** Sentinel for "no limit". Chosen over Infinity so it round-trips through JSON. */
export const UNLIMITED = -1;

export const PLAN_KEYS = ["free", "starter", "growth"];

export const PLANS = {
  free: {
    key: "free",
    handle: "free",
    name: "Free",
    price: 0,
    limits: { contacts: 250, emails: 500, segments: 1, flows: 1 },
    features: [],
  },
  starter: {
    key: "starter",
    handle: "starter",
    name: "Starter",
    price: 4.99,
    limits: { contacts: 1000, emails: 5000, segments: 5, flows: 3 },
    features: ["no_branding", "custom_domain"],
  },
  growth: {
    key: "growth",
    handle: "growth",
    name: "Growth",
    price: 14.99,
    limits: {
      contacts: 5000,
      emails: 25000,
      segments: UNLIMITED,
      flows: UNLIMITED,
    },
    features: ["no_branding", "custom_domain", "whatsapp"],
  },
};

/**
 * `comped` is not a purchasable plan — it's the grandfathering state for shops
 * that installed before billing existed. It resolves to the highest tier's
 * limits, and `isComped` short-circuits the caps entirely in getEntitlement().
 */
export const COMPED_PLAN_KEY = "comped";

/** Plans shown on the pricing page, cheapest first. */
export const PUBLIC_PLANS = PLAN_KEYS.map((k) => PLANS[k]);

/** Resolve a plan record by key, falling back to free for unknown/comped keys. */
export function getPlan(planKey) {
  if (planKey === COMPED_PLAN_KEY) return PLANS.growth;
  return PLANS[planKey] || PLANS.free;
}

/** True when `limit` represents no cap. */
export function isUnlimited(limit) {
  return limit === UNLIMITED || limit === null || limit === Infinity;
}

/**
 * Human-readable limit for UI. Returns "Unlimited" for uncapped values.
 * @param {number} limit
 */
export function formatLimit(limit) {
  return isUnlimited(limit) ? "Unlimited" : limit.toLocaleString();
}

/**
 * Map a Shopify plan handle (from the `plan_handle` redirect param) to a local
 * planKey. Handles are stable across display-name edits, unlike subscription
 * names — prefer this over name matching. Returns null when unrecognised so the
 * caller can fall back rather than guessing.
 * @param {string} handle
 */
export function planKeyFromHandle(handle) {
  if (!handle) return null;
  const needle = String(handle).trim().toLowerCase();
  const match = PLAN_KEYS.find((k) => PLANS[k].handle === needle);
  return match || null;
}

/**
 * Fallback mapping from a Shopify subscription *display name* to a planKey.
 *
 * ⚠️ FRAGILE: this breaks silently if a plan is renamed in the Partner
 * Dashboard. It exists only as a reconciliation fallback when `plan_handle`
 * isn't available (e.g. a periodic sync rather than the post-approval redirect).
 * Callers MUST treat null as "unknown, keep previous plan" — never as "free".
 * @param {string} name
 */
export function planKeyFromSubscriptionName(name) {
  if (!name) return null;
  const needle = String(name).trim().toLowerCase();
  const match = PLAN_KEYS.find(
    (k) =>
      PLANS[k].name.toLowerCase() === needle ||
      PLANS[k].handle === needle ||
      // Tolerate Dashboard names like "Retainify Growth" / "Growth Plan".
      needle.includes(PLANS[k].handle),
  );
  return match || null;
}
