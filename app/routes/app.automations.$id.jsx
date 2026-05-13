import { useState, useMemo } from "react";
import { useLoaderData, useFetcher, useNavigate, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { renderCartRescueEmail } from "../lib/email/templates.server.js";
import { saveDraft, publishJourney, pauseJourney } from "../lib/journey/journey-lifecycle.server.js";

const TRIGGER_LABELS = {
  customer_created: "Subscribed to Marketing",
  cart_abandoned: "Cart Abandoned",
  order_placed: "Order Placed",
  win_back: "Inactive for 90 days",
};

const STATUS_TONE = {
  draft: { label: "Draft", bg: "#f1f8fd", color: "#005c8a" },
  published: { label: "Active", bg: "#e6f3ec", color: "#0c5132" },
  paused: { label: "Paused", bg: "#fdf4e6", color: "#b25d00" },
};

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

function buildPreview({ style, stepNumber, settings, subject }) {
  return renderCartRescueEmail({
    style,
    emailNumber: Math.min(Math.max(stepNumber, 1), 3),
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
    merchantAddress: "",
    customSubject: subject || undefined,
  });
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { id } = params;

  const [journey, settings] = await Promise.all([
    prisma.journey.findFirst({
      where: { id, shop },
      include: { steps: { orderBy: { positionY: "asc" } } },
    }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);

  if (!journey) throw new Response("Not found", { status: 404 });

  // Collapse delay nodes into per-email cumulative delay for display.
  const emails = [];
  let cumulative = 0;
  let priorDelayHours = 0;
  for (const s of journey.steps) {
    if (s.nodeType === "delay") {
      priorDelayHours += s.delayHours;
      cumulative += s.delayHours;
    } else if (s.nodeType === "email") {
      emails.push({
        id: s.id,
        emailName: s.emailName,
        subject: s.subject,
        previewText: s.previewText,
        templateStyle: s.templateStyle,
        discountPct: s.discountPct,
        isEnabled: s.isEnabled,
        // gap from previous email (or from trigger for the first)
        gapHours: priorDelayHours,
      });
      priorDelayHours = 0;
    }
  }

  const previews = {};
  for (const e of emails) {
    previews[e.id] = buildPreview({
      style: e.templateStyle || "classic",
      stepNumber: emails.indexOf(e) + 1,
      settings,
      subject: e.subject,
    });
  }

  return {
    journey,
    emails,
    settings: settings ?? {},
    previews,
  };
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { id } = params;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  const journey = await prisma.journey.findFirst({ where: { id, shop } });
  if (!journey) return { ok: false };

  if (intent === "toggle-active") {
    if (journey.status === "published") await pauseJourney(id);
    else await publishJourney(id);
    return { ok: true };
  }

  if (intent === "save") {
    const emails = JSON.parse(String(fd.get("emails") || "[]"));
    const name = String(fd.get("name") || journey.name);

    // Reconstruct canvas-order step rows: [delay?, email, delay?, email, ..., exit]
    const stepsForSave = [];
    for (const e of emails) {
      if (Number(e.gapHours) > 0) {
        stepsForSave.push({ nodeType: "delay", delayHours: Number(e.gapHours) });
      }
      stepsForSave.push({
        nodeType: "email",
        subject: e.subject || "",
        previewText: e.previewText || "",
        emailName: e.emailName || "",
        templateStyle: e.templateStyle || "classic",
        discountPct: Number(e.discountPct) || 0,
        isEnabled: e.isEnabled !== false,
      });
    }
    stepsForSave.push({ nodeType: "exit" });

    await saveDraft(id, {
      name,
      entryFrequency: journey.entryFrequency,
      exitCriteria: safeJson(journey.exitCriteria, []),
      steps: stepsForSave,
    });
    return { ok: true, saved: true };
  }

  return { ok: false };
};

function safeJson(s, fb) {
  try { return JSON.parse(s); } catch { return fb; }
}

export default function AutomationDetail() {
  const { journey, emails: initial, previews } = useLoaderData();
  const fetcher = useFetcher();
  const toggleFetcher = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();

  const [name, setName] = useState(journey.name);
  const [emails, setEmails] = useState(initial.map((e) => ({ ...e, gapHours: String(e.gapHours) })));
  const [previewIdx, setPreviewIdx] = useState(0);

  const tone = STATUS_TONE[journey.status] || STATUS_TONE.draft;
  const saving = fetcher.state !== "idle";
  const saved = fetcher.data?.saved;

  function updateEmail(i, field, value) {
    setEmails((arr) => arr.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)));
  }

  function save() {
    fetcher.submit({ intent: "save", name, emails: JSON.stringify(emails) }, { method: "post" });
  }

  function toggle() {
    toggleFetcher.submit({ intent: "toggle-active" }, { method: "post" });
  }

  const currentPreview = previews[emails[previewIdx]?.id];

  return (
    <s-page heading={journey.name}>
      <div style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{
          display: "inline-block", padding: "2px 8px", borderRadius: 12,
          background: tone.bg, color: tone.color, fontSize: 12, fontWeight: 500,
        }}>{tone.label}</span>
        <span style={{ fontSize: 13, color: "#6d7175" }}>
          Trigger: {TRIGGER_LABELS[journey.trigger] || journey.trigger}
        </span>
        <div style={{ flex: 1 }} />
        <s-button onClick={() => navigate(`/app/flows/${journey.id}${location.search}`)}>
          Open in visual builder
        </s-button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 480px", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <s-section heading="Status">
            <s-stack direction="inline" gap="base" align="center" justify="space-between">
              <s-stack direction="block" gap="tight">
                <s-text variant="bodyLg">{journey.status === "published" ? "Active" : "Paused / Draft"}</s-text>
                <s-text tone="subdued" variant="bodySm">
                  Toggle to {journey.status === "published" ? "pause" : "publish"} this automation.
                </s-text>
              </s-stack>
              <ToggleSwitch
                checked={journey.status === "published"}
                onChange={toggle}
                disabled={toggleFetcher.state !== "idle"}
              />
            </s-stack>
          </s-section>

          <s-section heading="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={textInput}
            />
          </s-section>

          {emails.map((e, i) => (
            <s-section key={e.id} heading={`Email ${i + 1}${e.emailName ? ` — ${e.emailName}` : ""}`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Field label="Email name (internal)">
                  <input
                    value={e.emailName || ""}
                    onChange={(ev) => updateEmail(i, "emailName", ev.target.value)}
                    style={textInput}
                  />
                </Field>
                <Field label="Subject">
                  <input
                    value={e.subject || ""}
                    onChange={(ev) => updateEmail(i, "subject", ev.target.value)}
                    style={textInput}
                  />
                </Field>
                <Field label="Preview text">
                  <input
                    value={e.previewText || ""}
                    onChange={(ev) => updateEmail(i, "previewText", ev.target.value)}
                    style={textInput}
                  />
                </Field>
                <Field label={i === 0 ? "Send after (hours from trigger)" : "Send after previous (hours)"}>
                  <input
                    type="number"
                    min="0"
                    value={e.gapHours}
                    onChange={(ev) => updateEmail(i, "gapHours", ev.target.value)}
                    style={textInput}
                  />
                </Field>
                <Field label="Template style">
                  <select
                    value={e.templateStyle || "classic"}
                    onChange={(ev) => updateEmail(i, "templateStyle", ev.target.value)}
                    style={textInput}
                  >
                    <option value="classic">Classic</option>
                    <option value="bold">Bold</option>
                    <option value="minimal">Minimal</option>
                  </select>
                </Field>
                <Field label="Discount % (0 = no discount)">
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={e.discountPct}
                    onChange={(ev) => updateEmail(i, "discountPct", ev.target.value)}
                    style={textInput}
                  />
                </Field>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#202223" }}>
                  <input
                    type="checkbox"
                    checked={e.isEnabled !== false}
                    onChange={(ev) => updateEmail(i, "isEnabled", ev.target.checked)}
                  />
                  Step enabled
                </label>
              </div>
            </s-section>
          ))}

          {emails.length === 0 && (
            <s-section>
              <div style={{ padding: 24, textAlign: "center", color: "#6d7175", fontSize: 13 }}>
                This automation has no email steps yet. Open it in the visual builder to add some.
              </div>
            </s-section>
          )}
        </div>

        <div style={{ position: "sticky", top: 16 }}>
          <s-section heading="Live preview">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {emails.length > 1 && (
                <div style={{ display: "flex", gap: 8 }}>
                  {emails.map((e, i) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setPreviewIdx(i)}
                      style={{
                        flex: 1, padding: "8px 12px", borderRadius: 8,
                        border: previewIdx === i ? "1.5px solid #202223" : "1px solid #e1e3e5",
                        background: previewIdx === i ? "#202223" : "#fff",
                        color: previewIdx === i ? "#fff" : "#202223",
                        fontSize: 12, fontWeight: previewIdx === i ? 600 : 500, cursor: "pointer",
                      }}
                    >Email {i + 1}</button>
                  ))}
                </div>
              )}
              <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, overflow: "hidden", background: "#f4f4f4" }}>
                <iframe
                  key={emails[previewIdx]?.id}
                  srcDoc={currentPreview || ""}
                  title="Email preview"
                  sandbox=""
                  style={{ width: "100%", height: 640, border: "none", display: "block", background: "#f4f4f4" }}
                />
              </div>
              <s-text tone="subdued" variant="bodySm">
                Save to refresh preview content.
              </s-text>
            </div>
          </s-section>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <s-page-actions>
          <s-button slot="primaryAction" onClick={save} {...(saving ? { loading: true } : {})}>
            {saved ? "Saved!" : "Save changes"}
          </s-button>
          <s-button slot="secondaryAction" onClick={() => navigate(`/app/automations${location.search}`)}>
            Back
          </s-button>
        </s-page-actions>
      </div>
    </s-page>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, color: "#202223", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const textInput = {
  width: "100%", padding: "7px 10px",
  border: "1px solid #c9cccf", borderRadius: 6,
  fontSize: 13, color: "#202223", outline: "none",
  background: "#fff", boxSizing: "border-box",
};

function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      style={{
        width: 44, height: 24, borderRadius: 12,
        background: checked ? "#0c5132" : "#c9cccf",
        border: "none", position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.2s",
        opacity: disabled ? 0.6 : 1, padding: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 22 : 2,
        width: 20, height: 20, borderRadius: "50%", background: "#fff",
        transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)",
      }} />
    </button>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
