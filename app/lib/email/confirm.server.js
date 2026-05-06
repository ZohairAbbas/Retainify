import { createHmac } from "crypto";

function secret() {
  return process.env.SHOPIFY_API_SECRET || "";
}

/**
 * Generate a double opt-in confirmation token.
 * Deterministic: same shop+email always produces the same token for a given secret.
 */
export function generateConfirmToken(shop, email) {
  return createHmac("sha256", secret())
    .update(`${shop}:${email}`)
    .digest("hex");
}

/**
 * Constant-time verification to prevent timing attacks.
 */
export function verifyConfirmToken(shop, email, token) {
  if (!token || token.length !== 64) return false;
  const expected = generateConfirmToken(shop, email);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}
