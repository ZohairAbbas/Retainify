/**
 * Popup signup from a website embed. Establishes the workspace from the site
 * key and allowed domain, then runs exactly the same signup as a Shopify
 * storefront (lib/popup/signup.server.js).
 */
import { resolveEmbedRequest, embedCors } from "../lib/popup/embed.server.js";
import { processPopupSignup } from "../lib/popup/signup.server.js";

async function handle(request) {
  const url = new URL(request.url);
  const r = await resolveEmbedRequest(request, url.searchParams.get("site"));
  if (!r.ok) {
    return new Response(JSON.stringify({ ok: false }), { status: 403, headers: embedCors("") });
  }
  const headers = embedCors(r.origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  return processPopupSignup({ shop: r.shop, request, headers });
}

export const action = ({ request }) => handle(request);
// React Router sends OPTIONS (preflight) to the loader.
export const loader = ({ request }) => handle(request);
