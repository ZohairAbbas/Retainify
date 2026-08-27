/**
 * Choose a new password from an emailed link.
 *
 * The token is consumed only when the new password is actually accepted — a
 * GET that consumed it would let an email scanner or link-preview bot burn the
 * link before the person ever saw the form.
 */
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { AuthShell, FormError, PasswordField } from "../components/auth/AuthShell.jsx";
import prisma from "../db.server.js";
import { consumeToken, peekToken, setPassword } from "../lib/auth/accounts.server.js";
import { destroyAllSessions } from "../lib/auth/session.server.js";
import { MIN_PASSWORD_LENGTH } from "../lib/auth/password-rules.js";

export const loader = async ({ params }) => {
  const row = await peekToken(params.token, "password_reset");
  return { valid: !!row, email: row?.email || "" };
};

export const action = async ({ request, params }) => {
  const fd = await request.formData();
  const password = String(fd.get("password") || "");
  const confirm = String(fd.get("confirm") || "");

  if (password !== confirm) return { error: "Those passwords don't match." };

  // Validate BEFORE consuming: a too-short password should let them try again,
  // not invalidate the link and force a second email.
  const peeked = await peekToken(params.token, "password_reset");
  if (!peeked) {
    return { error: "This link has expired or already been used. Request a new one." };
  }
  const user = await prisma.user.findUnique({ where: { email: peeked.email } });
  if (!user) return { error: "This link is no longer valid. Request a new one." };

  const result = await setPassword(user.id, password);
  if (!result.ok) return { error: result.error };

  const consumed = await consumeToken(params.token, "password_reset");
  if (!consumed) {
    // Lost the race with another tab. The password did change, so send them to
    // sign in rather than reporting a failure that isn't one.
    return redirect("/login?notice=reset");
  }

  // Every other device holding a session was authenticated with the old
  // password. Changing it should evict them — that is what a reset is for.
  await destroyAllSessions(user.id).catch(() => {});

  return redirect("/login?notice=reset");
};

export default function Reset() {
  const { valid, email } = useLoaderData();
  const data = useActionData();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  if (!valid) {
    return (
      <AuthShell
        title="Link expired"
        subtitle="Reset links work once and last an hour."
        footer={<Link className="auth-link" to="/forgot">Request a new link</Link>}
      >
        <div className="auth-notice auth-notice-warn">
          This link has expired or has already been used.
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle={email}>
      <FormError>{data?.error}</FormError>
      <Form method="post" className="auth-form" replace>
        <PasswordField
          label="New password"
          name="password"
          autoComplete="new-password"
          required
          autoFocus
          minLength={MIN_PASSWORD_LENGTH}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        <PasswordField
          label="Confirm password"
          name="confirm"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
        />
        <button className="btn btn-primary btn-lg auth-submit" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </button>
      </Form>
    </AuthShell>
  );
}
