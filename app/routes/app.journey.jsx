import { useState, useMemo } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { renderCartRescueEmail } from "../lib/email/templates.server.js";

const SAMPLE_LINE_ITEMS = [
  {
    title: "Sample Product",
    variantTitle: "Default",
    quantity: 1,
    price: "$49.00",
    imageUrl: "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_medium.png",
    productUrl: "#",
  },
];

function buildPreview({ style, emailNumber, settings, journey }) {
  const subject =
    emailNumber === 1
      ? journey?.email1Subject
      : emailNumber === 2
        ? journey?.email2Subject
        : journey?.email3Subject;
  return renderCartRescueEmail({
    style,
    emailNumber,
    customerName: "Alex",
    lineItems: SAMPLE_LINE_ITEMS,
    totalPrice: "$49.00",
    currency: "USD",
    storeName: settings?.senderName || "Your Store",
    senderEmail: settings?.senderEmail || "noreply@yourstore.com",
    logoUrl: settings?.logoUrl || "",
    brandColor: settings?.brandColor || "#000000",
    recoveryUrl: "#",
    unsubscribeUrl: "#",
    merchantAddress: "123 Main St, Springfield",
    discountCode:
      emailNumber === 3
        ? `RETAINIFY-PREVIEW (${journey?.email3DiscountPct ?? 10}% off)`
        : undefined,
    customSubject: subject || undefined,
  });
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [settings, journey] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.journeySettings.findUnique({ where: { shop } }),
  ]);

  const settingsObj = settings ?? {};
  const journeyObj = journey ?? {};

  // Pre-render all 9 combinations (3 styles × 3 emails) so preview switching is instant
  const styles = ["classic", "bold", "minimal"];
  const previews = {};
  for (const style of styles) {
    previews[style] = {};
    for (const n of [1, 2, 3]) {
      previews[style][n] = buildPreview({
        style,
        emailNumber: n,
        settings: settingsObj,
        journey: journeyObj,
      });
    }
  }

  return { settings: settingsObj, journey: journeyObj, previews };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle-active") {
    const current = await prisma.shopSettings.findUnique({ where: { shop } });
    await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, isActive: true },
      update: { isActive: !current?.isActive },
    });
    return { ok: true, toggled: true };
  }

  if (intent === "save-journey") {
    const templateStyle = String(formData.get("templateStyle") || "classic");
    const email1Enabled = formData.get("email1Enabled") === "true";
    const email1DelayHours = parseFloat(formData.get("email1DelayHours") || "1");
    const email1Subject = String(formData.get("email1Subject") || "").trim();
    const email2Enabled = formData.get("email2Enabled") === "true";
    const email2DelayHours = parseInt(formData.get("email2DelayHours") || "24", 10);
    const email2Subject = String(formData.get("email2Subject") || "").trim();
    const email3Enabled = formData.get("email3Enabled") === "true";
    const email3DelayHours = parseInt(formData.get("email3DelayHours") || "72", 10);
    const email3Subject = String(formData.get("email3Subject") || "").trim();
    const email3DiscountPct = parseInt(formData.get("email3DiscountPct") || "10", 10);

    await prisma.journeySettings.upsert({
      where: { shop },
      create: {
        shop, templateStyle,
        email1Enabled, email1DelayHours, email1Subject,
        email2Enabled, email2DelayHours, email2Subject,
        email3Enabled, email3DelayHours, email3Subject, email3DiscountPct,
      },
      update: {
        templateStyle,
        email1Enabled, email1DelayHours, email1Subject,
        email2Enabled, email2DelayHours, email2Subject,
        email3Enabled, email3DelayHours, email3Subject, email3DiscountPct,
      },
    });
    return { ok: true, saved: true };
  }

  return { ok: false };
};

const TEMPLATES = [
  { label: "Classic", value: "classic", helpText: "Clean layout with product images." },
  { label: "Bold", value: "bold", helpText: "High-contrast brand-color header." },
  { label: "Minimal", value: "minimal", helpText: "Simple text-forward design." },
];

export default function JourneySettings() {
  const { settings, journey, previews } = useLoaderData();
  const fetcher = useFetcher();
  const toggleFetcher = useFetcher();

  const saving = fetcher.state !== "idle";
  const saved = fetcher.data?.saved;
  const isActive = settings.isActive ?? false;

  const [templateStyle, setTemplateStyle] = useState(journey.templateStyle || "classic");
  const [email1Subject, setEmail1Subject] = useState(journey.email1Subject || "You left something behind");
  const [email1DelayHours, setEmail1DelayHours] = useState(String(journey.email1DelayHours ?? "1"));
  const [email2Subject, setEmail2Subject] = useState(journey.email2Subject || "Still thinking it over?");
  const [email2DelayHours, setEmail2DelayHours] = useState(String(journey.email2DelayHours ?? "24"));
  const [email3Subject, setEmail3Subject] = useState(journey.email3Subject || "Last chance — 10% off");
  const [email3DelayHours, setEmail3DelayHours] = useState(String(journey.email3DelayHours ?? "72"));
  const [email3DiscountPct, setEmail3DiscountPct] = useState(String(journey.email3DiscountPct ?? "10"));

  const [previewEmail, setPreviewEmail] = useState(1);

  // Use server-rendered HTML; fall back to whatever's available
  const previewHtml = useMemo(
    () => previews?.[templateStyle]?.[previewEmail] || "",
    [previews, templateStyle, previewEmail],
  );

  function saveJourney() {
    fetcher.submit(
      {
        intent: "save-journey",
        templateStyle,
        email1Enabled: "true",
        email1DelayHours,
        email1Subject,
        email2Enabled: "true",
        email2DelayHours,
        email2Subject,
        email3Enabled: "true",
        email3DelayHours,
        email3Subject,
        email3DiscountPct,
      },
      { method: "post" },
    );
  }

  function toggleActive() {
    toggleFetcher.submit({ intent: "toggle-active" }, { method: "post" });
  }

  return (
    <s-page heading="Cart Rescue">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 480px", gap: "20px", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <s-section heading="Status">
            <s-stack direction="inline" gap="base" align="center" justify="space-between">
              <s-stack direction="block" gap="tight">
                <s-text variant="bodyLg">{isActive ? "Active" : "Paused"}</s-text>
                <s-text tone="subdued" variant="bodySm">
                  {isActive
                    ? "Cart rescue emails will send to abandoned checkouts."
                    : "Toggle on to start sending cart rescue emails."}
                </s-text>
              </s-stack>
              <ToggleSwitch
                checked={isActive}
                onChange={toggleActive}
                disabled={toggleFetcher.state !== "idle"}
              />
            </s-stack>
          </s-section>

          <s-section heading="Email style">
            <s-choice-list
              name="templateStyle"
              label="Template"
              onChange={(e) => {
                const val = e.detail?.value?.[0] ?? e.target?.value;
                if (val) setTemplateStyle(val);
              }}
            >
              {TEMPLATES.map((t) => (
                <s-choice key={t.value} value={t.value} selected={templateStyle === t.value || undefined}>
                  {t.label}
                  <span slot="details">{t.helpText}</span>
                </s-choice>
              ))}
            </s-choice-list>
          </s-section>

          <s-section heading="Email 1 — First reminder">
            <s-form-layout>
              <s-select
                label="Send after"
                value={email1DelayHours}
                onChange={(e) => setEmail1DelayHours(e.target?.value ?? e.detail?.value ?? email1DelayHours)}
              >
                <s-option value="0.0167">1 minute (for testing)</s-option>
                <s-option value="0.5">30 minutes</s-option>
                <s-option value="1">1 hour</s-option>
                <s-option value="2">2 hours</s-option>
              </s-select>
              <s-text-field
                label="Subject line"
                value={email1Subject}
                onInput={(e) => setEmail1Subject(e.target.value)}
              />
            </s-form-layout>
          </s-section>

          <s-section heading="Email 2 — Follow-up">
            <s-form-layout>
              <s-select
                label="Send after"
                value={email2DelayHours}
                onChange={(e) => setEmail2DelayHours(e.target?.value ?? e.detail?.value ?? email2DelayHours)}
              >
                <s-option value="12">12 hours</s-option>
                <s-option value="24">24 hours</s-option>
                <s-option value="48">48 hours</s-option>
              </s-select>
              <s-text-field
                label="Subject line"
                value={email2Subject}
                onInput={(e) => setEmail2Subject(e.target.value)}
              />
            </s-form-layout>
          </s-section>

          <s-section heading="Email 3 — Last chance + discount">
            <s-form-layout>
              <s-select
                label="Send after"
                value={email3DelayHours}
                onChange={(e) => setEmail3DelayHours(e.target?.value ?? e.detail?.value ?? email3DelayHours)}
              >
                <s-option value="48">48 hours</s-option>
                <s-option value="72">72 hours</s-option>
                <s-option value="96">96 hours</s-option>
              </s-select>
              <s-text-field
                label="Subject line"
                value={email3Subject}
                onInput={(e) => setEmail3Subject(e.target.value)}
              />
              <s-text-field
                label="Discount percentage"
                type="number"
                min="1"
                max="50"
                suffix="%"
                value={email3DiscountPct}
                onInput={(e) => setEmail3DiscountPct(e.target.value)}
              />
            </s-form-layout>
          </s-section>
        </div>

        <div style={{ position: "sticky", top: "16px" }}>
          <s-section heading="Live preview">
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPreviewEmail(n)}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: previewEmail === n ? "1.5px solid #202223" : "1px solid #e1e3e5",
                      background: previewEmail === n ? "#202223" : "#fff",
                      color: previewEmail === n ? "#fff" : "#202223",
                      fontSize: "13px",
                      fontWeight: previewEmail === n ? 600 : 500,
                      cursor: "pointer",
                    }}
                  >
                    Email {n}
                  </button>
                ))}
              </div>
              <div style={{
                border: "1px solid #e1e3e5",
                borderRadius: "8px",
                overflow: "hidden",
                background: "#f4f4f4",
              }}>
                <iframe
                  key={`${templateStyle}-${previewEmail}`}
                  srcDoc={previewHtml}
                  title="Email preview"
                  sandbox=""
                  style={{ width: "100%", height: "640px", border: "none", display: "block", background: "#f4f4f4" }}
                />
              </div>
              <s-text tone="subdued" variant="bodySm">
                Preview reflects saved subject &amp; discount. Save changes to refresh content.
              </s-text>
            </div>
          </s-section>
        </div>
      </div>

      <div style={{ marginTop: "20px" }}>       
        <s-page-actions>
          <s-button
            slot="primaryAction"
            onClick={saveJourney}
            {...(saving ? { loading: true } : {})}
          >
            {saved ? "Saved!" : "Save changes"}
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
