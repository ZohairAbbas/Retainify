import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
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
    return { ok: true, toggled: true };
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
  const toggleFetcher = useFetcher();
  const testFetcher = useFetcher();

  const pushEnabled = settings.pushEnabled ?? false;
  const togglePending = toggleFetcher.state !== "idle";
  const sending = testFetcher.state !== "idle";
  const testResult = testFetcher.data;

  const [title, setTitle] = useState("Hello from Retainify");
  const [body, setBody] = useState("Your cart is waiting for you.");
  const [url, setUrl] = useState("/");

  function toggleEnabled() {
    toggleFetcher.submit({ intent: "toggle-push-enabled" }, { method: "post" });
  }

  function sendTest() {
    testFetcher.submit(
      { intent: "send-test", title, body, url },
      { method: "post" },
    );
  }

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Push</h1>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 24, alignItems: "start" }}>
        {/* Left: form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Status */}
          <section className="rt-form-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div className="t-micro muted" style={{ marginBottom: 4 }}>Status</div>
                <div className="t-body" style={{ fontWeight: 500 }}>
                  {pushEnabled ? "Enabled" : "Disabled"}
                </div>
                <div className="t-small muted" style={{ marginTop: 2 }}>
                  {pushEnabled
                    ? "The popup will prompt visitors for push permission after email capture."
                    : "Toggle on to start collecting push subscribers from your popup."}
                </div>
              </div>
              <label className="rt-toggle">
                <input
                  type="checkbox"
                  checked={pushEnabled}
                  onChange={toggleEnabled}
                  disabled={togglePending}
                />
                <span className="rt-toggle-switch" />
              </label>
            </div>
          </section>

          {/* Subscribers */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>Subscribers</div>
            <div style={{ display: "flex", gap: 48 }}>
              <div>
                <div className="t-display-2 t-mono" style={{ lineHeight: 1, margin: 0 }}>{subCount}</div>
                <div className="t-small muted" style={{ marginTop: 6 }}>
                  Active push subscriptions
                </div>
              </div>
            </div>
          </section>

          {/* How it works */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>How it works</div>
            <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10 }} className="t-small">
              <li className="muted">
                Make sure the <strong style={{ color: "var(--ink-1)" }}>Retainify Popup</strong> app embed is enabled in your theme.
              </li>
              <li className="muted">
                When a visitor submits their email in the popup, they'll be prompted to allow browser push notifications.
              </li>
              <li className="muted">
                Add a <strong style={{ color: "var(--ink-1)" }}>Push Notification</strong> step to any flow to send pushes to enrolled subscribers.
              </li>
            </ol>
          </section>

          {/* Test notification */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>Send a test notification</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label className="field-label">Title</label>
                <input
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={65}
                />
                <div className="field-help">{65 - title.length} characters remaining</div>
              </div>
              <div>
                <label className="field-label">Body</label>
                <input
                  className="input"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div>
                <label className="field-label">Click URL</label>
                <input
                  className="input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="/"
                />
                <div className="field-help">Where the visitor lands when they tap the notification.</div>
              </div>

              {testResult?.ok === true && testResult.sent !== undefined && (
                <div
                  className="t-small"
                  style={{
                    background: "var(--success-bg)",
                    color: "var(--success-ink)",
                    padding: "8px 12px",
                    borderRadius: "var(--r-2)",
                  }}
                >
                  Sent to {testResult.sent} subscriber{testResult.sent !== 1 ? "s" : ""}.
                </div>
              )}
              {testResult?.ok === false && testResult.error && (
                <div
                  className="t-small"
                  style={{
                    background: "var(--danger-bg)",
                    color: "var(--danger-ink)",
                    padding: "8px 12px",
                    borderRadius: "var(--r-2)",
                  }}
                >
                  {testResult.error}
                </div>
              )}
            </div>
          </section>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              className="btn btn-primary"
              onClick={sendTest}
              disabled={sending || subCount === 0}
            >
              {Icons.Send && <Icons.Send size={14} />}
              {sending ? "Sending…" : "Send test"}
            </button>
          </div>
        </div>

        {/* Right: live preview */}
        <div style={{ position: "sticky", top: 16 }}>
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Live preview</div>
          <div style={{
            background: "var(--ink-4)",
            borderRadius: "var(--r-3)",
            padding: "32px 16px",
            minHeight: 480,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
          }}>
            <NotificationPreview title={title} body={body} url={url} />
          </div>
        </div>
      </div>
    </div>
  );
}

function NotificationPreview({ title, body, url }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        borderRadius: 10,
        padding: "12px 14px",
        width: "100%",
        maxWidth: 340,
        boxShadow: "0 6px 18px rgba(0,0,0,.22)",
        fontFamily: "var(--font-ui)",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        marginTop: 8,
      }}
    >
      {/* Icon block */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: "var(--node-push-bg)",
          color: "var(--node-push-ink)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {Icons.Bell && <Icons.Bell size={20} />}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#111",
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title || "Notification"}
          </div>
          <div style={{ fontSize: 11, color: "#9aa0a6", flexShrink: 0 }}>now</div>
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#5f6368",
            marginTop: 4,
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {body || "Push notification body text."}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "#9aa0a6",
            marginTop: 6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {(url && url.startsWith("http") ? new URL(url).hostname : "yourstore.com")}
          {url && !url.startsWith("http") && url}
        </div>
      </div>
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
