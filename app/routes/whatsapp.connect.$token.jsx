/**
 * Start of the WhatsApp connect flow, in a top-level tab.
 *
 * The merchant arrives here from a signed link on the WhatsApp settings page
 * (see lib/whatsapp/connect-link.server.js for why the flow leaves the Shopify
 * admin at all), and is redirected straight on to Meta. Nothing is rendered:
 * the page exists only to turn a signed token into a dialog URL, so the
 * merchant sees one tab open and Meta's own screen appear in it.
 *
 * Deliberately unauthenticated. A tab outside the Shopify admin carries no app
 * session, and requiring one would bounce the merchant back into the embedded
 * frame this flow exists to escape. The token is the credential.
 */
import { redirect } from "react-router";
import { verifyConnectToken, buildConnectDialogUrl } from "../lib/whatsapp/connect-link.server.js";
import { hit, clientIp } from "../lib/security/rate-limit.server.js";

export const loader = async ({ params, request }) => {
  // Unauthenticated and public: rate limit before spending anything on it.
  const ip = clientIp(request);
  if (!hit(`waconnect:ip:${ip}`, 20, 10 * 60 * 1000).allowed) {
    return new Response("Too many attempts. Try again in a few minutes.", { status: 429 });
  }

  const check = verifyConnectToken(params.token);
  if (!check.ok) return problem(check.error);

  const dialog = buildConnectDialogUrl(params.token);
  if (!dialog.ok) return problem(dialog.error);

  return redirect(dialog.url);
};

/**
 * A plain page rather than a thrown error: this tab is the merchant's whole
 * view of the flow, and an error boundary here would tell them nothing about
 * what to do next.
 */
function problem(message) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>WhatsApp connection</title>
     <div style="font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.5rem">
       <h1 style="font-size:1.25rem;margin:0 0 .75rem">This connection link didn't work</h1>
       <p style="color:#444;margin:0 0 1rem">${escapeHtml(message)}</p>
       <p style="color:#666;font-size:.9rem;margin:0">You can close this tab and start again from the WhatsApp page in your Retainify admin.</p>
     </div>`,
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
