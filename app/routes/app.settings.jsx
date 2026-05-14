import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  return { settings: settings ?? {} };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-settings") {
    const senderName = String(formData.get("senderName") || "").trim();
    const senderEmail = String(formData.get("senderEmail") || "").trim();
    const replyTo = String(formData.get("replyTo") || "").trim();
    const brandColor = String(formData.get("brandColor") || "#000000").trim();
    const logoUrl = String(formData.get("logoUrl") || "").trim();
    const quietHoursStart = parseInt(formData.get("quietHoursStart") || "22", 10);
    const quietHoursEnd = parseInt(formData.get("quietHoursEnd") || "8", 10);
    const storeTimezone = String(formData.get("storeTimezone") || "UTC").trim();

    await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, senderName, senderEmail, replyTo, brandColor, logoUrl, quietHoursStart, quietHoursEnd, storeTimezone },
      update: { senderName, senderEmail, replyTo, brandColor, logoUrl, quietHoursStart, quietHoursEnd, storeTimezone },
    });
    return { ok: true, saved: true };
  }

  return { ok: false };
};

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  label: `${i.toString().padStart(2, "0")}:00`,
  value: String(i),
}));

export default function Settings() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const saved = fetcher.data?.saved;

  const [senderName, setSenderName] = useState(settings.senderName || "");
  const [senderEmail, setSenderEmail] = useState(settings.senderEmail || "");
  const [replyTo, setReplyTo] = useState(settings.replyTo || "");
  const [brandColor, setBrandColor] = useState(settings.brandColor || "#000000");
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || "");
  const [quietHoursStart, setQuietHoursStart] = useState(String(settings.quietHoursStart ?? "22"));
  const [quietHoursEnd, setQuietHoursEnd] = useState(String(settings.quietHoursEnd ?? "8"));
  const [storeTimezone, setStoreTimezone] = useState(settings.storeTimezone || "UTC");

  function saveSettings() {
    fetcher.submit(
      {
        intent: "save-settings",
        senderName,
        senderEmail,
        replyTo,
        brandColor,
        logoUrl,
        quietHoursStart,
        quietHoursEnd,
        storeTimezone,
      },
      { method: "post" },
    );
  }

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Settings</h1>
        </div>
      </header>

      <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Sender details */}
        <section className="rt-form-section">
          <div className="t-micro muted" style={{ marginBottom: 16 }}>Sender details</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label className="field-label">Sender name</label>
              <input
                className="input"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="Your Store"
              />
              <div className="field-help">Shown as the From name in emails.</div>
            </div>
            <div>
              <label className="field-label">Sender email</label>
              <input
                className="input"
                type="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                placeholder="hello@yourstore.com"
              />
            </div>
            <div>
              <label className="field-label">Reply-to email</label>
              <input
                className="input"
                type="email"
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                placeholder="support@yourstore.com"
              />
            </div>
          </div>
        </section>

        {/* Brand */}
        <section className="rt-form-section">
          <div className="t-micro muted" style={{ marginBottom: 16 }}>Brand</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label className="field-label">Brand color</label>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  style={{ width: 40, height: 36, padding: 2, border: "1px solid var(--hair-1)", borderRadius: "var(--r-2)", cursor: "pointer", background: "none" }}
                />
                <input
                  className="input"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  placeholder="#000000"
                  style={{ flex: 1 }}
                />
              </div>
              <div className="field-help">Hex color used for buttons and accents in emails.</div>
            </div>
            <div>
              <label className="field-label">Logo URL</label>
              <input
                className="input"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://yourstore.com/logo.png"
              />
              <div className="field-help">Shown at the top of every recovery email.</div>
            </div>
          </div>
        </section>

        {/* Quiet hours */}
        <section className="rt-form-section">
          <div className="t-micro muted" style={{ marginBottom: 4 }}>Quiet hours</div>
          <div className="t-small muted" style={{ marginBottom: 16 }}>
            Emails will not be sent during this window.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label className="field-label">Start (don&apos;t send after)</label>
              <select
                className="select"
                value={quietHoursStart}
                onChange={(e) => setQuietHoursStart(e.target.value)}
              >
                {HOURS.map((h) => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">End (resume sending after)</label>
              <select
                className="select"
                value={quietHoursEnd}
                onChange={(e) => setQuietHoursEnd(e.target.value)}
              >
                {HOURS.map((h) => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Store timezone</label>
              <input
                className="input"
                value={storeTimezone}
                onChange={(e) => setStoreTimezone(e.target.value)}
                placeholder="Asia/Karachi"
              />
              <div className="field-help">
                IANA timezone e.g. Asia/Dubai, Asia/Kolkata, America/New_York
              </div>
            </div>
          </div>
        </section>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn btn-primary"
            onClick={saveSettings}
            disabled={saving}
          >
            {saved && !saving ? "Saved!" : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
