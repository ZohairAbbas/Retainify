/**
 * Accounts, users and membership.
 *
 * An Account is a workspace. Its `key` is the value every data table already
 * stores in its `shop` column, so no existing query changes: for a Shopify
 * install the key is "store.myshopify.com"; for a direct signup it's a
 * generated slug. See the note on the Account model in schema.prisma.
 */
import { randomBytes, createHash } from "node:crypto";
import prisma from "../../db.server.js";
import { hashPassword, validatePassword, verifyPassword } from "./password.server.js";
import { ROLES } from "./roles.js";

// Defined in a client-safe module (the team page renders the role picker) and
// re-exported so server callers keep one import.
export { ROLES, canManage } from "./roles.js";

export function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

/**
 * Turn a workspace name into a stable, unique key.
 *
 * The key is a tenant identifier that appears in no URL and is never shown, so
 * readability matters less than never colliding — hence the random suffix
 * rather than a "-2" retry loop.
 */
export async function generateAccountKey(name) {
  const base = String(name || "workspace")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "workspace";

  for (let attempt = 0; attempt < 5; attempt++) {
    const key = `${base}-${randomBytes(4).toString("hex")}`;
    const clash = await prisma.account.findUnique({ where: { key } });
    if (!clash) return key;
  }
  // Astronomically unlikely; fall back to something that cannot collide.
  return `workspace-${randomBytes(12).toString("hex")}`;
}

/**
 * Create a workspace and its first user.
 *
 * Returns a structured error rather than throwing, because every caller is a
 * form handler that needs to render the message.
 *
 * @returns {Promise<{ok:boolean, error?:string, field?:string, user?:object, account?:object}>}
 */
export async function signUp({ email, password, name, workspaceName }) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
    return { ok: false, error: "Enter a valid email address.", field: "email" };
  }

  const pwError = validatePassword(password);
  if (pwError) return { ok: false, error: pwError, field: "password" };

  const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (existing) {
    // Deliberately explicit rather than vague. Email enumeration is a real
    // concern on some products, but here signup is the front door of a B2B tool
    // and "that email is already registered — sign in instead" prevents far
    // more support tickets than the disclosure costs.
    return { ok: false, error: "That email already has an account. Sign in instead.", field: "email" };
  }

  const finalWorkspace = String(workspaceName || "").trim() || "My workspace";
  const key = await generateAccountKey(finalWorkspace);
  const passwordHash = await hashPassword(password);

  // One transaction: a user without a workspace, or a workspace with no owner,
  // is a broken state that the UI has no way to resolve.
  const { user, account } = await prisma.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: { key, name: finalWorkspace, kind: "direct" },
    });
    const user = await tx.user.create({
      data: {
        email: cleanEmail,
        name: String(name || "").trim(),
        passwordHash,
        emailVerifiedAt: null,
      },
    });
    await tx.membership.create({
      data: { userId: user.id, accountId: account.id, role: "owner" },
    });
    // Seed the settings row every feature reads, so the workspace works
    // immediately rather than on first save.
    await tx.shopSettings.create({
      data: {
        shop: key,
        senderName: finalWorkspace,
        replyTo: cleanEmail,
        // A direct workspace has no Shopify onboarding to complete.
        onboardingStep: 0,
        isActive: false,
      },
    });
    return { user, account };
  });

  return { ok: true, user, account };
}

/**
 * Verify credentials.
 *
 * The error message is identical for an unknown email and a wrong password —
 * at the sign-in door, confirming which addresses exist hands an attacker a
 * free account-enumeration oracle.
 */
export async function signIn({ email, password }) {
  const cleanEmail = normalizeEmail(email);
  const generic = { ok: false, error: "That email and password don't match." };

  const user = await prisma.user.findUnique({
    where: { email: cleanEmail },
    include: { memberships: { include: { account: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!user || !user.passwordHash) return generic;

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return generic;

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  }).catch(() => {});

  return { ok: true, user };
}

/** Every workspace a user can open, owner-first then alphabetical. */
export async function listWorkspaces(userId) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { account: true },
  });
  return memberships
    .map((m) => ({ id: m.account.id, key: m.account.key, name: m.account.name, kind: m.account.kind, role: m.role }))
    .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0) || a.name.localeCompare(b.name));
}

/**
 * The Account for a Shopify shop, created on demand.
 *
 * Existing installs predate this table entirely, so the first authenticated
 * request after deploy creates their Account — with the key set to the shop
 * domain, which is already the tenant value on all their data. Nothing moves.
 */
export async function ensureShopifyAccount(shop, { email, firstName } = {}) {
  const existing = await prisma.account.findUnique({ where: { key: shop } });
  if (existing) return existing;

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const name =
    settings?.senderName && settings.senderName !== "Your Store"
      ? settings.senderName
      : shop.replace(".myshopify.com", "");

  const account = await prisma.account.create({
    data: { key: shop, name, kind: "shopify" },
  });

  // Link the staff member Shopify told us about, so they can also sign in
  // directly later without a separate signup. No password yet — they'd use the
  // reset flow to set one.
  const cleanEmail = normalizeEmail(email);
  if (cleanEmail) {
    const user = await prisma.user.upsert({
      where: { email: cleanEmail },
      create: { email: cleanEmail, name: String(firstName || "").trim(), emailVerifiedAt: new Date() },
      update: {},
    });
    await prisma.membership.upsert({
      where: { userId_accountId: { userId: user.id, accountId: account.id } },
      create: { userId: user.id, accountId: account.id, role: "owner" },
      update: {},
    });
  }

  console.log(`[auth] provisioned account for Shopify shop ${shop}`);
  return account;
}

// ── Invites and password resets ────────────────────────────────────────────
// Both are single-use, expiring tokens that arrive by email, so they share one
// table and one consume path. `kind` distinguishes them.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

/** @returns {Promise<{token: string, invite: object}>} */
export async function createInvite({ accountId, email, role = "member", invitedByUserId }) {
  const token = randomBytes(32).toString("base64url");
  const invite = await prisma.invite.create({
    data: {
      accountId,
      email: normalizeEmail(email),
      role: ROLES.includes(role) ? role : "member",
      kind: "invite",
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedByUserId,
    },
  });
  return { token, invite };
}

export async function createPasswordReset(email) {
  const token = randomBytes(32).toString("base64url");
  const invite = await prisma.invite.create({
    data: {
      email: normalizeEmail(email),
      kind: "password_reset",
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });
  return { token, invite };
}

/** Look up a token without consuming it — for rendering the accept screen. */
export async function peekToken(token, kind) {
  if (!token) return null;
  const row = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { account: true },
  });
  if (!row || row.kind !== kind) return null;
  if (row.acceptedAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

/**
 * Consume a token atomically.
 *
 * The `acceptedAt: null` predicate is what makes it single-use: two concurrent
 * accepts, and only one updates a row.
 */
export async function consumeToken(token, kind) {
  const row = await peekToken(token, kind);
  if (!row) return null;
  const claim = await prisma.invite.updateMany({
    where: { id: row.id, acceptedAt: null },
    data: { acceptedAt: new Date() },
  });
  return claim.count === 1 ? row : null;
}

/** Add a user to a workspace, or update their role if already a member. */
export async function addMember(accountId, userId, role = "member") {
  return prisma.membership.upsert({
    where: { userId_accountId: { userId, accountId } },
    create: { userId, accountId, role: ROLES.includes(role) ? role : "member" },
    update: { role: ROLES.includes(role) ? role : "member" },
  });
}

/**
 * Remove someone from a workspace.
 *
 * Refuses to remove the last owner — a workspace nobody can administer is
 * unrecoverable without database access.
 */
export async function removeMember(accountId, userId) {
  const target = await prisma.membership.findUnique({
    where: { userId_accountId: { userId, accountId } },
  });
  if (!target) return { ok: false, error: "That person isn't in this workspace." };

  if (target.role === "owner") {
    const owners = await prisma.membership.count({ where: { accountId, role: "owner" } });
    if (owners <= 1) {
      return { ok: false, error: "This is the only owner. Make someone else an owner first." };
    }
  }
  await prisma.membership.delete({ where: { id: target.id } });
  return { ok: true };
}

export async function setPassword(userId, password) {
  const err = validatePassword(password);
  if (err) return { ok: false, error: err };
  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  return { ok: true };
}
