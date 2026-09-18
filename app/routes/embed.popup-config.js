/**
 * Popup configuration for a website embed. The site key says which popup;
 * the page's Origin must be one of the merchant's listed domains.
 */
import { resolveEmbedRequest, recordEmbedSeen, embedCors } from "../lib/popup/embed.server.js";
import { popupConfigPayload } from "../lib/popup/config.server.js";
import { hit, clientIp } from "../lib/security/rate-limit.server.js";

// One page view fetches this once, so a browser never comes close. It is a
// public endpoint that costs two database reads, so it gets a ceiling like
// every other one.
const IP_LIMIT = 120;
const IP_WINDOW_MS = 60 * 1000;

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (!hit(`embed:config:${clientIp(request)}`, IP_LIMIT, IP_WINDOW_MS).allowed) {
    return new Response(JSON.stringify({ enabled: false }), {
      status: 429,
      headers: { ...embedCors(request.headers.get("origin") || ""), "Cache-Control": "no-store" },
    });
  }
  const r = await resolveEmbedRequest(request, url.searchParams.get("site"));
  if (!r.ok) {
    // Same body whatever the reason — the page just shows nothing. The reason
    // goes to the console so a merchant testing their install can see it.
    if (r.reason === "wrong_domain" || r.reason === "no_domains") {
      console.warn(`[embed] popup refused — ${r.reason}${r.host ? ` host=${r.host}` : ""}`);
    }
    return new Response(JSON.stringify({ enabled: false }), {
      status: 200,
      headers: { ...embedCors(request.headers.get("origin") || ""), "Cache-Control": "no-store" },
    });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: embedCors(r.origin) });
  await recordEmbedSeen(r.settings, r.host);
  const payload = await popupConfigPayload(r.settings, { isShopify: false });
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...embedCors(r.origin), "Cache-Control": "private, max-age=60" },
  });
};
