/**
 * GET /api/v1/growzar/status — is Retainify installed on this shop, and what
 * can it do for Growzar this release (API-CONTRACT §11, D-03).
 *
 *   Authorization: Bearer <GROWZAR_PLATFORM_KEY>
 *   X-Growzar-Shop, X-Growzar-Timestamp, X-Growzar-Signature   (§2.1)
 *
 * `capabilities` lists the read feeds this build serves (Phase 5); Growzar opens
 * a section only for the verbs listed here.
 *
 * `installed` means Shopify has an offline session for the shop — the one
 * app/uninstalled deletes. That is our own record, not a live probe of Shopify
 * (see shop-health.server.js for why the two can disagree); a live probe costs
 * an Admin API call and can refresh a token, which a status poll should not do.
 */
import prisma from "../db.server.js";
import { authenticateGrowzarRequest, growzarError } from "../lib/growzar/platform-auth.js";
import { APP_VERSION } from "../lib/growzar/version.server.js";
import { GROWZAR_CAPABILITIES } from "../lib/growzar/capabilities.js";

export const loader = async ({ request }) => {
  const auth = authenticateGrowzarRequest(request);
  if (!auth.ok) return auth.response;

  let installed;
  try {
    const session = await prisma.session.findFirst({
      where: { shop: auth.shop, isOnline: false },
      select: { id: true },
    });
    installed = !!session;
  } catch (err) {
    console.error("[growzar] status lookup failed", err);
    return growzarError(500, "internal_error", "Could not read install state.");
  }

  return new Response(
    JSON.stringify({
      installed,
      appVersion: APP_VERSION,
      shop: auth.shop,
      capabilities: GROWZAR_CAPABILITIES,
      planRelevantFeatures: [],
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
};

export const action = () => growzarError(405, "bad_request", "Use GET.");
