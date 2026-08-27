/**
 * Team management for a workspace: who's in it, what they can do, and who's
 * been invited but hasn't accepted yet.
 *
 * Only meaningful for a direct workspace. Inside the Shopify admin, access is
 * whatever Shopify staff permissions say it is — we don't get a user list, and
 * inventing a parallel one that Shopify ignores would be a lie.
 */
import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import prisma from "../db.server.js";
import { requireAccount } from "../lib/auth/require.server.js";
import { createInvite, normalizeEmail, removeMember } from "../lib/auth/accounts.server.js";
import { ROLES, ROLE_HELP, canManage, roleLabel } from "../lib/auth/roles.js";
import { sendInviteEmail, appBaseUrl } from "../lib/auth/mail.server.js";
import { ConfirmDialog } from "../components/ui/Dialog.jsx";

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);

  if (ctx.isShopify) {
    return { shopify: true, members: [], invites: [], canManage: false, me: null, accountName: ctx.account?.name || "" };
  }

  const [memberships, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { accountId: ctx.account.id },
      include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invite.findMany({
      where: {
        accountId: ctx.account.id,
        kind: "invite",
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    shopify: false,
    accountName: ctx.account.name,
    canManage: canManage(ctx.role),
    me: ctx.user?.id || null,
    members: memberships.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      lastLoginAt: m.user.lastLoginAt,
    })),
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt,
    })),
  };
};

export const action = async ({ request }) => {
  const ctx = await requireAccount(request);
  if (ctx.isShopify) {
    return { ok: false, error: "Team management isn't available for Shopify installs." };
  }
  if (!canManage(ctx.role)) {
    return { ok: false, error: "Only owners and admins can manage the team." };
  }

  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent === "invite") {
    const email = normalizeEmail(fd.get("email"));
    const role = String(fd.get("role") || "member");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return { ok: false, error: "Enter a valid email address." };
    }
    if (!ROLES.includes(role)) return { ok: false, error: "Pick a valid role." };

    // Already in the workspace — inviting them again would create a token that
    // does nothing when accepted.
    const existing = await prisma.membership.findFirst({
      where: { accountId: ctx.account.id, user: { email } },
    });
    if (existing) return { ok: false, error: "That person is already in this workspace." };

    // Supersede any outstanding invite for the same address rather than leaving
    // two live tokens, either of which would work.
    await prisma.invite.updateMany({
      where: { accountId: ctx.account.id, email, kind: "invite", acceptedAt: null },
      data: { expiresAt: new Date(0) },
    });

    const { token } = await createInvite({
      accountId: ctx.account.id,
      email,
      role,
      invitedByUserId: ctx.user?.id || null,
    });

    const sent = await sendInviteEmail({
      to: email,
      token,
      accountName: ctx.account.name,
      invitedByName: ctx.user?.name || "",
    });

    // If the mail failed, hand back the link so the invite isn't stranded — the
    // token is valid either way and copy-paste is a perfectly good delivery
    // mechanism when email isn't cooperating.
    return sent?.ok
      ? { ok: true, message: `Invitation sent to ${email}.` }
      : {
          ok: true,
          warn: "We couldn't send the email. Copy this link and send it yourself:",
          link: `${appBaseUrl()}/invite/${token}`,
        };
  }

  if (intent === "revoke") {
    const id = String(fd.get("inviteId") || "");
    await prisma.invite.deleteMany({ where: { id, accountId: ctx.account.id, acceptedAt: null } });
    return { ok: true, message: "Invitation revoked." };
  }

  if (intent === "role") {
    const userId = String(fd.get("userId") || "");
    const role = String(fd.get("role") || "");
    if (!ROLES.includes(role)) return { ok: false, error: "Pick a valid role." };

    // Demoting the last owner leaves a workspace nobody can administer.
    if (role !== "owner") {
      const current = await prisma.membership.findUnique({
        where: { userId_accountId: { userId, accountId: ctx.account.id } },
      });
      if (current?.role === "owner") {
        const owners = await prisma.membership.count({
          where: { accountId: ctx.account.id, role: "owner" },
        });
        if (owners <= 1) {
          return { ok: false, error: "This is the only owner. Promote someone else first." };
        }
      }
    }

    await prisma.membership.updateMany({
      where: { userId, accountId: ctx.account.id },
      data: { role },
    });
    return { ok: true, message: "Role updated." };
  }

  if (intent === "remove") {
    const userId = String(fd.get("userId") || "");
    const result = await removeMember(ctx.account.id, userId);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, message: "Removed from the workspace." };
  }

  return { ok: false, error: "Unknown action." };
};

function fmtDate(v) {
  if (!v) return "Never";
  return new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function Team() {
  const { shopify, accountName, members, invites, canManage: allowed, me } = useLoaderData();
  const fetcher = useFetcher();
  const [confirm, setConfirm] = useState(null);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;

  if (shopify) {
    return (
      <div className="rt-page">
        <header className="rt-page-head">
          <h1 className="t-display-2" style={{ margin: 0 }}>Team</h1>
        </header>
        <div className="card card-pad">
          <div className="t-h3" style={{ marginBottom: 6 }}>Managed by Shopify</div>
          <p className="t-small muted" style={{ margin: 0 }}>
            Anyone with access to your Shopify admin can use Retainify. Add or remove
            people from <strong>Settings → Users and permissions</strong> in Shopify.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>{accountName}</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Team</h1>
        </div>
      </header>

      {result?.error && <div className="auth-notice auth-notice-warn">{result.error}</div>}
      {result?.message && <div className="auth-notice auth-notice-success">{result.message}</div>}
      {result?.link && (
        <div className="auth-notice auth-notice-info">
          {result.warn}
          <div className="t-mono" style={{ marginTop: 6, wordBreak: "break-all" }}>{result.link}</div>
        </div>
      )}

      {allowed && (
        <section className="card card-pad" style={{ marginTop: 24 }}>
          <div className="t-h3" style={{ marginBottom: 4 }}>Invite someone</div>
          <p className="t-small muted" style={{ marginTop: 0, marginBottom: 16 }}>
            They&apos;ll get an email with a link to join. Invitations expire after 7 days.
          </p>
          <fetcher.Form
            method="post"
            style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}
          >
            <input type="hidden" name="intent" value="invite" />
            <input
              className="input"
              name="email"
              type="email"
              placeholder="teammate@company.com"
              required
              style={{ flex: "1 1 240px", minWidth: 0 }}
            />
            <select className="select" name="role" defaultValue="member" aria-label="Role">
              {ROLES.map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Sending…" : "Send invitation"}
            </button>
          </fetcher.Form>
          <div className="t-micro muted" style={{ marginTop: 10 }}>
            {ROLES.map((r) => (
              <div key={r}><strong>{r}</strong> — {ROLE_HELP[r]}</div>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginTop: 32 }}>
        <div className="t-micro muted" style={{ marginBottom: 12 }}>
          {members.length} {members.length === 1 ? "person" : "people"}
        </div>
        <div className="card">
          {members.map((m) => (
            <div className="rt-member-row" key={m.id}>
              <div style={{ minWidth: 0 }}>
                <div className="rt-member-name">
                  {m.name || m.email}
                  {m.id === me && <span className="t-micro muted"> · you</span>}
                </div>
                <div className="rt-member-email">
                  {m.email} · last seen {fmtDate(m.lastLoginAt)}
                </div>
              </div>

              {allowed && m.id !== me ? (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="role" />
                  <input type="hidden" name="userId" value={m.id} />
                  <select
                    className="select"
                    name="role"
                    defaultValue={m.role}
                    aria-label={`Role for ${m.email}`}
                    onChange={(e) => e.currentTarget.form.requestSubmit()}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{roleLabel(r)}</option>
                    ))}
                  </select>
                </fetcher.Form>
              ) : (
                <span className="pill">{m.role}</span>
              )}

              {allowed && m.id !== me ? (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setConfirm(m)}
                  aria-label={`Remove ${m.email}`}
                >
                  Remove
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      </section>

      {invites.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Pending invitations</div>
          <div className="card">
            {invites.map((i) => (
              <div className="rt-member-row" key={i.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="rt-member-name">{i.email}</div>
                  <div className="rt-member-email">Expires {fmtDate(i.expiresAt)}</div>
                </div>
                <span className="pill">{i.role}</span>
                {allowed ? (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="revoke" />
                    <input type="hidden" name="inviteId" value={i.id} />
                    <button className="btn btn-secondary btn-sm">Revoke</button>
                  </fetcher.Form>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {confirm && (
        <ConfirmDialog
          title={`Remove ${confirm.name || confirm.email}?`}
          body="They'll lose access to this workspace immediately. Their account and any other workspaces are unaffected."
          confirmLabel="Remove"
          destructive
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            fetcher.submit({ intent: "remove", userId: confirm.id }, { method: "post" });
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
