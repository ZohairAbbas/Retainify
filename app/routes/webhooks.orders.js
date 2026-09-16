/**
 * Order webhooks: create, paid, updated, cancelled, and refunds.
 *
 * ── Why five topics ─────────────────────────────────────────────────────────
 * create and paid alone describe an order only as it was at checkout. A COD
 * order lands as financial_status "pending" and stays that way forever, so a
 * cancellation, a refund or an RTO never reached us: attributed revenue and
 * lifetime value went on counting sales that had unwound. Both queries already
 * excluded cancelled/refunded/voided orders correctly — the states simply never
 * arrived. updated and cancelled carry the order itself; refunds/create does not
 * (see below).
 *
 * ── Errors are retryable ────────────────────────────────────────────────────
 * Shopify retries a webhook only on a non-2xx response. This handler used to
 * catch every failure and return 200, so a transient database blip silently
 * dropped an order — and for an order state that arrives exactly once, there is
 * no later correction. Anything that leaves our records wrong now returns 500 so
 * Shopify delivers it again; the write path is idempotent, so a retry is safe.
 *
 * Enrollment and exit-criteria failures are deliberately NOT retryable. They are
 * downstream effects, and replaying the whole webhook to retry one enrollment
 * would re-run the order write and re-fire exit criteria for every other flow.
 */
import { authenticate, unauthenticated } from "../shopify.server.js";
import prisma from "../db.server.js";
import { enrollInAllFlows } from "../lib/journey/journey-queue.server.js";
import { evaluateExitCriteria } from "../lib/journey/exit-criteria.server.js";
import { recordOrder } from "../lib/orders/orders.server.js";

/** Topics that carry a full order payload. */
const ORDER_TOPICS = new Set([
  "ORDERS_CREATE",
  "ORDERS_PAID",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
]);

/** Topics that should enroll into a post-purchase flow — the purchase itself. */
const PURCHASE_TOPICS = new Set(["ORDERS_CREATE", "ORDERS_PAID"]);

const ORDER_STATUS_QUERY = `#graphql
  query orderFinancialStatus($id: ID!) {
    order(id: $id) {
      id
      email
      processedAt
      cancelledAt
      displayFinancialStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      customer { id firstName lastName phone }
    }
  }
`;

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  if (topic === "REFUNDS_CREATE") {
    return handleRefund(shop, payload);
  }

  if (!ORDER_TOPICS.has(topic)) {
    // A topic we never subscribed to. Acknowledge rather than retry forever.
    console.warn(`[webhook] orders handler received unexpected topic ${topic}`);
    return new Response(null, { status: 200 });
  }

  const checkoutToken = payload.checkout_token;
  const customerEmail = payload.email || payload.contact_email;
  const phone =
    payload.phone ||
    payload.customer?.phone ||
    payload.billing_address?.phone ||
    payload.shipping_address?.phone ||
    "";

  // Persist the order and refresh the buyer's purchase aggregates. This also
  // upserts the Contact (carrying the phone through for the WhatsApp channel).
  //
  // Idempotent: several topics fire for the same order and Shopify retries, so
  // this runs more than once per order by design. recordOrder upserts on
  // shop + shopifyOrderId and recomputes aggregates from scratch rather than
  // incrementing, which is what makes repeat delivery harmless.
  if (customerEmail) {
    try {
      await recordOrder(shop, { ...payload, phone: payload.phone || phone });
    } catch (err) {
      // The order state is the whole point of this webhook. Failing to store it
      // leaves revenue and lifetime value wrong with nothing to correct them,
      // so this is the one failure worth making Shopify repeat.
      console.error(`[webhook] recordOrder failed for ${topic}:`, err.message);
      return new Response("order write failed", { status: 500 });
    }
  }

  // Mark abandoned cart recovered if this order matches one. Pending journey
  // jobs are cancelled via evaluateExitCriteria below (cart_recovered event).
  if (checkoutToken) {
    try {
      const cart = await prisma.abandonedCart.findUnique({
        where: { shop_checkoutToken: { shop, checkoutToken } },
      });
      // Only on the first order event — recoveredAt is a moment, and letting a
      // later orders/updated overwrite it would move the recovery to whenever
      // the order was last edited.
      if (cart && !cart.recoveredAt) {
        const orderTotal = parseFloat(payload.total_price || "0");
        await prisma.abandonedCart.update({
          where: { id: cart.id },
          data: { recoveredAt: new Date(), recoveredRevenue: orderTotal },
        });
        if (cart.customerEmail) {
          await evaluateExitCriteria(shop, cart.customerEmail, "cart_recovered").catch((err) =>
            console.error("[webhook] exit-criteria cart_recovered failed:", err.message),
          );
        }
      }
    } catch (err) {
      console.error("[webhook] abandoned cart update failed:", err.message);
      return new Response("cart update failed", { status: 500 });
    }
  }

  // Fire exit-criteria for active enrollments (win-back, welcome, etc.)
  if (customerEmail) {
    await evaluateExitCriteria(shop, customerEmail, "order_placed").catch((err) =>
      console.error("[webhook] exit-criteria order_placed failed:", err.message),
    );
  }

  // Enroll in post-purchase journeys. Only for the topics that mean "a purchase
  // just happened" — an order edited or cancelled weeks later is not a new
  // purchase, and enrolling on ORDERS_UPDATED would send a thank-you for it.
  if (customerEmail && PURCHASE_TOPICS.has(topic)) {
    await enrollPostPurchase(shop, customerEmail, payload);
  }

  return new Response(null, { status: 200 });
};

/**
 * refunds/create carries a Refund, not an Order: no email, no financial_status,
 * no totals. Refetching the order is what makes the difference between recording
 * the truth and guessing — a partial refund leaves the order "partially_refunded"
 * and still largely real revenue, while stamping "refunded" from the webhook
 * alone would drop the entire order out of attribution and lifetime value.
 */
async function handleRefund(shop, payload) {
  const orderId = String(payload?.order_id ?? "");
  if (!orderId) {
    console.warn("[webhook] refunds/create carried no order_id");
    return new Response(null, { status: 200 });
  }

  let order;
  try {
    const { admin } = await unauthenticated.admin(shop);
    const resp = await admin.graphql(ORDER_STATUS_QUERY, {
      variables: { id: `gid://shopify/Order/${orderId}` },
    });
    const body = await resp.json();
    order = body?.data?.order;
  } catch (err) {
    // Could not reach Shopify. The refund is real and unrecorded, so ask for a
    // redelivery rather than leaving the order looking fully paid.
    console.error("[webhook] refund order refetch failed:", err.message);
    return new Response("refund refetch failed", { status: 500 });
  }

  if (!order) {
    // The order is gone, or belongs to a shop we can no longer read. Retrying
    // will not conjure it, so acknowledge.
    console.warn(`[webhook] refunds/create: order ${orderId} not readable`);
    return new Response(null, { status: 200 });
  }

  if (!order.email) {
    // Every contact is keyed on email; an anonymous order has nothing to attach
    // to. Phone-only orders are deliberately out of scope.
    return new Response(null, { status: 200 });
  }

  // Shaped as a webhook payload so recordOrder stays the single write path.
  // displayFinancialStatus is uppercase in GraphQL and lowercase on webhooks —
  // lowered here to match, exactly as the historical backfill does.
  try {
    await recordOrder(shop, {
      id: orderId,
      email: order.email,
      financial_status: String(order.displayFinancialStatus || "").toLowerCase(),
      total_price: order.currentTotalPriceSet?.shopMoney?.amount ?? "0",
      currency: order.currentTotalPriceSet?.shopMoney?.currencyCode || "USD",
      processed_at: order.processedAt,
      cancelled_at: order.cancelledAt,
      customer: order.customer
        ? {
            id: order.customer.id,
            first_name: order.customer.firstName,
            last_name: order.customer.lastName,
            phone: order.customer.phone,
          }
        : undefined,
    });
  } catch (err) {
    console.error("[webhook] recordOrder failed for refund:", err.message);
    return new Response("refund write failed", { status: 500 });
  }

  return new Response(null, { status: 200 });
}

/** Enroll the buyer into every published post-purchase flow. */
async function enrollPostPurchase(shop, customerEmail, payload) {
  const firstName = payload.customer?.first_name || "";
  const lastName = payload.customer?.last_name || "";
  const name = [firstName, lastName].filter(Boolean).join(" ");

  await enrollInAllFlows(shop, "order_placed", customerEmail, name, {
    orderId: String(payload.id || ""),
    totalPrice: payload.total_price || "",
    currency: payload.currency || "USD",
  }).catch((err) => console.error("[webhook] post-purchase enroll failed:", err.message));
}
