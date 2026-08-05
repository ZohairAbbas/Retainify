/**
 * Custom-domain slot accounting.
 *
 * Resend's paid plan allows 10 custom domains per account. A slot is consumed
 * only when a shop's domain reaches `verified` (pending/abandoned domains don't
 * count), so we gate on the count of `domainVerified` shops. The current shop is
 * excluded from the count so re-checking its own already-verified domain never
 * trips the guard.
 */
import prisma from "../../db.server.js";

export const MAX_CUSTOM_DOMAINS = parseInt(
  process.env.RESEND_MAX_CUSTOM_DOMAINS || "10",
  10,
);

/**
 * Number of custom-domain slots currently used (verified domains), optionally
 * excluding one shop (the one being evaluated).
 * @param {string} [excludeShop]
 * @returns {Promise<number>}
 */
export async function usedDomainSlots(excludeShop) {
  return prisma.shopSettings.count({
    where: {
      domainVerified: true,
      ...(excludeShop ? { shop: { not: excludeShop } } : {}),
    },
  });
}

/**
 * Whether `shop` may start/continue a custom-domain setup — i.e. there's a free
 * slot once we exclude the shop itself. A shop already holding a verified slot
 * is always allowed.
 * @param {string} shop
 * @returns {Promise<boolean>}
 */
export async function canUseDomainSlot(shop) {
  const used = await usedDomainSlots(shop);
  return used < MAX_CUSTOM_DOMAINS;
}
