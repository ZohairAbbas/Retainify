/**
 * WhatsApp opt-in / opt-out — the consent gate the worker enforces.
 *
 * recordOptIn upserts a WhatsappSubscription and links it back into the Contact
 * graph (whatsappStatus). recordOptOut is the inverse, used by the webhook on a
 * STOP message and by any merchant-side unsubscribe.
 *
 * A double opt-in confirmation token (HMAC, same scheme as email) is provided
 * for flows that require the customer to confirm before we mark them sendable.
 */
import { createHmac } from "crypto";
import prisma from "../../db.server.js";
import { upsertContact, normalizePhone } from "../contacts/contacts.server.js";

const VALID_METHODS = new Set(["popup", "checkout", "click_to_wa", "imported", "api"]);

function secret() {
  return process.env.SHOPIFY_API_SECRET || "";
}

/** Deterministic double opt-in token for shop+phone. */
export function generateOptInToken(shop, phoneNumber) {
  return createHmac("sha256", secret())
    .update(`${shop}:wa:${phoneNumber}`)
    .digest("hex");
}

export function verifyOptInToken(shop, phoneNumber, token) {
  if (!token || token.length !== 64) return false;
  const expected = generateOptInToken(shop, phoneNumber);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Record (or refresh) a WhatsApp opt-in.
 *
 * @param {Object} input
 * @param {string} input.shop
 * @param {string} input.phoneNumber - any format; normalized to E.164 digits.
 * @param {string} [input.contactEmail] - links the subscription to a Contact.
 * @param {string} [input.optInMethod] - popup | checkout | click_to_wa | imported | api
 * @param {boolean} [input.confirmed] - true to mark double opt-in complete now.
 * @returns {Promise<object|null>} the subscription row, or null on bad input.
 */
export async function recordOptIn({ shop, phoneNumber, contactEmail, optInMethod, confirmed = false }) {
  const phone = normalizePhone(phoneNumber);
  if (!shop || !phone) return null;
  const method = VALID_METHODS.has(optInMethod) ? optInMethod : "api";
  const now = new Date();

  const sub = await prisma.whatsappSubscription.upsert({
    where: { shop_phoneNumber: { shop, phoneNumber: phone } },
    create: {
      shop,
      phoneNumber: phone,
      contactEmail: contactEmail || null,
      status: "subscribed",
      optInMethod: method,
      confirmedAt: confirmed ? now : null,
      optInAt: now,
    },
    update: {
      status: "subscribed",
      optOutAt: null,
      ...(contactEmail ? { contactEmail } : {}),
      ...(confirmed ? { confirmedAt: now } : {}),
    },
  });

  // Clear any prior suppression — an explicit re-opt-in wins.
  await prisma.whatsappSuppression
    .deleteMany({ where: { shop, phoneNumber: phone } })
    .catch(() => {});

  if (contactEmail) {
    await upsertContact({
      shop,
      email: contactEmail,
      phone,
      whatsappStatus: "subscribed",
      whatsappOptInAt: now,
      revive: true,
    }).catch(() => {});
  }

  return sub;
}

/**
 * Confirm a pending double opt-in (sets confirmedAt). Used by the confirm link.
 */
export async function confirmOptIn(shop, phoneNumber) {
  const phone = normalizePhone(phoneNumber);
  if (!shop || !phone) return null;
  return prisma.whatsappSubscription.updateMany({
    where: { shop, phoneNumber: phone, status: "subscribed", confirmedAt: null },
    data: { confirmedAt: new Date() },
  });
}

/**
 * Record a WhatsApp opt-out — flips the subscription, adds suppression, and
 * downgrades the linked contact.
 */
export async function recordOptOut({ shop, phoneNumber, reason = "opt_out" }) {
  const phone = normalizePhone(phoneNumber);
  if (!shop || !phone) return null;
  const now = new Date();

  const sub = await prisma.whatsappSubscription.findUnique({
    where: { shop_phoneNumber: { shop, phoneNumber: phone } },
  });

  await prisma.whatsappSubscription
    .updateMany({
      where: { shop, phoneNumber: phone },
      data: { status: "unsubscribed", optOutAt: now },
    })
    .catch(() => {});

  await prisma.whatsappSuppression.upsert({
    where: { shop_phoneNumber: { shop, phoneNumber: phone } },
    create: { shop, phoneNumber: phone, reason },
    update: { reason },
  });

  if (sub?.contactEmail) {
    await upsertContact({
      shop,
      email: sub.contactEmail,
      whatsappStatus: "unsubscribed",
    }).catch(() => {});
  }

  return sub;
}
