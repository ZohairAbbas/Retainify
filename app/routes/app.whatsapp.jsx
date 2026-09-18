import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import { canManage } from "../lib/auth/roles.js";
import prisma from "../db.server.js";
import { getDefaults } from "../lib/popup-templates/index.js";
import { rtPopupKit } from "../lib/popup-templates/kit.js";

/** Popup templates with no room for the opt-in fields (see kit.js). */
const NO_OPTIN_TEMPLATES = new Set(
  Object.entries(rtPopupKit({ esc: String, rich: String, wa: () => "", preview: false }).templates)
    .filter(([, t]) => t.noWhatsapp)
    .map(([id]) => id),
);
import { resubscribeWebhooks } from "../lib/whatsapp/embedded-signup.server.js";
import { syncTemplates, createTemplate } from "../lib/whatsapp/templates.server.js";
import {
  sendWhatsapp,
  registerWhatsappNumber,
  syncRegistrationState,
  sendBlockedReason,
} from "../lib/whatsapp/index.server.js";
import { toE164 } from "../lib/contacts/contacts.server.js";
import { recordOptOut } from "../lib/whatsapp/optin.server.js";
import Icons from "../components/ui/Icons.jsx";
import EmbeddedSignup from "../components/whatsapp/EmbeddedSignup.jsx";
import TemplatePreview from "../components/whatsapp/TemplatePreview.jsx";
import { featureState, requireFeature } from "../lib/billing/gate.server.js";
import UpgradeNotice from "../components/billing/UpgradeNotice.jsx";
import { mintConnectToken, appBaseUrl } from "../lib/whatsapp/connect-link.server.js";
import { safeReturnPath } from "../lib/whatsapp/problems.js";

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

/** How long a synced template list stays trustworthy before we refresh it. */
const TEMPLATE_TTL_MS = 15 * 60 * 1000;

/** Never synced, or synced longer ago than the TTL. */
function isStale(syncedAt) {
  if (!syncedAt) return true;
  return Date.now() - new Date(syncedAt).getTime() > TEMPLATE_TTL_MS;
}

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  // Open to every workspace. Popup opt-in capture works on a Shopify storefront
  // and on any website with the popup embed installed.
  const { shop } = ctx;

  const [account, settings, subCount, subscribers, templates, popup, flowsWithWhatsapp] = await Promise.all([
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
        bodyText: true,
      },
    }),
    prisma.popupSettings.findUnique({ where: { shop }, select: { config: true, template: true } }),
    // For the setup checklist's last step.
    prisma.journey.count({
      where: { shop, archivedAt: null, steps: { some: { nodeType: "whatsapp", isArchived: false } } },
    }),
  ]);

  // WhatsApp is a Growth-tier feature (Meta bills per conversation). In shadow
  // mode `locked` is false, so the page stays fully usable until enforcement is on.
  const gate = await featureState(shop, "whatsapp");

  // Reconcile registration with Meta before rendering. A number that is already
  // CONNECTED — every test number, and any registered in WhatsApp Manager — was
  // otherwise shown a PIN prompt it could not satisfy, because re-registering
  // demands the PIN set at first registration. One Graph call, and only while
  // our own stamp is missing.
  const registration =
    account && account.status === "connected" && !account.registeredAt
      ? await syncRegistrationState(shop).catch(() => ({ registered: false }))
      : { registered: !!account?.registeredAt };
  const isConnected = account?.status === "connected";

  return {
    gate,
    isShopify: ctx.isShopify,
    flowsWithWhatsapp,
    // Set when the flow builder sent the merchant here to fix WhatsApp; the
    // page offers the way back. Only in-app flow paths are accepted.
    returnTo: safeReturnPath(new URL(request.url).searchParams.get("return")),
    account: account
      ? {
          status: account.status,
          wabaId: account.wabaId,
          displayPhoneNumber: account.displayPhoneNumber,
          registered: !!account.registeredAt || registration.registered === true,
          // Null means Meta sends us no events for this shop at all: sends
          // work, but delivery, reads, replies and STOP never come back.
          webhooksSubscribed: !!account.webhooksSubscribedAt,
          tokenExpiresAt: account.tokenExpiresAt ? account.tokenExpiresAt.toISOString() : null,
          lastError: account.lastError,
          // Meta refusing to send for the whole account — an expired token, an
          // unregistered number, a display name awaiting review. Shown on a
          // CONNECTED account, which is exactly when it matters: the connection
          // looks healthy and nothing arrives.
          sendBlocked: sendBlockedReason(account),
        }
      : null,
    whatsappEnabled: settings?.whatsappEnabled ?? false,
    popupOptIn: popup?.config?.whatsappOptIn === true,
    // The announcement bar is one line of controls with nowhere to put a phone
    // field and a consent checkbox, so it never collects opt-ins — say so here
    // rather than leaving the merchant to wonder why none arrive.
    popupTakesOptIn: !NO_OPTIN_TEMPLATES.has(popup?.template || ""),
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
    //
    // `components` and `buttonUrls` ride along for the preview: the body alone
    // hides the header, footer and buttons, which is most of what a merchant
    // wants to check before putting a template in a flow.
    templates: templates.map(({ buttonUrls, components, ...t }) => ({
      ...t,
      components: components ?? null,
      buttonUrls: buttonUrls ?? null,
      untracked: hasUrlButton(components) && !(buttonUrls && Object.keys(buttonUrls).length),
    })),
    // Drives the one-shot refresh on load. Templates change at Meta (approval,
    // rejection, edits made in Business Manager) with no webhook for shops whose
    // subscription is off, so a list last pulled an hour ago can be wrong.
    templatesStale: isConnected && isStale(account?.templatesSyncedAt),
    // A signed, short-lived link that starts Meta's flow in a top-level tab.
    // Minted per page load so it cannot outlive the session that produced it.
    connectUrl: (() => {
      const token = mintConnectToken(shop);
      const base = appBaseUrl();
      return token && base ? `${base}/whatsapp/connect/${token}` : "";
    })(),
  };
};

/**
 * Intents that change the WhatsApp ACCOUNT rather than use it.
 *
 * Connecting, registering a number and disconnecting are workspace-level
 * identity: they bind the workspace to a Meta WABA, put a phone number on the
 * shop's behalf into Meta's hands, and — in the case of disconnect — silently
 * stop every queued WhatsApp send. Separate from the plan gate below, which asks
 * a different question (is this feature paid for), so the two lists differ on
 * purpose: send-test is plan-gated but not role-gated, because sending a test
 * to yourself is using the channel, not reconfiguring it.
 */
const MANAGE_INTENTS = ["connect", "register-number", "disconnect", "resubscribe-webhooks"];

export const action = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  // Role gate before the plan gate: "you may not do this" is a truer answer than
  // "your plan does not include this" for someone who is not allowed either way.
  // Embedded Shopify sessions resolve to owner and are unaffected.
  if (MANAGE_INTENTS.includes(intent) && !canManage(ctx.role)) {
    return { ok: false, error: "Only owners and admins can change the WhatsApp connection." };
  }

  // Anything that connects or sends on WhatsApp is plan-gated. Read-only intents
  // (template sync/list) stay open so a downgraded shop can still see its state.
  const GATED_INTENTS = [
    "connect",
    "register-number",
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
    // Only switching ON is plan-gated. A shop that has been downgraded must
    // still be able to pause WhatsApp — gating both ways left it stuck on.
    if (!current?.whatsappEnabled) {
      const denied = await requireFeature(shop, "whatsapp");
      if (denied) return denied;
    }
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
    // With no popup chosen yet, start from the default one — a config holding
    // only this flag would render as a popup with no content. It stays paused:
    // switching on an opt-in field is not publishing a popup.
    const base = row?.config || getDefaults(ctx.isShopify ? "editorial" : "newsletter");
    const config = { ...base, whatsappOptIn: enabled };
    await prisma.popupSettings.upsert({
      where: { shop },
      create: { shop, config, template: config.template, enabled: false },
      update: row?.config ? { config } : { config, template: config.template },
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
    // Template tests only. A free-text test proved nothing a flow can do —
    // flows can only ever send approved templates — and it failed for anyone
    // who hadn't messaged the number in the last 24 hours, which read as the
    // channel being broken.
    const templateName = String(fd.get("templateName") || "");
    const templateLanguage = String(fd.get("templateLanguage") || "");
    if (!templateName) return { ok: false, error: "Pick an approved template." };
    const tpl = await prisma.whatsappTemplate.findFirst({
      where: { shop, name: templateName, status: "APPROVED", ...(templateLanguage ? { language: templateLanguage } : {}) },
    });
    if (!tpl) return { ok: false, error: "That template isn't approved any more. Sync templates and pick another." };

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
  const { gate, isShopify = true, returnTo = "", flowsWithWhatsapp = 0, account, whatsappEnabled, whatsappRequireOptIn, popupOptIn, popupTakesOptIn = true, subCount, subscribers = [], templates, templatesStale, connectUrl } = useLoaderData();
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
  const [openPreview, setOpenPreview] = useState(null); // template id

  // Refresh the list from Meta when it is stale, once per mount. Approval,
  // rejection and edits all happen at Meta, and a shop whose webhook
  // subscription is off hears about none of them — so the button alone meant
  // the list could sit wrong indefinitely. The fetcher shows the same
  // "Syncing…" state as a manual press, so this is visible rather than magic.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (!templatesStale || autoSynced.current) return;
    autoSynced.current = true;
    syncFetcher.submit({ intent: "sync-templates" }, { method: "post" });
  }, [templatesStale, syncFetcher]);

  const [testPhone, setTestPhone] = useState("");
  const [testTemplate, setTestTemplate] = useState(""); // "name|language"

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
    const [templateName, templateLanguage] = testTemplate.split("|");
    testFetcher.submit(
      { intent: "send-test", to: testPhone, templateName, templateLanguage: templateLanguage || "" },
      { method: "post" },
    );
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

      {/* Came here from a flow: say where they'll go back to, and — once the
          channel can actually send — say so, so they know they're done. */}
      {returnTo && (
        <BackToFlow returnTo={returnTo} ready={isConnected && whatsappEnabled && approvedTemplates.length > 0} />
      )}

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
          <section className="rt-form-section" id="wa-connect" style={{ scrollMarginTop: 16 }}>
            <h2 className="t-h3" style={{ margin: "0 0 16px" }}>Connect WhatsApp</h2>
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

                {account.sendBlocked && (
                  <div className="t-small" style={{ background: "var(--danger-bg)", color: "var(--danger-ink)", padding: "10px 12px", borderRadius: "var(--r-2)", lineHeight: 1.5 }}>
                    <strong>Sending is blocked.</strong> {account.sendBlocked}
                    <div style={{ marginTop: 6 }}>
                      Queued messages are held, not lost. Once it&rsquo;s fixed at Meta, send a
                      test below — a successful send clears this.
                    </div>
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
                      (templates). Enter a 6-digit PIN to register it. This becomes the
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
                <EmbeddedSignup connectUrl={connectUrl} connected={isConnected} />
                {account?.status === "disconnected" && account?.lastError && (
                  <div className="t-small muted">Last attempt: {account.lastError}</div>
                )}
              </div>
            )}
          </section>

          {/* Channel status */}
          <section className="rt-form-section" id="wa-status" style={{ scrollMarginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h2 className="t-h3" style={{ margin: "0 0 8px" }}>Channel</h2>
                <div className="t-body" style={{ fontWeight: 500 }}>
                  {whatsappEnabled ? "On" : "Off"}
                </div>
                <div className="t-small muted" style={{ marginTop: 2, maxWidth: 460 }}>
                  {!isConnected
                    ? "Turns on automatically when you connect a number."
                    : !isRegistered
                      ? "Register your number above — nothing can send until then."
                      : whatsappEnabled
                        ? "WhatsApp steps in published flows and campaigns send. Turn off to pause every WhatsApp send at once."
                        : "Paused — WhatsApp steps are skipped (and logged) until you turn this back on."}
                </div>
              </div>
              <label className="rt-toggle">
                <input
                  type="checkbox"
                  checked={whatsappEnabled}
                  onChange={toggleEnabled}
                  aria-label="WhatsApp channel"
                  // Turning it ON needs a number that can send; turning it
                  // OFF must always work, or a broken account couldn't be paused.
                  disabled={toggleFetcher.state !== "idle" || (!whatsappEnabled && !canSend)}
                />
                <span className="rt-toggle-switch" />
              </label>
            </div>
          </section>

          {/* Templates */}
          <section className="rt-form-section" id="wa-templates" style={{ scrollMarginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 className="t-h3" style={{ margin: 0 }}>Message templates</h2>
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
              <div className="t-small muted">
                {syncFetcher.state !== "idle"
                  ? "Syncing templates from Meta…"
                  : isConnected
                    ? "No templates on this WhatsApp Business account yet. Create one below, or make one in Meta Business Manager and sync."
                    : "Connect an account above — your Meta-approved templates sync automatically."}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {templates.map((t) => {
                  const open = openPreview === t.id;
                  return (
                    <div key={t.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
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
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "2px 10px", marginTop: 6 }}
                        aria-expanded={open}
                        onClick={() => setOpenPreview(open ? null : t.id)}
                      >
                        {open ? "Hide preview" : "Preview"}
                      </button>
                      {open && (
                        <div style={{ marginTop: 10, marginBottom: 4 }}>
                          <TemplatePreview
                            components={t.components}
                            bodyText={t.bodyText}
                            buttonUrls={t.buttonUrls}
                          />
                          {/* Variables stay as {{1}} here on purpose: this page
                              has no contact to merge, and the values are chosen
                              per flow or campaign, not per template. */}
                          <div className="t-micro muted" style={{ marginTop: 8 }}>
                            Variables show as {"{{1}}"}, {"{{2}}"}… — real values are set on the
                            flow step or campaign that sends this template.
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Test — before Create. Only an approved template can be sent, so the
              first useful thing after connecting is to send one of the
              templates the account already has; creating a new one means
              waiting on Meta's review. It does not need the channel toggle
              on: a test send goes through the Cloud API directly. */}
          <section className="rt-form-section" id="wa-test" style={{ scrollMarginTop: 16 }}>
            <h2 className="t-h3" style={{ margin: "0 0 16px" }}>Send yourself a test</h2>
            {!canSend && (
              <div className="t-small muted" style={{ marginBottom: 16 }}>
                {!isConnected
                  ? "Connect a WhatsApp account above to send a test."
                  : "Register your number above to send a test."}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label className="field-label">Template</label>
                <select className="input" value={testTemplate} onChange={(e) => setTestTemplate(e.target.value)} disabled={approvedTemplates.length === 0}>
                  <option value="">{approvedTemplates.length ? "Select an approved template…" : "No approved templates yet"}</option>
                  {approvedTemplates.map((t) => (
                    <option key={t.id} value={`${t.name}|${t.language}`}>{t.name} ({t.language})</option>
                  ))}
                </select>
                {approvedTemplates.length === 0 ? (
                  <div className="field-help">
                    Tests use a Meta-approved template — the only kind of message a flow can send.
                    Create one below or sync from Meta; it appears here once approved.
                  </div>
                ) : (() => {
                  const [n, l] = testTemplate.split("|");
                  const t = approvedTemplates.find((x) => x.name === n && x.language === l);
                  return t?.bodyText ? (
                    <div className="field-help" style={{ whiteSpace: "pre-wrap", background: "var(--paper-2)", padding: 10, borderRadius: "var(--r-2)", marginTop: 8 }}>
                      {t.bodyText}
                      {/\{\{\s*\d+\s*\}\}/.test(t.bodyText) && (
                        <div className="muted" style={{ marginTop: 6 }}>Variables are filled with sample text in a test.</div>
                      )}
                    </div>
                  ) : null;
                })()}
              </div>

              <div>
                <label className="field-label">Send to</label>
                <input className="input" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+92 300 1234567" />
                <div className="field-help">Your own WhatsApp number, with country code.</div>
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
                    !testTemplate
                  }
                >
                  {Icons.Send && <Icons.Send size={14} />}
                  {testFetcher.state !== "idle" ? "Sending…" : "Send test"}
                </button>
              </div>
            </div>
          </section>

          {/* Create template */}
          <section className="rt-form-section" id="wa-create" style={{ scrollMarginTop: 16 }}>
            <h2 className="t-h3" style={{ margin: "0 0 16px" }}>Create a template</h2>
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

          {/* Audience / consent */}
          <section className="rt-form-section" id="wa-consent" style={{ scrollMarginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ maxWidth: 460 }}>
                <h2 className="t-h3" style={{ margin: "0 0 8px" }}>Consent</h2>
                <div className="t-body" style={{ fontWeight: 500 }}>
                  {requireOptIn ? "On — send only to opted-in contacts" : "Off — send to any contact with a phone"}
                </div>
                <div className="t-small muted" style={{ marginTop: 2 }}>
                  {requireOptIn
                    ? "Recommended. Only contacts who explicitly opted in to WhatsApp receive messages."
                    : "Messages go to any enrolled contact who has a phone number, even without a WhatsApp opt-in."}
                </div>
              </div>
              {/* The switch shows the setting it is labelled with. It was
                  inverted: "Require opt-in: On" rendered as OFF, so the obvious
                  action — switching it on — turned the consent requirement off. */}
              <label className="rt-toggle">
                <input
                  type="checkbox"
                  checked={requireOptIn}
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

          {/* Subscribers */}
          <section className="rt-form-section" id="wa-subscribers" style={{ scrollMarginTop: 16 }}>
            <h2 className="t-h3" style={{ margin: "0 0 16px" }}>Subscribers</h2>
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
                  {isShopify ? "" : " Works with the popup on your website (Popups → Install on your website)."}
                  {popupOptIn && !popupTakesOptIn && (
                    <strong style={{ display: "block", marginTop: 6 }}>
                      Your current popup is the Announcement Bar, which has no room for these fields — pick another popup to collect opt-ins.
                    </strong>
                  )}
                </span>
              </span>
            </label>
          </section>


        </div>

        {/* Right: live setup checklist. Replaces a static "How it works" list
            that looked the same whether you had done every step or none. */}
        <div style={{ position: "sticky", top: 16 }}>
          <WhatsappChecklist
            steps={[
              { id: "wa-connect", label: "Connect your WhatsApp Business account", done: isConnected && isRegistered },
              { id: "wa-status", label: "Channel on", done: isConnected && whatsappEnabled,
                hint: isConnected && !whatsappEnabled ? "Paused — turn it back on to send" : "" },
              { id: "wa-templates", label: "Get a message template approved", done: approvedTemplates.length > 0,
                hint: templates.some((t) => t.status === "PENDING") ? "Waiting for Meta's review" : "" },
              { id: "wa-test", label: "Send yourself a test", done: testFetcher.data?.ok === true },
              { id: "flows", label: "Add a WhatsApp step to a flow", done: flowsWithWhatsapp > 0, href: "/app/flows" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function BackToFlow({ returnTo, ready }) {
  const navigate = useNavigate();
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        padding: "12px 16px", marginBottom: 16, borderRadius: "var(--r-3)",
        border: `1px solid ${ready ? "var(--success-ink)" : "var(--hair-2)"}`,
        background: ready ? "var(--success-bg)" : "var(--paper-3)",
      }}
    >
      <span className="t-small" style={{ color: ready ? "var(--success-ink)" : "var(--ink-2)" }}>
        {ready
          ? "WhatsApp is ready: connected, switched on, with an approved template."
          : "Finish setting up WhatsApp here, then head back to your flow."}
      </span>
      <button type="button" className={`btn ${ready ? "btn-primary" : "btn-secondary"} btn-sm`} onClick={() => navigate(returnTo)}>
        ← Back to your flow
      </button>
    </div>
  );
}

/**
 * Where you are in WhatsApp setup, ticking itself off from real state, with
 * each step a link to the section that does it.
 */
function WhatsappChecklist({ steps }) {
  const navigate = useNavigate();
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <section className="rt-form-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h2 className="t-h3" style={{ margin: 0 }}>Setup</h2>
        <span className="t-small muted tabular">{done} of {steps.length} done</span>
      </div>
      <div style={{ height: 6, background: "var(--paper-2)", borderRadius: 3, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ width: `${(done / steps.length) * 100}%`, height: "100%", background: "var(--brand-700)" }} />
      </div>
      <ol className="rt-checklist">
        {steps.map((s, i) => (
          <li key={s.id} className={s.done ? "rt-check-done" : next?.id === s.id ? "rt-check-next" : ""}>
            <span className="rt-check-mark" aria-hidden="true">{s.done ? "✓" : i + 1}</span>
            <span style={{ flex: 1 }}>
              <button
                type="button"
                className="rt-check-link"
                onClick={() => {
                  if (s.href) navigate(s.href);
                  else document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {s.label}
              </button>
              {s.hint && !s.done && <span className="t-small muted" style={{ display: "block" }}>{s.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
      {!next && (
        <p className="t-small" style={{ margin: "12px 0 0", color: "var(--success-ink)" }}>
          WhatsApp is ready. Messages go to opted-in contacts only.
        </p>
      )}
    </section>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

export default function WhatsappPage() {
  return <WhatsappPageInner />;
}
