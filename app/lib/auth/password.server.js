/**
 * Password hashing.
 *
 * Uses node:crypto's scrypt rather than bcrypt or argon2. Both of those are
 * native modules that need a compile step and break on Node upgrades; scrypt is
 * built in, memory-hard, and recommended by OWASP for password storage. One
 * fewer thing to go wrong at deploy time matters more here than the marginal
 * difference between good KDFs.
 *
 * Format: scrypt$N$r$p$<salt-hex>$<hash-hex>
 * The parameters are stored WITH the hash so they can be raised later without
 * invalidating existing passwords — verify reads whatever the stored record
 * used, and needsRehash() tells the caller when to upgrade on next login.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-rules.js";

const scrypt = promisify(scryptCb);

// N is the CPU/memory cost. scrypt allocates roughly 128 * N * r bytes PER
// HASH, so N = 2^16 costs ~64MB a login. This process is capped at 500MB by PM2
// and runs the job workers in-process, so a handful of simultaneous logins at
// that setting could trip a memory restart and kill in-flight sends.
//
// 2^15 costs ~32MB and ~100ms — still far above bcrypt-equivalent work, and it
// leaves headroom. Raise it (and the PM2 limit together) if logins ever move to
// their own process.
const N = 2 ** 15;
const r = 8;
const p = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

/** scrypt needs maxmem raised well past the default for N this size. */
const MAXMEM = 256 * 1024 * 1024;

// Re-exported so server callers have one import, but defined in a client-safe
// module because the sign-up and reset forms need the number too.
export { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH };

/**
 * Validate a password before hashing it.
 *
 * Length is the only rule. Composition rules (a digit, a symbol, a capital)
 * measurably push people toward "Password1!" and are no longer recommended by
 * NIST; length is what actually costs an attacker.
 *
 * @returns {string|null} an error message, or null when acceptable
 */
export function validatePassword(password) {
  const value = String(password || "");
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    // Not a security rule — a guard against someone pasting a megabyte and
    // making the server do scrypt over it.
    return "That password is too long.";
  }
  return null;
}

/** @returns {Promise<string>} the encoded hash record */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_LEN);
  const derived = await scrypt(String(password), salt, KEY_LEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Constant-time verification.
 *
 * Returns false rather than throwing for a malformed or absent record — an
 * invited user with no password yet has null, and that is a normal state, not
 * an error.
 */
export async function verifyPassword(password, record) {
  if (!record || typeof record !== "string") return false;

  const parts = record.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const params = { N: Number(nStr), r: Number(rStr), p: Number(pStr), maxmem: MAXMEM };
  if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) {
    return false;
  }

  let expected;
  let actual;
  try {
    expected = Buffer.from(hashHex, "hex");
    actual = await scrypt(String(password), Buffer.from(saltHex, "hex"), expected.length, params);
  } catch {
    return false;
  }

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Whether a stored hash used weaker parameters than we now require, so the
 * caller can transparently upgrade it during a successful login.
 */
export function needsRehash(record) {
  if (!record || typeof record !== "string") return true;
  const parts = record.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < N;
}
