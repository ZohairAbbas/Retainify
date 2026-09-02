import { useState, useMemo, useEffect, Fragment } from "react";
import { useLoaderData, useFetcher, useNavigate, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import prisma from "../db.server.js";
import { saveDraft, publishJourney, pauseJourney, unpublishToDraft, archiveJourney } from "../lib/journey/journey-lifecycle.server.js";
import { validateFlowForPublish } from "../lib/journey/flow-validation.server.js";
import { sendTestEmail } from "../lib/email/test-send.server.js";
import { resolveFrom, resolveProvider } from "../lib/email/index.server.js";
import { getJourneyStepStats } from "../lib/journey/journey-analytics.server.js";
import Icons from "../components/ui/Icons.jsx";
import { TRIGGER_CONFIG, STATUS_PILL } from "../lib/triggerConfig.js";
import { listSegmentChoices } from "../lib/segments/segments.server.js";
import { flowFilterFieldsFor, OPERATORS } from "../lib/segments/fields.server.js";
import { listTagsForShop } from "../lib/contacts/tags.server.js";
import { evaluateSegment, validateFilterTree } from "../lib/segments/evaluator.server.js";
import { isSystemSegmentId } from "../lib/segments/systemSegments.server.js";
import { GroupBlock } from "../components/segments/FilterTree.jsx";
import { emptyGroup } from "../components/segments/constants.js";
import TriggerPicker from "../components/flows/TriggerPicker.jsx";
import { ConfirmDialog } from "../components/ui/Dialog.jsx";
import EmailEditor, { RenderedBlockPreview } from "../components/EmailEditor.jsx";

const EXIT_CRITERIA_OPTIONS = [
  { value: "order_placed", label: "Contact places an order" },
  { value: "cart_recovered", label: "Cart is recovered" },
  { value: "unsubscribed", label: "Contact unsubscribes" },
];

// Extra exit criteria only shown when the flow is segment-triggered.
const SEGMENT_EXIT_CRITERIA = [
  { value: "leaves_trigger_segment", label: "Contact leaves the trigger segment" },
];

export const loader = async ({ request, params }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const { id } = params;

  const [journey, settings, whatsappTemplates] = await Promise.all([
    prisma.journey.findFirst({
      where: { id, shop },
      include: { steps: { where: { isArchived: false }, orderBy: { positionY: "asc" } } },
    }),
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.whatsappTemplate.findMany({
      where: { shop, status: "APPROVED" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, language: true, bodyText: true },
    }),
  ]);

  if (!journey) {
    throw new Response("Not found", { status: 404 });
  }

  const canvasNodes = expandCanvasNodes(journey.steps);

  // Segment trigger metadata: choices for the dropdown, plus a current-match
  // count when the flow already points at a segment. The count is the same
  // number the segment detail page shows.
  const [stats, segmentChoices] = await Promise.all([
    getJourneyStepStats(journey.id, 30),
    listSegmentChoices(shop),
  ]);

  let triggerSegmentCount = null;
  if (journey.trigger === "segment_entered" && journey.triggerSegmentKey) {
    const key = journey.triggerSegmentKey;
    if (isSystemSegmentId(key)) {
      // listSegmentChoices already evaluated every system segment live — reuse
      // that count instead of paying for a second full evaluation.
      triggerSegmentCount = segmentChoices.find((c) => c.key === key)?.contactCount ?? null;
    } else {
      const segment = await prisma.segment.findFirst({
        where: { id: key, shop, deletedAt: null },
      });
      if (segment) {
        try {
          const { count } = await evaluateSegment(shop, segment, { sampleSize: 0 });
          triggerSegmentCount = count;
        } catch (_e) {
          triggerSegmentCount = null;
        }
      }
    }
  }

  return {
    journey: {
      ...journey,
      exitCriteria: safeJson(journey.exitCriteria, []),
    },
    canvasNodes,
    settings: settings ?? {},
    // Entry-filter builder inputs. Fields are the supported-only set — see
    // flowFilterFieldsFor for why gated fields are hidden here but shown in
    // the segment builder.
    filterFields: flowFilterFieldsFor(ctx.isShopify),
    filterOperators: OPERATORS,
    filterTags: await listTagsForShop(shop),
    // Prefills the "Send test" recipient. The logged-in staff address is the
    // right default; reply-to is the next best guess for an inbox the merchant
    // actually reads.
    testEmailDefault: ctx.user?.email || ctx.session?.email || settings?.replyTo || "",
    // The address this shop actually sends from, resolved by the same seam the
    // worker uses, so the builder shows the truth rather than a placeholder.
    sendingFromAddress: (() => {
      const provider = resolveProvider(settings);
      const { from } = resolveFrom({ settings, provider });
      return from.match(/<([^>]+)>/)?.[1] || from;
    })(),
    stats,
    // Gates the commerce triggers in the picker and the commerce channels
    // below — neither can fire without a connected store.
    isShopify: ctx.isShopify,
    segmentChoices,
    triggerSegmentCount,
    whatsappTemplates,
  };
};

function safeJson(s, fb) {
  try { return JSON.parse(s); } catch { return fb; }
}

/**
 * A filter tree with no rules imposes no restriction, so it is stored as null
 * rather than an empty group. That keeps "has filters" a simple null check
 * everywhere downstream instead of a structural inspection, and means clearing
 * the last rule leaves the flow exactly as it was before any were added.
 *
 * Shared by the server (before writing) and the client (dirty comparison, so
 * that adding a rule and removing it again isn't left looking unsaved).
 */
function prunedFilters(tree) {
  if (!tree || tree.type !== "group") return null;
  if (!Array.isArray(tree.children) || tree.children.length === 0) return null;
  return tree;
}

/**
 * Prepare an entry-filter tree for storage, rejecting one we could not later
 * evaluate.
 *
 * The builder can only produce valid fields, so this guards against a
 * hand-crafted POST rather than ordinary use. It matters because of the
 * fail-closed rule in entry-filters.server.js: a tree naming an unknown field
 * throws at enrollment, and a throw there stops the flow sending to anyone.
 * A rejected save is visible and recoverable; a flow that silently stopped
 * sending is neither.
 */
function normalizeEntryFilters(tree) {
  const pruned = prunedFilters(tree);
  if (!pruned) return null;
  validateFilterTree(pruned);
  return pruned;
}

function expandCanvasNodes(steps) {
  const nodes = [{ kind: "trigger", id: "trigger" }];
  for (const s of steps) {
    // stepKey rides along on every node and goes straight back to saveDraft
    // untouched. It is the only thing tying a step to its own send history
    // across a save — `id` is regenerated every time — so a node that loses it
    // comes back as a brand new step with an empty report.
    if (s.nodeType === "delay") {
      nodes.push({ kind: "delay", id: s.id, stepKey: s.stepKey, hours: s.delayHours });
    } else if (s.nodeType === "exit") {
      nodes.push({ kind: "exit", id: s.id, stepKey: s.stepKey });
    } else if (s.nodeType === "push") {
      nodes.push({
        kind: "push",
        id: s.id,
        stepKey: s.stepKey,
        pushTitle: s.pushTitle,
        pushBody: s.pushBody,
        pushIconUrl: s.pushIconUrl,
        pushClickUrl: s.pushClickUrl,
        delayHours: s.delayHours,
        isEnabled: s.isEnabled,
      });
    } else if (s.nodeType === "whatsapp") {
      nodes.push({
        kind: "whatsapp",
        id: s.id,
        stepKey: s.stepKey,
        waTemplateName: s.waTemplateName,
        waLanguage: s.waLanguage,
        waVariables: s.waVariables || {},
        waMediaUrl: s.waMediaUrl,
        delayHours: s.delayHours,
        isEnabled: s.isEnabled,
      });
    } else {
      nodes.push({
        kind: "email",
        id: s.id,
        stepKey: s.stepKey,
        stepNumber: s.stepNumber,
        emailName: s.emailName,
        subject: s.subject,
        previewText: s.previewText,
        templateStyle: s.templateStyle,
        discountPct: s.discountPct,
        isEnabled: s.isEnabled,
        emailMode: s.emailMode || "blocks",
        emailHtml: s.emailHtml || "",
        emailBlocks: safeJson(s.emailBlocks, []),
        emailBrand: safeJson(s.emailBrand, {}),
      });
    }
  }
  if (!nodes.some((n) => n.kind === "exit")) {
    nodes.push({ kind: "exit", id: "exit-pending" });
  }
  return nodes;
}

export const action = async ({ request, params }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const { id } = params;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  const journey = await prisma.journey.findFirst({ where: { id, shop } });
  if (!journey) return { ok: false };

  // save-draft and publish share the same payload shape. Publishing a dirty
  // canvas used to be two separate fetcher submissions 100ms apart, which React
  // Router cancels (both went through the same fetcher) — so on any connection
  // slower than the timeout the save was aborted and the PREVIOUS version went
  // live under a "published" confirmation. One request, one transaction.
  if (intent === "save-draft" || intent === "publish") {
    const isPublish = intent === "publish";

    // A publish can arrive without canvas state (e.g. re-publishing an unchanged
    // flow), in which case there is nothing to save first.
    const hasDraftPayload = fd.get("nodes") !== null;

    if (hasDraftPayload) {
      try {
        await persistDraft({ id, journey, fd });
      } catch (err) {
        // Entry-filter validation is the first thing here that can reject a
        // draft. Surfacing it as a failed save keeps the merchant's canvas
        // intact; letting it throw would drop them on an error boundary and
        // lose the edit.
        console.error("[flows] draft save rejected:", err.message);
        return { ok: false, saveError: "Those flow filters aren't valid. Remove the last one you added and try again." };
      }
    }

    if (!isPublish) return { ok: true, saved: true };

    const validation = await validateFlowForPublish(id);
    if (!validation.ok) {
      // The draft is already saved at this point — the merchant keeps their work
      // and only the go-live step is refused.
      return { ok: false, saved: hasDraftPayload, publishErrors: validation.errors };
    }

    const backfillSegmentMembers = fd.get("backfillSegmentMembers") === "1";
    const result = await publishJourney(id, { backfillSegmentMembers });
    return {
      ok: true,
      saved: hasDraftPayload,
      published: true,
      segmentBaseline: result?.segmentBaseline ?? null,
    };
  }

  // Send a real email through the real render + send pipeline, to an address the
  // merchant chooses. The editor previously had a "Send test" button with no
  // handler at all, which left email — the primary channel — as the only one
  // with no way to preview an actual send.
  if (intent === "send-test-email") {
    let blocks = [];
    let brand = {};
    try { blocks = JSON.parse(String(fd.get("emailBlocks") || "[]")); } catch { blocks = []; }
    try { brand = JSON.parse(String(fd.get("emailBrand") || "{}")); } catch { brand = {}; }

    const result = await sendTestEmail({
      shop,
      to: String(fd.get("to") || ""),
      subject: String(fd.get("subject") || ""),
      // The editor's CURRENT state, not the saved step — a merchant who just
      // edited a headline expects the test to show that headline.
      emailMode: String(fd.get("emailMode") || "blocks"),
      emailHtml: String(fd.get("emailHtml") || ""),
      emailBlocks: blocks,
      emailBrand: brand,
    });
    return { intent: "send-test-email", ...result };
  }

  if (intent === "pause") {
    await pauseJourney(id);
    return { ok: true };
  }

  if (intent === "unpublish") {
    await unpublishToDraft(id);
    return { ok: true, unpublished: true };
  }

  if (intent === "archive") {
    await archiveJourney(id);
    return { ok: true, archived: true };
  }

  return { ok: false };
};

/** Translate the canvas payload into saveDraft()'s step shape and persist it. */
async function persistDraft({ id, journey, fd }) {
    const nodes = JSON.parse(String(fd.get("nodes") || "[]"));
    const name = String(fd.get("name") || journey.name);
    const entryFrequency = String(fd.get("entryFrequency") || journey.entryFrequency);
    const exitCriteria = JSON.parse(String(fd.get("exitCriteria") || "[]"));
    // Absent field leaves filters untouched; an empty tree clears them. The
    // client always sends this, so absence means an older cached bundle.
    const rawFilters = fd.get("entryFilters");
    const entryFilters =
      rawFilters === null ? undefined : normalizeEntryFilters(JSON.parse(String(rawFilters)));
    // Only pass triggerSegmentKey if the client sent one explicitly. Empty
    // string from a cleared dropdown becomes null; absent field leaves it
    // alone (so non-segment flows aren't disturbed).
    const rawSegKey = fd.get("triggerSegmentKey");
    const triggerSegmentKey =
      rawSegKey === null ? undefined : (String(rawSegKey) || null);
    // Same pattern for trigger itself — the new TriggerPicker lets the
    // merchant change a flow's trigger inline.
    const rawTrigger = fd.get("trigger");
    const trigger = rawTrigger === null ? undefined : String(rawTrigger);

    const stepsForSave = nodes
      .filter((n) => n.kind !== "trigger")
      .map((n) => {
        // Sent back exactly as it arrived, or omitted for a node the merchant
        // just added so the database mints one. Never regenerate it here: a
        // step whose key changes is a new step as far as every report is
        // concerned, and its history simply stops being counted.
        const stepKey = n.stepKey ? { stepKey: n.stepKey } : {};
        if (n.kind === "delay") {
          return { ...stepKey, nodeType: "delay", delayHours: Number(n.hours) || 0 };
        }
        if (n.kind === "exit") {
          return { ...stepKey, nodeType: "exit" };
        }
        // Note: push and WhatsApp steps deliberately send no delayHours.
        // Timing for every sendable step is derived from the Wait nodes above
        // it (saveDraft accumulates them), exactly as it is for email. The old
        // per-step "Timing" control in the inspector wrote a value that
        // saveDraft then overwrote, so it accepted input and silently discarded
        // it; the control has been removed rather than given a second, competing
        // timing model.
        if (n.kind === "push") {
          return {
            ...stepKey,
            nodeType: "push",
            isEnabled: n.isEnabled !== false,
            pushTitle: n.pushTitle || "",
            pushBody: n.pushBody || "",
            pushIconUrl: n.pushIconUrl || "",
            pushClickUrl: n.pushClickUrl || "",
          };
        }
        if (n.kind === "whatsapp") {
          return {
            ...stepKey,
            nodeType: "whatsapp",
            isEnabled: n.isEnabled !== false,
            waTemplateName: n.waTemplateName || "",
            waLanguage: n.waLanguage || "",
            waVariables: n.waVariables || {},
            waMediaUrl: n.waMediaUrl || "",
          };
        }
        return {
          ...stepKey,
          nodeType: "email",
          subject: n.subject || "",
          previewText: n.previewText || "",
          emailName: n.emailName || "",
          templateStyle: n.templateStyle || "classic",
          discountPct: Number(n.discountPct) || 0,
          isEnabled: n.isEnabled !== false,
          emailMode: n.emailMode === "html" ? "html" : "blocks",
          emailHtml: n.emailHtml || "",
          emailBlocks: JSON.stringify(n.emailBlocks || []),
          emailBrand: JSON.stringify(n.emailBrand || {}),
        };
      });

    await saveDraft(id, { name, entryFrequency, exitCriteria, entryFilters, steps: stepsForSave, triggerSegmentKey, trigger });
}

export default function FlowBuilder() {
  const { journey, canvasNodes: initialNodes, settings, stats, segmentChoices = [], triggerSegmentCount, whatsappTemplates = [], testEmailDefault = "", sendingFromAddress = "", isShopify = true, filterFields = [], filterOperators = {}, filterTags = [] } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();

  const [nodes, setNodes] = useState(initialNodes);
  const [name, setName] = useState(journey.name);
  const [entryFrequency, setEntryFrequency] = useState(journey.entryFrequency || "no_reentry");
  const [exitCriteria, setExitCriteria] = useState(journey.exitCriteria || []);
  const [triggerSegmentKey, setTriggerSegmentKey] = useState(journey.triggerSegmentKey || "");
  // Entry filters. Stored as null when empty, but the builder always wants a
  // root group to render into, so the two forms are converted at the edges.
  const [entryFilters, setEntryFilters] = useState(
    journey.entryFilters?.children ? journey.entryFilters : emptyGroup("all"),
  );
  // Local trigger draft so the TriggerPicker can change it inline. Persisted
  // on save-draft alongside other flow fields.
  const [triggerDraft, setTriggerDraft] = useState(journey.trigger || "customer_created");
  const [selectedId, setSelectedId] = useState("trigger");
  const [viewMode, setViewMode] = useState("canvas");
  const [showPreview, setShowPreview] = useState(true);
  const [showAnalytics, setShowAnalytics] = useState(journey.status === "published");
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [emailEditorNodeId, setEmailEditorNodeId] = useState(null);
  // When the TriggerPicker wants to navigate to a segment route mid-edit,
  // we capture the target here and show a confirm modal. Null = no pending
  // navigation. Resolved by either saving the draft + navigating, or
  // discarding draft state and navigating directly.
  const [pendingLeavePath, setPendingLeavePath] = useState(null);
  const [dialog, setDialog] = useState(null);
  // Destination to navigate to once an in-flight save-draft completes.
  const [navigateAfterSave, setNavigateAfterSave] = useState(null);

  const isDirty = useMemo(() => {
    return (
      name !== journey.name ||
      entryFrequency !== (journey.entryFrequency || "no_reentry") ||
      JSON.stringify(exitCriteria) !== JSON.stringify(journey.exitCriteria || []) ||
      JSON.stringify(nodes) !== JSON.stringify(initialNodes) ||
      triggerDraft !== (journey.trigger || "customer_created") ||
      // Compare through the same null-when-empty normalisation the server
      // applies, so adding a rule and removing it again isn't "dirty".
      JSON.stringify(prunedFilters(entryFilters)) !==
        JSON.stringify(prunedFilters(journey.entryFilters)) ||
      (triggerDraft === "segment_entered" && triggerSegmentKey !== (journey.triggerSegmentKey || ""))
    );
  }, [name, entryFrequency, exitCriteria, entryFilters, nodes, journey, initialNodes, triggerSegmentKey, triggerDraft]);

  const selected = nodes.find((n) => n.id === selectedId);

  // Validation failures keep the modal open and are rendered inside it, so the
  // merchant sees exactly which step blocked the publish.
  const publishErrors = fetcher.data?.publishErrors || null;

  // Deferred navigation after "Save draft & continue". Waiting on the fetcher
  // rather than a timer means the draft is guaranteed persisted before the
  // component unmounts.
  useEffect(() => {
    if (!navigateAfterSave) return;
    if (fetcher.state !== "idle") return;
    if (fetcher.data?.saved) {
      const dest = navigateAfterSave;
      setNavigateAfterSave(null);
      navigate(dest);
    } else if (fetcher.data && fetcher.data.ok === false) {
      // The save failed — stay put and surface it rather than navigating away
      // from work that was not persisted.
      setNavigateAfterSave(null);
      setToast({ tone: "info", text: "Couldn't save your draft. Nothing was lost — try again." });
    }
  }, [navigateAfterSave, fetcher.state, fetcher.data, navigate]);

  useEffect(() => {
    if (fetcher.data?.archived) {
      navigate(`/app/flows${location.search}`);
      return;
    }
    if (fetcher.data?.published) {
      setShowPublishModal(false);
      setToast(publishToastMessage(fetcher.data.segmentBaseline));
    }
    // A rejected save reports itself whether or not a navigation was pending —
    // otherwise the Save button simply stops saying "Saved" with no reason why.
    if (fetcher.data?.saveError) {
      setToast({ tone: "info", text: fetcher.data.saveError });
    }
  }, [fetcher.data]);

  // Browser-level guard for reloads and tab closes. In-app navigation is
  // covered by the confirm modal below; this catches everything outside React
  // Router's control, where previously a reload silently discarded the canvas.
  useEffect(() => {
    if (!isDirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // Auto-dismiss the toast. Cleared on unmount so a navigation mid-timer
  // doesn't setState on a gone component.
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function updateNode(id, patch) {
    setNodes((arr) => arr.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }

  function deleteNode(id) {
    setNodes((arr) => arr.filter((n) => n.id !== id));
    if (selectedId === id) setSelectedId("trigger");
  }

  function duplicateNode(id) {
    setNodes((arr) => {
      const idx = arr.findIndex((n) => n.id === id);
      if (idx === -1) return arr;
      // The copy is a NEW step and must not inherit stepKey — that key is what
      // ties a step to its send history, and two steps carrying the same one
      // would have their numbers silently added together in every report.
      const { stepKey: _dropped, ...source } = arr[idx];
      const copy = { ...source, id: `tmp-${Date.now()}` };
      const next = [...arr];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }

  function insertNode(afterIndex, kind) {
    let newNode;
    if (kind === "delay") {
      newNode = { kind: "delay", id: `tmp-${Date.now()}`, hours: 24 };
    } else if (kind === "push") {
      newNode = {
        kind: "push",
        id: `tmp-${Date.now()}`,
        pushTitle: "",
        pushBody: "",
        pushIconUrl: "",
        pushClickUrl: "",
        delayHours: 1,
        isEnabled: true,
      };
    } else if (kind === "whatsapp") {
      newNode = {
        kind: "whatsapp",
        id: `tmp-${Date.now()}`,
        waTemplateName: "",
        waLanguage: "",
        waVariables: {},
        waMediaUrl: "",
        delayHours: 1,
        isEnabled: true,
      };
    } else {
      newNode = {
          kind: "email",
          id: `tmp-${Date.now()}`,
          stepNumber: 0,
          emailName: "New email",
          subject: "",
          previewText: "",
          templateStyle: "classic",
          discountPct: 0,
          isEnabled: true,
        };
    }
    setNodes((arr) => {
      const next = [...arr];
      next.splice(afterIndex + 1, 0, newNode);
      return next;
    });
    setOpenMenuId(null);
    setSelectedId(newNode.id);
  }

  /** The canvas payload, shared by save-draft and publish. */
  function draftFormData(intent) {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("name", name);
    fd.set("entryFrequency", entryFrequency);
    fd.set("exitCriteria", JSON.stringify(exitCriteria));
    fd.set("entryFilters", JSON.stringify(entryFilters));
    fd.set("nodes", JSON.stringify(nodes));
    if (triggerDraft !== (journey.trigger || "customer_created")) {
      fd.set("trigger", triggerDraft);
    }
    if (triggerDraft === "segment_entered") {
      fd.set("triggerSegmentKey", triggerSegmentKey || "");
    }
    return fd;
  }

  function saveDraftAction() {
    fetcher.submit(draftFormData("save-draft"), { method: "post" });
  }

  /**
   * Publish always carries the current canvas, so the server saves and publishes
   * in a single request. The previous version fired save-draft and then publish
   * 100ms apart through the same fetcher, which React Router cancels — so a slow
   * save silently published the previous version instead.
   */
  function publishAction({ backfillSegmentMembers = false } = {}) {
    const fd = draftFormData("publish");
    if (backfillSegmentMembers) fd.set("backfillSegmentMembers", "1");
    fetcher.submit(fd, { method: "post" });
  }

  function pauseAction() {
    const fd = new FormData();
    fd.set("intent", "pause");
    fetcher.submit(fd, { method: "post" });
  }

  const pillClass = STATUS_PILL[journey.status] || "draft";
  const pillLabel = pillClass === "active" ? "Active" : pillClass.charAt(0).toUpperCase() + pillClass.slice(1);
  const isPublished = journey.status === "published";
  const saving = fetcher.state !== "idle";

  // ── Email visual editor full-page takeover ──
  if (emailEditorNodeId) {
    const emailNode = nodes.find((n) => n.id === emailEditorNodeId);
    if (emailNode) {
      return (
        <EmailEditor
          flow={{ name, trigger: journey.trigger }}
          node={emailNode}
          testEmailDefault={testEmailDefault}
          senderName={settings?.senderName || ""}
          sendingFrom={sendingFromAddress}
          onBack={() => setEmailEditorNodeId(null)}
          onSave={(updatedNode) => {
            updateNode(updatedNode.id, {
              subject: updatedNode.subject,
              previewText: updatedNode.previewText,
              emailMode: updatedNode.emailMode,
              emailHtml: updatedNode.emailHtml,
              emailBlocks: updatedNode.emailBlocks,
              emailBrand: updatedNode.emailBrand,
            });
            setEmailEditorNodeId(null);
          }}
        />
      );
    }
  }

  return (
    <div className="rt-builder-shell">
      {/* Top bar */}
      <div className="rt-builder-topbar">
        <div className="rt-bt-left">
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => {
              const dest = `/app/flows${location.search}`;
              // Same guard the TriggerPicker uses. The back arrow previously
              // discarded unsaved canvas edits without a word.
              if (isDirty) setPendingLeavePath(dest);
              else navigate(dest);
            }}
            aria-label="Back"
          >
            <Icons.ArrowBack size={16} />
          </button>
          <div className="rt-bt-flowmeta">
            <input
              className="rt-bt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <span className={`pill ${pillClass}`}>{pillLabel}</span>
          </div>
        </div>

        <div className="rt-bt-center">
          <div className="rt-view-toggle">
            <button
              className={viewMode === "canvas" ? "rt-vt-on" : ""}
              onClick={() => setViewMode("canvas")}
            >
              <Icons.Flow size={13} /> Canvas
            </button>
            <button
              className={viewMode === "form" ? "rt-vt-on" : ""}
              onClick={() => setViewMode("form")}
            >
              <Icons.List size={13} /> Form
            </button>
          </div>
        </div>

        <div className="rt-bt-right">
          {viewMode === "canvas" && (
            <>
              <button
                className={`btn btn-ghost${showPreview ? " rt-toggle-on" : ""}`}
                onClick={() => setShowPreview((v) => !v)}
              >
                {showPreview ? <Icons.Eye size={14} /> : <Icons.EyeOff size={14} />} Preview
              </button>
              {isPublished && (
                <button
                  className={`btn btn-ghost${showAnalytics ? " rt-toggle-on" : ""}`}
                  onClick={() => setShowAnalytics((v) => !v)}
                  title="Show per-step numbers on the canvas"
                >
                  <Icons.Chart size={14} /> Inline stats
                </button>
              )}
              <span className="rt-bt-divider" />
            </>
          )}
          {/* The full campaign report. Available whatever the flow's status and
              whichever view is open — a paused flow's history is exactly what a
              merchant wants to look at before deciding to relaunch it. */}
          <button
            className="btn btn-ghost"
            onClick={() => navigate(`/app/flows/${journey.id}/analytics${location.search}`)}
          >
            <Icons.Chart size={14} /> Analytics
          </button>
          {isPublished && (
            <button className="btn btn-secondary" onClick={pauseAction} disabled={saving}>
              <Icons.Pause size={13} /> Pause
            </button>
          )}
          {/* The unpublish and archive intents were both implemented on the
              server with nothing in the UI that could reach them. */}
          <FlowMoreMenu
            isPublished={isPublished}
            onUnpublish={() => setDialog({ kind: "unpublish" })}
            onArchive={() => setDialog({ kind: "archive" })}
            onAnalytics={() => navigate(`/app/flows/${journey.id}/analytics${location.search}`)}
          />
          <button
            className="btn btn-secondary"
            onClick={saveDraftAction}
            disabled={!isDirty || saving}
          >
            {fetcher.data?.saved && !isDirty ? "Saved" : "Save draft"}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowPublishModal(true)}
            disabled={saving}
          >
            <Icons.Play size={13} /> {isPublished ? "Publish changes" : "Publish"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="rt-builder-body">
        {/* Canvas / Form */}
        <div className="rt-builder-canvas">
          {viewMode === "canvas" ? (
            <div className="rt-canvas-pad">
              <div className="rt-canvas-col">
                {nodes.map((node, idx) => (
                  <Fragment key={node.id}>
                    <NodeCard
                      node={node}
                      journey={journey}
                      selected={node.id === selectedId}
                      onSelect={() => setSelectedId(node.id)}
                      onDuplicate={() => duplicateNode(node.id)}
                      onDelete={() => deleteNode(node.id)}
                      stats={stats?.[node.id]}
                      showPreview={showPreview}
                      showAnalytics={showAnalytics}
                    />
                    {node.kind !== "exit" && (
                      <Connector
                        id={`conn-${idx}`}
                        openMenuId={openMenuId}
                        setOpenMenuId={setOpenMenuId}
                        onInsert={(kind) => insertNode(idx, kind)}
                      />
                    )}
                  </Fragment>
                ))}
              </div>
            </div>
          ) : (
            <FormView
              nodes={nodes}
              journey={journey}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={updateNode}
              onOpenEditor={setEmailEditorNodeId}
            />
          )}
        </div>

        {/* Inspector */}
        <div className="rt-builder-inspector">
          <Inspector
            node={selected}
            journey={journey}
            entryFrequency={entryFrequency}
            setEntryFrequency={setEntryFrequency}
            exitCriteria={exitCriteria}
            setExitCriteria={setExitCriteria}
            entryFilters={entryFilters}
            setEntryFilters={setEntryFilters}
            filterFields={filterFields}
            filterOperators={filterOperators}
            filterTags={filterTags}
            triggerSegmentKey={triggerSegmentKey}
            setTriggerSegmentKey={setTriggerSegmentKey}
            triggerDraft={triggerDraft}
            setTriggerDraft={setTriggerDraft}
            segmentChoices={segmentChoices}
            triggerSegmentCount={triggerSegmentCount}
            settings={settings}
            sendingFromAddress={sendingFromAddress}
            whatsappTemplates={whatsappTemplates}
            isShopify={isShopify}
            onChange={(patch) => selected && updateNode(selected.id, patch)}
            onOpenEditor={setEmailEditorNodeId}
            // Block destructive cross-route nav when there are unsaved
            // changes — return false from the picker's confirmLeave to
            // cancel default navigation and surface the warning modal.
            confirmLeave={(path) => {
              if (isDirty) {
                setPendingLeavePath(path);
                return false;
              }
              return true;
            }}
          />
        </div>
      </div>

      {dialog?.kind === "unpublish" && (
        <ConfirmDialog
          title="Unpublish this flow?"
          body="It returns to draft and stops enrolling anyone new. Contacts already partway through keep receiving their remaining messages — pause instead if you want those stopped too."
          confirmLabel="Unpublish"
          loading={saving}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            fetcher.submit({ intent: "unpublish" }, { method: "post" });
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "archive" && (
        <ConfirmDialog
          title="Archive this flow?"
          body="It's paused and hidden from your flows list. Its history stays available in the campaign report."
          confirmLabel="Archive"
          destructive
          loading={saving}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            fetcher.submit({ intent: "archive" }, { method: "post" });
            setDialog(null);
          }}
        />
      )}

      <PublishToast toast={toast} onDismiss={() => setToast(null)} />

      {showPublishModal && (
        <PublishModal
          isPublished={isPublished}
          onCancel={() => setShowPublishModal(false)}
          onConfirm={publishAction}
          loading={saving}
          errors={publishErrors}
          segmentBackfill={{
            eligible: triggerDraft === "segment_entered" && !!triggerSegmentKey,
            count: triggerSegmentCount || 0,
          }}
        />
      )}
      {pendingLeavePath && (
        <LeaveDraftModal
          onCancel={() => setPendingLeavePath(null)}
          onSaveAndContinue={() => {
            // Navigate only once the save has actually landed — see
            // navigateAfterSave below. A fixed timeout here was the same race
            // the publish path had: unmounting mid-submit can abort the
            // request, silently discarding the draft it promised to save.
            setNavigateAfterSave(pendingLeavePath);
            setPendingLeavePath(null);
            saveDraftAction();
          }}
          onDiscardAndContinue={() => {
            const dest = pendingLeavePath;
            setPendingLeavePath(null);
            navigate(dest);
          }}
          loading={saving}
        />
      )}
    </div>
  );
}

/** Overflow menu in the builder top bar. */
function FlowMoreMenu({ isPublished, onUnpublish, onArchive, onAnalytics }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rt-kebab-wrap">
      <button
        className="btn btn-ghost btn-icon"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-expanded={open}
      >
        <Icons.More size={16} />
      </button>
      {open && (
        <>
          <div className="rt-veil" onClick={() => setOpen(false)} />
          <div className="rt-menu" style={{ right: 0, left: "auto" }}>
            <button onClick={() => { setOpen(false); onAnalytics(); }}>
              <Icons.Chart size={14} /> Campaign report
            </button>
            {isPublished && (
              <button onClick={() => { setOpen(false); onUnpublish(); }}>
                <Icons.EyeOff size={14} /> Unpublish to draft
              </button>
            )}
            <div className="rt-menu-sep" />
            <button className="rt-menu-danger" onClick={() => { setOpen(false); onArchive(); }}>
              <Icons.Trash size={14} /> Archive flow
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LeaveDraftModal({ onCancel, onSaveAndContinue, onDiscardAndContinue, loading }) {
  return (
    <div className="rt-modal-backdrop" onClick={onCancel}>
      <div
        className="rt-save-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520 }}
      >
        <div className="rt-save-head">
          <div className="t-micro">Unsaved changes</div>
          <h2 className="t-h1">Save your draft before leaving?</h2>
        </div>
        <div className="rt-save-body">
          <p className="t-body" style={{ margin: 0 }}>
            This flow has unsaved changes. If you leave without saving, you'll
            lose your edits to this draft.
          </p>
        </div>
        <div className="rt-save-foot">
          <div className="rt-save-foot-left">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Stay here
            </button>
          </div>
          <div className="rt-save-foot-right">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onDiscardAndContinue}
              disabled={loading}
            >
              Discard &amp; continue
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSaveAndContinue}
              disabled={loading}
            >
              {loading ? "Saving…" : "Save draft & continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NodeCard({ node, journey, selected, onSelect, onDuplicate, onDelete, stats, showPreview, showAnalytics }) {
  const trig = TRIGGER_CONFIG[journey.trigger] || TRIGGER_CONFIG.customer_created;
  const TrigIcon = Icons[trig.icon];

  if (node.kind === "trigger") {
    return (
      <div
        className={`rt-node rt-node-trigger${selected ? " rt-selected" : ""}`}
        onClick={onSelect}
      >
        <div className="rt-node-head">
          <div className="rt-node-glyph rt-tint-trigger">
            {TrigIcon && <TrigIcon size={14} />}
          </div>
          <div className="rt-node-title">Trigger</div>
          <span className="rt-node-tag">Entry</span>
        </div>
        <div className="rt-node-body">
          <div className="rt-node-line">
            <span className="muted">When:</span> {trig.label}
          </div>
        </div>
      </div>
    );
  }

  if (node.kind === "delay") {
    return (
      <div
        className={`rt-node rt-node-delay${selected ? " rt-selected" : ""}`}
        onClick={onSelect}
      >
        <div className="rt-node-head">
          <div className="rt-node-glyph rt-tint-delay"><Icons.Clock size={14} /></div>
          <div className="rt-node-title">Wait {formatHours(node.hours)}</div>
          <div className="rt-node-actions">
            <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>
              <Icons.Copy size={13} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }}>
              <Icons.Trash size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (node.kind === "exit") {
    return (
      <div
        className={`rt-node rt-node-exit${selected ? " rt-selected" : ""}`}
        onClick={onSelect}
      >
        <div className="rt-node-head">
          <div className="rt-node-glyph rt-tint-exit"><Icons.Exit size={14} /></div>
          <div className="rt-node-title">Exit flow</div>
        </div>
        <div className="rt-node-body">
          <div className="rt-node-line muted">The contact exits the flow here.</div>
        </div>
      </div>
    );
  }

  if (node.kind === "push") {
    return (
      <div
        className={`rt-node rt-node-push${selected ? " rt-selected" : ""}`}
        onClick={onSelect}
      >
        <div className="rt-node-head">
          <div className="rt-node-glyph rt-tint-push"><Icons.Bell size={14} /></div>
          <div className="rt-node-title">{node.pushTitle || "Push Notification"}</div>
          <div className="rt-node-actions">
            <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>
              <Icons.Copy size={13} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }}>
              <Icons.Trash size={13} />
            </button>
          </div>
        </div>
        {node.pushBody && (
          <div className="rt-node-body">
            <div className="rt-node-line muted">{node.pushBody.slice(0, 80)}</div>
          </div>
        )}
      </div>
    );
  }

  if (node.kind === "whatsapp") {
    return (
      <div
        className={`rt-node rt-node-whatsapp${selected ? " rt-selected" : ""}`}
        onClick={onSelect}
      >
        <div className="rt-node-head">
          <div className="rt-node-glyph rt-tint-whatsapp"><Icons.Whatsapp size={14} /></div>
          <div className="rt-node-title">{node.waTemplateName || "WhatsApp message"}</div>
          <div className="rt-node-actions">
            <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>
              <Icons.Copy size={13} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }}>
              <Icons.Trash size={13} />
            </button>
          </div>
        </div>
        <div className="rt-node-body">
          <div className="rt-node-line muted">
            {node.waTemplateName ? `Template · ${node.waLanguage || "en_US"}` : "No template selected"}
          </div>
        </div>
      </div>
    );
  }

  // Email node
  return (
    <div
      className={`rt-node rt-node-email${selected ? " rt-selected" : ""}`}
      onClick={onSelect}
    >
      <div className="rt-node-head">
        <div className="rt-node-glyph rt-tint-email"><Icons.Mail size={14} /></div>
        <div className="rt-node-title">{node.emailName || "Email"}</div>
        <div className="rt-node-actions">
          <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>
            <Icons.Copy size={13} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Icons.Trash size={13} />
          </button>
        </div>
      </div>
      <div className="rt-node-body">
        <div className="rt-node-line">
          <span className="muted">Subject:</span>{" "}
          {node.subject || <em className="faint">No subject</em>}
        </div>
        {showPreview && (
          <div className="rt-node-preview">
            {node.emailMode === "html" ? (
              <CustomHtmlPreview node={node} />
            ) : node.emailBlocks?.length ? (
              <RenderedBlockPreview node={node} />
            ) : (
              <EmailPreview node={node} />
            )}
          </div>
        )}
        {showAnalytics && stats && (
          <div className="rt-node-stats">
            <div>
              <div className="t-micro muted">Sent</div>
              <div className="t-mono rt-stat-num">{stats.sent ?? 0}</div>
            </div>
            <div>
              <div className="t-micro muted">Opens</div>
              <div className="t-mono rt-stat-num">{stats.openRate ?? 0}%</div>
            </div>
            <div>
              <div className="t-micro muted">Clicks</div>
              <div className="t-mono rt-stat-num">{stats.clickRate ?? 0}%</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Placeholder shown on the canvas for an email step with no blocks yet.
 *
 * Deliberately abstract. It used to render invented body copy ("Hi Alex, thanks
 * for joining us…") over a fake wordmark, which reads as a preview of the real
 * email rather than as the empty state it actually is.
 */
function EmailPreview({ node }) {
  return (
    <div className="rt-email-preview">
      <div className="rt-email-h">{node.subject || "No subject yet"}</div>
      <div className="rt-email-body">
        Nothing designed yet — open the visual editor to build this email.
      </div>
    </div>
  );
}

// Node-card preview for custom-HTML email steps. Renders the pasted HTML in a
// small sandboxed, non-interactive iframe so the merchant sees their real
// design (not the default block template).
function CustomHtmlPreview({ node }) {
  const html = (node.emailHtml || "").trim();
  if (!html) {
    return (
      <div className="rt-email-html-card rt-email-html-empty">
        <span>Custom HTML — nothing pasted yet</span>
      </div>
    );
  }
  return (
    <div className="rt-email-html-card">
      <div className="rt-email-html-badge">Custom HTML</div>
      <iframe
        title="Custom HTML preview"
        className="rt-email-html-thumb"
        sandbox=""
        scrolling="no"
        srcDoc={html}
      />
    </div>
  );
}

function Connector({ id, openMenuId, setOpenMenuId, onInsert }) {
  const open = openMenuId === id;
  return (
    <div className="rt-connector">
      <div className="rt-connector-line" />
      <button
        className="rt-insert-btn"
        onClick={() => setOpenMenuId(open ? null : id)}
        aria-label="Insert step"
      >
        <Icons.Plus size={14} />
      </button>
      <InsertMenu
        open={open}
        onClose={() => setOpenMenuId(null)}
        onAdd={onInsert}
      />
    </div>
  );
}

function InsertMenu({ open, onClose, onAdd }) {
  if (!open) return null;
  const item = (iconName, label, type, soon = false) => {
    const Icon = Icons[iconName];
    return (
      <button
        key={type}
        className={`rt-insert-item${soon ? " rt-insert-locked" : ""}`}
        onClick={() => { if (!soon) { onAdd(type); onClose(); } }}
      >
        {Icon && <Icon size={14} />}
        <span>{label}</span>
        {soon && (
          <span className="pill soon" style={{ marginLeft: "auto", height: 16, fontSize: 9, padding: "0 5px" }}>
            Soon
          </span>
        )}
      </button>
    );
  };
  return (
    <>
      <div className="rt-insert-veil" onClick={onClose} />
      <div className="rt-insert-menu">
        <div className="t-micro muted rt-insert-heading">Send</div>
        {item("Mail", "Email", "email")}
        {item("Bell", "Push notification", "push")}
        {item("Whatsapp", "WhatsApp message", "whatsapp")}
        {item("Sms", "SMS message", "sms", true)}
        <div className="t-micro muted rt-insert-heading">Timing</div>
        {item("Clock", "Wait (delay)", "delay")}
        <div className="t-micro muted rt-insert-heading">Logic</div>
        {item("Split", "Split branch", "split", true)}
        {item("Tag", "Tag contact", "tag", true)}
      </div>
    </>
  );
}

function Inspector({ node, journey, sendingFromAddress, entryFrequency, setEntryFrequency, exitCriteria, setExitCriteria, entryFilters, setEntryFilters, filterFields = [], filterOperators = {}, filterTags = [], triggerSegmentKey, setTriggerSegmentKey, triggerDraft, setTriggerDraft, segmentChoices = [], triggerSegmentCount, settings, whatsappTemplates = [], onChange, onOpenEditor, confirmLeave, isShopify = true }) {
  const filterFieldsById = useMemo(
    () => Object.fromEntries(filterFields.map((f) => [f.id, f])),
    [filterFields],
  );
  if (!node) {
    return (
      <div className="rt-ins">
        <div className="rt-ins-empty">
          <Icons.Sliders size={20} />
          <div className="t-h3" style={{ margin: "12px 0 6px" }}>Click a step to edit it</div>
          <div className="t-small muted">
            Or use the <strong>+</strong> on any connector to add one.
          </div>
        </div>
      </div>
    );
  }

  if (node.kind === "trigger") {
    // Read from the in-memory draft so swapping the trigger reflects in
    // the head + glyph immediately without waiting for save.
    const activeTrigger = triggerDraft || journey.trigger || "customer_created";
    const trig = TRIGGER_CONFIG[activeTrigger] || TRIGGER_CONFIG.customer_created;
    const TrigIcon = Icons[trig.icon];
    const isDelayed = entryFrequency.startsWith("delayed_");
    const delayedHours = isDelayed ? Number(entryFrequency.slice("delayed_".length)) : 168;

    function toggleCriterion(value) {
      setExitCriteria((arr) =>
        arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value],
      );
    }

    return (
      <div className="rt-ins">
        <div className="rt-ins-head">
          <div className={`rt-node-glyph rt-tint-${trig.tint || "trigger"}`}>
            {TrigIcon && <TrigIcon size={14} />}
          </div>
          <div>
            <div className="t-micro muted">Trigger</div>
            <div className="t-h2" style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>
              {trig.label}
            </div>
          </div>
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 4 }}>When this happens</div>
          <div className="t-small muted" style={{ margin: "0 0 4px" }}>
            Pick what kicks off the flow.
          </div>
          <TriggerPicker
            value={triggerDraft}
            segmentKey={triggerSegmentKey}
            segmentChoices={segmentChoices}
            onChange={(t, segKey) => {
              setTriggerDraft(t);
              if (t === "segment_entered") {
                setTriggerSegmentKey(segKey || "");
              } else {
                setTriggerSegmentKey("");
              }
            }}
            confirmLeave={confirmLeave}
            isShopify={isShopify}
          />
          {/* The loader already resolves this count for the publish modal's
              backfill offer; showing it here too tells the merchant how large
              the audience is while they're choosing, not after. */}
          {activeTrigger === "segment_entered" && triggerSegmentKey && triggerSegmentCount !== null && (
            <div className="field-help" style={{ marginTop: 8 }}>
              {triggerSegmentCount.toLocaleString()}{" "}
              {triggerSegmentCount === 1 ? "contact matches" : "contacts match"} this segment right now.
              {" "}They won&apos;t be enrolled unless you choose to when publishing — this flow triggers
              when someone <em>enters</em>.
            </div>
          )}
        </div>

        {/* Entry filters. Hidden for broadcasts, which already pick their
            audience explicitly — see the matching guard in enrollContact. */}
        {activeTrigger !== "broadcast" && (
          <div className="rt-ins-section">
            <div className="t-micro muted">Flow filters</div>
            <div className="t-small muted" style={{ margin: "6px 0 12px" }}>
              Only enter when these conditions are met. Checked once, when the
              contact enters.
            </div>
            <GroupBlock
              node={entryFilters}
              fields={filterFields}
              fieldsById={filterFieldsById}
              operators={filterOperators}
              tags={filterTags}
              onChange={setEntryFilters}
              canRemove={false}
            />
          </div>
        )}

        <div className="rt-ins-section">
          <div className="t-micro muted">Entry frequency</div>
          <div className="t-small muted" style={{ margin: "6px 0 14px" }}>
            Control when contacts can re-enter this flow.
          </div>
          <div className="rt-radios">
            <RadioOption
              checked={entryFrequency === "no_reentry"}
              onClick={() => setEntryFrequency("no_reentry")}
              label="No re-entry"
              sub="Once enrolled, never again."
            />
            <RadioOption
              checked={isDelayed}
              onClick={() => setEntryFrequency(`delayed_${delayedHours}`)}
              label="Delayed re-entry"
              sub="Re-enter only after a waiting period."
            />
            {isDelayed && (
              <div style={{ marginLeft: 28, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={delayedHours}
                  onChange={(e) =>
                    setEntryFrequency(`delayed_${Math.max(1, Number(e.target.value) || 1)}`)
                  }
                  style={{ width: 80 }}
                />
                <span className="t-small muted">hours</span>
              </div>
            )}
            <RadioOption
              checked={entryFrequency === "immediate"}
              onClick={() => setEntryFrequency("immediate")}
              label="Immediate re-entry"
              sub="Re-enter at any time."
            />
          </div>
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted">Exit criteria</div>
          <div className="t-small muted" style={{ margin: "6px 0 12px" }}>
            Remove a contact from the flow if any of these occur.
          </div>
          <div className="rt-checks">
            {EXIT_CRITERIA_OPTIONS.map((opt) => (
              <CheckOption
                key={opt.value}
                label={opt.label}
                checked={exitCriteria.includes(opt.value)}
                onChange={() => toggleCriterion(opt.value)}
              />
            ))}
            {activeTrigger === "segment_entered" &&
              SEGMENT_EXIT_CRITERIA.map((opt) => (
                <CheckOption
                  key={opt.value}
                  label={opt.label}
                  checked={exitCriteria.includes(opt.value)}
                  onChange={() => toggleCriterion(opt.value)}
                />
              ))}
          </div>
        </div>
      </div>
    );
  }

  if (node.kind === "email") {
    return (
      <div className="rt-ins">
        <div className="rt-ins-head">
          <div className="rt-node-glyph rt-tint-email"><Icons.Mail size={14} /></div>
          <div>
            <div className="t-micro muted">Email step</div>
            <div className="t-h2" style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>
              {node.emailName || "Email"}
            </div>
          </div>
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Content</div>
          <label className="field-label">Internal name</label>
          <input
            className="input"
            value={node.emailName || ""}
            onChange={(e) => onChange({ emailName: e.target.value })}
          />
          <div className="field-help">Not shown to contacts.</div>

          <label className="field-label" style={{ marginTop: 16 }}>Subject</label>
          <input
            className="input"
            value={node.subject || ""}
            onChange={(e) => onChange({ subject: e.target.value })}
          />
          {/* A recommendation, not a limit — the old copy said "N characters
              remaining" and happily counted into the negatives. */}
          <div className="field-help">
            {(node.subject || "").length} characters
            {(node.subject || "").length > 50
              ? " — long subjects get truncated in most inboxes"
              : " · around 50 reads best"}
          </div>

          <label className="field-label" style={{ marginTop: 16 }}>Preview text</label>
          <input
            className="input"
            value={node.previewText || ""}
            placeholder="A short preview shown in the inbox"
            onChange={(e) => onChange({ previewText: e.target.value })}
          />
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Design</div>
          <button className="btn btn-secondary" style={{ width: "100%", justifyContent: "center" }}
                  onClick={() => onOpenEditor && onOpenEditor(node.id)}>
            <Icons.Tab size={14} /> Open visual editor
          </button>
          {node.emailBlocks?.length > 0 && (
            <div className="field-help" style={{ marginTop: 8 }}>
              {node.emailBlocks.length} block{node.emailBlocks.length !== 1 ? "s" : ""} — click to edit
            </div>
          )}
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Settings</div>
          <label className="rt-toggle">
            <input
              type="checkbox"
              checked={node.isEnabled !== false}
              onChange={() => onChange({ isEnabled: node.isEnabled === false })}
            />
            <span className="rt-toggle-switch" />
            <span>Step enabled</span>
          </label>
          {/* The real resolved from-address, computed by the same seam the send
              path uses. This used to print a literal "noreply@..." whenever
              senderEmail was empty — which is every shop on the shared domain. */}
          {sendingFromAddress && (
            <div className="field-help" style={{ marginTop: 12 }}>
              From: {settings?.senderName || "Your Store"} &lt;{sendingFromAddress}&gt;
            </div>
          )}
        </div>
      </div>
    );
  }

  if (node.kind === "push") {
    return (
      <div className="rt-ins">
        <div className="rt-ins-head">
          <div className="rt-node-glyph rt-tint-push"><Icons.Bell size={14} /></div>
          <div>
            <div className="t-micro muted">Push notification</div>
            <div className="t-h2" style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>
              {node.pushTitle || "Push Notification"}
            </div>
          </div>
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Content</div>
          <label className="field-label">Title</label>
          <input
            className="input"
            value={node.pushTitle || ""}
            onChange={(e) => onChange({ pushTitle: e.target.value })}
            maxLength={65}
          />
          <div className="field-help">{65 - (node.pushTitle || "").length} characters remaining</div>

          <label className="field-label" style={{ marginTop: 16 }}>Body</label>
          <textarea
            className="input"
            rows={3}
            value={node.pushBody || ""}
            onChange={(e) => onChange({ pushBody: e.target.value })}
            maxLength={200}
          />

          <label className="field-label" style={{ marginTop: 16 }}>Icon URL <span className="faint">(optional)</span></label>
          <input
            className="input"
            value={node.pushIconUrl || ""}
            onChange={(e) => onChange({ pushIconUrl: e.target.value })}
            placeholder="https://..."
          />
          <div className="field-help">Defaults to store favicon if empty.</div>

          <label className="field-label" style={{ marginTop: 16 }}>Click URL <span className="faint">(optional)</span></label>
          <input
            className="input"
            value={node.pushClickUrl || ""}
            onChange={(e) => onChange({ pushClickUrl: e.target.value })}
            placeholder="Leave blank to use cart recovery link"
          />
        </div>

        {/* Timing comes from the Wait steps above this one on the canvas, exactly
            as it does for email. A per-step delay editor used to sit here, but
            saveDraft overwrites push/WhatsApp delays with the accumulated canvas
            value — so the control took input and silently discarded it. */}

        <div className="rt-ins-section">
          <label className="rt-toggle">
            <input
              type="checkbox"
              checked={node.isEnabled !== false}
              onChange={() => onChange({ isEnabled: node.isEnabled === false })}
            />
            <span className="rt-toggle-switch" />
            <span>Step enabled</span>
          </label>
        </div>
      </div>
    );
  }

  if (node.kind === "whatsapp") {
    return (
      <WhatsappInspector node={node} onChange={onChange} whatsappTemplates={whatsappTemplates} />
    );
  }

  if (node.kind === "delay") {
    return (
      <div className="rt-ins">
        <div className="rt-ins-head">
          <div className="rt-node-glyph rt-tint-delay"><Icons.Clock size={14} /></div>
          <div>
            <div className="t-micro muted">Delay step</div>
            <div className="t-h2" style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>Wait</div>
          </div>
        </div>
        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Duration</div>
          <DelayEditor node={node} onChange={onChange} />
        </div>
      </div>
    );
  }

  if (node.kind === "exit") {
    return (
      <div className="rt-ins">
        <div className="rt-ins-head">
          <div className="rt-node-glyph rt-tint-exit"><Icons.Exit size={14} /></div>
          <div>
            <div className="t-micro muted">Exit</div>
            <div className="t-h2" style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>
              End of flow
            </div>
          </div>
        </div>
        <div className="rt-ins-section">
          <p className="t-small muted">
            The contact leaves the flow here. This step is automatic and cannot be removed.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

function DelayEditor({ node, onChange }) {
  const totalHours = Number(node.hours) || 0;
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours - days * 24;
  const [unit, setUnit] = useState(days > 0 && remHours === 0 ? "days" : "hours");
  const displayValue = unit === "days" ? totalHours / 24 : totalHours;

  function setValue(num) {
    const n = Math.max(0, Number(num) || 0);
    onChange({ hours: unit === "days" ? n * 24 : n });
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        className="input"
        type="number"
        min="0"
        value={displayValue}
        onChange={(e) => setValue(e.target.value)}
        style={{ flex: 1 }}
      />
      <select
        className="select"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        style={{ width: 100 }}
      >
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
    </div>
  );
}

// Merge tags the WhatsApp worker's resolveVar understands, plus a literal mode.
const WA_MERGE_TAGS = [
  { value: "contactName", label: "Contact name" },
  { value: "recoveryUrl", label: "Cart recovery URL" },
];

function WhatsappInspector({ node, onChange, whatsappTemplates = [] }) {
  const selectedTpl = whatsappTemplates.find((t) => t.name === node.waTemplateName) || null;
  // Positional params {{1}},{{2}}… declared in the template body.
  const paramNums = selectedTpl
    ? Array.from(new Set([...(selectedTpl.bodyText || "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))))
        .sort((a, b) => a - b)
    : [];
  const vars = node.waVariables || {};

  function pickTemplate(name) {
    const tpl = whatsappTemplates.find((t) => t.name === name);
    // Reset variable mappings when the template changes.
    onChange({ waTemplateName: name, waLanguage: tpl?.language || "", waVariables: {} });
  }

  function setVar(num, value) {
    onChange({ waVariables: { ...vars, [String(num)]: value } });
  }

  return (
    <div className="rt-ins">
      <div className="rt-ins-head">
        <div className="rt-node-glyph rt-tint-whatsapp"><Icons.Whatsapp size={14} /></div>
        <div>
          <div className="t-micro muted">WhatsApp message</div>
          <div className="t-h2" style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>
            {node.waTemplateName || "WhatsApp message"}
          </div>
        </div>
      </div>

      <div className="rt-ins-section">
        <div className="t-micro muted" style={{ marginBottom: 12 }}>Template</div>
        {whatsappTemplates.length === 0 ? (
          <div className="field-help">
            No approved templates yet. <a href="/app/whatsapp">Connect WhatsApp and sync templates</a> to pick one here.
          </div>
        ) : (
          <>
            <select
              className="input"
              value={node.waTemplateName || ""}
              onChange={(e) => pickTemplate(e.target.value)}
            >
              <option value="">Select a template…</option>
              {whatsappTemplates.map((t) => (
                <option key={t.id} value={t.name}>{t.name} ({t.language})</option>
              ))}
            </select>
            {selectedTpl?.bodyText && (
              <div className="field-help" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{selectedTpl.bodyText}</div>
            )}
          </>
        )}
      </div>

      {paramNums.length > 0 && (
        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Variables</div>
          {paramNums.map((num) => {
            const current = vars[String(num)] ?? "";
            const isMergeTag = WA_MERGE_TAGS.some((t) => t.value === current);
            const mode = current === "" ? "" : isMergeTag ? current : "__literal__";
            return (
              <div key={num} style={{ marginBottom: 12 }}>
                <label className="field-label">{`{{${num}}}`}</label>
                <select
                  className="input"
                  value={mode}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__literal__") setVar(num, " ");
                    else setVar(num, v);
                  }}
                >
                  <option value="">Choose value…</option>
                  {WA_MERGE_TAGS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                  <option value="__literal__">Custom text…</option>
                </select>
                {mode === "__literal__" && (
                  <input
                    className="input"
                    style={{ marginTop: 6 }}
                    value={current}
                    onChange={(e) => setVar(num, e.target.value)}
                    placeholder="Literal text"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="rt-ins-section">
        <label className="field-label">Header image URL <span className="faint">(optional)</span></label>
        <input
          className="input"
          value={node.waMediaUrl || ""}
          onChange={(e) => onChange({ waMediaUrl: e.target.value })}
          placeholder="https://…"
        />
        <div className="field-help">Only if the template has a media header.</div>
      </div>

      {selectedTpl?.bodyText && (
        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Preview</div>
          <WhatsappPreview bodyText={selectedTpl.bodyText} vars={vars} mediaUrl={node.waMediaUrl} />
        </div>
      )}

      {/* Timing comes from the Wait steps above this one on the canvas, exactly
            as it does for email. A per-step delay editor used to sit here, but
            saveDraft overwrites push/WhatsApp delays with the accumulated canvas
            value — so the control took input and silently discarded it. */}

      <div className="rt-ins-section">
        <label className="rt-toggle">
          <input
            type="checkbox"
            checked={node.isEnabled !== false}
            onChange={() => onChange({ isEnabled: node.isEnabled === false })}
          />
          <span className="rt-toggle-switch" />
          <span>Step enabled</span>
        </label>
      </div>
    </div>
  );
}

// A lightweight WhatsApp chat-bubble preview. Substitutes {{n}} in the template
// body with a readable label for the mapped variable so merchants see the shape
// of the message as they configure it.
function WhatsappPreview({ bodyText, vars = {}, mediaUrl }) {
  // Bracketed placeholders rather than invented sample values, matching the
  // email test send. A name like "Alex" in a preview reads as real data and
  // leaves the merchant wondering where it came from.
  const labelFor = (num) => {
    const ref = vars[String(num)];
    if (ref === "contactName") return "[Contact name]";
    if (ref === "recoveryUrl") return "[Cart link]";
    if (ref && String(ref).trim()) return String(ref);
    return `{{${num}}}`;
  };
  const rendered = String(bodyText).replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => labelFor(Number(n)));

  return (
    <div style={{ background: "#E5DDD5", borderRadius: "var(--r-3)", padding: 16 }}>
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 8,
          padding: mediaUrl ? 0 : "8px 10px",
          maxWidth: 260,
          boxShadow: "0 1px 1px rgba(0,0,0,.12)",
          overflow: "hidden",
          fontFamily: "var(--font-ui)",
        }}
      >
        {mediaUrl && (
          // eslint-disable-next-line jsx-a11y/img-redundant-alt
          <img
            src={mediaUrl}
            alt="header"
            style={{ width: "100%", maxHeight: 140, objectFit: "cover", display: "block" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        )}
        <div style={{ padding: mediaUrl ? "8px 10px" : 0 }}>
          <div style={{ fontSize: 13, color: "#111", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{rendered}</div>
          <div style={{ fontSize: 10, color: "#9aa0a6", textAlign: "right", marginTop: 4 }}>now</div>
        </div>
      </div>
    </div>
  );
}

function RadioOption({ checked, onClick, label, sub }) {
  return (
    <button className={`rt-radio${checked ? " rt-on" : ""}`} onClick={onClick}>
      <span className="rt-radio-dot"><span /></span>
      <span>
        <span className="rt-radio-label">{label}</span>
        <span className="rt-radio-sub">{sub}</span>
      </span>
    </button>
  );
}

function CheckOption({ label, checked, onChange, soon }) {
  return (
    <label className={`rt-check${soon ? " rt-locked" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={soon}
      />
      <span className="rt-check-box">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12l5 5 11-11" />
        </svg>
      </span>
      <span>{label}</span>
      {soon && (
        <span className="pill soon" style={{ marginLeft: "auto", height: 18, fontSize: 9, padding: "0 6px" }}>
          Soon
        </span>
      )}
    </label>
  );
}

const FORM_KIND_LABEL = {
  email: "Email",
  delay: "Delay",
  push: "Push notification",
  whatsapp: "WhatsApp",
};

function formViewTitle(n) {
  if (n.kind === "email") return n.emailName || "Email";
  if (n.kind === "delay") return `Wait ${formatHours(n.hours)}`;
  if (n.kind === "push") return n.pushTitle || "Push notification";
  if (n.kind === "whatsapp") return n.waTemplateName || "WhatsApp message";
  return n.kind;
}

function FormView({ nodes, journey, selectedId, onSelect, onChange, onOpenEditor }) {
  const trig = TRIGGER_CONFIG[journey.trigger] || TRIGGER_CONFIG.customer_created;
  const TrigIcon = Icons[trig.icon];
  const triggerNode = nodes.find((n) => n.kind === "trigger");

  return (
    <div className="rt-form-view">
      {/* Trigger */}
      <section className="rt-form-section">
        <div className="rt-form-section-head">
          <div className="rt-node-glyph rt-tint-trigger">
            {TrigIcon && <TrigIcon size={14} />}
          </div>
          <div>
            <div className="t-micro muted">Step 0 · Trigger</div>
            <div className="t-h2">{trig.label}</div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: "auto" }}
            onClick={() => onSelect(triggerNode?.id || "trigger")}
          >
            Edit →
          </button>
        </div>
        <p className="t-small muted" style={{ margin: "12px 0 0" }}>{trig.desc}</p>
      </section>

      {/* Email and delay steps */}
      {nodes
        .filter((n) => n.kind !== "trigger" && n.kind !== "exit")
        .map((n, i) => (
          <section
            key={n.id}
            className={`rt-form-section${selectedId === n.id ? " rt-form-selected" : ""}`}
          >
            <div className="rt-form-section-head">
              {/* Every sendable kind gets its own icon and label. This used
                  to be a two-way email/delay branch, so a push or WhatsApp step
                  rendered with no icon, the heading "Delay", and no fields. */}
              <div className={`rt-node-glyph rt-tint-${n.kind}`}>
                {n.kind === "email" && <Icons.Mail size={14} />}
                {n.kind === "delay" && <Icons.Clock size={14} />}
                {n.kind === "push" && <Icons.Bell size={14} />}
                {n.kind === "whatsapp" && <Icons.Whatsapp size={14} />}
              </div>
              <div>
                <div className="t-micro muted">
                  Step {i + 1} · {FORM_KIND_LABEL[n.kind] || n.kind}
                </div>
                <div className="t-h2">{formViewTitle(n)}</div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: "auto" }}
                onClick={() => onSelect(n.id)}
              >
                Edit →
              </button>
            </div>

            {n.kind === "email" && (
              <div className="rt-form-grid">
                <div>
                  <label className="field-label">Subject</label>
                  <input
                    className="input"
                    value={n.subject || ""}
                    onChange={(e) => onChange(n.id, { subject: e.target.value })}
                  />
                </div>
                {/* The old "Template" select wrote JourneyStep.templateStyle,
                    which the renderer never reads — design comes entirely from
                    emailBlocks/emailBrand. It's replaced with a route into the
                    editor that actually changes the design. */}
                <div>
                  <label className="field-label">Design</label>
                  <button
                    className="btn btn-secondary"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={() => onOpenEditor && onOpenEditor(n.id)}
                  >
                    Open visual editor
                  </button>
                </div>
                <div>
                  <label className="field-label">Enabled</label>
                  <label className="rt-toggle" style={{ marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={n.isEnabled !== false}
                      onChange={() => onChange(n.id, { isEnabled: n.isEnabled === false })}
                    />
                    <span className="rt-toggle-switch" />
                    <span>{n.isEnabled !== false ? "On" : "Off"}</span>
                  </label>
                </div>
              </div>
            )}

            {n.kind === "push" && (
              <div className="rt-form-grid">
                <div>
                  <label className="field-label">Title</label>
                  <input
                    className="input"
                    value={n.pushTitle || ""}
                    maxLength={65}
                    onChange={(e) => onChange(n.id, { pushTitle: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label">Body</label>
                  <input
                    className="input"
                    value={n.pushBody || ""}
                    maxLength={200}
                    onChange={(e) => onChange(n.id, { pushBody: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label">Enabled</label>
                  <label className="rt-toggle" style={{ marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={n.isEnabled !== false}
                      onChange={() => onChange(n.id, { isEnabled: n.isEnabled === false })}
                    />
                    <span className="rt-toggle-switch" />
                    <span>{n.isEnabled !== false ? "On" : "Off"}</span>
                  </label>
                </div>
              </div>
            )}

            {n.kind === "whatsapp" && (
              <div className="rt-form-grid">
                <div>
                  <label className="field-label">Template</label>
                  <input className="input" value={n.waTemplateName || "Not selected"} readOnly />
                  <div className="field-help">Pick a template in Canvas view.</div>
                </div>
                <div>
                  <label className="field-label">Enabled</label>
                  <label className="rt-toggle" style={{ marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={n.isEnabled !== false}
                      onChange={() => onChange(n.id, { isEnabled: n.isEnabled === false })}
                    />
                    <span className="rt-toggle-switch" />
                    <span>{n.isEnabled !== false ? "On" : "Off"}</span>
                  </label>
                </div>
              </div>
            )}

            {n.kind === "delay" && (
              // The unit select used to be an uncontrolled <select> with no
              // onChange — switching to days did nothing while the number stayed
              // in hours. DelayEditor owns both halves and keeps them in sync.
              <div className="rt-form-grid">
                <div>
                  <label className="field-label">Duration</label>
                  <DelayEditor node={n} onChange={(patch) => onChange(n.id, patch)} />
                </div>
              </div>
            )}
          </section>
        ))}

      {/* Exit */}
      <section className="rt-form-section rt-form-exit">
        <div className="rt-form-section-head">
          <div className="rt-node-glyph rt-tint-exit"><Icons.Exit size={14} /></div>
          <div>
            <div className="t-micro muted">End · Exit</div>
            <div className="t-h2">Contacts leave the flow</div>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Post-publish toast copy. `baseline` is the seedSegmentBaselineForFlow result
 * ({ seeded, enrolled, inSegment }) and is null for non-segment flows or a
 * re-publish, where a plain confirmation is all that's warranted.
 *
 * The "0 enrolled" case is the important one: publishing a segment flow onto a
 * populated segment deliberately enrolls nobody, and merchants read that
 * silence as a bug. Say it out loud instead.
 */
function publishToastMessage(baseline) {
  if (!baseline || !baseline.inSegment) {
    return { tone: "ok", text: "Flow published." };
  }
  const { enrolled = 0, inSegment = 0 } = baseline;
  const people = (n) => `${n} ${n === 1 ? "contact" : "contacts"}`;
  if (enrolled > 0) {
    return {
      tone: "ok",
      text: `Flow published — enrolling ${people(enrolled)} already in the segment.`,
    };
  }
  return {
    tone: "info",
    text: `Flow published. ${people(inSegment)} already in the segment ${inSegment === 1 ? "was" : "were"} not enrolled — this flow triggers when someone enters it.`,
  };
}

function PublishToast({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div className={`rt-toast rt-toast-${toast.tone}`} role="status" aria-live="polite">
      <span>{toast.text}</span>
      <button className="rt-toast-close" onClick={onDismiss} aria-label="Dismiss">
        <Icons.Close size={13} />
      </button>
    </div>
  );
}

function PublishModal({ isPublished, onCancel, onConfirm, loading, segmentBackfill, errors }) {
  const [backfill, setBackfill] = useState(false);
  // Offered only on first publish of a segment-triggered flow that has members
  // waiting. Re-publishing never backfills, so the box would be a lie.
  const showBackfill = !isPublished && segmentBackfill?.eligible && segmentBackfill.count > 0;
  const n = segmentBackfill?.count || 0;
  const hasErrors = Array.isArray(errors) && errors.length > 0;

  return (
    <div className="rt-modal-backdrop">
      <div className="rt-publish-modal">
        <h2 className="t-h1" style={{ margin: "0 0 8px" }}>
          {hasErrors
            ? "Fix these before publishing"
            : isPublished
              ? "Publish changes?"
              : "Publish flow?"}
        </h2>
        <p className="t-small muted" style={{ margin: "0 0 24px", lineHeight: 1.6 }}>
          {hasErrors
            ? "Your draft has been saved. These steps would not send as configured:"
            : isPublished
              ? "Your changes will go live. New enrollments will use the updated flow."
              : "This will make the flow active and start sending messages to customers."}
        </p>
        {hasErrors && (
          <ul
            style={{
              margin: "0 0 24px",
              padding: "12px 16px 12px 32px",
              background: "var(--danger-bg, #FBE9E7)",
              color: "var(--danger-ink, #8A2018)",
              border: "1px solid var(--danger-ink, #E0B4AE)",
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        )}
        {showBackfill && (
          <label
            className="t-small"
            style={{
              display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
              margin: "0 0 24px", padding: 12, borderRadius: 8,
              border: "1px solid var(--rt-border, #e3e3e3)",
            }}
          >
            <input
              type="checkbox"
              checked={backfill}
              onChange={(e) => setBackfill(e.target.checked)}
              disabled={loading}
              style={{ marginTop: 2 }}
            />
            <span>
              Also enroll the {n} {n === 1 ? "contact" : "contacts"} already in this segment
              <span className="muted" style={{ display: "block", marginTop: 4, lineHeight: 1.5 }}>
                Off by default — this flow triggers when someone <em>enters</em> the segment, so
                existing members are skipped. Ticking this sends to all {n} now.
              </span>
            </span>
          </label>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            {hasErrors ? "Close" : "Cancel"}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm({ backfillSegmentMembers: showBackfill && backfill })}
            disabled={loading}
          >
            <Icons.Play size={13} />{" "}
            {hasErrors ? "Try again" : isPublished ? "Publish changes" : "Publish flow"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatHours(h) {
  const n = Number(h) || 0;
  if (n === 0) return "immediately";
  if (n < 24) return `${n} ${n === 1 ? "hour" : "hours"}`;
  const days = n / 24;
  if (Number.isInteger(days)) return `${days} ${days === 1 ? "day" : "days"}`;
  return `${n} hours`;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
