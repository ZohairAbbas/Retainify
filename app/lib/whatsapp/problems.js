/**
 * What each WhatsApp readiness problem means and what its fix button says.
 * Client-safe (no server imports) — shared by the flow builder, the flows list
 * and the WhatsApp page. The problems themselves are computed by
 * whatsappReadiness() in ./readiness.server.js.
 */
export const WHATSAPP_PROBLEMS = {
  not_connected: {
    title: "WhatsApp isn't connected",
    body: "Connect a WhatsApp Business account before WhatsApp steps can send.",
    action: "Connect WhatsApp",
  },
  blocked: {
    title: "Meta is blocking WhatsApp sends",
    body: "Meta is refusing messages for this account. Fix it at Meta, then send a test from the WhatsApp page.",
    action: "Open WhatsApp settings",
  },
  disabled: {
    title: "The WhatsApp channel is switched off",
    body: "Your account is connected, but sending is turned off, so WhatsApp steps are skipped.",
    action: "Turn on WhatsApp",
  },
  no_templates: {
    title: "No approved templates yet",
    body: "WhatsApp can only start a conversation with a template Meta has approved. Create one, or sync the ones you made in Meta Business Manager.",
    action: "Create a template",
  },
};

/** The WhatsApp settings URL that brings the merchant back to `returnTo` after. */
export function whatsappSetupUrl(returnTo) {
  return returnTo ? `/app/whatsapp?return=${encodeURIComponent(returnTo)}` : "/app/whatsapp";
}

/** Only in-app flow pages are valid return targets — never an arbitrary URL. */
export function safeReturnPath(raw) {
  const v = String(raw || "");
  return /^\/app\/flows(\/[A-Za-z0-9_-]+)?$/.test(v) ? v : "";
}
