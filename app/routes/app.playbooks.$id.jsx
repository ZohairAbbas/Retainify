import { useState, useMemo } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
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

const TRIGGER_LABELS = {
  customer_created: "New customer",
  order_placed: "Order placed",
  win_back: "Win-back (90 days inactive)",
};

const TEMPLATES = [
  { label: "Classic", value: "classic" },
  { label: "Bold", value: "bold" },
  { label: "Minimal", value: "minimal" },
];

function buildPreview({ style, stepNumber, settings }) {
  return renderCartRescueEmail({
    style,
    emailNumber: Math.min(stepNumber, 3),
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
  });
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { id } = params;

  const [journey, settings] = await Promise.all([
    prisma.journey.findFirst({
      where: { id, shop },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);

  if (!journey) {
    throw new Response("Not found", { status: 404 });
  }

  // Pre-render preview HTML for all 3 styles × all steps
  const styles = ["classic", "bold", "minimal"];
  const previews = {};
  for (const style of styles) {
    previews[style] = {};
    for (const step of journey.steps) {
      previews[style][step.stepNumber] = buildPreview({ style, stepNumber: step.stepNumber, settings });
    }
  }

  return { journey, settings: settings ?? {}, previews };
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { id } = params;
  const formData = await request.formData();
  const intent = formData.get("intent");

  const journey = await prisma.journey.findFirst({ where: { id, shop } });
  if (!journey) return { ok: false };

  if (intent === "toggle-active") {
    await prisma.journey.update({ where: { id }, data: { isActive: !journey.isActive } });
    return { ok: true, toggled: true };
  }

  if (intent === "save-playbook") {
    const rawSteps = JSON.parse(formData.get("steps") || "[]");

    await prisma.$transaction(async (tx) => {
      for (const s of rawSteps) {
        await tx.journeyStep.update({
          where: { id: s.id },
          data: {
            subject: s.subject,
            delayHours: parseFloat(s.delayHours) || 0,
            templateStyle: s.templateStyle || "classic",
            discountPct: parseInt(s.discountPct, 10) || 0,
            isEnabled: s.isEnabled !== false,
          },
        });
      }
    });

    return { ok: true, saved: true };
  }

  return { ok: false };
};

export default function PlaybookDetail() {
  const { journey, previews } = useLoaderData();
  const fetcher = useFetcher();
  const toggleFetcher = useFetcher();
  const navigate = useNavigate();

  const saving = fetcher.state !== "idle";
  const saved = fetcher.data?.saved;
  const isActive = journey.isActive;

  const [steps, setSteps] = useState(
    journey.steps.map((s) => ({
      id: s.id,
      stepNumber: s.stepNumber,
      subject: s.subject,
      delayHours: String(s.delayHours),
      templateStyle: s.templateStyle,
      discountPct: String(s.discountPct),
      isEnabled: s.isEnabled,
    })),
  );

  const [templateStyle, setTemplateStyle] = useState(
    journey.steps[0]?.templateStyle || "classic",
  );
  const [previewStep, setPreviewStep] = useState(steps[0]?.stepNumber || 1);

  const previewHtml = useMemo(
    () => previews?.[templateStyle]?.[previewStep] || "",
    [previews, templateStyle, previewStep],
  );

  function updateStep(index, field, value) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
    if (field === "templateStyle") setTemplateStyle(value);
  }

  function save() {
    fetcher.submit(
      { intent: "save-playbook", steps: JSON.stringify(steps) },
      { method: "post" },
    );
  }

  function toggleActive() {
    toggleFetcher.submit({ intent: "toggle-active" }, { method: "post" });
  }

  return (
    <s-page heading={journey.name}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 480px", gap: "20px", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <s-section heading="Status">
            <s-stack direction="inline" gap="base" align="center" justify="space-between">
              <s-stack direction="block" gap="tight">
                <s-text variant="bodyLg">{isActive ? "Active" : "Paused"}</s-text>
                <s-text tone="subdued" variant="bodySm">
                  Trigger: {TRIGGER_LABELS[journey.trigger] || journey.trigger}
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
                if (val) {
                  setTemplateStyle(val);
                  setSteps((prev) => prev.map((s) => ({ ...s, templateStyle: val })));
                }
              }}
            >
              {TEMPLATES.map((t) => (
                <s-choice key={t.value} value={t.value} selected={templateStyle === t.value || undefined}>
                  {t.label}
                </s-choice>
              ))}
            </s-choice-list>
          </s-section>

          {steps.map((step, i) => (
            <s-section key={step.id} heading={`Email ${step.stepNumber}`}>
              <s-form-layout>
                <s-text-field
                  label="Subject line"
                  value={step.subject}
                  onInput={(e) => updateStep(i, "subject", e.target.value)}
                />
                <s-text-field
                  label="Send after (hours)"
                  type="number"
                  min="0"
                  value={step.delayHours}
                  onInput={(e) => updateStep(i, "delayHours", e.target.value)}
                  helpText="Hours after enrollment (0 = immediate)"
                />
                {step.discountPct !== "0" && (
                  <s-text-field
                    label="Discount %"
                    type="number"
                    min="0"
                    max="50"
                    suffix="%"
                    value={step.discountPct}
                    onInput={(e) => updateStep(i, "discountPct", e.target.value)}
                  />
                )}
              </s-form-layout>
            </s-section>
          ))}
        </div>

        <div style={{ position: "sticky", top: "16px" }}>
          <s-section heading="Live preview">
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                {steps.map((step) => (
                  <button
                    key={step.stepNumber}
                    type="button"
                    onClick={() => setPreviewStep(step.stepNumber)}
                    style={{
                      flex: 1, padding: "8px 12px", borderRadius: "8px",
                      border: previewStep === step.stepNumber ? "1.5px solid #202223" : "1px solid #e1e3e5",
                      background: previewStep === step.stepNumber ? "#202223" : "#fff",
                      color: previewStep === step.stepNumber ? "#fff" : "#202223",
                      fontSize: "13px",
                      fontWeight: previewStep === step.stepNumber ? 600 : 500,
                      cursor: "pointer",
                    }}
                  >
                    Email {step.stepNumber}
                  </button>
                ))}
              </div>
              <div style={{
                border: "1px solid #e1e3e5", borderRadius: "8px",
                overflow: "hidden", background: "#f4f4f4",
              }}>
                <iframe
                  key={`${templateStyle}-${previewStep}`}
                  srcDoc={previewHtml}
                  title="Email preview"
                  sandbox=""
                  style={{ width: "100%", height: "640px", border: "none", display: "block", background: "#f4f4f4" }}
                />
              </div>
              <s-text tone="subdued" variant="bodySm">
                Save changes to refresh preview content.
              </s-text>
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
            {saved ? "Saved!" : "Save changes"}
          </s-button>
          <s-button
            slot="secondaryAction"
            onClick={() => navigate(`/app/playbooks${window.location.search}`)}
          >
            Back
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
        width: "44px", height: "24px", borderRadius: "12px",
        background: checked ? "#0c5132" : "#c9cccf",
        border: "none", position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.2s",
        opacity: disabled ? 0.6 : 1,
        padding: 0,
      }}
    >
      <span style={{
        position: "absolute", top: "2px",
        left: checked ? "22px" : "2px",
        width: "20px", height: "20px",
        borderRadius: "50%", background: "#fff",
        transition: "left 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,.2)",
      }} />
    </button>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
