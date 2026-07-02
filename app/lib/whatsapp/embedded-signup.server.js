/**
 * Meta Embedded Signup — token exchange + WABA provisioning.
 *
 * Called by the (deferred) OAuth callback route once the merchant completes the
 * Embedded Signup popup and we receive a short-lived authorization `code`. This
 * module exchanges it for a long-lived token, discovers the WABA + phone-number
 * IDs, and upserts a WhatsappAccount with the token encrypted at rest.
 *
 * The HTTP/redirect route is part of the deferred admin UI; this exchange logic
 * lives here now so it is unit-testable and ready to wire up at approval.
 */
import prisma from "../../db.server.js";
import { encryptSecret } from "../crypto/secrets.server.js";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

/**
 * Exchange the Embedded Signup `code` for a long-lived access token.
 * @param {string} code
 * @returns {Promise<{ ok: boolean, accessToken?: string, error?: string }>}
 */
export async function exchangeCodeForToken(code) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return { ok: false, error: "META_APP_ID / META_APP_SECRET not configured" };
  }
  if (!code) return { ok: false, error: "missing authorization code" };

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);

  try {
    const res = await fetch(url, { method: "GET" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true, accessToken: json.access_token };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Fetch the WABA id and its first phone number for a granted token.
 * `wabaId` is supplied by the Embedded Signup callback payload; we read the
 * phone number from it.
 * @param {string} accessToken
 * @param {string} wabaId
 * @returns {Promise<{ ok: boolean, phoneNumberId?: string, displayPhoneNumber?: string, error?: string }>}
 */
export async function fetchPhoneNumber(accessToken, wabaId) {
  if (!wabaId) return { ok: false, error: "missing wabaId" };
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/phone_numbers`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.error?.message || `HTTP ${res.status}` };
    }
    const first = json?.data?.[0];
    if (!first) return { ok: false, error: "WABA has no phone numbers" };
    return {
      ok: true,
      phoneNumberId: first.id,
      displayPhoneNumber: first.display_phone_number || "",
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Full provisioning: exchange code, resolve phone number, store encrypted token.
 * @param {{ shop: string, code: string, wabaId: string, businessId?: string }} input
 * @returns {Promise<{ ok: boolean, account?: object, error?: string }>}
 */
export async function connectWhatsappAccount({ shop, code, wabaId, businessId = "" }) {
  if (!shop) return { ok: false, error: "missing shop" };

  const tokenRes = await exchangeCodeForToken(code);
  if (!tokenRes.ok) {
    await recordFailure(shop, tokenRes.error);
    return { ok: false, error: tokenRes.error };
  }

  const phoneRes = await fetchPhoneNumber(tokenRes.accessToken, wabaId);
  if (!phoneRes.ok) {
    await recordFailure(shop, phoneRes.error);
    return { ok: false, error: phoneRes.error };
  }

  const accessTokenEnc = encryptSecret(tokenRes.accessToken);

  const account = await prisma.whatsappAccount.upsert({
    where: { shop },
    create: {
      shop,
      wabaId,
      businessId,
      phoneNumberId: phoneRes.phoneNumberId,
      displayPhoneNumber: phoneRes.displayPhoneNumber,
      accessTokenEnc,
      status: "connected",
      connectedAt: new Date(),
    },
    update: {
      wabaId,
      businessId,
      phoneNumberId: phoneRes.phoneNumberId,
      displayPhoneNumber: phoneRes.displayPhoneNumber,
      accessTokenEnc,
      status: "connected",
      connectedAt: new Date(),
      lastError: "",
    },
  });

  return { ok: true, account };
}

async function recordFailure(shop, error) {
  await prisma.whatsappAccount
    .upsert({
      where: { shop },
      create: { shop, status: "pending", lastError: String(error || "").slice(0, 500) },
      update: { lastError: String(error || "").slice(0, 500) },
    })
    .catch(() => {});
}
