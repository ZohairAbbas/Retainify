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

/**
 * The scheduling link behind the "Book an onboarding call" step.
 *
 * Hardcoded rather than env-only because an unset env var is what made this
 * step ship as a disabled "Scheduling link coming soon" button — the last
 * thing a new merchant saw in onboarding, and a step the checklist could never
 * resolve. The env var still overrides, so a staging deploy or a different
 * specialist's calendar needs no code change.
 *
 * If this is ever emptied, the call step degrades to a Skip-only panel (see
 * CallPanel) rather than offering a link to nowhere.
 */
export const DEFAULT_ONBOARDING_CALL_URL =
  "https://calendly.com/preventify/retainify-onboarding";

/**
 * Resolve the scheduling link. Takes the env value explicitly rather than
 * reading process.env, because this module is imported by the client bundle.
 *
 * Returns "" when there is no link anywhere, which is the only falsy value the
 * UI has to handle — the old sentinel "#" looked like a URL to every check.
 */
export function resolveCallUrl(envValue) {
  const url = String(envValue || "").trim() || DEFAULT_ONBOARDING_CALL_URL;
  if (!/^https?:\/\//i.test(url)) {
    // Not silently swapped for the default: a set-but-unusable value is a
    // misconfiguration, and quietly serving a different calendar than the one
    // the deploy asked for is worse than the step going quiet and saying so.
    if (url) console.warn(`[onboarding] ignoring non-http scheduling link: ${url}`);
    return "";
  }
  return url;
}

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
