/**
 * At-rest secret encryption (AES-256-GCM).
 *
 * First use: WhatsApp WABA access tokens (WhatsappAccount.accessTokenEnc).
 * Long-lived Meta system-user tokens must never sit in the DB in plaintext.
 *
 * Format of the stored blob is three base64 segments joined by ":":
 *   "<iv>:<authTag>:<ciphertext>"
 *
 * Key: process.env.WHATSAPP_TOKEN_KEY — a 32-byte key, base64-encoded.
 * Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length

function getKey() {
  const b64 = process.env.WHATSAPP_TOKEN_KEY;
  if (!b64) {
    throw new Error("WHATSAPP_TOKEN_KEY is not set — cannot encrypt/decrypt secrets");
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(
      `WHATSAPP_TOKEN_KEY must decode to 32 bytes (got ${key.length}) — expected a base64-encoded 256-bit key`,
    );
  }
  return key;
}

/**
 * Encrypt a UTF-8 plaintext string. Returns "iv:tag:ciphertext" (all base64).
 * @param {string} plaintext
 * @returns {string}
 */
export function encryptSecret(plaintext) {
  if (plaintext == null) throw new Error("encryptSecret: plaintext is required");
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/**
 * Decrypt a blob produced by encryptSecret. Throws if the key is wrong or the
 * blob was tampered with (GCM auth tag mismatch).
 * @param {string} blob - "iv:tag:ciphertext" (base64 segments)
 * @returns {string} plaintext
 */
export function decryptSecret(blob) {
  if (!blob) throw new Error("decryptSecret: blob is required");
  const parts = String(blob).split(":");
  if (parts.length !== 3) throw new Error("decryptSecret: malformed blob");
  const [ivB64, tagB64, ctB64] = parts;
  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
