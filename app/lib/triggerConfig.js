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
  // Enrolment comes from another Growzar app: it reports a lifecycle event
  // ("installed", "setup_completed"…) to /internal/event, and every published
  // flow subscribed to that (app, event) pair enrolls the person.
  //
  // `internalOnly` because the API only ever acts on the internal Growzar
  // tenant. Offered to any other workspace it would let someone publish a flow
  // that can never fire — the failure `commerce` exists to prevent, from the
  // other direction.
  api_event: {
    label: "App event",
    tint: "trigger",
    icon: "Trigger",
    desc: "Starts when a Growzar app reports an event, like an install.",
    subLabel: "Growzar app",
    requiresAppEvent: true,
    internalOnly: true,
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
 * @param {{ isInternal?: boolean }} [opts] whether this is the internal Growzar tenant
 */
export function triggersFor(isShopify, { isInternal = false } = {}) {
  return Object.fromEntries(
    Object.entries(TRIGGER_CONFIG).filter(
      ([, cfg]) => (isShopify || !cfg.commerce) && (isInternal || !cfg.internalOnly),
    ),
  );
}

/**
 * The lifecycle events every Growzar app is expected to send. Offered as
 * suggestions in the builder, and "uninstalled" carries a guarantee of its own
 * (see app/lib/internal/events.server.js). Not a whitelist — an app may send
 * events of its own, and a flow may subscribe to them.
 */
export const STANDARD_APP_EVENTS = [
  { value: "installed", label: "Installed the app" },
  { value: "setup_completed", label: "Finished setup" },
  { value: "inactive", label: "Went inactive" },
  { value: "uninstalled", label: "Uninstalled the app" },
];

/** Always exits every one of the sending app's flows for that person. */
export const UNINSTALL_EVENT = "uninstalled";

/**
 * Shape check for the app and event names sent to /internal/event, and for the
 * app/event a flow subscribes to. They are identifiers another codebase
 * hardcodes, so the grammar is deliberately narrow: lowercase, digits and
 * underscores.
 *
 * Rejects rather than repairs. Silently slugifying "Setup Completed" into
 * "setup_completed" on one side would leave the calling app posting the string
 * it was given and matching nothing, with nothing anywhere saying why. An error
 * at the moment of typing costs one correction; a silent fix costs a debugging
 * session in someone else's repo.
 *
 * @param {string} raw
 * @param {string} [label] what to call it in the error message
 * @returns {{ ok: true, key: string } | { ok: false, error: string }}
 */
export function validateExternalKey(raw, label = "Key") {
  const key = String(raw ?? "").trim();
  if (!key) return { ok: false, error: `${label} is required.` };
  if (key.length > 64) return { ok: false, error: `${label} must be 64 characters or fewer.` };
  if (!/^[a-z0-9_]+$/.test(key)) {
    return {
      ok: false,
      error: `${label} can use lowercase letters, numbers and underscores only — for example setup_completed.`,
    };
  }
  return { ok: true, key };
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
