/**
 * GET /api/v1/growzar/checkouts (G-RTN5-4): AbandonedCart rows, one per
 * Shopify checkout this app heard about, abandoned or not.
 *
 * Keyed and ordered by checkoutToken, unique per shop. Money is in the
 * checkout's own currency, null when the checkout did not say (rows stored
 * before this phase hold whatever was sent then, or the old "USD" default).
 *
 * recoveredAt / retainifyRecoveredRevenue are Retainify's claim and named as
 * such: they are set when the checkout turns into an order, whether or not
 * anything was sent, so they mean "completed", not "recovered by a message".
 * Growzar computes recovery itself (rule #24).
 *
 * The buyer is the cart's own email and phone, with the contact's phone as
 * the fallback for carts stored before checkout phones were kept. A deleted
 * contact's carts keep coming with buyer null.
 */
import prisma from "../../../db.server.js";
import { buyerLookup, iso, money, paginate, windowWhere, TOMBSTONE_CAP } from "../feed.server.js";
import { tombstonesSince } from "../tombstones.server.js";

export async function readCheckouts(req) {
  const rows = await prisma.abandonedCart.findMany({
    where: { shop: req.shop, ...windowWhere(req, "updatedAt", "checkoutToken") },
    orderBy: [{ updatedAt: "asc" }, { checkoutToken: "asc" }],
    take: req.limit + 1,
    select: {
      checkoutToken: true, checkoutId: true, customerEmail: true, phone: true, phoneE164: true,
      totalPrice: true, currency: true, lineItemsJson: true, abandonedAt: true,
      recoveredAt: true, recoveredRevenue: true, updatedAt: true,
    },
  });
  const { page, pagination } = paginate(rows, req.limit, (r) => ({ at: r.updatedAt, id: r.checkoutToken }));
  const contact = await buyerLookup(req.shop, page.map((r) => r.customerEmail));
  const deleted = await tombstonesSince(req.shop, "checkouts", req.updatedSince, TOMBSTONE_CAP);
  return {
    data: page.map((c) => toCheckoutRow(c, contact)),
    pagination,
    extra: { deletedCheckoutTokens: deleted.ids, deletedCheckoutTokensTruncated: deleted.truncated },
  };
}

export function toCheckoutRow(c, contact) {
  const fromContact = c.customerEmail ? contact(c.customerEmail) : undefined;
  // null from the lookup means the contact was deleted: the buyer leaves.
  const buyer =
    fromContact === null
      ? null
      : {
          email: fromContact?.email ?? null,
          phone: c.phone ? c.phoneE164 || null : fromContact?.phone ?? null,
          phoneRaw: c.phone || fromContact?.phoneRaw || null,
        };
  return {
    checkoutToken: c.checkoutToken,
    checkoutId: /^\d+$/.test(c.checkoutId || "") ? c.checkoutId : null,
    abandonedAt: iso(c.abandonedAt),
    total: money(c.totalPrice, c.currency),
    lines: parseLines(c.lineItemsJson, c.currency),
    buyer: buyer && (buyer.email || buyer.phoneRaw) ? buyer : null,
    recoveredAt: iso(c.recoveredAt),
    retainifyRecoveredRevenue: money(c.recoveredRevenue, c.currency),
    updatedAt: iso(c.updatedAt),
  };
}

function parseLines(json, currency) {
  let items;
  try {
    items = JSON.parse(json || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  return items.map((l) => ({
    variantId: typeof l?.variantId === "string" ? l.variantId : null,
    productId: typeof l?.productId === "string" ? l.productId : null,
    title: l?.title ?? null,
    variantTitle: l?.variantTitle || null,
    quantity: Number.isFinite(Number(l?.quantity)) ? Number(l.quantity) : null,
    price: money(l?.price, currency),
  }));
}
