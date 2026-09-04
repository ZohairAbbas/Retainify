import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import prisma from "../db.server.js";
import { connectWhatsappAccount, resubscribeWebhooks } from "../lib/whatsapp/embedded-signup.server.js";
import { syncTemplates, createTemplate } from "../lib/whatsapp/templates.server.js";
import { sendWhatsapp, sendWhatsappText, registerWhatsappNumber } from "../lib/whatsapp/index.server.js";
import { toE164 } from "../lib/contacts/contacts.server.js";
import { recordOptOut } from "../lib/whatsapp/optin.server.js";
import Icons from "../components/ui/Icons.jsx";
import EmbeddedSignup from "../components/whatsapp/EmbeddedSignup.jsx";
import { featureState, requireFeature } from "../lib/billing/gate.server.js";
import UpgradeNotice from "../components/billing/UpgradeNotice.jsx";
import StorefrontOnly from "../components/ui/StorefrontOnly.jsx";

/** Subscription states in the merchant's language. */
const SUB_STATUS = {
  subscribed: "Subscribed",
  unsubscribed: "Opted out",
  invalid: "Invalid number",
};

/** Whether a Meta component spec contains at least one URL button. */
function hasUrlButton(components) {
  if (!Array.isArray(components)) return false;
  return components.some(
    (c) =>
      c?.type === "BUTTONS" &&
      Array.isArray(c.buttons) &&
      c.buttons.some((b) => b?.type === "URL"),
  );
}

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  // Gate below: this whole page depends on a storefront.
  if (!ctx.isShopify) return { storefrontOnly: true };
  const { shop } = ctx;

  const [account, settings, subCount, subscribers, templates, popup] = await Promise.all([
    prisma.whatsappAccount.findUnique({ where: { shop } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.whatsappSubscription.count({ where: { shop, status: "subscribed" } }),
    // Newest first, capped. A merchant with 40,000 subscribers does not need
    // them paginated on a settings page — they need to see that capture is
    // working and be able to remove someone who asked in person. Contacts is
    // where the whole audience is browsed and segmented.
    prisma.whatsappSubscription.findMany({
      where: { shop },
      orderBy: { optInAt: "desc" },
      take: 25,
      select: {
        id: true, phoneNumber: true, contactEmail: true, status: true,
        optInMethod: true, confirmedAt: true, optInAt: true,
      },
    }),
    prisma.whatsappTemplate.findMany({
      where: { shop },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, language: true, category: true, status: true,
        // Present only on templates created here. Meta approves a button's URL
        // as part of the template, so one authored in Business Manager links
        // straight to the merchant and its taps never reach us.
        buttonUrls: true,
        components: true,
      },
    }),
    prisma.popupSettings.findUnique({ where: { shop }, select: { config: true } }),
  ]);

  // WhatsApp is a Growth-tier feature (Meta bills per conversation). In shadow
  // mode `locked` is false, so the page stays fully usable until enforcement is on.
  const gate = await featureState(shop, "whatsapp");

  return {
    gate,
    account: account
      ? {
          status: account.status,
          wabaId: account.wabaId,
          displayPhoneNumber: account.displayPhoneNumber,
          registered: !!account.registeredAt,
          // Null means Meta sends us no events for this shop at all: sends
          // work, but delivery, reads, replies and STOP never come back.
          webhooksSubscribed: !!account.webhooksSubscribedAt,
          tokenExpiresAt: account.tokenExpiresAt ? account.tokenExpiresAt.toISOString() : null,
          lastError: account.lastError,
        }
      : null,
    whatsappEnabled: settings?.whatsappEnabled ?? false,
    popupOptIn: popup?.config?.whatsappOptIn === true,
    whatsappRequireOptIn: settings?.whatsappRequireOptIn ?? true,
    subCount,
    subscribers: subscribers.map((sub) => ({
      ...sub,
      optInAt: sub.optInAt.toISOString(),
      confirmed: !!sub.confirmedAt,
      confirmedAt: undefined,
    })),
    // `untracked` means the template has a link button whose taps we can never
    // see: it was authored in Meta Business Manager, so its URL goes straight to
    // the merchant instead of through our redirect. Templates without any link
    // button are not flagged — there is nothing to track either way.
    templates: templates.map(({ buttonUrls, components, ...t }) => ({
      ...t,
      untracked: hasUrlButton(components) && !(buttonUrls && Object.keys(buttonUrls).length),
    })),
    // eslint-disable-next-line no-undef
    metaAppId: process.env.META_APP_ID || "",
    // eslint-disable-next-line no-undef
    esConfigId: process.env.META_ES_CONFIG_ID || "",
  };
};

export const action = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  // Anything that connects or sends on WhatsApp is plan-gated. Read-only intents
  // (template sync/list) stay open so a downgraded shop can still see its state.
  const GATED_INTENTS = [
    "connect",
    "register-number",
    "toggle-enabled",
    "send-test",
    "create-template",
    "resubscribe-webhooks",
  ];
  if (GATED_INTENTS.includes(intent)) {
    const denied = await requireFeature(shop, "whatsapp");
    if (denied) return denied;
  }

  if (intent === "toggle-enabled") {
    const current = await prisma.shopSettings.findUnique({ where: { shop } });
    await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, whatsappEnabled: true },
      update: { whatsappEnabled: !current?.whatsappEnabled },
    });
    return { ok: true, toggled: true };
  }

  // Turns the popup's phone + consent fields on. Stored on PopupSettings.config
  // because it is a property of the popup, not of the WhatsApp account.
  if (intent === "toggle-popup-optin") {
    const enabled = fd.get("enabled") === "1";
    const row = await prisma.popupSettings.findUnique({ where: { shop } });
    const config = { ...(row?.config || {}), whatsappOptIn: enabled };
    await prisma.popupSettings.upsert({
      where: { shop },
      create: { shop, config, enabled: true },
      update: { config },
    });
    return { ok: true, popupOptIn: enabled };
  }

  if (intent === "toggle-require-optin") {
    const current = await prisma.shopSettings.findUnique({ where: { shop } });
    const next = !(current?.whatsappRequireOptIn ?? true);
    await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, whatsappRequireOptIn: next },
      update: { whatsappRequireOptIn: next },
    });
    return { ok: true, requireOptIn: next };
  }

  if (intent === "connect") {
    const code = String(fd.get("code") || "");
    const wabaId = String(fd.get("wabaId") || "");
    const businessId = String(fd.get("businessId") || "");
    if (!code || !wabaId) {
      return { ok: false, error: "Missing sign-up code or WABA id from Meta." };
    }
    const res = await connectWhatsappAccount({ shop, code, wabaId, businessId });
    if (!res.ok) return { ok: false, error: res.error || "Failed to connect." };
    return { ok: true, connected: true, warning: res.warning };
  }

  // Remove one subscriber by hand. Same path as a STOP message, so consent is
  // withdrawn everywhere it is recorded rather than in the one table this page
  // happens to read. Not plan-gated: a merchant must always be able to honour
  // an opt-out, whatever they are paying.
  if (intent === "remove-subscriber") {
    const phoneNumber = String(fd.get("phoneNumber") || "");
    if (!phoneNumber) return { ok: false, error: "Missing phone number." };
    await recordOptOut({ shop, phoneNumber, reason: "opt_out" });
    return { ok: true, removed: true };
  }

  if (intent === "resubscribe-webhooks") {
    const res = await resubscribeWebhooks(shop);
    if (!res.ok) return { ok: false, error: res.error || "Could not subscribe to WhatsApp events." };
    return { ok: true, subscribed: true };
  }

  if (intent === "register-number") {
    const pin = String(fd.get("pin") || "");
    const res = await registerWhatsappNumber(shop, pin);
    if (!res.ok) return { ok: false, error: res.error || "Registration failed." };
    return { ok: true, registered: true };
  }

  if (intent === "disconnect") {
    await prisma.whatsappAccount.updateMany({
      where: { shop },
      data: { status: "disconnected" },
    });
    return { ok: true, disconnected: true };
  }

  if (intent === "sync-templates") {
    const res = await syncTemplates(shop);
    if (!res.ok) return { ok: false, error: res.error || "Sync failed." };
    return { ok: true, synced: res.synced };
  }

  if (intent === "create-template") {
    const samples = [];
    for (let i = 1; i <= 10; i++) {
      const v = fd.get(`sample_${i}`);
      if (v !== null) samples[i - 1] = String(v);
    }
    const headerFormat = String(fd.get("headerFormat") || "NONE");
    const header =
      headerFormat === "TEXT"
        ? { format: "TEXT", text: String(fd.get("headerText") || "") }
        : headerFormat === "IMAGE"
          ? { format: "IMAGE", sampleUrl: String(fd.get("headerSampleUrl") || "") }
          : undefined;

    const buttons = [];
    for (let i = 1; i <= 3; i++) {
      const text = fd.get(`btn_${i}_text`);
      if (text === null || !String(text).trim()) continue;
      const type = String(fd.get(`btn_${i}_type`) || "QUICK_REPLY");
      buttons.push({ type, text: String(text), url: String(fd.get(`btn_${i}_url`) || "") });
    }

    const res = await createTemplate(shop, {
      name: String(fd.get("name") || ""),
      language: String(fd.get("language") || "en_US"),
      category: String(fd.get("category") || "MARKETING"),
      bodyText: String(fd.get("bodyText") || ""),
      samples,
      header,
      buttons,
    });
    if (!res.ok) return { ok: false, error: res.error || "Create failed." };
    return { ok: true, created: true, status: res.status };
  }

  if (intent === "send-test") {
    const check = toE164(String(fd.get("to") || ""));
    if (!check.ok) return { ok: false, error: check.error };
    const to = check.phone;
    const mode = String(fd.get("mode") || "template"); // template | text

    if (mode === "text") {
      const text = String(fd.get("text") || "");
      if (!text.trim()) return { ok: false, error: "Enter a message to send." };
      const result = await sendWhatsappText({ to, text }, { shop });
      if (!result.ok) return { ok: false, error: result.error || "Send failed." };
      return { ok: true, sent: true };
    }

    const templateName = String(fd.get("templateName") || "");
    if (!templateName) return { ok: false, error: "Pick an approved template." };
    const tpl = await prisma.whatsappTemplate.findFirst({
      where: { shop, name: templateName, status: "APPROVED" },
    });

    // Fill every {{n}} the template declares with a visible placeholder.
    // Sending components: [] meant any template WITH variables was rejected by
    // Meta with an opaque parameter-count error — which is most real templates.
    const paramCount = new Set(
      [...String(tpl?.bodyText || "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1]),
    ).size;
    const components = paramCount
      ? [{
          type: "body",
          parameters: Array.from({ length: paramCount }, (_, i) => ({
            type: "text",
            text: `sample ${i + 1}`,
          })),
        }]
      : [];

    const result = await sendWhatsapp(
      { to, templateName, language: tpl?.language || "en_US", components },
      { shop },
    );
    if (!result.ok) return { ok: false, error: result.error || "Send failed." };
    return { ok: true, sent: true };
  }

  return { ok: false };
};

function WhatsappPageInner() {
  const { gate, account, whatsappEnabled, whatsappRequireOptIn, popupOptIn, subCount, subscribers = [], templates, metaAppId, esConfigId } = useLoaderData();
  const connectFetcher = useFetcher();
  const toggleFetcher = useFetcher();
  const syncFetcher = useFetcher();
  const testFetcher = useFetcher();
  const createFetcher = useFetcher();
  const optInFetcher = useFetcher();
  const registerFetcher = useFetcher();
  const subscribeFetcher = useFetcher();
  const removeFetcher = useFetcher();

  const isConnected = account?.status === "connected";
  // Optimistic: reflect a just-completed registration immediately, since a
  // fetcher submit doesn't guarantee the loader re-read lands before render.
  const isRegistered = !!account?.registered || registerFetcher.data?.ok === true;
  const canSend = isConnected && isRegistered;
  // Same optimism as registration: reflect a just-succeeded retry immediately.
  const webhooksLive = !!account?.webhooksSubscribed || subscribeFetcher.data?.ok === true;
  const approvedTemplates = templates.filter((t) => t.status === "APPROVED");
  const [pin, setPin] = useState("");

  const [testPhone, setTestPhone] = useState("");
  const [testTemplate, setTestTemplate] = useState("");
  const [testMode, setTestMode] = useState("template"); // template | text
  const [testText, setTestText] = useState("Hello from Retainify 👋");

  // Template composer
  const [tplName, setTplName] = useState("");
  const [tplLang, setTplLang] = useState("en_US");
  const [tplCategory, setTplCategory] = useState("MARKETING");
  const [tplBody, setTplBody] = useState("");
  const varCount = Math.max(
    0,
    ...[...tplBody.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])),
  );
  const [samples, setSamples] = useState({});
  const [headerFormat, setHeaderFormat] = useState("NONE"); // NONE | TEXT | IMAGE
  const [headerText, setHeaderText] = useState("");
  const [headerSampleUrl, setHeaderSampleUrl] = useState("");
  const [buttons, setButtons] = useState([]); // [{ type, text, url }]

  function toggleEnabled() {
    toggleFetcher.submit({ intent: "toggle-enabled" }, { method: "post" });
  }
  function toggleRequireOptIn() {
    optInFetcher.submit({ intent: "toggle-require-optin" }, { method: "post" });
  }
  // Optimistic value so the warning shows immediately on toggle.
  const requireOptIn =
    optInFetcher.state !== "idle" && optInFetcher.formData
      ? !whatsappRequireOptIn
      : optInFetcher.data?.requireOptIn ?? whatsappRequireOptIn;
  function disconnect() {
    connectFetcher.submit({ intent: "disconnect" }, { method: "post" });
  }
  function registerNumber() {
    registerFetcher.submit({ intent: "register-number", pin }, { method: "post" });
  }
  function syncTemplatesNow() {
    syncFetcher.submit({ intent: "sync-templates" }, { method: "post" });
  }
  function sendTest() {
    const payload =
      testMode === "text"
        ? { intent: "send-test", mode: "text", to: testPhone, text: testText }
        : { intent: "send-test", mode: "template", to: testPhone, templateName: testTemplate };
    testFetcher.submit(payload, { method: "post" });
  }
  function createTemplateNow() {
    const payload = {
      intent: "create-template",
      name: tplName,
      language: tplLang,
      category: tplCategory,
      bodyText: tplBody,
      headerFormat,
    };
    for (let i = 1; i <= varCount; i++) payload[`sample_${i}`] = samples[i] || "";
    if (headerFormat === "TEXT") payload.headerText = headerText;
    if (headerFormat === "IMAGE") payload.headerSampleUrl = headerSampleUrl;
    buttons.forEach((b, idx) => {
      const i = idx + 1;
      payload[`btn_${i}_type`] = b.type;
      payload[`btn_${i}_text`] = b.text;
      payload[`btn_${i}_url`] = b.url || "";
    });
    createFetcher.submit(payload, { method: "post" });
  }
  function addButton() {
    if (buttons.length >= 3) return;
    setButtons((b) => [...b, { type: "QUICK_REPLY", text: "", url: "" }]);
  }
  function updateButton(idx, patch) {
    setButtons((b) => b.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }
  function removeButton(idx) {
    setButtons((b) => b.filter((_, i) => i !== idx));
  }

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>WhatsApp</h1>
        </div>
      </header>

      {/* Plan gate. `locked` is only true once enforcement is on, so this stays
          hidden during shadow mode. An already-connected shop keeps its panels
          visible below — we never hide a live integration behind a paywall. */}
      {gate?.locked && (
        <UpgradeNotice
          title={`WhatsApp is available on the ${gate.upgradeToName || "Growth"} plan.`}
          body="Reach customers on WhatsApp with approved templates in your flows."
          planName={gate.upgradeToName}
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 24, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Connection */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>Connection</div>
            {isConnected ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div className="t-body" style={{ fontWeight: 500 }}>
                      {account.displayPhoneNumber || "Connected number"}
                    </div>
                    <div className="t-small muted" style={{ marginTop: 2 }}>
                      WABA {account.wabaId} · <span style={{ color: "var(--node-whatsapp-ink)" }}>Connected</span>
                      {isRegistered
                        ? <> · <span style={{ color: "var(--node-whatsapp-ink)" }}>Registered</span></>
                        : <> · <span style={{ color: "var(--danger-ink)" }}>Not registered</span></>}
                      {webhooksLive
                        ? <> · <span style={{ color: "var(--node-whatsapp-ink)" }}>Events on</span></>
                        : <> · <span style={{ color: "var(--danger-ink)" }}>Events off</span></>}
                    </div>
                  </div>
                  <button className="btn" onClick={disconnect} disabled={connectFetcher.state !== "idle"}>
                    Disconnect
                  </button>
                </div>

                {/* A ~60-day token is what Meta grants an unapproved app, and
                    it is indistinguishable from a permanent one except by this
                    date. Without it the only symptom of expiry is that every
                    send starts failing. */}
                {account.tokenExpiresAt && (
                  <div className="t-small" style={{ borderTop: "1px solid var(--line)", paddingTop: 16, color: "var(--ink-2)" }}>
                    This connection expires on{" "}
                    <strong>{new Date(account.tokenExpiresAt).toLocaleDateString()}</strong>.
                    Reconnect before then to keep sending.
                  </div>
                )}

                {!webhooksLive && (
                  <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                    <div className="t-small" style={{ marginBottom: 10, background: "var(--danger-bg)", color: "var(--danger-ink)", padding: "10px 12px", borderRadius: "var(--r-2)" }}>
                      <strong>Delivery reporting is off.</strong> We aren&rsquo;t subscribed to
                      WhatsApp events for this account, so messages will send but nothing comes
                      back: no delivered or read status, no replies, and <strong>STOP opt-outs
                      won&rsquo;t be honored</strong>. Retry the subscription before sending.
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={() => subscribeFetcher.submit({ intent: "resubscribe-webhooks" }, { method: "post" })}
                      disabled={subscribeFetcher.state !== "idle"}
                    >
                      {subscribeFetcher.state !== "idle" ? "Subscribing\u2026" : "Retry event subscription"}
                    </button>
                    {subscribeFetcher.data?.ok === false && (
                      <div className="t-small" style={{ marginTop: 8, color: "var(--danger-ink)" }}>{subscribeFetcher.data.error}</div>
                    )}
                  </div>
                )}

                {!isRegistered && (
                  <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                    <div className="t-small" style={{ marginBottom: 10, background: "var(--danger-bg)", color: "var(--danger-ink)", padding: "10px 12px", borderRadius: "var(--r-2)" }}>
                      This number must be registered for the Cloud API before it can send any message
                      (template or free-text). Enter a 6-digit PIN to register it. This becomes the
                      number's two-step verification PIN — save it somewhere safe.
                    </div>
                    <label className="field-label">Registration PIN (6 digits)</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        className="input"
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="123456"
                        inputMode="numeric"
                        style={{ maxWidth: 160 }}
                      />
                      <button
                        className="btn btn-primary"
                        onClick={registerNumber}
                        disabled={registerFetcher.state !== "idle" || pin.length !== 6}
                      >
                        {registerFetcher.state !== "idle" ? "Registering…" : "Register number"}
                      </button>
                    </div>
                    {registerFetcher.data?.ok === false && (
                      <div className="t-small" style={{ marginTop: 8, color: "var(--danger-ink)" }}>{registerFetcher.data.error}</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="t-small muted">
                  Connect your WhatsApp Business account through Meta to start sending. Takes a couple of minutes.
                </div>
                <EmbeddedSignup appId={metaAppId} configId={esConfigId} fetcher={connectFetcher} />
                {account?.status === "disconnected" && account?.lastError && (
                  <div className="t-small muted">Last attempt: {account.lastError}</div>
                )}
              </div>
            )}
          </section>

          {/* Channel status */}
          <section className="rt-form-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div className="t-micro muted" style={{ marginBottom: 4 }}>Status</div>
                <div className="t-body" style={{ fontWeight: 500 }}>
                  {whatsappEnabled ? "Enabled" : "Disabled"}
                </div>
                <div className="t-small muted" style={{ marginTop: 2 }}>
                  {!isConnected
                    ? "Connect an account first, then enable the channel."
                    : !isRegistered
                      ? "Register your number above before enabling the channel."
                      : "WhatsApp steps in your flows will send once enabled."}
                </div>
              </div>
              <label className="rt-toggle">
                <input
                  type="checkbox"
                  checked={whatsappEnabled}
                  onChange={toggleEnabled}
                  disabled={toggleFetcher.state !== "idle" || !canSend}
                />
                <span className="rt-toggle-switch" />
              </label>
            </div>
          </section>

          {/* Audience / consent */}
          <section className="rt-form-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ maxWidth: 460 }}>
                <div className="t-micro muted" style={{ marginBottom: 4 }}>Require opt-in</div>
                <div className="t-body" style={{ fontWeight: 500 }}>
                  {requireOptIn ? "On — send only to opted-in contacts" : "Off — send to any contact with a phone"}
                </div>
                <div className="t-small muted" style={{ marginTop: 2 }}>
                  {requireOptIn
                    ? "Recommended. Only contacts who explicitly opted in to WhatsApp receive messages."
                    : "Messages go to any enrolled contact who has a phone number, even without a WhatsApp opt-in."}
                </div>
              </div>
              <label className="rt-toggle">
                <input
                  type="checkbox"
                  checked={!requireOptIn}
                  onChange={toggleRequireOptIn}
                  disabled={optInFetcher.state !== "idle"}
                />
                <span className="rt-toggle-switch" />
              </label>
            </div>
            {!requireOptIn && (
              <div
                className="t-small"
                style={{ marginTop: 12, background: "var(--danger-bg)", color: "var(--danger-ink)", padding: "10px 12px", borderRadius: "var(--r-2)" }}
              >
                <strong>Compliance warning:</strong> Meta's WhatsApp Business Policy requires opt-in before
                messaging. Sending to non-opted-in contacts can lower your quality rating and lead to your
                number being restricted or banned. Opt-outs (STOP) are always honored. Use only if you have a
                lawful basis (e.g. phone collected at checkout).
              </div>
            )}
          </section>

          {/* Templates */}
          <section className="rt-form-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div className="t-micro muted">Message templates</div>
              <button className="btn" onClick={syncTemplatesNow} disabled={syncFetcher.state !== "idle" || !isConnected}>
                {syncFetcher.state !== "idle" ? "Syncing…" : "Sync from Meta"}
              </button>
            </div>
            {syncFetcher.data?.ok && syncFetcher.data.synced !== undefined && (
              <div className="t-small" style={{ marginBottom: 12, color: "var(--node-whatsapp-ink)" }}>
                Synced {syncFetcher.data.synced} template{syncFetcher.data.synced !== 1 ? "s" : ""}.
              </div>
            )}
            {syncFetcher.data?.ok === false && (
              <div className="t-small" style={{ marginBottom: 12, color: "var(--danger-ink)" }}>{syncFetcher.data.error}</div>
            )}
            {templates.length === 0 ? (
              <div className="t-small muted">No templates yet. Sync after connecting to pull your approved templates from Meta.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {templates.map((t) => (
                  <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div className="t-small" style={{ minWidth: 0 }}>
                      <strong style={{ color: "var(--ink-1)" }}>{t.name}</strong>
                      <span className="muted"> · {t.language} · {t.category}</span>
                      {t.untracked && (
                        <div className="t-micro muted" style={{ marginTop: 2 }}>
                          Link clicks and revenue aren&rsquo;t measured — this template was
                          made in Meta Business Manager. Recreate it here to track it.
                        </div>
                      )}
                    </div>
                    <span className="t-micro" style={{
                      flexShrink: 0,
                      color: t.status === "APPROVED" ? "var(--node-whatsapp-ink)" : "var(--ink-3)",
                    }}>{t.status}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Create template */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>Create a template</div>
            <div className="t-small muted" style={{ marginBottom: 16 }}>
              Templates are reviewed by Meta before they can be sent. Approval usually takes a few minutes to a day.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="field-label">Name</label>
                  <input
                    className="input"
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                    placeholder="abandoned_cart_reminder"
                  />
                  <div className="field-help">Lowercase, numbers, underscores only.</div>
                </div>
                <div>
                  <label className="field-label">Language</label>
                  <input
                    className="input"
                    value={tplLang}
                    onChange={(e) => setTplLang(e.target.value)}
                    placeholder="en_US"
                  />
                </div>
              </div>
              <div>
                <label className="field-label">Category</label>
                <select className="input" value={tplCategory} onChange={(e) => setTplCategory(e.target.value)}>
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utility</option>
                  <option value="AUTHENTICATION">Authentication</option>
                </select>
              </div>
              <div>
                <label className="field-label">Body</label>
                <textarea
                  className="input"
                  rows={4}
                  value={tplBody}
                  onChange={(e) => setTplBody(e.target.value)}
                  placeholder="Hi {{1}}, your cart is waiting! Finish checkout: {{2}}"
                />
                <div className="field-help">Use {"{{1}}"}, {"{{2}}"}… for variables.</div>
              </div>

              {/* Header */}
              <div>
                <label className="field-label">Header <span className="faint">(optional)</span></label>
                <select className="input" value={headerFormat} onChange={(e) => setHeaderFormat(e.target.value)}>
                  <option value="NONE">None</option>
                  <option value="TEXT">Text</option>
                  <option value="IMAGE">Image</option>
                </select>
                {headerFormat === "TEXT" && (
                  <input
                    className="input"
                    style={{ marginTop: 8 }}
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    placeholder="Header text"
                    maxLength={60}
                  />
                )}
                {headerFormat === "IMAGE" && (
                  <>
                    <input
                      className="input"
                      style={{ marginTop: 8 }}
                      value={headerSampleUrl}
                      onChange={(e) => setHeaderSampleUrl(e.target.value)}
                      placeholder="https://example.com/sample-image.jpg"
                    />
                    <div className="field-help">A sample image URL Meta uses for review.</div>
                  </>
                )}
              </div>

              {/* Buttons */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label className="field-label" style={{ marginBottom: 0 }}>Buttons <span className="faint">(optional, up to 3)</span></label>
                  {buttons.length < 3 && (
                    <button type="button" className="btn" style={{ padding: "2px 10px" }} onClick={addButton}>Add</button>
                  )}
                </div>
                {buttons.map((b, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-start" }}>
                    <select
                      className="input"
                      style={{ flex: "0 0 130px" }}
                      value={b.type}
                      onChange={(e) => updateButton(idx, { type: e.target.value })}
                    >
                      <option value="QUICK_REPLY">Quick reply</option>
                      <option value="URL">URL</option>
                    </select>
                    <div style={{ flex: 1 }}>
                      <input
                        className="input"
                        value={b.text}
                        onChange={(e) => updateButton(idx, { text: e.target.value })}
                        placeholder="Button text"
                        maxLength={25}
                      />
                      {b.type === "URL" && (
                        <input
                          className="input"
                          style={{ marginTop: 6 }}
                          value={b.url}
                          onChange={(e) => updateButton(idx, { url: e.target.value })}
                          placeholder="https://…"
                        />
                      )}
                    </div>
                    <button type="button" className="btn" style={{ padding: "2px 10px" }} onClick={() => removeButton(idx)}>✕</button>
                  </div>
                ))}
              </div>

              {varCount > 0 && (
                <div>
                  <label className="field-label">Sample values</label>
                  <div className="field-help" style={{ marginBottom: 8 }}>
                    Meta requires an example for each variable.
                  </div>
                  {Array.from({ length: varCount }, (_, i) => i + 1).map((n) => (
                    <input
                      key={n}
                      className="input"
                      style={{ marginBottom: 8 }}
                      value={samples[n] || ""}
                      onChange={(e) => setSamples((s) => ({ ...s, [n]: e.target.value }))}
                      placeholder={`Example for {{${n}}}`}
                    />
                  ))}
                </div>
              )}
              {createFetcher.data?.ok && (
                <div className="t-small" style={{ background: "var(--success-bg)", color: "var(--success-ink)", padding: "8px 12px", borderRadius: "var(--r-2)" }}>
                  Template submitted — status: {createFetcher.data.status || "PENDING"}. It will be sendable once Meta approves it.
                </div>
              )}
              {createFetcher.data?.ok === false && (
                <div className="t-small" style={{ background: "var(--danger-bg)", color: "var(--danger-ink)", padding: "8px 12px", borderRadius: "var(--r-2)" }}>
                  {createFetcher.data.error}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="btn btn-primary"
                  onClick={createTemplateNow}
                  disabled={createFetcher.state !== "idle" || !isConnected || !tplName || !tplBody}
                >
                  {createFetcher.state !== "idle" ? "Submitting…" : "Submit for approval"}
                </button>
              </div>
            </div>
          </section>

          {/* Subscribers */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>Subscribers</div>
            <div className="t-display-2 t-mono" style={{ lineHeight: 1, margin: 0 }}>{subCount}</div>
            <div className="t-small muted" style={{ marginTop: 6 }}>
              Contacts who explicitly opted in to WhatsApp.
            </div>

            {subscribers.length > 0 && (
              <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                <div className="t-micro muted" style={{ marginBottom: 10 }}>
                  Most recent{subCount > subscribers.length ? ` · showing ${subscribers.length} of ${subCount}` : ""}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {subscribers.map((sub) => (
                    <div
                      key={sub.id}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: 12, padding: "6px 0",
                      }}
                    >
                      <div className="t-small" style={{ minWidth: 0 }}>
                        <span className="t-mono" style={{ color: "var(--ink-1)" }}>+{sub.phoneNumber}</span>
                        {sub.contactEmail && <span className="muted"> · {sub.contactEmail}</span>}
                        <div className="t-micro muted" style={{ marginTop: 2 }}>
                          {SUB_STATUS[sub.status] || sub.status}
                          {sub.optInMethod ? ` · via ${sub.optInMethod.replace(/_/g, " ")}` : ""}
                          {" · "}
                          {new Date(sub.optInAt).toLocaleDateString()}
                          {/* An unconfirmed row cannot be sent to when the
                              shop requires opt-in — the worker checks
                              confirmedAt, not status — so it must be visible
                              here rather than looking like a live subscriber. */}
                          {sub.status === "subscribed" && !sub.confirmed ? " · unconfirmed" : ""}
                        </div>
                      </div>
                      {sub.status === "subscribed" && (
                        <button
                          className="btn"
                          style={{ flexShrink: 0, padding: "2px 10px" }}
                          onClick={() =>
                            removeFetcher.submit(
                              { intent: "remove-subscriber", phoneNumber: sub.phoneNumber },
                              { method: "post" },
                            )
                          }
                          disabled={removeFetcher.state !== "idle"}
                        >
                          Opt out
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {removeFetcher.data?.ok === false && (
                  <div className="t-small" style={{ marginTop: 8, color: "var(--danger-ink)" }}>
                    {removeFetcher.data.error}
                  </div>
                )}
              </div>
            )}
            {/* Storefront capture used to say "coming soon" — recordOptIn had no
                caller anywhere, so this count could never leave zero and no
                WhatsApp step in any flow could send. */}
            <label
              className="t-small"
              style={{
                display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                marginTop: 16, padding: 12, borderRadius: 8,
                border: "1px solid var(--hair-1)", background: "var(--paper-2)",
              }}
            >
              <input
                type="checkbox"
                checked={popupOptIn}
                disabled={!isConnected || optInFetcher.state !== "idle"}
                onChange={(e) =>
                  optInFetcher.submit(
                    { intent: "toggle-popup-optin", enabled: e.target.checked ? "1" : "0" },
                    { method: "post" },
                  )
                }
                style={{ marginTop: 2 }}
              />
              <span>
                Collect WhatsApp opt-ins in my popup
                <span className="muted" style={{ display: "block", marginTop: 4, lineHeight: 1.5 }}>
                  Adds a phone field and a consent checkbox to your popup. The
                  ticked box is the opt-in record Meta requires before you may
                  message someone.
                  {!isConnected && " Connect a WhatsApp account first."}
                </span>
              </span>
            </label>
          </section>

          {/* Test */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>Send a test</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Mode switch */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className={`btn${testMode === "template" ? " btn-primary" : ""}`}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => setTestMode("template")}
                >
                  Approved template
                </button>
                <button
                  type="button"
                  className={`btn${testMode === "text" ? " btn-primary" : ""}`}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => setTestMode("text")}
                >
                  Free text
                </button>
              </div>

              {testMode === "template" ? (
                <div>
                  <label className="field-label">Template</label>
                  <select className="input" value={testTemplate} onChange={(e) => setTestTemplate(e.target.value)}>
                    <option value="">Select an approved template…</option>
                    {approvedTemplates.map((t) => (
                      <option key={t.id} value={t.name}>{t.name} ({t.language})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="field-label">Message</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={testText}
                    onChange={(e) => setTestText(e.target.value)}
                    placeholder="Type a test message…"
                  />
                  <div className="field-help">
                    Free text only works if this number has messaged your WhatsApp number in the last 24 hours.
                    Text your business number first, then send the test.
                  </div>
                </div>
              )}

              <div>
                <label className="field-label">Test phone (E.164)</label>
                <input className="input" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+1 555 123 4567" />
              </div>
              {testFetcher.data?.ok && (
                <div className="t-small" style={{ background: "var(--success-bg)", color: "var(--success-ink)", padding: "8px 12px", borderRadius: "var(--r-2)" }}>
                  Test sent.
                </div>
              )}
              {testFetcher.data?.ok === false && (
                <div className="t-small" style={{ background: "var(--danger-bg)", color: "var(--danger-ink)", padding: "8px 12px", borderRadius: "var(--r-2)" }}>
                  {testFetcher.data.error}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="btn btn-primary"
                  onClick={sendTest}
                  disabled={
                    testFetcher.state !== "idle" ||
                    !canSend ||
                    !testPhone ||
                    (testMode === "template" && approvedTemplates.length === 0) ||
                    (testMode === "text" && !testText.trim())
                  }
                >
                  {Icons.Send && <Icons.Send size={14} />}
                  {testFetcher.state !== "idle" ? "Sending…" : "Send test"}
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Right: how it works */}
        <div style={{ position: "sticky", top: 16 }}>
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>How it works</div>
            <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10 }} className="t-small">
              <li className="muted">Connect your WhatsApp Business account with the button.</li>
              <li className="muted">Sync your Meta-approved message templates.</li>
              <li className="muted">Add a <strong style={{ color: "var(--ink-1)" }}>WhatsApp</strong> step to any flow and pick a template.</li>
              <li className="muted">Enable the channel — sends go to opted-in contacts only.</li>
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

export default function WhatsappPage() {
  // A direct workspace can still reach this URL by bookmark or shared link.
  const data = useLoaderData();
  if (data?.storefrontOnly) {
    return (
      <StorefrontOnly
        feature="WhatsApp"
        what="WhatsApp opt-in is captured by a block in your storefront theme."
      />
    );
  }
  return <WhatsappPageInner />;
}
