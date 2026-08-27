// Shared onboarding/setup-guide task registry. Imported by both the server
// (state derivation in onboarding.server.js) and the client checklist UI, so it
// must stay framework-free — no React, no prisma, no server-only imports.
//
// Task kinds:
//  - essential: gates activation. Merchant can't reach the dashboard until all
//    essentials are done. Essentials are never skippable.
//  - optional:  encouraged but non-blocking; surfaced later via the Setup Guide.
//
// `platform` scopes a task to one kind of workspace:
//  - "shopify": needs a storefront (theme embed, on-site popup, the store link)
//  - "direct":  only makes sense without one (import your list from elsewhere)
//  - absent:    shown to everyone
// Use tasksFor(kind) rather than TASKS anywhere the list is shown or counted;
// a direct workspace being blocked on "enable the theme embed" would be an
// unresolvable dead end.
//
// Completion detection per task lives in onboarding.server.js:
//  - auto:   derived from real data (sender email set, popup enabled, journey exists)
//  - manual: stored in ShopSettings.onboardingProgress (store/embed/call)

export const TASKS = [
  {
    id: "store",
    title: "Connect your store",
    sub: "Confirm Retainify is on the right shop",
    time: "30 sec",
    optional: false,
    detect: "manual",
    panel: "store",
    platform: "shopify",
  },
  {
    id: "contacts",
    title: "Add your contacts",
    sub: "Import a CSV or add people by hand",
    time: "2 min",
    optional: false,
    detect: "auto",
    panel: "contacts",
    platform: "direct",
  },
  {
    id: "sender",
    title: "Set your sender details",
    sub: "The “From” name & address in every email",
    time: "1 min",
    optional: false,
    detect: "auto",
    panel: "sender",
  },
  {
    id: "domain",
    title: "Use your own domain (optional)",
    sub: "Send from your brand instead of the shared address",
    time: "5 min",
    optional: true,
    detect: "auto",
    panel: "domain",
  },
  {
    id: "embed",
    title: "Enable the on-site popup",
    sub: "Turn on the Retainify embed in your theme",
    time: "1 min",
    optional: false,
    detect: "manual",
    panel: "embed",
    platform: "shopify",
  },
  {
    id: "popup",
    title: "Publish your first popup",
    sub: "Start collecting emails from new visitors",
    time: "1 min",
    optional: true,
    detect: "auto",
    panel: "popup",
    platform: "shopify",
  },
  {
    id: "flow",
    title: "Launch your first flow",
    sub: "Cart recovery or a welcome series",
    time: "2 min",
    optional: true,
    detect: "auto",
    panel: "flow",
  },
  {
    id: "call",
    title: "Book an onboarding call",
    sub: "Get a specialist to review your setup",
    time: "20 min",
    optional: true,
    detect: "manual",
    panel: "call",
  },
];

/** Build the theme-editor deep link that highlights the Retainify app embed.
 *  Pure string helper — safe on client + server. */
export function themeEditorEmbedUrl(shop, apiKey) {
  return `https://${shop}/admin/themes/current/editor?context=apps&template=index&activateAppId=${apiKey}/popup`;
}

/**
 * The tasks that apply to one kind of workspace.
 * @param {"shopify"|"direct"} kind
 */
export function tasksFor(kind) {
  const k = kind === "shopify" ? "shopify" : "direct";
  return TASKS.filter((t) => !t.platform || t.platform === k);
}

export function essentialIdsFor(kind) {
  return tasksFor(kind).filter((t) => !t.optional).map((t) => t.id);
}

// Detection strategy is a property of the task itself, not of the workspace, so
// these stay global.
export const MANUAL_IDS = TASKS.filter((t) => t.detect === "manual").map((t) => t.id);
export const AUTO_IDS = TASKS.filter((t) => t.detect === "auto").map((t) => t.id);
