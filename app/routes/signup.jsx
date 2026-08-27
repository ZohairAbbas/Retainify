/**
 * Create an account and its first workspace.
 *
 * One screen, not a wizard: email, password, and what to call the workspace.
 * Everything else (sender identity, contacts, first flow) belongs to the
 * onboarding that runs once they're inside, where we can show it in context.
 */
import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { AuthShell, Field, FormError, PasswordField } from "../components/auth/AuthShell.jsx";
import { signUp } from "../lib/auth/accounts.server.js";
import { createSession, getSession } from "../lib/auth/session.server.js";
import { sendWelcomeEmail } from "../lib/auth/mail.server.js";
import { MIN_PASSWORD_LENGTH } from "../lib/auth/password-rules.js";
import { hit } from "../lib/security/rate-limit.server.js";
import { clientIp } from "../lib/security/ip.server.js";

const LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

export const loader = async ({ request }) => {
  if (await getSession(request)) throw redirect("/app");
  return { minLength: MIN_PASSWORD_LENGTH };
};

export const action = async ({ request }) => {
  const fd = await request.formData();
  const email = String(fd.get("email") || "");
  const name = String(fd.get("name") || "");
  const workspaceName = String(fd.get("workspaceName") || "");
  const password = String(fd.get("password") || "");

  if (!hit(`signup:${clientIp(request)}`, LIMIT, WINDOW_MS).allowed) {
    return { error: "Too many sign-ups from this network. Try again later.", values: { email, name, workspaceName } };
  }

  const result = await signUp({ email, password, name, workspaceName });
  if (!result.ok) {
    return { error: result.error, field: result.field, values: { email, name, workspaceName } };
  }

  // Best effort — a failed welcome email must never cost someone their account.
  sendWelcomeEmail({
    to: result.user.email,
    name: result.user.name,
    workspaceName: result.account.name,
  }).catch(() => {});

  const { cookie } = await createSession({
    request,
    userId: result.user.id,
    accountId: result.account.id,
  });
  return redirect("/app/onboarding", { headers: { "Set-Cookie": cookie } });
};

export default function Signup() {
  const data = useActionData();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const v = data?.values || {};

  return (
    <AuthShell
      title="Start sending"
      subtitle="Create your workspace. Free to begin, no card required."
      trust="We never email your contacts without you sending it."
      footer={
        <>
          Already have an account? <Link className="auth-link" to="/login">Sign in</Link>
        </>
      }
    >
      <FormError>{data?.error}</FormError>

      <Form method="post" className="auth-form" replace>
        <Field
          label="Your name"
          name="name"
          autoComplete="name"
          placeholder="Sam Rivera"
          defaultValue={v.name || ""}
          autoFocus
        />
        <Field
          label="Work email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@company.com"
          required
          defaultValue={v.email || ""}
          error={data?.field === "email"}
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short phrase beats a scrambled word.`}
          error={data?.field === "password"}
        />
        <Field
          label="Workspace name"
          name="workspaceName"
          placeholder="Northwind Coffee"
          defaultValue={v.workspaceName || ""}
          hint="Your company or list name. You can change this later."
        />
        <button className="btn btn-primary auth-submit" disabled={busy}>
          {busy ? "Creating your workspace…" : "Create account"}
        </button>
      </Form>
    </AuthShell>
  );
}
