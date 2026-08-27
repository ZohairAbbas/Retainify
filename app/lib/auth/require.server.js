/**
 * The authentication seam.
 *
 * Every /app route asks this module who is calling, and gets the same answer
 * shape whether the request arrived embedded in the Shopify admin or directly
 * at our own domain. That symmetry is the whole point: routes contain no
 * branching on how you signed in.
 *
 *   const { shop } = await requireAccount(request);
 *
 * `shop` is the workspace key — the value already stored in every table's
 * `shop` column — so existing queries are untouched.
 */
import prisma from "../../db.server.js";
import { authenticate } from "../../shopify.server.js";
import { getSession } from "./session.server.js";
import { ensureShopifyAccount } from "./accounts.server.js";

/**
 * Whether this request is Shopify's embedded admin rather than our own domain.
 *
 * Two signals, and both are needed:
 *
 *   1. Query params — Shopify appends `shop`, and normally `host`/`embedded`/
 *      `id_token`, to the iframe URL. Present on the initial document load.
 *   2. `Authorization: Bearer` — once App Bridge boots it patches fetch to
 *      attach the session token as a header. Client-side navigations (the
 *      `.data` single-fetch requests) carry NO Shopify query params at all, so
 *      the header is the only thing distinguishing them from a direct visit.
 *
 * Checking params alone sends every embedded in-app navigation down the cookie
 * path, where it finds no cookie and redirects to /login.
 */
export function looksLikeShopify(request) {
  const auth = request.headers.get("authorization") || "";
  if (auth.slice(0, 7).toLowerCase() === "bearer ") return true;

  try {
    const url = new URL(request.url);
    const p = url.searchParams;
    return !!(p.get("shop") || p.get("host") || p.get("embedded") || p.get("id_token") || p.get("session"));
  } catch {
    return false;
  }
}

/**
 * Resolve the caller, or redirect them somewhere they can fix it.
 *
 * @param {Request} request
 * @param {{ requireManage?: boolean }} [opts]
 * @returns {Promise<{
 *   shop: string, account: object, user: object|null, role: string|null,
 *   isShopify: boolean, admin: object|null, billing: object|null, session: object|null
 * }>}
 */
export async function requireAccount(request, opts = {}) {
  // ── Shopify embedded ─────────────────────────────────────────────────────
  // Checked first: when Shopify params are present the SDK owns the redirect
  // dance (OAuth, token exchange, re-auth on scope change), and short-circuiting
  // that with our own cookie would break installs.
  if (looksLikeShopify(request)) {
    const { session, admin, billing } = await authenticate.admin(request);
    const shop = session.shop;

    const account = await ensureShopifyAccount(shop, {
      email: session.email,
      firstName: session.firstName,
    });

    return {
      shop,
      account,
      // Shopify identifies a store, not a person in our user table. Anyone with
      // admin access to the store is treated as an owner of the workspace.
      user: null,
      role: "owner",
      isShopify: true,
      admin,
      billing,
      session,
    };
  }

  // ── Our own session ──────────────────────────────────────────────────────
  const session = await getSession(request);
  if (!session) throw redirectToLogin(request);

  const memberships = session.user?.memberships || [];
  if (memberships.length === 0) {
    // Signed in but belongs to nothing — can happen if their last workspace was
    // deleted. Send them somewhere they can create one rather than to a 403.
    throw redirect("/welcome");
  }

  // The session remembers which workspace you were last in; fall back to the
  // first one you belong to.
  let membership =
    memberships.find((m) => m.accountId === session.accountId) || memberships[0];

  if (session.accountId !== membership.accountId) {
    await prisma.authSession
      .update({ where: { id: session.id }, data: { accountId: membership.accountId } })
      .catch(() => {});
  }

  if (opts.requireManage && !["owner", "admin"].includes(membership.role)) {
    throw new Response("You don't have permission to do that.", { status: 403 });
  }

  return {
    shop: membership.account.key,
    account: membership.account,
    user: session.user,
    role: membership.role,
    isShopify: membership.account.kind === "shopify",
    admin: null,
    billing: null,
    session,
  };
}

/**
 * For routes that genuinely need the Shopify Admin API — the product picker,
 * discount creation, customer sync.
 *
 * A direct workspace has no store to talk to, so this returns a 409 rather than
 * pretending. Callers should hide these features when `isShopify` is false; the
 * error is the backstop for a stale page.
 */
export async function requireShopifyAdmin(request) {
  const ctx = await requireAccount(request);
  if (!ctx.admin) {
    throw new Response("This workspace isn't connected to a Shopify store.", { status: 409 });
  }
  return ctx;
}

/**
 * Optional resolution — for pages that render differently when signed in but
 * do not demand it (the marketing shell, the login page itself).
 */
export async function getAccount(request) {
  try {
    return await requireAccount(request);
  } catch {
    return null;
  }
}

function redirect(to) {
  return new Response(null, { status: 302, headers: { Location: to } });
}

/** Bounce to login, remembering where they were headed. */
function redirectToLogin(request) {
  let next = "/app";
  try {
    const url = new URL(request.url);
    next = url.pathname + url.search;
  } catch {
    // Keep the default.
  }
  const target = next && next !== "/app" ? `/login?next=${encodeURIComponent(next)}` : "/login";
  return redirect(target);
}
