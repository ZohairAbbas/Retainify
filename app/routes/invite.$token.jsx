/**
 * Accept an invitation to a workspace.
 *
 * Three cases arrive on this URL and all three are handled here rather than by
 * bouncing between pages:
 *
 *   1. Brand new person  → set a password, get an account, join.
 *   2. Existing user, signed out → sign in with their password, join.
 *   3. Existing user, already signed in → one click to join.
 *
 * The invited address is authoritative. Someone signed in as another user gets
 * told whose invitation it is rather than silently joining the wrong account
 * to a workspace they were never invited to.
 */
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { AuthShell, Field, FormError, FormNotice, PasswordField } from "../components/auth/AuthShell.jsx";
import prisma from "../db.server.js";
import { addMember, consumeToken, peekToken } from "../lib/auth/accounts.server.js";
import { hashPassword, verifyPassword } from "../lib/auth/password.server.js";
import { MIN_PASSWORD_LENGTH } from "../lib/auth/password-rules.js";
import { createSession, getSession } from "../lib/auth/session.server.js";

export const loader = async ({ request, params }) => {
  const invite = await peekToken(params.token, "invite");
  if (!invite) return { valid: false };

  const session = await getSession(request);
  const existing = await prisma.user.findUnique({ where: { email: invite.email } });

  return {
    valid: true,
    email: invite.email,
    role: invite.role,
    accountName: invite.account?.name || "the workspace",
    // Which of the three cases this is.
    mode: session
      ? session.user.email === invite.email ? "signed-in" : "wrong-user"
      : existing?.passwordHash ? "sign-in" : "sign-up",
    signedInAs: session?.user?.email || "",
  };
};

export const action = async ({ request, params }) => {
  const fd = await request.formData();
  const password = String(fd.get("password") || "");

  const invite = await peekToken(params.token, "invite");
  if (!invite || !invite.accountId) {
    return { error: "This invitation has expired or already been used." };
  }

  const session = await getSession(request);
  let userId = null;
  let setCookie = null;

  if (session && session.user.email === invite.email) {
    // Already the right person — nothing to verify.
    userId = session.user.id;
  } else {
    const existing = await prisma.user.findUnique({ where: { email: invite.email } });

    if (existing?.passwordHash) {
      // Known account: their existing password is the proof of identity. The
      // invitation alone must not be enough to take over an account that has a
      // password, or a forwarded email becomes an account takeover.
      const ok = await verifyPassword(password, existing.passwordHash);
      if (!ok) return { error: "That password doesn't match this account." };
      userId = existing.id;
    } else {
      if (password.length < MIN_PASSWORD_LENGTH) {
        return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
      }
      const passwordHash = await hashPassword(password);
      const user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            // The invite proves control of the mailbox, so mark it verified.
            data: { passwordHash, emailVerifiedAt: new Date() },
          })
        : await prisma.user.create({
            data: {
              email: invite.email,
              name: String(fd.get("name") || "").trim(),
              passwordHash,
              emailVerifiedAt: new Date(),
            },
          });
      userId = user.id;
    }

    const created = await createSession({ request, userId, accountId: invite.accountId });
    setCookie = created.cookie;
  }

  // Consume last: everything above can fail and be retried, but a consumed
  // token cannot be handed back.
  const consumed = await consumeToken(params.token, "invite");
  if (!consumed) return { error: "This invitation has already been used." };

  await addMember(invite.accountId, userId, invite.role);

  return redirect("/app", setCookie ? { headers: { "Set-Cookie": setCookie } } : undefined);
};

export default function AcceptInvite() {
  const data = useLoaderData();
  const result = useActionData();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  if (!data.valid) {
    return (
      <AuthShell
        title="Invitation not valid"
        subtitle="Invitations expire after 7 days and work only once."
        footer={<Link className="auth-link" to="/login">Go to sign in</Link>}
      >
        <FormNotice tone="warn">
          Ask whoever invited you to send a fresh invitation.
        </FormNotice>
      </AuthShell>
    );
  }

  if (data.mode === "wrong-user") {
    return (
      <AuthShell
        title={`Invitation for ${data.email}`}
        subtitle={`You're signed in as ${data.signedInAs}.`}
      >
        <FormNotice tone="info">
          Sign out and open this link again to accept it as {data.email}.
        </FormNotice>
        <Form method="post" action="/logout" className="auth-form">
          <button className="btn btn-secondary btn-lg auth-submit">Sign out</button>
        </Form>
      </AuthShell>
    );
  }

  const isNew = data.mode === "sign-up";

  return (
    <AuthShell
      title={`Join ${data.accountName}`}
      subtitle={
        data.mode === "signed-in"
          ? `You'll join as ${data.role}.`
          : `Invitation for ${data.email} · joining as ${data.role}`
      }
    >
      <FormError>{result?.error}</FormError>

      <Form method="post" className="auth-form" replace>
        {data.mode === "signed-in" ? null : isNew ? (
          <>
            <Field label="Your name" name="name" autoComplete="name" autoFocus />
            <PasswordField
              label="Create a password"
              name="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            />
          </>
        ) : (
          <PasswordField
            label="Your password"
            name="password"
            autoComplete="current-password"
            required
            autoFocus
            hint="You already have a Retainify account with this address."
          />
        )}
        <button className="btn btn-primary btn-lg auth-submit" disabled={busy}>
          {busy ? "Joining…" : `Join ${data.accountName}`}
        </button>
      </Form>
    </AuthShell>
  );
}
