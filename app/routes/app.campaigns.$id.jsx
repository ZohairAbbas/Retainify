/**
 * Campaign editor — audience, content, schedule, send.
 *
 * Three decisions on one screen, in the order you make them. The email itself
 * opens the same full-page visual editor flows use, so there is one place to
 * learn and one renderer to trust.
 */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import prisma from "../db.server.js";
import Icons from "../components/ui/Icons.jsx";
import { ConfirmDialog, Toast } from "../components/ui/Dialog.jsx";
import EmailEditor from "../components/EmailEditor.jsx";
import { listSegmentChoices } from "../lib/segments/segments.server.js";
import { previewAudienceCount, dispatchBroadcast } from "../lib/journey/broadcast.server.js";
import { sendTestEmail } from "../lib/email/test-send.server.js";
import { resolveFrom, resolveProvider } from "../lib/email/index.server.js";

function safeJson(s, fb) {
  try { return JSON.parse(s); } catch { return fb; }
}

export const loader = async ({ request, params }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;

  const campaign = await prisma.journey.findFirst({
    where: { id: params.id, shop, trigger: "broadcast" },
    include: { steps: { where: { isArchived: false }, orderBy: { stepNumber: "asc" }, take: 1 } },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });

  const [segmentChoices, settings, audienceCount] = await Promise.all([
    listSegmentChoices(shop),
    prisma.shopSettings.findUnique({ where: { shop } }),
    previewAudienceCount(shop, campaign.triggerSegmentKey).catch(() => 0),
  ]);

  const provider = resolveProvider(settings);
  const { from } = resolveFrom({ settings, provider });
  const step = campaign.steps[0] || null;

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      segmentKey: campaign.triggerSegmentKey || "",
      scheduledFor: campaign.scheduledFor,
      dispatchedAt: campaign.dispatchedAt,
      recipientCount: campaign.recipientCount,
    },
    step: step && {
      id: step.id,
      subject: step.subject,
      previewText: step.previewText,
      emailName: step.emailName,
      emailMode: step.emailMode || "blocks",
      emailHtml: step.emailHtml || "",
      emailBlocks: safeJson(step.emailBlocks, []),
      emailBrand: safeJson(step.emailBrand, {}),
    },
    segmentChoices,
    audienceCount,
    senderName: settings?.senderName || "",
    sendingFrom: from.match(/<([^>]+)>/)?.[1] || from,
    testEmailDefault: ctx.user?.email || ctx.session?.email || settings?.replyTo || "",
  };
};

export const action = async ({ request, params }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  const campaign = await prisma.journey.findFirst({
    where: { id: params.id, shop, trigger: "broadcast" },
    include: { steps: { where: { isArchived: false }, take: 1 } },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };

  // Once dispatched, content and audience are history — editing them would make
  // the report describe something that was never sent.
  const locked = !!campaign.dispatchedAt;

  if (intent === "save") {
    if (locked) return { ok: false, error: "This campaign has already been sent." };

    const name = String(fd.get("name") || campaign.name);
    const rawSegment = fd.get("segmentKey");
    const segmentKey = rawSegment === null ? undefined : (String(rawSegment) || null);

    await prisma.journey.update({
      where: { id: campaign.id },
      data: { name, ...(segmentKey !== undefined ? { triggerSegmentKey: segmentKey } : {}) },
    });

    if (campaign.steps[0] && fd.get("subject") !== null) {
      await prisma.journeyStep.update({
        where: { id: campaign.steps[0].id },
        data: {
          subject: String(fd.get("subject") || ""),
          previewText: String(fd.get("previewText") || ""),
          emailName: name,
          ...(fd.get("emailBlocks") !== null ? {
            emailMode: String(fd.get("emailMode") || "blocks"),
            emailHtml: String(fd.get("emailHtml") || ""),
            emailBlocks: String(fd.get("emailBlocks") || "[]"),
            emailBrand: String(fd.get("emailBrand") || "{}"),
          } : {}),
        },
      });
    }
    const count = await previewAudienceCount(shop, segmentKey ?? campaign.triggerSegmentKey).catch(() => 0);
    return { ok: true, saved: true, audienceCount: count };
  }

  if (intent === "send-test-email") {
    let blocks = [];
    let brand = {};
    try { blocks = JSON.parse(String(fd.get("emailBlocks") || "[]")); } catch { blocks = []; }
    try { brand = JSON.parse(String(fd.get("emailBrand") || "{}")); } catch { brand = {}; }
    const result = await sendTestEmail({
      shop,
      to: String(fd.get("to") || ""),
      subject: String(fd.get("subject") || ""),
      emailMode: String(fd.get("emailMode") || "blocks"),
      emailHtml: String(fd.get("emailHtml") || ""),
      emailBlocks: blocks,
      emailBrand: brand,
    });
    return { intent: "send-test-email", ...result };
  }

  if (intent === "schedule") {
    if (locked) return { ok: false, error: "This campaign has already been sent." };

    const step = campaign.steps[0];
    if (!step || !String(step.subject || "").trim()) {
      return { ok: false, error: "Add a subject line before sending." };
    }

    const count = await previewAudienceCount(shop, campaign.triggerSegmentKey).catch(() => 0);
    if (count === 0) {
      return { ok: false, error: "This audience is empty — nobody would receive it." };
    }

    const whenRaw = String(fd.get("scheduledFor") || "");
    let scheduledFor = null;
    if (whenRaw) {
      const d = new Date(whenRaw);
      if (Number.isNaN(d.getTime())) return { ok: false, error: "That date could not be read." };
      // A past time would dispatch on the very next tick, which is almost never
      // what someone picking a date meant.
      if (d.getTime() < Date.now() - 60_000) {
        return { ok: false, error: "That time is in the past." };
      }
      scheduledFor = d;
    }

    await prisma.journey.update({
      where: { id: campaign.id },
      data: { status: "published", isActive: true, publishedAt: new Date(), scheduledFor },
    });

    // Sending now means dispatching inline rather than waiting up to a minute
    // for the worker — the merchant is watching the screen.
    if (!scheduledFor) {
      const result = await dispatchBroadcast(campaign.id);
      return result.ok
        ? { ok: true, sentNow: true, enrolled: result.enrolled }
        : { ok: false, error: result.reason || "Could not start the send." };
    }
    return { ok: true, scheduled: true, scheduledFor };
  }

  return { ok: false };
};

export default function CampaignEditor() {
  const {
    campaign, step, segmentChoices, audienceCount,
    senderName, sendingFrom, testEmailDefault,
  } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();

  const [name, setName] = useState(campaign.name);
  const [segmentKey, setSegmentKey] = useState(campaign.segmentKey);
  const [subject, setSubject] = useState(step?.subject || "");
  const [previewText, setPreviewText] = useState(step?.previewText || "");
  const [node, setNode] = useState(step);
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState("later-none");
  const [scheduledAt, setScheduledAt] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [toast, setToast] = useState(null);

  const sent = !!campaign.dispatchedAt;
  const busy = fetcher.state !== "idle";
  const count = fetcher.data?.audienceCount ?? audienceCount;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const d = fetcher.data;
    if (d.ok === false && d.error) setToast(d.error);
    else if (d.sentNow) setToast(`Sending to ${(d.enrolled || 0).toLocaleString()} contacts now.`);
    else if (d.scheduled) setToast("Campaign scheduled.");
    else if (d.saved) setToast("Saved.");
  }, [fetcher.state, fetcher.data]);

  const save = (extra = {}) => {
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("name", name);
    fd.set("segmentKey", segmentKey);
    fd.set("subject", subject);
    fd.set("previewText", previewText);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    fetcher.submit(fd, { method: "post" });
  };

  // The email editor is a full-page takeover, same as in the flow builder.
  if (editing && node) {
    return (
      <EmailEditor
        flow={{ name, trigger: "broadcast" }}
        node={{ ...node, subject, previewText }}
        testEmailDefault={testEmailDefault}
        senderName={senderName}
        sendingFrom={sendingFrom}
        onBack={() => setEditing(false)}
        onSave={(updated) => {
          setNode((n) => ({ ...n, ...updated }));
          setSubject(updated.subject || "");
          setPreviewText(updated.previewText || "");
          save({
            subject: updated.subject || "",
            previewText: updated.previewText || "",
            emailMode: updated.emailMode || "blocks",
            emailHtml: updated.emailHtml || "",
            emailBlocks: JSON.stringify(updated.emailBlocks || []),
            emailBrand: JSON.stringify(updated.emailBrand || {}),
          });
          setEditing(false);
        }}
      />
    );
  }

  const audienceLabel = segmentKey
    ? segmentChoices.find((s) => s.key === segmentKey)?.name || "Selected segment"
    : "Everyone subscribed";

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginBottom: 10 }}
            onClick={() => navigate(`/app/campaigns${location.search}`)}
          >
            <Icons.ArrowBack size={14} /> All campaigns
          </button>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify · Campaign</div>
          {sent ? (
            <h1 className="t-display-2" style={{ margin: 0 }}>{name}</h1>
          ) : (
            <input
              className="rt-bt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => save()}
              style={{ fontSize: 28, fontWeight: 600 }}
              aria-label="Campaign name"
            />
          )}
        </div>
        <div className="rt-page-actions">
          {sent ? (
            <button
              className="btn btn-secondary"
              onClick={() => navigate(`/app/flows/${campaign.id}/analytics${location.search}`)}
            >
              <Icons.Chart size={14} /> View report
            </button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={() => save()} disabled={busy}>
                {fetcher.data?.saved && !busy ? "Saved" : "Save draft"}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setConfirm(true)}
                disabled={busy || !subject.trim() || count === 0}
              >
                <Icons.Send size={13} /> {when === "later" ? "Schedule" : "Send now"}
              </button>
            </>
          )}
        </div>
      </header>

      {sent && (
        <div className="card card-pad" style={{ marginBottom: 24 }}>
          <div className="t-h3" style={{ marginBottom: 4 }}>
            Sent to {campaign.recipientCount.toLocaleString()} contacts
          </div>
          <div className="t-small muted">
            Dispatched {new Date(campaign.dispatchedAt).toLocaleString()}. Content and
            audience are locked so the report keeps describing what actually went out.
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* 1. Audience */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 4 }}>Audience</div>
            <div className="t-small muted" style={{ marginBottom: 14 }}>
              Resolved when the campaign sends, not now — so a segment that grows
              between here and then reaches everyone in it.
            </div>
            <select
              className="select"
              value={segmentKey}
              disabled={sent}
              onChange={(e) => { setSegmentKey(e.target.value); save({ segmentKey: e.target.value }); }}
            >
              <option value="">Everyone subscribed</option>
              {segmentChoices.map((s) => (
                <option key={s.key} value={s.key}>{s.name}</option>
              ))}
            </select>
            <div className="field-help" style={{ marginTop: 8 }}>
              {count === 0
                ? "Nobody matches this audience right now."
                : `${count.toLocaleString()} ${count === 1 ? "contact" : "contacts"} would receive this. Unsubscribed and bounced addresses are always excluded.`}
            </div>
          </section>

          {/* 2. Content */}
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 14 }}>Content</div>
            <label className="field-label" htmlFor="rt-c-subject">Subject</label>
            <input
              id="rt-c-subject"
              className="input"
              value={subject}
              disabled={sent}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => save()}
              placeholder="What lands in the inbox"
            />
            <div className="field-help">
              {subject.length} characters
              {subject.length > 50 ? " — long subjects get truncated in most inboxes" : " · around 50 reads best"}
            </div>

            <label className="field-label" style={{ marginTop: 16 }} htmlFor="rt-c-preview">
              Preview text
            </label>
            <input
              id="rt-c-preview"
              className="input"
              value={previewText}
              disabled={sent}
              onChange={(e) => setPreviewText(e.target.value)}
              onBlur={() => save()}
              placeholder="The line shown after the subject"
            />

            <button
              className="btn btn-secondary"
              style={{ width: "100%", justifyContent: "center", marginTop: 18 }}
              onClick={() => setEditing(true)}
            >
              <Icons.Tab size={14} /> {sent ? "View the email" : "Design the email"}
            </button>
          </section>

          {/* 3. Timing */}
          {!sent && (
            <section className="rt-form-section">
              <div className="t-micro muted" style={{ marginBottom: 14 }}>When to send</div>
              <div className="rt-radios">
                <label className={`rt-radio${when !== "later" ? " rt-on" : ""}`} style={{ cursor: "pointer" }}>
                  <input type="radio" name="when" checked={when !== "later"} onChange={() => setWhen("now")} style={{ display: "none" }} />
                  <span className="rt-radio-dot"><span /></span>
                  <span>
                    <span className="rt-radio-label">Send now</span>
                    <span className="rt-radio-sub">Starts immediately. Quiet hours still apply.</span>
                  </span>
                </label>
                <label className={`rt-radio${when === "later" ? " rt-on" : ""}`} style={{ cursor: "pointer" }}>
                  <input type="radio" name="when" checked={when === "later"} onChange={() => setWhen("later")} style={{ display: "none" }} />
                  <span className="rt-radio-dot"><span /></span>
                  <span>
                    <span className="rt-radio-label">Schedule</span>
                    <span className="rt-radio-sub">Pick a date and time.</span>
                  </span>
                </label>
              </div>
              {when === "later" && (
                <input
                  className="input"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  style={{ marginTop: 12 }}
                />
              )}
            </section>
          )}
        </div>

        {/* Summary rail */}
        <div style={{ position: "sticky", top: 16 }}>
          <section className="rt-form-section">
            <div className="t-micro muted" style={{ marginBottom: 14 }}>Summary</div>
            <div className="rt-rail-row">
              <div className="rt-rail-row-left"><Icons.Users size={14} /><span>Audience</span></div>
              <div className="rt-rail-row-right"><span className="rt-rail-row-val">{audienceLabel}</span></div>
            </div>
            <div className="rt-rail-row">
              <div className="rt-rail-row-left"><Icons.Send size={14} /><span>Recipients</span></div>
              <div className="rt-rail-row-right"><span className="rt-rail-row-val">{count.toLocaleString()}</span></div>
            </div>
            <div className="rt-rail-row">
              <div className="rt-rail-row-left"><Icons.Mail size={14} /><span>From</span></div>
              <div className="rt-rail-row-right"><span className="rt-rail-row-val">{sendingFrom}</span></div>
            </div>
            <div className="field-help" style={{ marginTop: 14 }}>
              Every recipient gets a one-click unsubscribe link, and anyone already
              unsubscribed is skipped automatically.
            </div>
          </section>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          title={when === "later" ? "Schedule this campaign?" : `Send to ${count.toLocaleString()} contacts?`}
          body={
            when === "later"
              ? `It will send at the time you picked, to whoever matches "${audienceLabel}" at that moment.`
              : `This goes out now and can't be recalled. Sending to everyone matching "${audienceLabel}".`
          }
          confirmLabel={when === "later" ? "Schedule" : "Send now"}
          loading={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            const fd = new FormData();
            fd.set("intent", "schedule");
            if (when === "later" && scheduledAt) fd.set("scheduledFor", scheduledAt);
            fetcher.submit(fd, { method: "post" });
            setConfirm(false);
          }}
        />
      )}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
