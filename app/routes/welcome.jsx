/**
 * The "you belong to no workspace" screen.
 *
 * Reachable when a user's only membership was removed, or when they signed up
 * through an invitation that has since been revoked. Without this they'd hit a
 * redirect loop between /app and /login, both of which have a valid session and
 * nothing to show.
 */
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { AuthShell, Field, FormError } from "../components/auth/AuthShell.jsx";
import prisma from "../db.server.js";
import { generateAccountKey, listWorkspaces } from "../lib/auth/accounts.server.js";
import { getSession, switchAccount } from "../lib/auth/session.server.js";

export const loader = async ({ request }) => {
  const session = await getSession(request);
  if (!session) throw redirect("/login");

  const workspaces = await listWorkspaces(session.user.id);
  return { name: session.user.name || "", email: session.user.email, workspaces };
};

export const action = async ({ request }) => {
  const session = await getSession(request);
  if (!session) throw redirect("/login");

  const fd = await request.formData();

  // Switching into one they already belong to.
  const open = String(fd.get("open") || "");
  if (open) {
    const allowed = await prisma.membership.findFirst({
      where: { userId: session.user.id, accountId: open },
    });
    if (!allowed) return { error: "You don't have access to that workspace." };
    await switchAccount(session.id, open);
    return redirect("/app");
  }

  const workspaceName = String(fd.get("workspaceName") || "").trim();
  if (!workspaceName) return { error: "Give your workspace a name." };

  const key = await generateAccountKey(workspaceName);
  const account = await prisma.$transaction(async (tx) => {
    const acc = await tx.account.create({
      data: { key, name: workspaceName, kind: "direct" },
    });
    await tx.membership.create({
      data: { userId: session.user.id, accountId: acc.id, role: "owner" },
    });
    await tx.shopSettings.create({
      data: {
        shop: key,
        senderName: workspaceName,
        replyTo: session.user.email,
        onboardingStep: 0,
        isActive: false,
      },
    });
    return acc;
  });

  await switchAccount(session.id, account.id);
  return redirect("/app/onboarding");
};

export default function Welcome() {
  const { name, email, workspaces } = useLoaderData();
  const data = useActionData();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <AuthShell
      title={workspaces.length ? "Choose a workspace" : "Create a workspace"}
      subtitle={
        workspaces.length
          ? `Signed in as ${email}`
          : `Hi${name ? ` ${name}` : ""} — you're not in a workspace yet. Make one to get started.`
      }
      footer={
        <Form method="post" action="/logout">
          <button className="auth-link" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}>
            Sign out
          </button>
        </Form>
      }
    >
      <FormError>{data?.error}</FormError>

      {workspaces.length > 0 && (
        <div className="auth-ws-list">
          {workspaces.map((w) => (
            <Form method="post" key={w.id}>
              <input type="hidden" name="open" value={w.id} />
              <button className="auth-ws" disabled={busy}>
                <span className="auth-ws-name">{w.name}</span>
                <span className="auth-ws-meta">{w.role}</span>
              </button>
            </Form>
          ))}
        </div>
      )}

      <Form method="post" className="auth-form" replace>
        <Field
          label={workspaces.length ? "Or create another workspace" : "Workspace name"}
          name="workspaceName"
          placeholder="Acme Inc"
          required
          autoFocus={workspaces.length === 0}
        />
        <button className="btn btn-primary btn-lg auth-submit" disabled={busy}>
          {busy ? "Creating…" : "Create workspace"}
        </button>
      </Form>
    </AuthShell>
  );
}
