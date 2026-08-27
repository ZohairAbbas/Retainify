/**
 * Login sessions for the standalone app.
 *
 * Deliberately separate from Shopify's `Session` table, which stores an OAuth
 * access token. Conflating the two would let a bug in one become an
 * authentication bypass in the other.
 *
 * ── What is stored ──────────────────────────────────────────────────────────
 * The cookie carries a random token; the database stores only its SHA-256 hash.
 * A leaked database therefore yields no usable cookies. The token is 32 random
 * bytes, so guessing is not a threat model worth further mitigation.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import prisma from "../../db.server.js";

export const SESSION_COOKIE = "rt_session";

/** Rolling window. Long enough not to nag, short enough to bound a stolen cookie. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Only touch lastSeenAt this often — otherwise every request is a write. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function isSecureRequest(request) {
  // Behind a proxy the protocol arrives in a header. Getting this wrong either
  // drops the cookie over plain HTTP in dev, or ships a non-Secure cookie in
  // production — so read both.
  const proto = request.headers.get("x-forwarded-proto") || "";
  if (proto) return proto.split(",")[0].trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return true;
  }
}

/**
 * Create a session and return the Set-Cookie value.
 *
 * @returns {Promise<{token: string, cookie: string, session: object}>}
 */
export async function createSession({ request, userId, accountId = null }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const session = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      accountId,
      expiresAt,
      userAgent: (request.headers.get("user-agent") || "").slice(0, 300),
      ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64),
    },
  });

  return { token, session, cookie: buildCookie(token, request, expiresAt) };
}

function buildCookie(token, request, expiresAt) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    // Lax, not Strict: a password-reset or invite link arrives as a top-level
    // navigation from an email client, and Strict would drop the cookie on that
    // first hop. Lax still blocks the cross-site POSTs that matter.
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

/** Set-Cookie value that clears the session cookie. */
export function destroyCookie(request) {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

/** Pull one cookie out of the request header. */
export function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Resolve the session behind a request, or null.
 *
 * Returns the user and their current account in one query — every authenticated
 * request needs both, and splitting them would double the round trips on the
 * hottest path in the app.
 */
export async function getSession(request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          // Ordered so "your first workspace" is a stable answer — requireAccount
          // falls back to memberships[0] when the session points at nothing.
          memberships: { include: { account: true }, orderBy: { createdAt: "asc" } },
        },
      },
      account: true,
    },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    // Clean up as we go rather than relying on a sweep job existing.
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // Constant-time confirmation. findUnique already matched the hash, so this is
  // belt-and-braces against a future refactor that loosens the lookup.
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(session.tokenHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Rolling expiry: someone using the app daily should not be signed out on day
  // 30. Extended on the same throttled write as lastSeenAt, so this still costs
  // at most one UPDATE per hour per session rather than one per request.
  //
  // The cookie's own Expires is not refreshed here — it is re-issued at sign-in,
  // and a browser that drops it simply lands on the login page, which is the
  // correct outcome for a session it can no longer prove it owns.
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.authSession
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      })
      .catch(() => {});
  }

  return session;
}

/** Point an existing session at a different workspace. */
export async function switchAccount(sessionId, accountId) {
  return prisma.authSession.update({
    where: { id: sessionId },
    data: { accountId },
  });
}

/**
 * Revoke the current session and return the cookie that clears it.
 *
 * Always returns a clearing cookie, even when there was no session to delete —
 * a sign-out on an already-dead session should still leave the browser clean.
 *
 * @returns {Promise<{cookie: string}>}
 */
export async function destroySession(request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => {});
  }
  return { cookie: destroyCookie(request) };
}

/**
 * Invalidate every session for a user.
 *
 * Called on password change: whoever had the old password should lose their
 * other devices, which is the entire point of changing it.
 */
export async function destroyAllSessions(userId, exceptSessionId = null) {
  await prisma.authSession.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
}

/** Remove expired rows. Called opportunistically from the worker tick. */
export async function pruneExpiredSessions() {
  const { count } = await prisma.authSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (count) console.log(`[auth] pruned ${count} expired sessions`);
  return count;
}
