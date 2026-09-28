/**
 * Who is pressing "Open in Growzar" — answered by Shopify, not by us.
 *
 * The embedded app runs on an OFFLINE session (shopify.server.js does not set
 * useOnlineTokens), and an offline session carries no user: its email, userId
 * and accountOwner columns are empty. So the offline session can prove the
 * store but not the person, and the claim token needs both (§10).
 *
 * The person comes from Shopify's token exchange for an ONLINE access token,
 * using the session token (id_token) that authenticate.admin has just verified.
 * Shopify answers with the associated user — id, email, whether that email is
 * verified, whether they are the account owner, their locale. That is the same
 * data the library would store on an online session; we just do not store it.
 * The online access token in the response is discarded unread.
 *
 * Shopify's `sub` in the session token and the associated user's id must match,
 * or the exchange answered for someone else and nothing is minted.
 */

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const ID_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";
const ONLINE_TOKEN_TYPE = "urn:shopify:params:oauth:token-type:online-access-token";

/**
 * The raw session token authenticate.admin verified. App Bridge sends it as
 * the bearer header on fetches; a document load carries it as ?id_token=.
 */
export function rawSessionToken(request) {
  const header = request.headers.get("authorization") || "";
  if (header.slice(0, 7).toLowerCase() === "bearer ") return header.slice(7).trim();
  return new URL(request.url).searchParams.get("id_token") || "";
}

/**
 * @param {{ shop: string, idToken: string, expectedUserId: string, fetchImpl?: typeof fetch }} args
 * @returns {Promise<
 *   | { ok: true, user: { shopifyUserId: string, email: string, emailVerified: boolean, isStoreOwner: boolean, locale: string|null } }
 *   | { ok: false, reason: string }
 * >}
 */
export async function identifyStaffMember({ shop, idToken, expectedUserId, fetchImpl = fetch }) {
  if (!idToken) return { ok: false, reason: "no_session_token" };
  if (!expectedUserId) return { ok: false, reason: "no_user_in_session_token" };

  let response;
  try {
    response = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        grant_type: TOKEN_EXCHANGE_GRANT,
        subject_token: idToken,
        subject_token_type: ID_TOKEN_TYPE,
        requested_token_type: ONLINE_TOKEN_TYPE,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, reason: "shopify_unreachable" };
  }

  // The body holds an access token: never logged, only the status.
  if (!response.ok) return { ok: false, reason: `shopify_${response.status}` };

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "shopify_bad_payload" };
  }

  const u = body?.associated_user;
  if (!u || u.id == null) return { ok: false, reason: "no_associated_user" };
  if (String(u.id) !== String(expectedUserId)) return { ok: false, reason: "user_mismatch" };

  const email = typeof u.email === "string" ? u.email.trim().toLowerCase() : "";
  if (!email) return { ok: false, reason: "no_email" };

  return {
    ok: true,
    user: {
      shopifyUserId: `gid://shopify/StaffMember/${u.id}`,
      email,
      emailVerified: u.email_verified === true,
      // A collaborator (agency/partner account) is never the owner, whatever
      // else the payload says.
      isStoreOwner: u.account_owner === true && u.collaborator !== true,
      locale: typeof u.locale === "string" && u.locale ? u.locale : null,
    },
  };
}
