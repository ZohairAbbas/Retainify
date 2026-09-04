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
import {
  previewAudienceCount,
  dispatchBroadcast,
  countUnreachableWhatsappSubscribers,
} from "../lib/journey/broadcast.server.js";
import { sendWhatsapp } from "../lib/whatsapp/index.server.js";
import { toE164 } from "../lib/contacts/contacts.server.js";
import { sendTestEmail } from "../lib/email/test-send.server.js";
import { resolveFrom, resolveProvider } from "../lib/email/index.server.js";

function safeJson(s, fb) {
  try { return JSON.parse(s); } catch { return fb; }
}

/** Does this Meta component spec declare an IMAGE header? */
function hasImageHeader(components) {
  if (!Array.isArray(components)) return false;
  return components.some((c) => c?.type === "HEADER" && c?.format === "IMAGE");
}

/**
 * The one sentence explaining why WhatsApp cannot send yet, or "".
 *
 * Ordered the way the setup actually goes, so a merchant is told the next thing
 * to do rather than the last thing that is wrong.
 */
function whatsappBlocker(channel, account, settings) {
  if (channel !== "whatsapp") return "";
  if (!account || account.status !== "connected") {
    return "Connect a WhatsApp Business account before sending this campaign.";
  }
  if (!account.registeredAt) {
    return "Register your WhatsApp number for the Cloud API before sending. Nothing can send until it is registered.";
  }
  if (settings?.whatsappEnabled !== true) {
    return "The WhatsApp channel is switched off. Turn it on in WhatsApp settings.";
  }
  return "";
}

export const loader = async ({ request, params }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;

  const campaign = await prisma.journey.findFirst({
    where: { id: params.id, shop, trigger: "broadcast" },
    include: { steps: { where: { isArchived: false }, orderBy: { stepNumber: "asc" }, take: 1 } },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });

  const step = campaign.steps[0] || null;
  const channel = step?.nodeType === "whatsapp" ? "whatsapp" : "email";

  const [segmentChoices, settings, audienceCount, waTemplates, waAccount, unreachable] =
    await Promise.all([
      listSegmentChoices(shop),
      prisma.shopSettings.findUnique({ where: { shop } }),
      previewAudienceCount(shop, campaign.triggerSegmentKey, channel).catch(() => 0),
      channel === "whatsapp"
        ? prisma.whatsappTemplate.findMany({
            where: { shop, status: "APPROVED" },
            orderBy: { name: "asc" },
            select: { id: true, name: true, language: true, bodyText: true, components: true },
          })
        : [],
      channel === "whatsapp"
        ? prisma.whatsappAccount.findUnique({ where: { shop } })
        : null,
      channel === "whatsapp" ? countUnreachableWhatsappSubscribers(shop).catch(() => 0) : 0,
    ]);

  const provider = resolveProvider(settings);
  const { from } = resolveFrom({ settings, provider });

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
    channel,
    // What stops a WhatsApp campaign sending, answered once here rather than
    // inferred from three separate flags in the component.
    whatsappReady:
      channel !== "whatsapp"
        ? true
        : !!waAccount &&
          waAccount.status === "connected" &&
          !!waAccount.registeredAt &&
          settings?.whatsappEnabled === true,
    whatsappBlocker: whatsappBlocker(channel, waAccount, settings),
    waTemplates: waTemplates.map(({ components, ...t }) => ({
      ...t,
      imageHeader: hasImageHeader(components),
    })),
    unreachableSubscribers: unreachable,
    step: step && {
      id: step.id,
      subject: step.subject,
      previewText: step.previewText,
      emailName: step.emailName,
      emailMode: step.emailMode || "blocks",
      emailHtml: step.emailHtml || "",
      emailBlocks: safeJson(step.emailBlocks, []),
      emailBrand: safeJson(step.emailBrand, {}),
      waTemplateName: step.waTemplateName || "",
      waLanguage: step.waLanguage || "",
      waVariables: step.waVariables || {},
      waMediaUrl: step.waMediaUrl || "",
    },
    segmentChoices,
    audienceCount,
    senderName: settings?.senderName || "",
    sendingFrom: from.match(/<([^>]+)>/)?.[1] || from,
    testEmailDefault: ctx.user?.email || ctx.session?.email || settings?.replyTo || "",
  };
};

/**
 * Why this WhatsApp campaign cannot be sent, or "".
 *
 * Deliberately the same four checks flow publishing runs
 * (journey/flow-validation.server.js): the connection, the template still being
 * approved in the step's language, a value for every {{n}}, and an image when
 * the template declares an image header. Campaigns do not go through
 * validateFlowForPublish — that walks a graph, and a broadcast is one step —
 * so the rules are applied here rather than shared, and the two must not drift.
 * Each of these otherwise surfaces as an opaque provider error after the whole
 * audience is already enrolled, which for a broadcast is the worst possible
 * moment to discover it.
 */
async function whatsappStepProblem(shop, step) {
  const name = String(step.waTemplateName || "").trim();
  if (!name) return "Pick an approved WhatsApp template before sending.";

  const [account, settings] = await Promise.all([
    prisma.whatsappAccount.findUnique({ where: { shop } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);
  const blocker = whatsappBlocker("whatsapp", account, settings);
  if (blocker) return blocker;

  const language = String(step.waLanguage || "").trim() || "en_US";
  const template = await prisma.whatsappTemplate.findUnique({
    where: { shop_name_language: { shop, name, language } },
    select: { status: true, bodyText: true, components: true },
  });
  if (!template || template.status !== "APPROVED") {
    return `The template "${name}" (${language}) is no longer approved. Re-sync your templates and pick another.`;
  }

  const vars = step.waVariables && typeof step.waVariables === "object" ? step.waVariables : {};
  const missing = [
    ...new Set([...String(template.bodyText || "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])),
  ]
    .sort((a, b) => Number(a) - Number(b))
    .filter((n) => !String(vars[n] ?? "").trim());
  if (missing.length) {
    return `This template needs a value for ${missing.map((n) => `{{${n}}}`).join(", ")}.`;
  }

  if (hasImageHeader(template.components) && !String(step.waMediaUrl || "").trim()) {
    return "This template has an image header, so the campaign needs an image URL.";
  }
  return "";
}

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
  const channel = campaign.steps[0]?.nodeType === "whatsapp" ? "whatsapp" : "email";

  if (intent === "save") {
    if (locked) return { ok: false, error: "This campaign has already been sent." };

    const name = String(fd.get("name") || campaign.name);
    const rawSegment = fd.get("segmentKey");
    const segmentKey = rawSegment === null ? undefined : (String(rawSegment) || null);

    await prisma.journey.update({
      where: { id: campaign.id },
      data: { name, ...(segmentKey !== undefined ? { triggerSegmentKey: segmentKey } : {}) },
    });

    if (campaign.steps[0] && channel === "whatsapp" && fd.get("waTemplateName") !== null) {
      let waVariables = {};
      try { waVariables = JSON.parse(String(fd.get("waVariables") || "{}")); } catch { waVariables = {}; }
      await prisma.journeyStep.update({
        where: { id: campaign.steps[0].id },
        data: {
          waTemplateName: String(fd.get("waTemplateName") || ""),
          waLanguage: String(fd.get("waLanguage") || ""),
          waVariables,
          waMediaUrl: String(fd.get("waMediaUrl") || ""),
        },
      });
    }

    if (campaign.steps[0] && channel === "email" && fd.get("subject") !== null) {
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
    const count = await previewAudienceCount(shop, segmentKey ?? campaign.triggerSegmentKey, channel).catch(() => 0);
    return { ok: true, saved: true, audienceCount: count };
  }

  // Switching channel on a DRAFT. Deliberately destructive and deliberately
  // confirmed in the UI: the two editors share no fields, so whichever content
  // exists is discarded rather than left as invisible state that would reappear
  // if the merchant switched back and then sent.
  if (intent === "switch-channel") {
    if (locked) return { ok: false, error: "This campaign has already been sent." };
    if (campaign.status !== "draft") {
      return { ok: false, error: "Unschedule the campaign before changing its channel." };
    }
    const next = String(fd.get("channel") || "") === "whatsapp" ? "whatsapp" : "email";
    if (next === channel) return { ok: true };
    const step = campaign.steps[0];
    if (!step) return { ok: false, error: "This campaign has no step to convert." };

    await prisma.journeyStep.update({
      where: { id: step.id },
      data:
        next === "whatsapp"
          ? {
              nodeType: "whatsapp",
              subject: "", previewText: "", emailHtml: "", emailBlocks: null, emailBrand: null,
              waTemplateName: "", waLanguage: "", waVariables: {}, waMediaUrl: "",
            }
          : {
              nodeType: "email",
              waTemplateName: "", waLanguage: "", waVariables: {}, waMediaUrl: "",
              subject: "", emailName: campaign.name,
            },
    });
    return { ok: true, switched: next };
  }

  if (intent === "send-test-whatsapp") {
    const check = toE164(String(fd.get("to") || ""));
    if (!check.ok) return { intent: "send-test-whatsapp", ok: false, error: check.error };

    const templateName = String(fd.get("waTemplateName") || "");
    if (!templateName) return { intent: "send-test-whatsapp", ok: false, error: "Pick an approved template first." };

    const tpl = await prisma.whatsappTemplate.findFirst({
      where: { shop, name: templateName, status: "APPROVED" },
    });
    // Fill every {{n}} the body declares. Meta rejects a template message whose
    // parameter count does not match the approved body, with an error that
    // names neither the template nor the variable.
    let waVariables = {};
    try { waVariables = JSON.parse(String(fd.get("waVariables") || "{}")); } catch { waVariables = {}; }
    const nums = [
      ...new Set([...String(tpl?.bodyText || "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])),
    ].sort((a, b) => Number(a) - Number(b));
    const components = nums.length
      ? [{
          type: "body",
          parameters: nums.map((n) => ({
            type: "text",
            // The merchant's own mapping is a merge tag, not a value — a test
            // send has no contact to resolve it against, so it stands in for
            // itself and the shape of the message is what gets checked.
            text: String(waVariables[n] || `sample ${n}`),
          })),
        }]
      : [];
    const mediaUrl = String(fd.get("waMediaUrl") || "").trim();
    if (mediaUrl) {
      components.unshift({ type: "header", parameters: [{ type: "image", image: { link: mediaUrl } }] });
    }

    const result = await sendWhatsapp(
      { to: check.phone, templateName, language: tpl?.language || "en_US", components },
      { shop },
    );
    return { intent: "send-test-whatsapp", ...result };
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
    if (!step) return { ok: false, error: "This campaign has no content." };

    const problem =
      channel === "whatsapp"
        ? await whatsappStepProblem(shop, step)
        : String(step.subject || "").trim()
          ? ""
          : "Add a subject line before sending.";
    if (problem) return { ok: false, error: problem };

    const count = await previewAudienceCount(shop, campaign.triggerSegmentKey, channel).catch(() => 0);
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
    channel, waTemplates = [], whatsappBlocker: waBlocker, unreachableSubscribers = 0,
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
  const [switchTo, setSwitchTo] = useState(null);

  const isWhatsapp = channel === "whatsapp";
  const [waTemplateName, setWaTemplateName] = useState(step?.waTemplateName || "");
  const [waLanguage, setWaLanguage] = useState(step?.waLanguage || "");
  const [waVariables, setWaVariables] = useState(step?.waVariables || {});
  const [waMediaUrl, setWaMediaUrl] = useState(step?.waMediaUrl || "");
  const [testPhone, setTestPhone] = useState("");

  const selectedTemplate = waTemplates.find(
    (t) => t.name === waTemplateName && (!waLanguage || t.language === waLanguage),
  ) || null;
  const templateVars = selectedTemplate
    ? [...new Set([...(selectedTemplate.bodyText || "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1]))]
        .sort((a, b) => Number(a) - Number(b))
    : [];

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
    else if (d.switched) setToast(`Switched to ${d.switched === "whatsapp" ? "WhatsApp" : "email"}.`);
    else if (d.intent === "send-test-whatsapp" && d.ok) setToast("Test sent.");
  }, [fetcher.state, fetcher.data]);

  const save = (extra = {}) => {
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("name", name);
    fd.set("segmentKey", segmentKey);
    if (isWhatsapp) {
      fd.set("waTemplateName", waTemplateName);
      fd.set("waLanguage", waLanguage);
      fd.set("waVariables", JSON.stringify(waVariables));
      fd.set("waMediaUrl", waMediaUrl);
    } else {
      fd.set("subject", subject);
      fd.set("previewText", previewText);
    }
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    fetcher.submit(fd, { method: "post" });
  };

  /** Picking a template resets the variable mapping — the positions differ. */
  const pickTemplate = (nameValue) => {
    const tpl = waTemplates.find((t) => t.name === nameValue);
    setWaTemplateName(nameValue);
    setWaLanguage(tpl?.language || "");
    setWaVariables({});
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("name", name);
    fd.set("segmentKey", segmentKey);
    fd.set("waTemplateName", nameValue);
    fd.set("waLanguage", tpl?.language || "");
    fd.set("waVariables", "{}");
    fd.set("waMediaUrl", waMediaUrl);
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
    : isWhatsapp ? "Everyone opted in to WhatsApp" : "Everyone subscribed";

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
                ? isWhatsapp
                  ? "Nobody in this audience has opted in to WhatsApp yet."
                  : "Nobody matches this audience right now."
                : `${count.toLocaleString()} ${count === 1 ? "contact" : "contacts"} would receive this. ${
                    isWhatsapp
                      ? "WhatsApp consent is separate from your email list — only contacts reachable on WhatsApp are counted, and opt-outs are always excluded."
                      : "Unsubscribed and bounced addresses are always excluded."
                  }`}
            </div>
            {/* Enrollment is keyed on a contact email, so a WhatsApp opt-in
                with no matching contact record cannot be reached however valid
                its consent is. Zero today; said plainly rather than left as an
                unexplained gap between two numbers. */}
            {isWhatsapp && unreachableSubscribers > 0 && (
              <div className="field-help" style={{ marginTop: 8 }}>
                {unreachableSubscribers.toLocaleString()} WhatsApp{" "}
                {unreachableSubscribers === 1 ? "subscriber has" : "subscribers have"} no email address on
                file and can&rsquo;t be included — campaigns are addressed by contact.
              </div>
            )}
          </section>

          {/* 2. Content */}
          {isWhatsapp ? (
            <section className="rt-form-section">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div className="t-micro muted">Message</div>
                {!sent && campaign.status === "draft" && (
                  <button className="btn" style={{ padding: "2px 10px" }} onClick={() => setSwitchTo("email")}>
                    Switch to email
                  </button>
                )}
              </div>

              {waBlocker && (
                <div className="t-small" style={{ marginBottom: 14, background: "var(--danger-bg)", color: "var(--danger-ink)", padding: "10px 12px", borderRadius: "var(--r-2)" }}>
                  {waBlocker} <a href="/app/whatsapp">Open WhatsApp settings</a>
                </div>
              )}

              {waTemplates.length === 0 ? (
                <div className="field-help">
                  No approved templates yet. <a href="/app/whatsapp">Connect WhatsApp and sync your templates</a> to
                  pick one here. Meta reviews every template before it can be sent.
                </div>
              ) : (
                <>
                  <label className="field-label" htmlFor="rt-c-template">Template</label>
                  <select
                    id="rt-c-template"
                    className="input"
                    value={waTemplateName}
                    disabled={sent}
                    onChange={(e) => pickTemplate(e.target.value)}
                  >
                    <option value="">Select an approved template…</option>
                    {waTemplates.map((t) => (
                      <option key={t.id} value={t.name}>{t.name} ({t.language})</option>
                    ))}
                  </select>

                  {selectedTemplate && (
                    <>
                      <div
                        className="t-small"
                        style={{ marginTop: 14, padding: "12px 14px", borderRadius: "var(--r-2)", background: "var(--node-whatsapp-bg)", color: "var(--ink-1)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}
                      >
                        {(selectedTemplate.bodyText || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) =>
                          waVariables[n] ? `[${waVariables[n]}]` : m,
                        )}
                      </div>

                      {templateVars.length > 0 && (
                        <div style={{ marginTop: 16 }}>
                          <span className="field-label">Variables</span>
                          <div className="field-help" style={{ marginBottom: 8 }}>
                            A merge tag, or literal text to send as-is. Every variable needs a value —
                            Meta rejects the message otherwise.
                          </div>
                          {templateVars.map((n) => (
                            <div key={n} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                              <span className="t-mono t-small muted" style={{ flex: "0 0 42px" }}>{`{{${n}}}`}</span>
                              <input
                                className="input"
                                value={waVariables[n] || ""}
                                disabled={sent}
                                placeholder="contactName, recoveryUrl, or plain text"
                                onChange={(e) => setWaVariables((v) => ({ ...v, [n]: e.target.value }))}
                                onBlur={() => save()}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {selectedTemplate.imageHeader && (
                        <div style={{ marginTop: 8 }}>
                          <label className="field-label" htmlFor="rt-c-media">Header image URL</label>
                          <input
                            id="rt-c-media"
                            className="input"
                            value={waMediaUrl}
                            disabled={sent}
                            placeholder="https://…"
                            onChange={(e) => setWaMediaUrl(e.target.value)}
                            onBlur={() => save()}
                          />
                          <div className="field-help">This template declares an image header, so one is required.</div>
                        </div>
                      )}

                      {!sent && (
                        <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                          <label className="field-label" htmlFor="rt-c-testphone">Send a test</label>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input
                              id="rt-c-testphone"
                              className="input"
                              value={testPhone}
                              placeholder="+1 555 123 4567"
                              onChange={(e) => setTestPhone(e.target.value)}
                            />
                            <button
                              className="btn"
                              disabled={busy || !testPhone.trim() || !waTemplateName}
                              onClick={() => {
                                const fd = new FormData();
                                fd.set("intent", "send-test-whatsapp");
                                fd.set("to", testPhone);
                                fd.set("waTemplateName", waTemplateName);
                                fd.set("waVariables", JSON.stringify(waVariables));
                                fd.set("waMediaUrl", waMediaUrl);
                                fetcher.submit(fd, { method: "post" });
                              }}
                            >
                              Send test
                            </button>
                          </div>
                          <div className="field-help">
                            Goes to one number, using this template. Variables send as the text you typed.
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </section>
          ) : (
          <section className="rt-form-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div className="t-micro muted">Content</div>
              {!sent && campaign.status === "draft" && (
                <button className="btn" style={{ padding: "2px 10px" }} onClick={() => setSwitchTo("whatsapp")}>
                  Switch to WhatsApp
                </button>
              )}
            </div>
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
          )}

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
            (when === "later"
              ? `It will send at the time you picked, to whoever matches "${audienceLabel}" at that moment.`
              : `This goes out now and can't be recalled. Sending to everyone matching "${audienceLabel}".`) +
            (isWhatsapp
              ? " Meta charges per conversation, so this campaign has a direct cost."
              : "")
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
      {switchTo && (
        <ConfirmDialog
          title={switchTo === "whatsapp" ? "Switch this campaign to WhatsApp?" : "Switch this campaign to email?"}
          body={
            switchTo === "whatsapp"
              ? "The subject line and email design are discarded, and you pick an approved WhatsApp template instead. The audience changes too — WhatsApp reaches the contacts who opted in to WhatsApp, which is a different list from your email subscribers."
              : "The template and its variables are discarded, and you write a subject line and design an email instead. The audience changes to your email subscribers."
          }
          confirmLabel="Switch"
          destructive
          loading={busy}
          onCancel={() => setSwitchTo(null)}
          onConfirm={() => {
            fetcher.submit({ intent: "switch-channel", channel: switchTo }, { method: "post" });
            setSwitchTo(null);
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
