// Shared trigger display config — used by flows list, builder, and automations.
//
// `commerce: true` marks a trigger that can only ever fire on a workspace with
// a connected store: nothing writes an abandoned cart or an order without one.
// Offering it to a direct workspace would let someone build and publish a flow
// that silently never enrols anyone. Use triggersFor(isShopify) when rendering
// a picker; TRIGGER_CONFIG itself stays complete so existing flows still render
// their own trigger's label.

export const TRIGGER_CONFIG = {
  customer_created: {
    label: "Subscribed to Marketing",
    tint: "trigger",
    icon: "Users",
    desc: "Starts when a new contact opts in.",
    subLabel: "Lifecycle",
  },
  cart_abandoned: {
    commerce: true,
    label: "Cart Abandoned",
    tint: "sms",
    icon: "Cart",
    desc: "Starts when a cart sits idle for 60 minutes.",
    subLabel: "Cart",
  },
  order_placed: {
    commerce: true,
    label: "Order Placed",
    tint: "email",
    icon: "Heart",
    desc: "Starts when a customer completes checkout.",
    subLabel: "Order",
  },
  win_back: {
    commerce: true,
    label: "Inactive 90 days",
    tint: "delay",
    icon: "Refresh",
    desc: "Starts when a customer has not purchased in 90 days.",
    subLabel: "Lifecycle",
  },
  segment_entered: {
    label: "Entered a segment",
    tint: "segment",
    icon: "Venn",
    desc: "Starts when a contact newly matches a segment you choose.",
    subLabel: "Segment match",
    requiresSegment: true,
  },
  // Not an automation. A broadcast sends once to an audience resolved at send
  // time, then stops. It lives in the same model so it inherits the editor,
  // renderer, queue and analytics, but it is presented separately in the UI
  // because "send this now" and "run this whenever X happens" are different
  // jobs to the person doing them.
  broadcast: {
    label: "One-off broadcast",
    tint: "email",
    icon: "Send",
    desc: "Sends once to the audience you choose, now or at a scheduled time.",
    subLabel: "Sends once",
    isBroadcast: true,
  },
};

/**
 * Triggers a workspace can actually choose.
 * @param {boolean} isShopify
 */
export function triggersFor(isShopify) {
  return Object.fromEntries(
    Object.entries(TRIGGER_CONFIG).filter(([, cfg]) => isShopify || !cfg.commerce),
  );
}

export const STATUS_PILL = {
  draft: "draft",
  published: "active",
  paused: "paused",
  archived: "archived",
};

export function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)} days ago`;
  return new Date(date).toLocaleDateString();
}
