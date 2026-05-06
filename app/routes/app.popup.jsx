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
      {
        intent: "save-popup",
        headline,
        bodyText,
        buttonText,
        brandColor,
        logoUrl,
        discountPct,
        delayMs,
      },
      { method: "post" },
    );
  }

  function toggleEnabled() {
    toggleFetcher.submit({ intent: "toggle-enabled" }, { method: "post" });
  }

  return (
    <s-page heading="Popup">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 480px", gap: "20px", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <s-section heading="Status">
            <s-stack direction="inline" gap="base" align="center" justify="space-between">
              <s-stack direction="block" gap="tight">
                <s-text variant="bodyLg">{enabled ? "Enabled" : "Disabled"}</s-text>
                <s-text tone="subdued" variant="bodySm">
                  {enabled
                    ? "The popup will appear on your storefront."
                    : "Toggle on to start showing the popup on your storefront."}
                </s-text>
              </s-stack>
              <ToggleSwitch
                checked={enabled}
                onChange={toggleEnabled}
                disabled={toggleFetcher.state !== "idle"}
              />
            </s-stack>
          </s-section>

          <s-section heading="Content">
            <s-form-layout>
              <s-text-field
                label="Headline"
                value={headline}
                onInput={(e) => setHeadline(e.target.value)}
              />
              <s-text-field
                label="Body text"
                value={bodyText}
                onInput={(e) => setBodyText(e.target.value)}
              />
              <s-text-field
                label="Button text"
                value={buttonText}
                onInput={(e) => setButtonText(e.target.value)}
              />
            </s-form-layout>
          </s-section>

          <s-section heading="Appearance">
            <s-form-layout>
              <s-text-field
                label="Button color"
                value={brandColor}
                onInput={(e) => setBrandColor(e.target.value)}
                placeholder="#000000"
                helpText="Hex color for the CTA button."
              />
              <s-text-field
                label="Logo URL (optional)"
                value={logoUrl}
                onInput={(e) => setLogoUrl(e.target.value)}
                placeholder="https://yourstore.com/logo.png"
              />
            </s-form-layout>
          </s-section>

          <s-section heading="Discount & timing">
            <s-form-layout>
              <s-select
                label="Discount percentage"
                value={discountPct}
                onChange={(e) => setDiscountPct(e.target?.value ?? e.detail?.value ?? discountPct)}
                helpText="Applied to the auto-generated single-use code sent after email confirmation."
              >
                <s-option value="5">5%</s-option>
                <s-option value="10">10%</s-option>
                <s-option value="15">15%</s-option>
                <s-option value="20">20%</s-option>
                <s-option value="25">25%</s-option>
              </s-select>
              <s-select
                label="Trigger delay"
                value={delayMs}
                onChange={(e) => setDelayMs(e.target?.value ?? e.detail?.value ?? delayMs)}
                helpText="Time before the popup appears on the storefront."
              >
                <s-option value="3000">3 seconds</s-option>
                <s-option value="10000">10 seconds</s-option>
                <s-option value="20000">20 seconds</s-option>
                <s-option value="30000">30 seconds</s-option>
                <s-option value="45000">45 seconds</s-option>
                <s-option value="60000">60 seconds</s-option>
              </s-select>
            </s-form-layout>
          </s-section>
        </div>

        <div style={{ position: "sticky", top: "16px" }}>
          <s-section heading="Live preview">
            <div style={{
              background: "#6d7175",
              borderRadius: "8px",
              padding: "32px 16px",
              minHeight: "480px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <div style={{
                background: "#fff",
                borderRadius: "12px",
                padding: "36px 32px",
                width: "100%",
                maxWidth: "360px",
                boxShadow: "0 20px 60px rgba(0,0,0,.18)",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                position: "relative",
              }}>
                <div style={{
                  position: "absolute", top: "12px", right: "14px",
                  fontSize: "20px", color: "#888", lineHeight: 1,
                }}>×</div>
                {logoUrl && (
                  <img src={logoUrl} alt="logo" style={{
                    display: "block", maxHeight: "48px", maxWidth: "160px",
                    margin: "0 auto 16px",
                  }} />
                )}
                <h2 style={{
                  margin: "0 0 8px", fontSize: "22px", fontWeight: 700,
                  color: "#111", textAlign: "center",
                }}>
                  {headline || "Wait — don't go yet!"}
                </h2>
                <p style={{
                  margin: "0 0 20px", fontSize: "14px", color: "#555",
                  textAlign: "center", lineHeight: 1.6,
                }}>
                  {bodyText || "Enter your email for an exclusive discount on your first order."}
                </p>
                <input
                  type="email"
                  placeholder="your@email.com"
                  readOnly
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "12px 14px",
                    border: "1.5px solid #ddd", borderRadius: "8px", fontSize: "15px",
                    outline: "none", marginBottom: "10px",
                  }}
                />
                <button type="button" style={{
                  width: "100%", padding: "13px", background: brandColor || "#000",
                  color: "#fff", border: "none", borderRadius: "8px",
                  fontSize: "15px", fontWeight: 600, cursor: "default",
                }}>
                  {buttonText || "Get my discount"}
                </button>
                {Number(discountPct) > 0 && (
                  <p style={{
                    marginTop: "10px", fontSize: "11px", color: "#aaa",
                    textAlign: "center",
                  }}>
                    By subscribing you agree to receive marketing emails. Unsubscribe anytime.
                  </p>
                )}
              </div>
            </div>
          </s-section>
        </div>
      </div>

      <div style={{ marginTop: "20px" }}>
        <s-page-actions>
          <s-button
            slot="primaryAction"
            onClick={save}
            {...(saving ? { loading: true } : {})}
          >
            {saved ? "Saved!" : "Save settings"}
          </s-button>
        </s-page-actions>
      </div>
    </s-page>
  );
}

function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      style={{
        width: "44px",
        height: "24px",
        borderRadius: "12px",
        background: checked ? "#0c5132" : "#c9cccf",
        border: "none",
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.2s",
        opacity: disabled ? 0.6 : 1,
        padding: 0,
      }}
    >
      <span style={{
        position: "absolute",
        top: "2px",
        left: checked ? "22px" : "2px",
        width: "20px",
        height: "20px",
        borderRadius: "50%",
        background: "#fff",
        transition: "left 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,.2)",
      }} />
    </button>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
