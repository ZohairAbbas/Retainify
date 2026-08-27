/**
 * Sign in with email and password.
 *
 * Lives at the top level rather than under /app, because /app requires a
 * session and this is where you go to get one.
 */
import { Form, Link, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import { AuthShell, Field, FormError, FormNotice, PasswordField } from "../components/auth/AuthShell.jsx";
import { signIn, listWorkspaces } from "../lib/auth/accounts.server.js";
import { createSession, getSession } from "../lib/auth/session.server.js";
import { hit } from "../lib/security/rate-limit.server.js";
import { clientIp } from "../lib/security/ip.server.js";

// Per IP, not per email: rate-limiting by email lets an attacker lock a real
// user out of their own account by hammering their address.
const LIMIT = 10;
const WINDOW_MS = 10 * 60 * 1000;

/** Only allow same-origin relative paths, so `?next=` can't become an open redirect. */
function safeNext(raw) {
  const next = String(raw || "");
  if (!next.startsWith("/") || next.startsWith("//")) return "/app";
  return next;
}

export const loader = async ({ request }) => {
  // Already signed in — don't show a login form, send them in.
  const session = await getSession(request);
  if (session) {
    const url = new URL(request.url);
    throw redirect(safeNext(url.searchParams.get("next")));
  }
  return {};
};

export const action = async ({ request }) => {
  const fd = await request.formData();
  const email = String(fd.get("email") || "");
  const password = String(fd.get("password") || "");
  const next = safeNext(fd.get("next"));

  if (!hit(`login:${clientIp(request)}`, LIMIT, WINDOW_MS).allowed) {
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  const result = await signIn({ email, password });
  if (!result.ok) return { error: result.error, email };

  const workspaces = await listWorkspaces(result.user.id);
  const { cookie } = await createSession({
    request,
    userId: result.user.id,
    accountId: workspaces[0]?.id || null,
  });

  // No workspace yet (their last one was deleted, or they were only ever an
  // invitee who was removed) — /welcome lets them make one.
  return redirect(workspaces.length ? next : "/welcome", {
    headers: { "Set-Cookie": cookie },
  });
};

export default function Login() {
  const data = useActionData();
  const nav = useNavigation();
  const [params] = useSearchParams();
  const busy = nav.state !== "idle";
  const notice = params.get("notice");

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      trust="Your session is encrypted and expires automatically."
      footer={
        <>
          New to Retainify? <Link className="auth-link" to="/signup">Create an account</Link>
        </>
      }
    >
      {notice === "reset" && (
        <FormNotice tone="success">
          Password updated. Sign in with your new one.
        </FormNotice>
      )}
      {notice === "signed-out" && (
        <FormNotice tone="info">You&apos;ve been signed out.</FormNotice>
      )}

      <FormError>{data?.error}</FormError>

      <Form method="post" className="auth-form" replace>
        <input type="hidden" name="next" value={params.get("next") || ""} />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@company.com"
          required
          autoFocus
          error={!!data?.error}
          defaultValue={data?.email || ""}
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          required
          error={!!data?.error}
          action={<Link className="auth-link" to="/forgot">Forgot?</Link>}
        />
        <button className="btn btn-primary auth-submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </Form>
    </AuthShell>
  );
}
