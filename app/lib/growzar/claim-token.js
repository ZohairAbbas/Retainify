/**
 * The "Open in Growzar" claim token (D-10, API-CONTRACT §10).
 *
 * A JWT, HS256 with GROWZAR_SIGNING_SECRET, that lives five minutes and is
 * single-use by `jti` (Growzar enforces the single use). It is minted only from
 * a Shopify session this app has already verified — see
 * routes/app.growzar.claim.jsx — so ownership is proven by the app and the
 * merchant never types or pastes anything.
 *
 * Built on node:crypto rather than a JWT library: none is a direct dependency
 * here, HS256 is thirty lines, and the claim set is fixed by the contract.
 * Verified against Growzar's jose-based verifier (see the Phase 1 report).
 *
 * The token is never logged. Growzar receives it in a URL fragment
 * (`/claim#token=…`), which does not reach any server log.
 */
import { createHmac, randomUUID } from "node:crypto";

export const CLAIM_TOKEN_TTL_SECONDS = 300;
export const CLAIM_ISSUER = "retainify";
export const CLAIM_AUDIENCE = "growzar";

const b64url = (input) => Buffer.from(input).toString("base64url");

/**
 * @param {{
 *   secret: string,
 *   shop: string,
 *   shopifyUserId: string,   // gid://shopify/StaffMember/<id>
 *   email: string,
 *   isStoreOwner: boolean,
 *   locale?: string|null,
 *   now?: number,            // ms, for tests
 *   jti?: string,
 * }} claims
 * @returns {{ token: string, jti: string, expiresAt: Date }}
 */
export function mintClaimToken({ secret, shop, shopifyUserId, email, isStoreOwner, locale = null, now = Date.now(), jti = randomUUID() }) {
  if (!secret) throw new Error("mintClaimToken: no signing secret");
  const iat = Math.floor(now / 1000);
  const payload = {
    iss: CLAIM_ISSUER,
    aud: CLAIM_AUDIENCE,
    shop,
    shopifyUserId,
    email,
    isStoreOwner: isStoreOwner === true,
    ...(locale ? { locale } : {}),
    jti,
    iat,
    exp: iat + CLAIM_TOKEN_TTL_SECONDS,
  };
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return { token: `${head}.${body}.${sig}`, jti, expiresAt: new Date((iat + CLAIM_TOKEN_TTL_SECONDS) * 1000) };
}

/** Where the browser is sent. A fragment, never a query string (§10). */
export function claimUrl(growzarUrl, token) {
  return `${growzarUrl}/claim#token=${encodeURIComponent(token)}`;
}
