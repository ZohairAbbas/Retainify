import { requireAccount, requireShopifyAdmin } from "../lib/auth/require.server.js";
import { startSync, getSyncProgress } from "../lib/contacts/shopifyCustomerSync.server.js";

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const sync = await getSyncProgress(shop);
  return { sync };
};

export const action = async ({ request }) => {
  // Not requireAccount: this pulls customers out of the Shopify Admin API, so a
  // workspace with no connected store has nothing to sync from. The UI hides
  // the button; this is the backstop for a stale page or a direct POST.
  const { shop } = await requireShopifyAdmin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "start");
  if (intent === "start") {
    const includeNonOptIn = String(fd.get("includeNonOptIn") || "0") === "1";
    const result = await startSync(shop, { includeNonOptIn });
    const sync = await getSyncProgress(shop);
    return { ok: result.started, reason: result.reason || null, sync };
  }
  return { ok: false };
};
