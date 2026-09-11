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
import { encryptSecret, decryptSecret } from "../crypto/secrets.server.js";
import { syncTemplates } from "./templates.server.js";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

/**
 * Exchange the Embedded Signup `code` for a long-lived access token.
 *
 * Meta returns a non-expiring business token to an approved Tech Provider and a
 * ~60-day token otherwise, and the two are indistinguishable apart from
 * `expires_in`. Recording the expiry is what lets the app say "this connection
 * lapses on the 3rd" instead of every send simply beginning to fail.
 *
 * @param {string} code
 * @returns {Promise<{ ok: boolean, accessToken?: string, expiresAt?: Date|null, error?: string }>}
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
    // expires_in is seconds, and absent entirely for a non-expiring token.
    const ttl = Number(json.expires_in);
    return {
      ok: true,
      accessToken: json.access_token,
      expiresAt: Number.isFinite(ttl) && ttl > 0 ? new Date(Date.now() + ttl * 1000) : null,
    };
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
 * Subscribe our Meta app to a merchant's WABA.
 *
 * Without this call the webhook at /webhooks/whatsapp receives nothing for this
 * shop — Meta delivers status (delivered/read/failed), inbound messages and
 * template-approval events only to apps subscribed to that specific WABA. Sends
 * still work, which is what makes the omission so easy to miss: every message
 * goes out and every metric stays at zero, STOP is never honoured, and a
 * template stays PENDING locally forever.
 *
 * @param {string} accessToken
 * @param {string} wabaId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function subscribeAppToWaba(accessToken, wabaId) {
  if (!wabaId) return { ok: false, error: "missing wabaId" };

  // Route this account's events to Retainify by name rather than relying on the
  // app's own callback URL. The app-wide callback is set for another product,
  // and changing it would redirect that product's traffic; a per-account
  // override (Meta: "Webhook overrides") moves only the accounts connected here.
  //
  // Refuse rather than fall back to a plain subscription when this can't be
  // built: a plain one "succeeds" and delivers every event to the other
  // product, which is exactly the silent failure this exists to end.
  const callback = webhookCallbackUrl();
  const verifyToken = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").trim();
  if (!callback || !verifyToken) {
    return {
      ok: false,
      error:
        "Can't route WhatsApp events to Retainify: SHOPIFY_APP_URL and WHATSAPP_WEBHOOK_VERIFY_TOKEN must both be set on the server.",
    };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`;
  try {
    // Meta verifies the override URL with a GET challenge before accepting it,
    // answered by the loader in routes/webhooks.whatsapp.jsx with this token.
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ override_callback_uri: callback, verify_token: verifyToken }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return { ok: false, error: json?.error?.error_user_msg || json?.error?.message || `HTTP ${res.status}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // Trust the account's recorded state, not the POST's reply. A success that
  // did not record the override would look connected and deliver nothing here.
  const check = await readOverride(accessToken, wabaId, callback);
  if (!check.ok) return check;
  return { ok: true, callback };
}

/**
 * Where this deployment receives WhatsApp events.
 * @returns {string} "" when the app has no public URL configured.
 */
export function webhookCallbackUrl(env = process.env) {
  const base = String(env.SHOPIFY_APP_URL || env.APP_PUBLIC_URL || "")
    .trim()
    .replace(/\/+$/, "");
  return base ? `${base}/webhooks/whatsapp` : "";
}

/**
 * Confirm Meta holds an override on this account pointing at `callback`.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function readOverride(accessToken, wabaId, callback) {
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error?.message || `HTTP ${res.status}` };
    const routed = (json?.data || []).some((app) => app?.override_callback_uri === callback);
    return routed
      ? { ok: true }
      : {
          ok: false,
          error: `Meta accepted the subscription but isn't routing this account's events to ${callback}.`,
        };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Re-run the WABA subscription for an already-connected shop. Backs the
 * "Retry webhook subscription" action, and repairs shops connected before this
 * call existed — every one of which has a live send path and a dead webhook.
 *
 * @param {string} shop
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function resubscribeWebhooks(shop) {
  const account = await prisma.whatsappAccount.findUnique({ where: { shop } });
  if (!account || account.status !== "connected" || !account.wabaId) {
    return { ok: false, error: "no connected WhatsApp account for shop" };
  }
  let accessToken;
  try {
    accessToken = decryptSecret(account.accessTokenEnc);
  } catch (err) {
    return { ok: false, error: `token decrypt failed: ${err.message}` };
  }

  const res = await subscribeAppToWaba(accessToken, account.wabaId);
  await prisma.whatsappAccount
    .update({
      where: { shop },
      data: {
        webhooksSubscribedAt: res.ok ? new Date() : null,
        lastError: res.ok ? "" : String(res.error || "").slice(0, 500),
      },
    })
    .catch(() => {});
  return res;
}

/**
 * Full provisioning: exchange code, resolve phone number, store encrypted token.
 * @param {{ shop: string, code: string, wabaId: string, businessId?: string }} input
 * @returns {Promise<{ ok: boolean, account?: object, error?: string, warning?: string,
 *   templatesSynced?: number, templateSyncError?: string }>}
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

  // Deliberately not fatal. A shop whose subscription call fails still has a
  // working send path, and refusing the whole connection would leave it with
  // nothing at all. It is recorded instead, so the page can say plainly that
  // delivery reporting and STOP handling are off until it is retried.
  const subRes = await subscribeAppToWaba(tokenRes.accessToken, wabaId);
  const subscribedAt = subRes.ok ? new Date() : null;
  const warning = subRes.ok
    ? undefined
    : `Connected, but we couldn't subscribe to WhatsApp events: ${subRes.error}. Delivery reports, replies and STOP opt-outs won't be recorded until this succeeds.`;

  const shared = {
    wabaId,
    businessId,
    phoneNumberId: phoneRes.phoneNumberId,
    displayPhoneNumber: phoneRes.displayPhoneNumber,
    accessTokenEnc,
    tokenExpiresAt: tokenRes.expiresAt ?? null,
    status: "connected",
    connectedAt: new Date(),
    webhooksSubscribedAt: subscribedAt,
    lastError: subRes.ok ? "" : String(subRes.error || "").slice(0, 500),
  };

  const account = await prisma.whatsappAccount.upsert({
    where: { shop },
    create: { shop, ...shared },
    update: shared,
  });

  // Pull the WABA's existing templates straight away. A merchant who has just
  // connected already has approved templates at Meta; leaving the list empty
  // until they find the Sync button reads as "this account has no templates",
  // and every downstream picker (flows, campaigns) is empty for the same reason.
  // Non-fatal on purpose — the connection itself succeeded either way.
  const syncRes = await syncTemplates(shop).catch((err) => ({ ok: false, error: err.message }));

  return {
    ok: true,
    account,
    warning,
    templatesSynced: syncRes.ok ? syncRes.synced : undefined,
    templateSyncError: syncRes.ok ? undefined : syncRes.error,
  };
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
