import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { connectWhatsappAccount } from "../lib/whatsapp/embedded-signup.server.js";
import { syncTemplates } from "../lib/whatsapp/templates.server.js";
import { sendWhatsapp } from "../lib/whatsapp/index.server.js";
import { normalizePhone } from "../lib/contacts/contacts.server.js";
import Icons from "../components/ui/Icons.jsx";
import EmbeddedSignup from "../components/whatsapp/EmbeddedSignup.jsx";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [account, settings, subCount, templates] = await Promise.all([
    prisma.whatsappAccount.findUnique({ where: { shop } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.whatsappSubscription.count({ where: { shop, status: "subscribed" } }),
    prisma.whatsappTemplate.findMany({
      where: { shop },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, language: true, category: true, status: true },
    }),
  ]);

  return {
    account: account
      ? {
          status: account.status,
          wabaId: account.wabaId,
          displayPhoneNumber: account.displayPhoneNumber,
          lastError: account.lastError,
        }
      : null,
    whatsappEnabled: settings?.whatsappEnabled ?? false,
    subCount,
    templates,
    // eslint-disable-next-line no-undef
    metaAppId: process.env.META_APP_ID || "",
    // eslint-disable-next-line no-undef
    esConfigId: process.env.META_ES_CONFIG_ID || "",
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent === "toggle-enabled") {
    const current = await prisma.shopSettings.findUnique({ where: { shop } });
    await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, whatsappEnabled: true },
      update: { whatsappEnabled: !current?.whatsappEnabled },
    });
    return { ok: true, toggled: true };
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
    return { ok: true, connected: true };
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

  if (intent === "send-test") {
    const to = normalizePhone(String(fd.get("to") || ""));
    const templateName = String(fd.get("templateName") || "");
    if (!to) return { ok: false, error: "Enter a test phone number in E.164 format." };
    if (!templateName) return { ok: false, error: "Pick an approved template." };

    const tpl = await prisma.whatsappTemplate.findFirst({
      where: { shop, name: templateName, status: "APPROVED" },
    });
    const result = await sendWhatsapp(
      { to, templateName, language: tpl?.language || "en_US", components: [] },
      { shop },
    );
    if (!result.ok) return { ok: false, error: result.error || "Send failed." };
    return { ok: true, sent: true };
  }

  return { ok: false };
};

export default function WhatsappPage() {
  const { account, whatsappEnabled, subCount, templates, metaAppId, esConfigId } = useLoaderData();
  const connectFetcher = useFetcher();
  const toggleFetcher = useFetcher();
  const syncFetcher = useFetcher();
  const testFetcher = useFetcher();

  const isConnected = account?.status === "connected";
  const approvedTemplates = templates.filter((t) => t.status === "APPROVED");

  const [testPhone, setTestPhone] = useState("");
  const [testTemplate, setTestTemplate] = useState("");

  function toggleEnabled() {
    toggleFetcher.submit({ intent: "toggle-enabled" }, { method: "post" });
  }
  function disconnect() {
    connectFetcher.submit({ intent: "disconnect" }, { method: "post" });
  }
  function syncTemplatesNow() {
    syncFetcher.submit({ intent: "sync-templates" }, { method: "post" });
  }
  function sendTest() {
    testFetcher.submit(
      { intent: "send-test", to: testPhone, templateName: testTemplate },
      { method: "post" },
    );
  }

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>WhatsApp</h1>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 24, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Connection */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>Connection</div>
            {isConnected ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div className="t-body" style={{ fontWeight: 500 }}>
                    {account.displayPhoneNumber || "Connected number"}
                  </div>
                  <div className="t-small muted" style={{ marginTop: 2 }}>
                    WABA {account.wabaId} · <span style={{ color: "var(--node-whatsapp-ink)" }}>Connected</span>
                  </div>
                </div>
                <button className="btn" onClick={disconnect} disabled={connectFetcher.state !== "idle"}>
                  Disconnect
                </button>
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
                  {isConnected
                    ? "WhatsApp steps in your flows will send once enabled."
                    : "Connect an account first, then enable the channel."}
                </div>
              </div>
              <label className="rt-toggle">
                <input
                  type="checkbox"
                  checked={whatsappEnabled}
                  onChange={toggleEnabled}
                  disabled={toggleFetcher.state !== "idle" || !isConnected}
                />
                <span className="rt-toggle-switch" />
              </label>
            </div>
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
                  <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="t-small">
                      <strong style={{ color: "var(--ink-1)" }}>{t.name}</strong>
                      <span className="muted"> · {t.language} · {t.category}</span>
                    </div>
                    <span className="t-micro" style={{
                      color: t.status === "APPROVED" ? "var(--node-whatsapp-ink)" : "var(--ink-3)",
                    }}>{t.status}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Subscribers */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>Subscribers</div>
            <div className="t-display-2 t-mono" style={{ lineHeight: 1, margin: 0 }}>{subCount}</div>
            <div className="t-small muted" style={{ marginTop: 6 }}>
              Opted-in WhatsApp contacts. Opt-in capture on the storefront is coming soon.
            </div>
          </section>

          {/* Test */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 16 }}>Send a test</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label className="field-label">Template</label>
                <select className="input" value={testTemplate} onChange={(e) => setTestTemplate(e.target.value)}>
                  <option value="">Select an approved template…</option>
                  {approvedTemplates.map((t) => (
                    <option key={t.id} value={t.name}>{t.name} ({t.language})</option>
                  ))}
                </select>
              </div>
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
                <button className="btn btn-primary" onClick={sendTest} disabled={testFetcher.state !== "idle" || !isConnected || approvedTemplates.length === 0}>
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
