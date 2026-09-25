/**
 * POST /app/growzar/claim — mint an "Open in Growzar" claim token (D-10, §10).
 *
 * Only for a request from the embedded Shopify admin: authenticate.admin
 * verifies the App Bridge session token (signature, audience = our API key,
 * expiry, and the shop in `dest`), and the token is then exchanged with Shopify
 * for the staff member's identity — see lib/growzar/staff-identity.server.js.
 * A direct (non-Shopify) login proves a Retainify user, not a store, so it gets
 * no token.
 *
 * Returns { url } — Growzar's /claim with the token in the fragment. The token
 * and the URL are never logged.
 */
import { authenticate } from "../shopify.server.js";
import { looksLikeShopify } from "../lib/auth/require.server.js";
import { growzarConfig } from "../lib/growzar/config.js";
import { mintClaimToken, claimUrl, CLAIM_TOKEN_TTL_SECONDS } from "../lib/growzar/claim-token.js";
import { identifyStaffMember, rawSessionToken } from "../lib/growzar/staff-identity.server.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const action = async ({ request }) => {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);

  if (!looksLikeShopify(request)) {
    return json({ error: "Open Retainify from your Shopify admin to connect it to Growzar." }, 409);
  }

  // Throws the library's own redirect/401 when the session token is invalid.
  const { session, sessionToken } = await authenticate.admin(request);

  const { url, signingSecret } = growzarConfig();
  if (!url || !signingSecret) {
    return json({ error: "Growzar is not set up on this app yet." }, 503);
  }

  const identity = await identifyStaffMember({
    shop: session.shop,
    idToken: rawSessionToken(request),
    expectedUserId: sessionToken?.sub,
  });
  if (!identity.ok) {
    console.warn(`[growzar] claim not minted for ${session.shop}: ${identity.reason}`);
    return json({ error: "Shopify could not confirm who you are. Reload the page and try again." }, 502);
  }

  const { token, expiresAt } = mintClaimToken({
    secret: signingSecret,
    shop: session.shop,
    shopifyUserId: identity.user.shopifyUserId,
    email: identity.user.email,
    isStoreOwner: identity.user.isStoreOwner,
    locale: identity.user.locale,
  });

  return json({
    url: claimUrl(url, token),
    expiresAt: expiresAt.toISOString(),
    ttlSeconds: CLAIM_TOKEN_TTL_SECONDS,
  });
};

export const loader = () => json({ error: "Use POST." }, 405);
