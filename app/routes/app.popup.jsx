import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const popup = await prisma.popupSettings.findUnique({ where: { shop } });
  return { popup: popup ?? {} };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle-enabled") {
    const current = await prisma.popupSettings.findUnique({ where: { shop } });
    await prisma.popupSettings.upsert({
      where: { shop },
      create: { shop, enabled: true },
      update: { enabled: !current?.enabled },
    });
    return { ok: true, toggled: true };
  }

  if (intent !== "save-popup") return { ok: false };

  const headline = String(formData.get("headline") || "").trim();
  const bodyText = String(formData.get("bodyText") || "").trim();
  const buttonText = String(formData.get("buttonText") || "").trim();
  const brandColor = String(formData.get("brandColor") || "#000000").trim();
  const logoUrl = String(formData.get("logoUrl") || "").trim();
  const discountPct = parseInt(formData.get("discountPct") || "10", 10);
  const delayMs = parseInt(formData.get("delayMs") || "30000", 10);

  await prisma.popupSettings.upsert({
    where: { shop },
    create: { shop, headline, bodyText, buttonText, brandColor, logoUrl, discountPct, delayMs },
    update: { headline, bodyText, buttonText, brandColor, logoUrl, discountPct, delayMs },
  });

  return { ok: true, saved: true };
};

export default function PopupSettings() {
  const { popup } = useLoaderData();
  const fetcher = useFetcher();
  const toggleFetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const saved = fetcher.data?.saved;

  const [headline, setHeadline] = useState(popup.headline || "Wait — don't go yet!");
  const [bodyText, setBodyText] = useState(popup.bodyText || "Enter your email and get 10% off your first order.");
  const [buttonText, setButtonText] = useState(popup.buttonText || "Get my discount");
  const [brandColor, setBrandColor] = useState(popup.brandColor || "#000000");
  const [logoUrl, setLogoUrl] = useState(popup.logoUrl || "");
  const [discountPct, setDiscountPct] = useState(String(popup.discountPct ?? 10));
  const [delayMs, setDelayMs] = useState(String(popup.delayMs ?? 30000));

  const enabled = popup.enabled !== false;

  function save() {
    fetcher.submit(
      { intent: "save-popup", headline, bodyText, buttonText, brandColor, logoUrl, discountPct, delayMs },
      { method: "post" },
    );
  }

  function toggleEnabled() {
    toggleFetcher.submit({ intent: "toggle-enabled" }, { method: "post" });
  }

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Popup</h1>
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
                  {enabled ? "Enabled" : "Disabled"}
                </div>
                <div className="t-small muted" style={{ marginTop: 2 }}>
                  {enabled
                    ? "The popup will appear on your storefront."
                    : "Toggle on to start showing the popup on your storefront."}
                </div>
              </div>
              <label className="rt-toggle">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={toggleEnabled}
                  disabled={toggleFetcher.state !== "idle"}
                />
                <span className="rt-toggle-switch" />
              </label>
            </div>
          </section>

          {/* Content */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>Content</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label className="field-label">Headline</label>
                <input
                  className="input"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Body text</label>
                <input
                  className="input"
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Button text</label>
                <input
                  className="input"
                  value={buttonText}
                  onChange={(e) => setButtonText(e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* Appearance */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>Appearance</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label className="field-label">Button color</label>
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
                <div className="field-help">Hex color for the CTA button.</div>
              </div>
              <div>
                <label className="field-label">Logo URL (optional)</label>
                <input
                  className="input"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://yourstore.com/logo.png"
                />
              </div>
            </div>
          </section>

          {/* Discount & timing */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>Discount &amp; timing</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label className="field-label">Discount percentage</label>
                <select
                  className="select"
                  value={discountPct}
                  onChange={(e) => setDiscountPct(e.target.value)}
                >
                  <option value="5">5%</option>
                  <option value="10">10%</option>
                  <option value="15">15%</option>
                  <option value="20">20%</option>
                  <option value="25">25%</option>
                </select>
                <div className="field-help">
                  Applied to the auto-generated single-use code sent after email confirmation.
                </div>
              </div>
              <div>
                <label className="field-label">Trigger delay</label>
                <select
                  className="select"
                  value={delayMs}
                  onChange={(e) => setDelayMs(e.target.value)}
                >
                  <option value="3000">3 seconds</option>
                  <option value="10000">10 seconds</option>
                  <option value="20000">20 seconds</option>
                  <option value="30000">30 seconds</option>
                  <option value="45000">45 seconds</option>
                  <option value="60000">60 seconds</option>
                </select>
                <div className="field-help">Time before the popup appears on the storefront.</div>
              </div>
            </div>
          </section>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saved && !saving ? "Saved!" : "Save settings"}
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
            alignItems: "center",
            justifyContent: "center",
          }}>
            <div style={{
              background: "#fff",
              borderRadius: 12,
              padding: "36px 32px",
              width: "100%",
              maxWidth: 340,
              boxShadow: "0 20px 60px rgba(0,0,0,.22)",
              fontFamily: "var(--font-ui)",
              position: "relative",
            }}>
              <div style={{
                position: "absolute", top: 12, right: 14,
                fontSize: 20, color: "#aaa", lineHeight: 1, cursor: "default",
              }}>×</div>
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt="logo"
                  style={{ display: "block", maxHeight: 48, maxWidth: 160, margin: "0 auto 16px" }}
                />
              )}
              <h2 style={{
                margin: "0 0 8px", fontSize: 20, fontWeight: 700,
                color: "#111", textAlign: "center", lineHeight: 1.3,
              }}>
                {headline || "Wait — don't go yet!"}
              </h2>
              <p style={{
                margin: "0 0 20px", fontSize: 13, color: "#666",
                textAlign: "center", lineHeight: 1.6,
              }}>
                {bodyText || "Enter your email for an exclusive discount on your first order."}
              </p>
              <input
                type="email"
                placeholder="your@email.com"
                readOnly
                style={{
                  width: "100%", boxSizing: "border-box", padding: "11px 14px",
                  border: "1.5px solid #e0e0e0", borderRadius: 8, fontSize: 14,
                  outline: "none", marginBottom: 10,
                }}
              />
              <button
                type="button"
                style={{
                  width: "100%", padding: "12px",
                  background: brandColor || "#000",
                  color: "#fff", border: "none", borderRadius: 8,
                  fontSize: 14, fontWeight: 600, cursor: "default",
                }}
              >
                {buttonText || "Get my discount"}
              </button>
              {Number(discountPct) > 0 && (
                <p style={{ marginTop: 10, fontSize: 11, color: "#bbb", textAlign: "center" }}>
                  By subscribing you agree to receive marketing emails. Unsubscribe anytime.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
