import { authenticate } from "../shopify.server.js";
import { startSync, getSyncProgress } from "../lib/contacts/shopifyCustomerSync.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const sync = await getSyncProgress(session.shop);
  return { sync };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "start");
  if (intent === "start") {
    const includeNonOptIn = String(fd.get("includeNonOptIn") || "0") === "1";
    const result = await startSync(session.shop, { includeNonOptIn });
    const sync = await getSyncProgress(session.shop);
    return { ok: result.started, reason: result.reason || null, sync };
  }
  return { ok: false };
};
