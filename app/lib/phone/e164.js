/**
 * One phone format for joining buyers across apps (API-CONTRACT §3): E.164
 * with a leading "+", e.g. "+923001234567".
 *
 * Contact.phone keeps the permissive digits-only form (normalizePhone), and
 * WhatsApp keeps its own stricter check (toE164 in contacts.server.js); neither
 * is changed. This is the third form: what Growzar, Courierify and Preventify
 * can match on. A Pakistani "03001234567" and "+923001234567" are the same
 * buyer here, where as digits they were two.
 *
 * Parsed with libphonenumber's full metadata against the shop's country as the
 * default region, and kept only when the result is a VALID number — not merely
 * a plausible length. Anything else is null: the contract allows "unknown",
 * never a guess.
 *
 * Pure: no database, no network. The shop's country is the caller's to supply
 * (lib/growzar/shop-facts.server.js).
 */
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/**
 * @param {string|null|undefined} raw  the number as typed or stored
 * @param {string|null|undefined} country  ISO-3166 alpha-2 of the shop, or null
 * @returns {string|null} E.164 ("+923001234567") or null
 */
export function phoneToE164(raw, country) {
  const text = String(raw ?? "").trim();
  if (!/\d/.test(text)) return null;
  const region = /^[A-Z]{2}$/.test(String(country || "").toUpperCase())
    ? String(country).toUpperCase()
    : undefined;

  // Written with "+": the country is in the number itself, so the shop's
  // country is irrelevant and is not consulted.
  if (text.startsWith("+")) return valid(text, undefined);

  const asNational = region ? valid(text, region) : null;

  // Digits without "+". Contact.phone has always been stored this way —
  // normalizePhone strips the "+" — so "447911123456" on a Pakistani shop is
  // almost certainly a UK number that lost its "+", not a Pakistani one. Try it
  // as international too, and accept it only when the two readings do not
  // compete: a string that is valid both ways is ambiguous, and stays null.
  const digits = text.replace(/[^\d]/g, "");
  const asInternational = digits.startsWith("0") ? null : valid(`+${digits}`, undefined);

  if (asNational && asInternational && asNational !== asInternational) return null;
  return asNational || asInternational || null;
}

function valid(text, region) {
  try {
    const n = parsePhoneNumberFromString(text, region);
    return n && n.isValid() ? n.number : null;
  } catch {
    return null;
  }
}

/**
 * The buyer block's two phone fields (§3): `phone` is E.164 or null, and
 * `phoneRaw` is what we hold, so a number we could not read is still visible.
 *
 * @param {string|null|undefined} e164
 * @param {string|null|undefined} raw
 */
export function phonePair(e164, raw) {
  const r = raw == null || String(raw).trim() === "" ? null : String(raw);
  return { phone: e164 || null, phoneRaw: r };
}
