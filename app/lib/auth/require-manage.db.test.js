/**
 * Role enforcement: members cannot change workspace identity.
 *
 * Run: npm test   (or: node --test app/lib/auth/require-manage.db.test.js)
 *
 * ── What this pins ─────────────────────────────────────────────────────────
 * Roles existed and were explained to users — ROLE_HELP tells a member they
 * "can build and send, but can't manage people or billing" — but requireManage
 * was never passed by any route. Only the Team page checked anything, inline.
 * A member could change the sender domain, the WhatsApp connection and the
 * workspace settings, which is not what they were told they could do.
 *
 * The other half matters just as much: embedded Shopify sessions resolve to
 * owner, because a store's Shopify admins are all owners of the workspace.
 * Gating must therefore be invisible inside Shopify — if any of these checks
 * ever bit an embedded session, every merchant would be locked out of their own
 * settings. That is the test that would catch a catastrophic regression, so it
 * is here rather than assumed.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { default: prisma } = await import("../../db.server.js");
const { requireAccount, looksLikeShopify } = await import("./require.server.js");
const { canManage } = await import("./roles.js");
// The real session path, not a hand-built row: AuthSession stores only a hash of
// the token, so a fabricated row cannot be authenticated with any cookie. Using
// the module that issues sessions also means a change to that scheme breaks
// these tests loudly instead of leaving them passing for the wrong reason.
const { createSession, SESSION_COOKIE } = await import("./session.server.js");

const ACCOUNT_KEY = "__test__roles-workspace";

/** A signed-in session for a user with the given role in the workspace. */
async function sessionFor(role) {
  const user = await prisma.user.create({
    data: {
      email: `${role}-${Date.now()}-${Math.round(performance.now())}@example.test`,
      name: role,
      passwordHash: "x",
    },
  });
  const account = await prisma.account.upsert({
    where: { key: ACCOUNT_KEY },
    create: { key: ACCOUNT_KEY, kind: "direct", name: "roles test" },
    update: {},
  });
  await prisma.membership.create({
    data: { userId: user.id, accountId: account.id, role },
  });
  const { token } = await createSession({
    request: new Request("https://example.test/"),
    userId: user.id,
    accountId: account.id,
  });
  return { user, token };
}

/** A request carrying that session's cookie, and no Shopify params. */
function requestFor(token) {
  return new Request("https://example.test/app/settings", {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

async function cleanup() {
  const account = await prisma.account.findUnique({ where: { key: ACCOUNT_KEY } });
  if (!account) return;
  const memberships = await prisma.membership.findMany({
    where: { accountId: account.id },
    select: { userId: true },
  });
  const userIds = memberships.map((m) => m.userId);
  await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { accountId: account.id } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.account.delete({ where: { id: account.id } });
}

test.beforeEach(cleanup);
test.after(cleanup);

test("canManage encodes exactly what ROLE_HELP promises", () => {
  // The copy shown under the invite form is a commitment to the user; this is
  // the code that has to honour it.
  assert.equal(canManage("owner"), true);
  assert.equal(canManage("admin"), true);
  assert.equal(canManage("member"), false);
  assert.equal(canManage(undefined), false);
  assert.equal(canManage("Owner"), false, "exact match only — no case coercion");
});

test("a member is refused by requireManage", async () => {
  const { token } = await sessionFor("member");

  await assert.rejects(
    () => requireAccount(requestFor(token), { requireManage: true }),
    (thrown) => {
      assert.ok(thrown instanceof Response, "refusal is a Response, not an Error");
      assert.equal(thrown.status, 403);
      return true;
    },
  );
});

test("a member is still allowed through without requireManage", async () => {
  // Members keep full access to everything else — building, sending, contacts.
  // Over-gating would be its own bug.
  const { token } = await sessionFor("member");

  const ctx = await requireAccount(requestFor(token));
  assert.equal(ctx.role, "member");
  assert.equal(ctx.shop, ACCOUNT_KEY);
});

test("owner and admin pass requireManage", async () => {
  for (const role of ["owner", "admin"]) {
    await cleanup();
    const { token } = await sessionFor(role);
    const ctx = await requireAccount(requestFor(token), { requireManage: true });
    assert.equal(ctx.role, role);
  }
});

test("an embedded Shopify request never reaches the role check", async () => {
  // The regression that would matter most. requireAccount takes the Shopify
  // branch first and returns role "owner" from it, so requireManage is never
  // evaluated for an embedded session. If that order were ever inverted, every
  // merchant would be locked out of their own settings — and because embedded
  // sessions have no row in our user table, the role lookup would find nothing
  // and refuse everyone rather than failing visibly for one person.
  //
  // Asserted against the branch predicate rather than through
  // authenticate.admin(), which needs a real OAuth handshake: the predicate IS
  // the decision, and it is what a careless edit would break.
  const embedded = [
    "https://example.test/app/settings?shop=x.myshopify.com",
    "https://example.test/app/settings?host=abc123",
    "https://example.test/app/settings?embedded=1",
    "https://example.test/app/settings?id_token=jwt",
  ];
  for (const url of embedded) {
    assert.equal(looksLikeShopify(new Request(url)), true, url);
  }

  // A Bearer token is the other embedded signal — in-app navigations carry it
  // instead of query params.
  assert.equal(
    looksLikeShopify(
      new Request("https://example.test/app/settings", {
        headers: { authorization: "Bearer session-token" },
      }),
    ),
    true,
  );

  // And the cookie path must NOT be mistaken for Shopify, or a real member
  // would be handed owner and every gate in this file would be bypassed.
  const { token } = await sessionFor("member");
  assert.equal(looksLikeShopify(requestFor(token)), false);
});
