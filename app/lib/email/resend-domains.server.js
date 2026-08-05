/**
 * Resend Domains API adapter.
 *
 * Thin wrapper for the self-serve custom sending-domain flow (Mode A). Merchants
 * add their own domain, get DNS records to configure, and once Resend verifies
 * them we send email as their address instead of our shared one.
 *
 * All calls use RESEND_API_KEY (already in env — no new secret). Custom domains
 * are created in one region with open + click tracking enabled so open/click
 * events keep firing for custom-domain shops (parity with the shared domain).
 *
 * Every function returns a normalized `{ ok, ... }` result and never throws, so
 * callers (loaders/actions/webhooks) can branch on `ok` — mirrors the other
 * email adapters (ses.server.js / resend.server.js).
 */
import { Resend } from "resend";

let _client = null;

function getClient() {
  if (!_client) {
    _client = new Resend(process.env.RESEND_API_KEY);
  }
  return _client;
}

// Tokyo — matches Resend's current egress for our mail and is closest to our
// PK/Gulf merchants. Override with RESEND_DOMAIN_REGION if ever needed.
const DOMAIN_REGION = process.env.RESEND_DOMAIN_REGION || "ap-northeast-1";
// Subdomain used to rewrite links / host the open pixel. Adds one CNAME to the
// records the merchant configures, in exchange for open/click tracking.
const TRACKING_SUBDOMAIN = "link";

/**
 * Create a custom sending domain in Resend.
 * @param {string} name - the bare domain, e.g. "theirbrand.com"
 * @returns {Promise<{ ok: true, id: string, status: string, records: any[] } | { ok: false, error: string }>}
 */
export async function createDomain(name) {
  try {
    const { data, error } = await getClient().domains.create({
      name,
      region: DOMAIN_REGION,
      openTracking: true,
      clickTracking: true,
      trackingSubdomain: TRACKING_SUBDOMAIN,
    });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      id: data?.id ?? "",
      status: data?.status ?? "pending",
      records: data?.records ?? [],
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Trigger asynchronous verification for a domain the merchant has configured DNS
 * for. Status transitions arrive via the `domain.updated` webhook (or a later get).
 * @param {string} id - Resend domain UUID
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function verifyDomain(id) {
  try {
    const { error } = await getClient().domains.verify(id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Fetch current domain state — used by the manual "Check now" fallback.
 * @param {string} id - Resend domain UUID
 * @returns {Promise<{ ok: true, status: string, records: any[] } | { ok: false, error: string }>}
 */
export async function getDomain(id) {
  try {
    const { data, error } = await getClient().domains.get(id);
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      status: data?.status ?? "",
      records: data?.records ?? [],
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Delete a domain (merchant removes it / reclaim a slot).
 * @param {string} id - Resend domain UUID
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function deleteDomain(id) {
  try {
    const { error } = await getClient().domains.remove(id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
