/**
 * Request a password reset link.
 *
 * The response is identical whether or not the address is registered. Telling
 * an anonymous visitor which emails have accounts is exactly the enumeration
 * oracle the sign-in page already refuses to be.
 */
import { Form, Link, useActionData, useNavigation } from "react-router";
import { AuthShell, Field, FormNotice } from "../components/auth/AuthShell.jsx";
import prisma from "../db.server.js";
import { createPasswordReset, normalizeEmail } from "../lib/auth/accounts.server.js";
import { sendPasswordResetEmail } from "../lib/auth/mail.server.js";
import { hit } from "../lib/security/rate-limit.server.js";
import { clientIp } from "../lib/security/ip.server.js";

const LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

const SENT = {
  sent: true,
  message: "If that address has an account, a reset link is on its way. Check your inbox.",
};

export const action = async ({ request }) => {
  const fd = await request.formData();
  const email = normalizeEmail(fd.get("email"));

  // Silently succeed when throttled: an attacker learns nothing, and a real
  // user who double-clicked sees the same confirmation they expected.
  if (!hit(`forgot:${clientIp(request)}`, LIMIT, WINDOW_MS).allowed) return SENT;
  if (!email) return SENT;

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    try {
      const { token } = await createPasswordReset(email);
      await sendPasswordResetEmail({ to: email, token });
    } catch (err) {
      // Logged, not surfaced — the response must not vary.
      console.error("[forgot] reset email failed:", err.message);
    }
  }

  return SENT;
};

export default function Forgot() {
  const data = useActionData();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <>
          Remembered it? <Link className="auth-link" to="/login">Back to sign in</Link>
        </>
      }
    >
      {data?.sent ? (
        <FormNotice tone="success">{data.message}</FormNotice>
      ) : (
        <Form method="post" className="auth-form" replace>
          <Field label="Email" name="email" type="email" autoComplete="username" required autoFocus />
          <button className="btn btn-primary btn-lg auth-submit" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </Form>
      )}
    </AuthShell>
  );
}
