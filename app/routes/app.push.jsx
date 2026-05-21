import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { sendPushNotification } from "../lib/push/web-push.server.js";
import Icons from "../components/ui/Icons.jsx";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [settings, subCount] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.pushSubscription.count({ where: { shop, isActive: true } }),
  ]);

  return { settings: settings ?? {}, subCount };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent === "toggle-push-enabled") {
    const current = await prisma.shopSettings.findUnique({ where: { shop } });
    await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, pushEnabled: true },
      update: { pushEnabled: !current?.pushEnabled },
    });
    return { ok: true };
  }

  if (intent === "send-test") {
    const title = String(fd.get("title") || "Test notification");
    const body = String(fd.get("body") || "This is a test push from Retainify.");
    const url = String(fd.get("url") || "/");

    const subs = await prisma.pushSubscription.findMany({
      where: { shop, isActive: true },
      take: 5,
    });

    if (!subs.length) return { ok: false, error: "No active subscribers yet." };

    let sent = 0;
    for (const sub of subs) {
      const result = await sendPushNotification(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title, body, url },
      );
      if (result.ok) sent++;
      if (result.gone) {
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { isActive: false, unsubscribedAt: new Date() },
        });
      }
    }

    return { ok: true, sent };
  }

  return { ok: false };
};

export default function PushPage() {
  const { settings, subCount } = useLoaderData();
  const fetcher = useFetcher();

  const pushEnabled = settings.pushEnabled ?? false;
  const saving = fetcher.state !== "idle";
  const testResult = fetcher.data;

  function toggle() {
    const fd = new FormData();
    fd.set("intent", "toggle-push-enabled");
    fetcher.submit(fd, { method: "post" });
  }

  function sendTest(e) {
    e.preventDefault();
    fetcher.submit(e.currentTarget, { method: "post" });
  }

  return (
    <div className="rt-page-shell">
      <div className="rt-page-header">
        <div>
          <h1 className="t-h1">Push Notifications</h1>
          <p className="t-small muted" style={{ marginTop: 4 }}>
            Send browser push notifications to your subscribers.
          </p>
        </div>
      </div>

      <div className="rt-page-body" style={{ maxWidth: 680 }}>
        {/* Status card */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="t-h3" style={{ marginBottom: 4 }}>Push channel</div>
              <div className="t-small muted">
                When enabled, the popup will prompt visitors for push permission after email capture.
              </div>
            </div>
            <label className="rt-toggle" style={{ flexShrink: 0, marginLeft: 24 }}>
              <input type="checkbox" checked={pushEnabled} onChange={toggle} disabled={saving} />
              <span className="rt-toggle-switch" />
            </label>
          </div>

          <div style={{ marginTop: 20, display: "flex", gap: 32 }}>
            <div>
              <div className="t-micro muted">Active subscribers</div>
              <div className="t-h2 t-mono" style={{ marginTop: 4 }}>{subCount}</div>
            </div>
            <div>
              <div className="t-micro muted">Status</div>
              <div style={{ marginTop: 4 }}>
                <span className={`pill ${pushEnabled ? "active" : "draft"}`}>
                  {pushEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Setup instructions */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="t-h3" style={{ marginBottom: 8 }}>How it works</div>
          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }} className="t-small muted">
            <li>Make sure the <strong>Retainify Popup</strong> app embed block is enabled in your theme (Online Store → Themes → Customize → App embeds).</li>
            <li>When a visitor submits their email in the popup, they'll be prompted to allow push notifications.</li>
            <li>Add a <strong>Push Notification</strong> step to any flow to send pushes to enrolled subscribers.</li>
          </ol>
        </div>

        {/* Test notification */}
        <div className="card">
          <div className="t-h3" style={{ marginBottom: 4 }}>Send a test notification</div>
          <div className="t-small muted" style={{ marginBottom: 16 }}>
            Sends to up to 5 active subscribers for this shop.
          </div>
          <fetcher.Form method="post" onSubmit={sendTest}>
            <input type="hidden" name="intent" value="send-test" />
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label className="field-label">Title</label>
                <input className="input" name="title" defaultValue="Hello from Retainify" maxLength={65} />
              </div>
              <div>
                <label className="field-label">Body</label>
                <input className="input" name="body" defaultValue="Your cart is waiting for you." maxLength={200} />
              </div>
              <div>
                <label className="field-label">Click URL</label>
                <input className="input" name="url" defaultValue="/" placeholder="/" />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button className="btn btn-primary" type="submit" disabled={saving || subCount === 0}>
                  <Icons.Send size={14} /> Send test
                </button>
                {subCount === 0 && (
                  <span className="t-small muted">No subscribers yet — accept push permission in your storefront first.</span>
                )}
              </div>
              {testResult?.ok === true && testResult.sent !== undefined && (
                <div className="t-small" style={{ color: "var(--success-ink)" }}>
                  Sent to {testResult.sent} subscriber{testResult.sent !== 1 ? "s" : ""}.
                </div>
              )}
              {testResult?.ok === false && testResult.error && (
                <div className="t-small" style={{ color: "var(--danger-ink)" }}>{testResult.error}</div>
              )}
            </div>
          </fetcher.Form>
        </div>
      </div>
    </div>
  );
}
