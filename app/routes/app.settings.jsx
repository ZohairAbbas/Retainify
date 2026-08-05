import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { resolveFrom, resolveProvider } from "../lib/email/index.server.js";
import { canUseDomainSlot } from "../lib/email/domain-slots.server.js";
import { addDomain, verifyOrCheckDomain, removeDomain } from "../lib/email/domain-actions.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });

  // The real from-address this shop sends from, computed by the same seam the
  // send path uses (Mode A → merchant domain; Mode B → our shared domain).
  // Shown read-only (Mode B) or as the editable local part (Mode A).
  const provider = resolveProvider(settings);
  const { from } = resolveFrom({ settings, provider });
  const sendingFromAddress = from.match(/<([^>]+)>/)?.[1] || from;

  // Whether a custom-domain slot is available to this shop (excludes itself).
  const slotAvailable = await canUseDomainSlot(shop);

  let domainRecords = [];
  try {
    domainRecords = settings?.domainRecords ? JSON.parse(settings.domainRecords) : [];
  } catch {
    domainRecords = [];
  }

  return { settings: settings ?? {}, sendingFromAddress, slotAvailable, domainRecords };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-settings") {
    const senderName = String(formData.get("senderName") || "").trim();
    const replyTo = String(formData.get("replyTo") || "").trim();
    const brandColor = String(formData.get("brandColor") || "#000000").trim();
    const logoUrl = String(formData.get("logoUrl") || "").trim();
    const quietHoursStart = parseInt(formData.get("quietHoursStart") || "22", 10);
    const quietHoursEnd = parseInt(formData.get("quietHoursEnd") || "8", 10);
    const storeTimezone = String(formData.get("storeTimezone") || "UTC").trim();

    // senderEmail (the from mailbox) is editable ONLY for a verified-domain shop,
    // and only as `[mailbox]@verifiedDomain`. We validate server-side so a stale
    // or forged value can't flip an unverified shop to an arbitrary from-address.
    const mailbox = String(formData.get("senderMailbox") || "").trim().toLowerCase();
    const update = { senderName, replyTo, brandColor, logoUrl, quietHoursStart, quietHoursEnd, storeTimezone };

    const current = await prisma.shopSettings.findUnique({ where: { shop } });
    if (current?.domainVerified && current?.verifiedDomain && mailbox) {
      // Accept only a bare local part (no @) — the domain is always verifiedDomain.
      const localPart = mailbox.includes("@") ? mailbox.split("@")[0] : mailbox;
      if (/^[a-z0-9._%+-]+$/.test(localPart)) {
        update.senderEmail = `${localPart}@${current.verifiedDomain}`;
      }
    }

    await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, senderName, replyTo, brandColor, logoUrl, quietHoursStart, quietHoursEnd, storeTimezone },
      update,
    });
    return { ok: true, saved: true };
  }

  // ── Custom sending-domain flow (shared handlers) ───────────────────────────
  if (intent === "add-domain") {
    return addDomain(shop, formData.get("domain"));
  }
  if (intent === "verify-domain" || intent === "check-domain") {
    return verifyOrCheckDomain(shop, { verify: intent === "verify-domain" });
  }
  if (intent === "remove-domain") {
    return removeDomain(shop);
  }

  return { ok: false };
};

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  label: `${i.toString().padStart(2, "0")}:00`,
  value: String(i),
}));

export default function Settings() {
  const { settings, sendingFromAddress, slotAvailable, domainRecords } = useLoaderData();
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const saved = fetcher.data?.saved;

  const domainVerified = !!settings.domainVerified;
  const verifiedDomain = settings.verifiedDomain || "";
  const domainStatus = settings.domainStatus || "";
  const domainError = fetcher.data?.domainError;

  const [senderName, setSenderName] = useState(settings.senderName || "");
  const [replyTo, setReplyTo] = useState(settings.replyTo || "");
  // Mailbox local-part for a verified domain (Mode A). Prefill from senderEmail.
  const [senderMailbox, setSenderMailbox] = useState(
    (settings.senderEmail || "").split("@")[0] || "hello",
  );
  const [domainInput, setDomainInput] = useState("");
  const [brandColor, setBrandColor] = useState(settings.brandColor || "#000000");
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || "");
  const [quietHoursStart, setQuietHoursStart] = useState(String(settings.quietHoursStart ?? "22"));
  const [quietHoursEnd, setQuietHoursEnd] = useState(String(settings.quietHoursEnd ?? "8"));
  const [storeTimezone, setStoreTimezone] = useState(settings.storeTimezone || "UTC");

  function submitIntent(fields) {
    fetcher.submit(fields, { method: "post" });
  }

  function saveSettings() {
    fetcher.submit(
      {
        intent: "save-settings",
        senderName,
        replyTo,
        senderMailbox: domainVerified ? senderMailbox : "",
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
              {domainVerified ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      className="input"
                      value={senderMailbox}
                      onChange={(e) => setSenderMailbox(e.target.value)}
                      placeholder="hello"
                      style={{ maxWidth: 200 }}
                    />
                    <span className="t-small muted">@{verifiedDomain}</span>
                  </div>
                  <div className="field-help">
                    Pick the mailbox emails are sent from. Your verified domain
                    (<b>{verifiedDomain}</b>) is fixed.
                  </div>
                </>
              ) : (
                <>
                  <input
                    className="input"
                    type="email"
                    value={sendingFromAddress}
                    disabled
                    readOnly
                  />
                  <div className="field-help">
                    Emails are sent from this shared, deliverability-optimized address.
                    Set up your own domain below to send from your brand.
                  </div>
                </>
              )}
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
              <div className="field-help">
                When a customer replies to your emails, their reply goes here.
                Use any inbox you can receive mail at.
              </div>
            </div>
          </div>
        </section>

        {/* Sending domain (custom, Mode A) */}
        <section className="rt-form-section">
          <div className="t-micro muted" style={{ marginBottom: 4 }}>Sending domain</div>
          <div className="t-small muted" style={{ marginBottom: 16 }}>
            Send emails from your own domain instead of the shared address.
          </div>

          {domainError && (
            <div className="t-small" style={{ color: "var(--danger, #c0392b)", marginBottom: 12 }}>
              {domainError}
            </div>
          )}

          {/* State: verified */}
          {domainVerified ? (
            <div>
              <div className="t-small" style={{ marginBottom: 8 }}>
                ✅ <b>{verifiedDomain}</b> is verified. Emails send from your domain.
              </div>
              <button
                className="btn"
                disabled={saving}
                onClick={() => submitIntent({ intent: "remove-domain" })}
              >
                Remove domain
              </button>
            </div>
          ) : verifiedDomain ? (
            /* State: pending — domain added, awaiting DNS + verification */
            <div>
              <div className="t-small" style={{ marginBottom: 12 }}>
                Add these DNS records at your domain provider for <b>{verifiedDomain}</b>,
                then click Verify. Status: <b>{domainStatus || "pending"}</b>.
              </div>
              <DnsRecordsTable records={domainRecords} />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={() => submitIntent({ intent: "verify-domain" })}
                >
                  Verify domain
                </button>
                <button
                  className="btn"
                  disabled={saving}
                  onClick={() => submitIntent({ intent: "check-domain" })}
                >
                  Check now
                </button>
                <button
                  className="btn"
                  disabled={saving}
                  onClick={() => submitIntent({ intent: "remove-domain" })}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : slotAvailable ? (
            /* State: no domain, slot free — offer to add */
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">Your domain</label>
                <input
                  className="input"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder="yourbrand.com"
                />
              </div>
              <button
                className="btn btn-primary"
                disabled={saving || !domainInput.trim()}
                onClick={() => submitIntent({ intent: "add-domain", domain: domainInput.trim() })}
              >
                Add domain
              </button>
            </div>
          ) : (
            /* State: no domain, no slot */
            <div className="t-small muted">
              Custom sending domains are currently full. Please contact us to request one.
            </div>
          )}
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

function DnsRecordsTable({ records }) {
  if (!records || !records.length) {
    return <div className="t-small muted">No DNS records available yet.</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="t-small" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--hair-1)" }}>
            <th style={{ padding: "6px 8px" }}>Type</th>
            <th style={{ padding: "6px 8px" }}>Name</th>
            <th style={{ padding: "6px 8px" }}>Value</th>
            <th style={{ padding: "6px 8px" }}>Priority</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--hair-1)" }}>
              <td style={{ padding: "6px 8px" }}>{r.type}</td>
              <td style={{ padding: "6px 8px", wordBreak: "break-all", fontFamily: "monospace" }}>{r.name}</td>
              <td style={{ padding: "6px 8px", wordBreak: "break-all", fontFamily: "monospace" }}>{r.value}</td>
              <td style={{ padding: "6px 8px" }}>{r.priority ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
