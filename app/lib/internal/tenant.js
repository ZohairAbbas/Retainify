/**
 * The reserved workspace that Growzar's own lifecycle messaging runs in.
 *
 * Every table in the schema keys on `shop` as the tenant. Rather than
 * generalising that to a `tenantId` — which would touch every model, every
 * query and every worker for one internal consumer — internal messaging runs as
 * one more workspace, under a key no Shopify domain can collide with.
 *
 * It is a `direct` Account, the same kind produced by signing up on our own
 * domain, so `requireAccount` resolves it, the flow builder renders it, and the
 * commerce-only triggers hide themselves (see triggersFor in ../triggerConfig.js)
 * without any of those paths knowing this workspace is special.
 *
 * Seeded by scripts/seed-internal-tenant.mjs.
 */

/** Tenant key: the `shop` value on every internal row. */
export const INTERNAL_SHOP = "__growzar_internal__";

/** Display name for the workspace in the console. */
export const INTERNAL_WORKSPACE_NAME = "Growzar Internal";

/** Is this the internal tenant? For guards that must not fire on merchant data. */
export function isInternalShop(shop) {
  return shop === INTERNAL_SHOP;
}
