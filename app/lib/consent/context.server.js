/**
 * Say why a consent change is happening, so the ConsentEvent the Contact
 * trigger writes carries it.
 *
 * The trigger (migration 20261007110000_g5_consent_events) records every change
 * to subscriptionStatus, whatsappStatus and pushEnabled whatever wrote it. What
 * it cannot know is the reason or the source. Those travel as
 * transaction-local settings, set here with set_config(..., true), so they
 * apply to the writes inside `fn` and to nothing else: not to the next query on
 * this pooled connection, and not to a concurrent request.
 *
 * A write made outside this helper is still recorded, labelled
 * source "unattributed".
 */
import prisma from "../../db.server.js";

/** The pack's reason codes (G-RTN5-6). */
export const CONSENT_REASONS = new Set([
  "opt_in",
  "unsubscribe",
  "bounce",
  "complaint",
  "blocked",
  "invalid",
  "shopify_sync",
  "import",
  "gdpr",
]);

/**
 * @template T
 * @param {{ reason?: string|null, source: string }} ctx
 *   reason: one of CONSENT_REASONS, or null to let the trigger infer it from
 *   the new state. source: where the change came from, e.g. "checkout".
 * @param {(tx: import("@prisma/client").Prisma.TransactionClient) => Promise<T>} fn
 *   must use `tx`, not the global client, or its writes run outside the
 *   transaction and lose the context.
 * @returns {Promise<T>}
 */
export async function withConsentContext({ reason = null, source }, fn) {
  if (reason != null && !CONSENT_REASONS.has(reason)) {
    throw new Error(`Unknown consent reason "${reason}"`);
  }
  if (!source) throw new Error("withConsentContext needs a source");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('retainify.consent_reason', ${reason ?? ""}, true),
                              set_config('retainify.consent_source', ${source}, true)`;
    return fn(tx);
  });
}
