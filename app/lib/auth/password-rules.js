/**
 * Password rules that BOTH sides need.
 *
 * The forms render the minimum length and set `minLength` on the input; the
 * server enforces it. Keeping the number here — in a module with no server-only
 * imports — is what lets the client import it without dragging node:crypto into
 * the browser bundle.
 */
export const MIN_PASSWORD_LENGTH = 10;

/** Longer than any real password; the ceiling exists to bound hashing cost. */
export const MAX_PASSWORD_LENGTH = 200;
