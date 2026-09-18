import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLoaderData, useFetcher, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import { canManage } from "../lib/auth/roles.js";
import prisma from "../db.server.js";
import { resolveFrom, resolveProvider, validateReplyTo } from "../lib/email/index.server.js";
import { canUseDomainSlot } from "../lib/email/domain-slots.server.js";
import { featureState, requireFeature } from "../lib/billing/gate.server.js";
import UpgradeNotice from "../components/billing/UpgradeNotice.jsx";
import { addDomain, verifyOrCheckDomain, removeDomain } from "../lib/email/domain-actions.server.js";
import ImageUpload from "../components/ui/ImageUpload.jsx";

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });

  // The real from-address this shop sends from, computed by the same seam the
  // send path uses (Mode A → merchant domain; Mode B → our shared domain).
  // Shown read-only (Mode B) or as the editable local part (Mode A).
  const provider = resolveProvider(settings);
  const { from } = resolveFrom({ settings, provider });
  const sendingFromAddress = from.match(/<([^>]+)>/)?.[1] || from;

  // Two INDEPENDENT constraints on custom domains, with different fixes:
  //   1. domainGate — is the feature on this shop's plan? (fix: upgrade)
  //   2. slotAvailable — is one of the 10 account-wide Resend slots free?
  //      (fix: nothing the merchant can do — we must raise the Resend plan)
  // They need separate merchant-facing messages; never collapse them into one.
  const domainGate = await featureState(shop, "custom_domain");
  const slotAvailable = await canUseDomainSlot(shop);

  let domainRecords = [];
  try {
    domainRecords = settings?.domainRecords ? JSON.parse(settings.domainRecords) : [];
  } catch {
    domainRecords = [];
  }

  return {
    settings: settings ?? {},
    sendingFromAddress,
    slotAvailable,
    domainRecords,
    domainGate,
    isShopify: ctx.isShopify,
    // So the page can show a member the settings read-only rather than letting
    // them fill the form and meet a 403 on save. The action enforces this
    // regardless — this only decides what the page looks like.
    canManage: canManage(ctx.role),
  };
};

export const action = async ({ request }) => {
  // Sender identity and the custom sending domain are workspace-level identity,
  // not content: they decide what every email from this workspace claims to be,
  // and a custom domain consumes one of the scarce Resend slots. ROLE_HELP tells
  // a member they "can build and send, but can't manage people or billing" —
  // changing who the mail comes from is on the far side of that line.
  //
  // requireManage is a no-op for an embedded Shopify session, which resolves to
  // owner: a store's Shopify admins are all owners of the workspace, so
  // behaviour inside Shopify is unchanged.
  const ctx = await requireAccount(request, { requireManage: true });
  const { shop } = ctx;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-settings") {
    const senderName = String(formData.get("senderName") || "").trim();
    // Rejecting at save time is the only place the merchant can see this — a
    // bad value silently 422s every send afterwards. See validateReplyTo().
    const reply = validateReplyTo(formData.get("replyTo"));
    if (!reply.ok) return { ok: false, fieldError: reply.error };
    const replyTo = reply.value;
    // Accept "acme.com" as readily as "https://acme.com" — merchants type both,
    // and a bare host stored raw would end up as a relative href in an email.
    const rawWebsite = String(formData.get("websiteUrl") || "").trim().replace(/\/+$/, "");
    const websiteUrl = rawWebsite && !/^https?:\/\//i.test(rawWebsite)
      ? `https://${rawWebsite}`
      : rawWebsite;
    const brandColor = String(formData.get("brandColor") || "#000000").trim();
    const logoUrl = String(formData.get("logoUrl") || "").trim();
    const quietHoursStart = parseInt(formData.get("quietHoursStart") || "22", 10);
    const quietHoursEnd = parseInt(formData.get("quietHoursEnd") || "8", 10);
    // Validated server-side too: the select can be bypassed, and an invalid
    // zone makes isInQuietHours() throw-and-return-false, silently disabling
    // quiet hours for every send.
    const rawTimezone = String(formData.get("storeTimezone") || "UTC").trim();
    let storeTimezone = "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: rawTimezone });
      storeTimezone = rawTimezone;
    } catch {
      console.warn(`[settings] rejected invalid timezone "${rawTimezone}" for ${shop}`);
    }

    // senderEmail (the from mailbox) is editable ONLY for a verified-domain shop,
    // and only as `[mailbox]@verifiedDomain`. We validate server-side so a stale
    // or forged value can't flip an unverified shop to an arbitrary from-address.
    const mailbox = String(formData.get("senderMailbox") || "").trim().toLowerCase();
    const update = { senderName, replyTo, websiteUrl, brandColor, logoUrl, quietHoursStart, quietHoursEnd, storeTimezone };

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
      create: { shop, senderName, replyTo, websiteUrl, brandColor, logoUrl, quietHoursStart, quietHoursEnd, storeTimezone },
      update,
    });
    return { ok: true, saved: true };
  }

  // ── Custom sending-domain flow (shared handlers) ───────────────────────────
  if (intent === "add-domain") {
    // Plan check first — a shop without the feature shouldn't consume one of the
    // scarce Resend slots. addDomain() still enforces the slot cap after this.
    const denied = await requireFeature(shop, "custom_domain");
    if (denied) return denied;
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

/**
 * Every IANA zone the runtime knows, so the merchant picks rather than types.
 * Falls back to a short list on the rare engine without supportedValuesOf.
 */
const TIMEZONES = (() => {
  try {
    const all = Intl.supportedValuesOf("timeZone");
    if (Array.isArray(all) && all.length) return ["UTC", ...all.filter((z) => z !== "UTC")];
  } catch {
    // Older runtimes: fall through.
  }
  return [
    "UTC", "America/New_York", "America/Chicago", "America/Denver",
    "America/Los_Angeles", "America/Sao_Paulo", "Europe/London", "Europe/Paris",
    "Europe/Berlin", "Africa/Lagos", "Asia/Dubai", "Asia/Karachi",
    "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
  ];
})();

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  label: `${i.toString().padStart(2, "0")}:00`,
  value: String(i),
}));

export default function Settings() {
  const {
    settings,
    sendingFromAddress,
    slotAvailable,
    domainRecords,
    domainGate,
    isShopify = true,
    // Defaults to true so an embedded Shopify session — which has no role in our
    // user table and always manages — is never accidentally locked out by a
    // loader that didn't send the field.
    canManage: allowed = true,
  } = useLoaderData();
  const fetcher = useFetcher();
  const location = useLocation();
  const saving = fetcher.state !== "idle";

  const domainVerified = !!settings.domainVerified;
  const verifiedDomain = settings.verifiedDomain || "";
  const domainStatus = settings.domainStatus || "";
  const domainError = fetcher.data?.domainError;
  const fieldError = fetcher.data?.fieldError;

  const [senderName, setSenderName] = useState(settings.senderName || "");
  const [replyTo, setReplyTo] = useState(settings.replyTo || "");
  const [websiteUrl, setWebsiteUrl] = useState(settings.websiteUrl || "");
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

  // What the form started from, so the save bar appears only when something
  // actually changed, and Discard can put it back.
  const initial = useMemo(() => ({
    senderName: settings.senderName || "",
    replyTo: settings.replyTo || "",
    websiteUrl: settings.websiteUrl || "",
    senderMailbox: (settings.senderEmail || "").split("@")[0] || "hello",
    brandColor: settings.brandColor || "#000000",
    logoUrl: settings.logoUrl || "",
    quietHoursStart: String(settings.quietHoursStart ?? "22"),
    quietHoursEnd: String(settings.quietHoursEnd ?? "8"),
    storeTimezone: settings.storeTimezone || "UTC",
  }), [settings]);
  const current = { senderName, replyTo, websiteUrl, senderMailbox, brandColor, logoUrl, quietHoursStart, quietHoursEnd, storeTimezone };
  // After a save, adopt what the server stored. It trims and lower-cases
  // (the mailbox, for one), and without this the save bar would stay up over
  // a form that is in fact saved. Only on a save: other actions on this page
  // (domain setup) also reload the settings and must not wipe unsaved edits.
  const lastSaved = fetcher.state === "idle" && fetcher.data?.saved ? fetcher.data : null;
  const adoptedSave = useRef(null);
  useEffect(() => {
    if (!lastSaved || adoptedSave.current === lastSaved) return;
    adoptedSave.current = lastSaved;
    discard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSaved]);
  const dirty = Object.keys(initial).some((k) => initial[k] !== current[k]);
  function discard() {
    setSenderName(initial.senderName);
    setReplyTo(initial.replyTo);
    setWebsiteUrl(initial.websiteUrl);
    setSenderMailbox(initial.senderMailbox);
    setBrandColor(initial.brandColor);
    setLogoUrl(initial.logoUrl);
    setQuietHoursStart(initial.quietHoursStart);
    setQuietHoursEnd(initial.quietHoursEnd);
    setStoreTimezone(initial.storeTimezone);
  }

  function saveSettings() {
    fetcher.submit(
      {
        intent: "save-settings",
        senderName,
        replyTo,
        websiteUrl,
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
          <p className="muted" style={{ margin: "8px 0 0", maxWidth: 560 }}>
            How your emails are sent and how they look. Each section explains what it changes.
          </p>
        </div>
        <div className="rt-page-actions">
          <Link className="btn btn-secondary" to={`/app/setup${location.search}`}>Open setup guide</Link>
        </div>
      </header>

      <div className="rt-settings">

        {/* Sender details */}
        <SettingsSection
          title="Sender"
          description="Who your emails come from, and where replies and plain links go."
        >
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
              <label className="field-label">
                Website{isShopify ? " (optional)" : ""}
              </label>
              <input
                className="input"
                type="url"
                inputMode="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder={isShopify ? "https://yourstore.com" : "https://yourcompany.com"}
              />
              <div className="field-help">
                {isShopify
                  ? "Where {store_url} points, and where an email button with no link of its own goes. Leave blank to use your Shopify domain."
                  : "Where {store_url} points, and where an email button with no link of its own goes. Without this, those buttons do nothing."}
              </div>
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
              {fieldError ? (
                <div className="t-small" style={{ color: "var(--danger, #c0392b)", marginTop: 4 }}>
                  {fieldError}
                </div>
              ) : (
                <div className="field-help">
                  When a customer replies to your emails, their reply goes here.
                  Use any inbox you can receive mail at.
                </div>
              )}
            </div>
          </div>
        </SettingsSection>

        {/* Sending domain (custom, Mode A) */}
        <SettingsSection
          title="Sending domain"
          description="Send from your own domain instead of our shared address. Better deliverability, your brand in the inbox."
          note="Saved separately — changes here take effect straight away."
        >

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
          ) : domainGate?.locked ? (
            /* State: feature not on plan. Distinct from "no slots" below —
               the fix here is an upgrade, which the merchant controls. */
            <UpgradeNotice
              title={`Custom sending domains are available on the ${domainGate.upgradeToName || "Starter"} plan.`}
              body="Send from your own domain instead of our shared address. Subject to availability."
              planName={domainGate.upgradeToName}
              compact
            />
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
        </SettingsSection>

        {/* Brand */}
        <SettingsSection
          title="Brand"
          description="Your colour and logo, applied to buttons, accents and the top of every email."
        >
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
            <ImageUpload
              label="Logo"
              value={logoUrl}
              onChange={setLogoUrl}
              source="brand-logo"
              disabled={!allowed}
              help="Shown at the top of every email. A transparent PNG or SVG, at least 300px wide, looks best."
            />
          </div>
        </SettingsSection>

        {/* Quiet hours */}
        <SettingsSection
          title="Quiet hours"
          description="Nothing is sent inside this window. Messages due then wait and go out when it ends."
        >
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
              <label className="field-label" htmlFor="rt-timezone">Store timezone</label>
              {/* Was a free-text field with an "Asia/Karachi" placeholder. A
                  typo there silently disabled quiet hours entirely — the worker
                  catches the invalid zone and returns false, so every send went
                  out regardless of the window. */}
              <select
                id="rt-timezone"
                className="select"
                value={storeTimezone}
                onChange={(e) => setStoreTimezone(e.target.value)}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <div className="field-help">
                Quiet hours are applied in this timezone.
              </div>
            </div>
          </div>
        </SettingsSection>

        {!allowed && (
          <p className="muted" style={{ margin: 0 }}>
            Only owners and admins can change these settings.
          </p>
        )}

        {/* Appears only with unsaved changes, and stays in reach however far
            down the page they are. The old single Save button sat below every
            section, a long scroll away from the field just edited. */}
        {dirty && allowed && (
          <div className="rt-savebar" role="region" aria-label="Unsaved changes">
            <span className="t-small">
              {fieldError ? fieldError : "You have unsaved changes."}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={discard} disabled={saving}>Discard</button>
              <button className="btn btn-accent btn-sm" onClick={saveSettings} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One settings group: what it is and why it matters on the left, the fields
 * on the right. The page used to be one column of identical cards labelled in
 * 11px capitals, so nothing told a merchant which part mattered or what each
 * one changed.
 */
function SettingsSection({ title, description, note, children }) {
  return (
    <section className="rt-settings-row">
      <div className="rt-settings-intro">
        <h2 className="t-h3" style={{ margin: 0 }}>{title}</h2>
        {description && <p className="t-small muted" style={{ margin: "6px 0 0" }}>{description}</p>}
        {note && <p className="t-small" style={{ margin: "8px 0 0", color: "var(--ink-3)" }}>{note}</p>}
      </div>
      <div className="rt-form-section">{children}</div>
    </section>
  );
}

/**
 * DNS records with per-value copy buttons.
 *
 * DKIM values are 200+ characters of base64. Hand-transcribing them is the
 * single most error-prone step in domain verification, and a one-character slip
 * fails silently — verification just never completes.
 */
function DnsRecordsTable({ records }) {
  const [copied, setCopied] = useState(null);

  const copy = async (value, key) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  };

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
            <th style={{ padding: "6px 8px" }} />
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--hair-1)" }}>
              <td style={{ padding: "6px 8px" }}>{r.type}</td>
              <td style={{ padding: "6px 8px", wordBreak: "break-all", fontFamily: "monospace" }}>{r.name}</td>
              <td style={{ padding: "6px 8px", wordBreak: "break-all", fontFamily: "monospace" }}>{r.value}</td>
              <td style={{ padding: "6px 8px" }}>{r.priority ?? "—"}</td>
              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => copy(r.value, i)}
                >
                  {copied === i ? "Copied" : "Copy"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
