import { useState, useMemo, useEffect, Fragment } from "react";
import { useLoaderData, useFetcher, useNavigate, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { saveDraft, publishJourney, pauseJourney, unpublishToDraft, archiveJourney } from "../lib/journey/journey-lifecycle.server.js";
import { getStepStats } from "../lib/journey/journey-analytics.server.js";
import Icons from "../components/ui/Icons.jsx";
import { TRIGGER_CONFIG, STATUS_PILL } from "../lib/triggerConfig.js";
import { listSegmentChoices } from "../lib/segments/segments.server.js";
import { evaluateSegment } from "../lib/segments/evaluator.server.js";
import { getSystemSegmentById, isSystemSegmentId } from "../lib/segments/systemSegments.server.js";
import TriggerPicker from "../components/flows/TriggerPicker.jsx";
import SoonPill from "../components/contacts/SoonPill.jsx";
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
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
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

  const stats = {};
  for (const step of journey.steps) {
    if (step.nodeType === "email") {
      stats[step.id] = await getStepStats(step.id, 30);
    }
  }

  // Segment trigger metadata: choices for the dropdown, plus a current-match
  // count when the flow already points at a segment. The count is the same
  // number the segment detail page shows.
  const segmentChoices = await listSegmentChoices(shop);
  let triggerSegmentCount = null;
  if (journey.trigger === "segment_entered" && journey.triggerSegmentKey) {
    const key = journey.triggerSegmentKey;
    let segment = null;
    if (isSystemSegmentId(key)) {
      segment = { ...getSystemSegmentById(key), shop };
    } else {
      segment = await prisma.segment.findFirst({
        where: { id: key, shop, deletedAt: null },
      });
    }
    if (segment) {
      try {
        const { count } = await evaluateSegment(shop, segment, { sampleSize: 0 });
        triggerSegmentCount = count;
      } catch (_e) {
        triggerSegmentCount = null;
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
    stats,
    segmentChoices,
    triggerSegmentCount,
    whatsappTemplates,
  };
};

function safeJson(s, fb) {
  try { return JSON.parse(s); } catch { return fb; }
}

function expandCanvasNodes(steps) {
  const nodes = [{ kind: "trigger", id: "trigger" }];
  for (const s of steps) {
    if (s.nodeType === "delay") {
      nodes.push({ kind: "delay", id: s.id, hours: s.delayHours });
    } else if (s.nodeType === "exit") {
      nodes.push({ kind: "exit", id: s.id });
    } else if (s.nodeType === "push") {
      nodes.push({
        kind: "push",
        id: s.id,
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
        stepNumber: s.stepNumber,
        emailName: s.emailName,
        subject: s.subject,
        previewText: s.previewText,
        templateStyle: s.templateStyle,
        discountPct: s.discountPct,
        isEnabled: s.isEnabled,
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
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { id } = params;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  const journey = await prisma.journey.findFirst({ where: { id, shop } });
  if (!journey) return { ok: false };

  if (intent === "save-draft") {
    const nodes = JSON.parse(String(fd.get("nodes") || "[]"));
    const name = String(fd.get("name") || journey.name);
    const entryFrequency = String(fd.get("entryFrequency") || journey.entryFrequency);
    const exitCriteria = JSON.parse(String(fd.get("exitCriteria") || "[]"));
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
        if (n.kind === "delay") {
          return { nodeType: "delay", delayHours: Number(n.hours) || 0 };
        }
        if (n.kind === "exit") {
          return { nodeType: "exit" };
        }
        if (n.kind === "push") {
          return {
            nodeType: "push",
            delayHours: Number(n.delayHours) || 0,
            isEnabled: n.isEnabled !== false,
            pushTitle: n.pushTitle || "",
            pushBody: n.pushBody || "",
            pushIconUrl: n.pushIconUrl || "",
            pushClickUrl: n.pushClickUrl || "",
          };
        }
        if (n.kind === "whatsapp") {
          return {
            nodeType: "whatsapp",
            delayHours: Number(n.delayHours) || 0,
            isEnabled: n.isEnabled !== false,
            waTemplateName: n.waTemplateName || "",
            waLanguage: n.waLanguage || "",
            waVariables: n.waVariables || {},
            waMediaUrl: n.waMediaUrl || "",
          };
        }
        return {
          nodeType: "email",
          subject: n.subject || "",
          previewText: n.previewText || "",
          emailName: n.emailName || "",
          templateStyle: n.templateStyle || "classic",
          discountPct: Number(n.discountPct) || 0,
          isEnabled: n.isEnabled !== false,
          emailBlocks: JSON.stringify(n.emailBlocks || []),
          emailBrand: JSON.stringify(n.emailBrand || {}),
        };
      });

    await saveDraft(id, { name, entryFrequency, exitCriteria, steps: stepsForSave, triggerSegmentKey, trigger });
    return { ok: true, saved: true };
  }

  if (intent === "publish") {
    const backfillSegmentMembers = fd.get("backfillSegmentMembers") === "1";
    const result = await publishJourney(id, { backfillSegmentMembers });
    return { ok: true, published: true, segmentBaseline: result?.segmentBaseline ?? null };
  }

  if (intent === "pause") {
    await pauseJourney(id);
    return { ok: true };
  }

  if (intent === "unpublish") {
    await unpublishToDraft(id);
    return { ok: true };
  }

  if (intent === "archive") {
    await archiveJourney(id);
    return { ok: true, archived: true };
  }

  return { ok: false };
};

export default function FlowBuilder() {
  const { journey, canvasNodes: initialNodes, settings, stats, segmentChoices = [], triggerSegmentCount, whatsappTemplates = [] } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();

  const [nodes, setNodes] = useState(initialNodes);
  const [name, setName] = useState(journey.name);
  const [entryFrequency, setEntryFrequency] = useState(journey.entryFrequency || "no_reentry");
  const [exitCriteria, setExitCriteria] = useState(journey.exitCriteria || []);
  const [triggerSegmentKey, setTriggerSegmentKey] = useState(journey.triggerSegmentKey || "");
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

  const isDirty = useMemo(() => {
    return (
      name !== journey.name ||
      entryFrequency !== (journey.entryFrequency || "no_reentry") ||
      JSON.stringify(exitCriteria) !== JSON.stringify(journey.exitCriteria || []) ||
      JSON.stringify(nodes) !== JSON.stringify(initialNodes) ||
      triggerDraft !== (journey.trigger || "customer_created") ||
      (triggerDraft === "segment_entered" && triggerSegmentKey !== (journey.triggerSegmentKey || ""))
    );
  }, [name, entryFrequency, exitCriteria, nodes, journey, initialNodes, triggerSegmentKey, triggerDraft]);

  const selected = nodes.find((n) => n.id === selectedId);

  useEffect(() => {
    if (fetcher.data?.published) {
      setShowPublishModal(false);
      setToast(publishToastMessage(fetcher.data.segmentBaseline));
    }
  }, [fetcher.data]);

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
      const copy = { ...arr[idx], id: `tmp-${Date.now()}` };
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

  function saveDraftAction() {
    const fd = new FormData();
    fd.set("intent", "save-draft");
    fd.set("name", name);
    fd.set("entryFrequency", entryFrequency);
    fd.set("exitCriteria", JSON.stringify(exitCriteria));
    fd.set("nodes", JSON.stringify(nodes));
    if (triggerDraft !== (journey.trigger || "customer_created")) {
      fd.set("trigger", triggerDraft);
    }
    if (triggerDraft === "segment_entered") {
      fd.set("triggerSegmentKey", triggerSegmentKey || "");
    }
    fetcher.submit(fd, { method: "post" });
  }

  function publishAction({ backfillSegmentMembers = false } = {}) {
    const build = () => {
      const fd = new FormData();
      fd.set("intent", "publish");
      if (backfillSegmentMembers) fd.set("backfillSegmentMembers", "1");
      return fd;
    };
    if (isDirty) {
      saveDraftAction();
      setTimeout(() => {
        fetcher.submit(build(), { method: "post" });
      }, 100);
    } else {
      fetcher.submit(build(), { method: "post" });
    }
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
          onBack={() => setEmailEditorNodeId(null)}
          onSave={(updatedNode) => {
            updateNode(updatedNode.id, {
              subject: updatedNode.subject,
              previewText: updatedNode.previewText,
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
            onClick={() => navigate(`/app/flows${location.search}`)}
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
                >
                  <Icons.Chart size={14} /> Analytics
                </button>
              )}
              <span className="rt-bt-divider" />
            </>
          )}
          {isPublished && (
            <button className="btn btn-secondary" onClick={pauseAction} disabled={saving}>
              <Icons.Pause size={13} /> Pause
            </button>
          )}
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
            triggerSegmentKey={triggerSegmentKey}
            setTriggerSegmentKey={setTriggerSegmentKey}
            triggerDraft={triggerDraft}
            setTriggerDraft={setTriggerDraft}
            segmentChoices={segmentChoices}
            triggerSegmentCount={triggerSegmentCount}
            settings={settings}
            whatsappTemplates={whatsappTemplates}
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

      <PublishToast toast={toast} onDismiss={() => setToast(null)} />

      {showPublishModal && (
        <PublishModal
          isPublished={isPublished}
          onCancel={() => setShowPublishModal(false)}
          onConfirm={publishAction}
          loading={saving}
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
            saveDraftAction();
            // Wait for the save to settle before navigating, otherwise
            // the unsaved-warning state desyncs with the persisted row.
            const dest = pendingLeavePath;
            setPendingLeavePath(null);
            setTimeout(() => navigate(dest), 120);
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
            {node.emailBlocks?.length ? (
              <RenderedBlockPreview node={node} />
            ) : (
              <EmailPreview node={node} />
            )}
          </div>
        )}
        {showAnalytics && stats && (
          <div className="rt-node-stats">
            <div>
              <div className="t-micro muted">Delivered</div>
              <div className="t-mono rt-stat-num">{stats.delivered ?? 0}</div>
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

function EmailPreview({ node }) {
  return (
    <div className="rt-email-preview">
      <div className="rt-email-logo">YOUR STORE</div>
      <div className="rt-email-hero" />
      <div className="rt-email-h">{node.subject || "Hello there"}</div>
      <div className="rt-email-body">
        Hi Alex, thanks for joining us. We hand-pick a few favourites each week — here's something we think you'll love.
      </div>
      <div className="rt-email-btn">Shop now</div>
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

function Inspector({ node, journey, entryFrequency, setEntryFrequency, exitCriteria, setExitCriteria, triggerSegmentKey, setTriggerSegmentKey, triggerDraft, setTriggerDraft, segmentChoices = [], triggerSegmentCount, settings, whatsappTemplates = [], onChange, onOpenEditor, confirmLeave }) {
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
          />
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted">
            Flow filters <SoonPill />
          </div>
          <div className="t-small muted" style={{ margin: "6px 0 12px" }}>
            Only enter when these conditions are met.
          </div>
          <button
            type="button"
            className="rt-add-filter"
            disabled
            title="Flow filters are coming soon"
          >
            <Icons.Plus size={13} /> Add filter
          </button>
        </div>

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
          <div className="field-help">
            {50 - (node.subject || "").length} characters remaining
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
          {settings?.senderName && (
            <div className="field-help" style={{ marginTop: 12 }}>
              From: {settings.senderName} &lt;{settings.senderEmail || "noreply@..."}&gt;
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

        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Timing</div>
          <DelayEditor node={{ hours: node.delayHours }} onChange={(p) => onChange({ delayHours: p.hours })} />
        </div>

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

      <div className="rt-ins-section">
        <div className="t-micro muted" style={{ marginBottom: 12 }}>Timing</div>
        <DelayEditor node={{ hours: node.delayHours }} onChange={(p) => onChange({ delayHours: p.hours })} />
      </div>

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
  const labelFor = (num) => {
    const ref = vars[String(num)];
    if (ref === "contactName") return "Alex";
    if (ref === "recoveryUrl") return "yourstore.com/cart";
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

function FormView({ nodes, journey, selectedId, onSelect, onChange }) {
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
              <div className={`rt-node-glyph rt-tint-${n.kind}`}>
                {n.kind === "email" && <Icons.Mail size={14} />}
                {n.kind === "delay" && <Icons.Clock size={14} />}
              </div>
              <div>
                <div className="t-micro muted">
                  Step {i + 1} · {n.kind === "email" ? "Email" : "Delay"}
                </div>
                <div className="t-h2">
                  {n.kind === "email"
                    ? n.emailName || "Email"
                    : `Wait ${formatHours(n.hours)}`}
                </div>
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
                <div>
                  <label className="field-label">Template</label>
                  <select
                    className="select"
                    value={n.templateStyle || "classic"}
                    onChange={(e) => onChange(n.id, { templateStyle: e.target.value })}
                  >
                    <option value="classic">Classic</option>
                    <option value="bold">Bold</option>
                    <option value="minimal">Minimal</option>
                  </select>
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
              <div className="rt-form-grid">
                <div>
                  <label className="field-label">Duration</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={n.hours || 0}
                    onChange={(e) => onChange(n.id, { hours: Number(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="field-label">Unit</label>
                  <select className="select" defaultValue="hours">
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </select>
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

function PublishModal({ isPublished, onCancel, onConfirm, loading, segmentBackfill }) {
  const [backfill, setBackfill] = useState(false);
  // Offered only on first publish of a segment-triggered flow that has members
  // waiting. Re-publishing never backfills, so the box would be a lie.
  const showBackfill = !isPublished && segmentBackfill?.eligible && segmentBackfill.count > 0;
  const n = segmentBackfill?.count || 0;

  return (
    <div className="rt-modal-backdrop">
      <div className="rt-publish-modal">
        <h2 className="t-h1" style={{ margin: "0 0 8px" }}>
          {isPublished ? "Publish changes?" : "Publish flow?"}
        </h2>
        <p className="t-small muted" style={{ margin: "0 0 24px", lineHeight: 1.6 }}>
          {isPublished
            ? "Your changes will go live. New enrollments will use the updated flow."
            : "This will make the flow active and start sending messages to customers."}
        </p>
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
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm({ backfillSegmentMembers: showBackfill && backfill })}
            disabled={loading}
          >
            <Icons.Play size={13} /> {isPublished ? "Publish changes" : "Publish flow"}
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
