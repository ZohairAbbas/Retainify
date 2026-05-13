import { useState, useMemo, useEffect } from "react";
import { useLoaderData, useFetcher, useNavigate, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { renderCartRescueEmail } from "../lib/email/templates.server.js";
import { saveDraft, publishJourney, pauseJourney, unpublishToDraft, archiveJourney } from "../lib/journey/journey-lifecycle.server.js";
import { getStepStats } from "../lib/journey/journey-analytics.server.js";

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

const TRIGGER_LABELS = {
  customer_created: "Subscribed to Marketing",
  cart_abandoned: "Cart Abandoned",
  order_placed: "Order Placed",
  win_back: "Inactive for 90 days",
};

const EXIT_CRITERIA_OPTIONS = [
  { value: "order_placed", label: "Contact places an order" },
  { value: "cart_recovered", label: "Cart is recovered" },
  { value: "unsubscribed", label: "Contact unsubscribes" },
];

const STATUS_TONE = {
  draft: { label: "Draft", bg: "#f1f8fd", color: "#005c8a" },
  published: { label: "Active", bg: "#e6f3ec", color: "#0c5132" },
  paused: { label: "Paused", bg: "#fdf4e6", color: "#b25d00" },
};

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

  if (!journey) {
    throw new Response("Not found", { status: 404 });
  }

  // Reconstruct canvas order from positionY (delay nodes get derived from cumulative offset diffs)
  // For V1, we expand stored steps into [email, delay, email, delay, email, exit] form
  // by computing gap-between-email-delays.
  const canvasNodes = expandCanvasNodes(journey.steps);

  // Per-step analytics (only for published, but render zero-state otherwise)
  const stats = {};
  for (const step of journey.steps) {
    if (step.nodeType === "email") {
      stats[step.id] = await getStepStats(step.id, 30);
    }
  }

  // Pre-render preview HTML per email step (we render based on stored values)
  const previews = {};
  for (const step of journey.steps) {
    if (step.nodeType !== "email") continue;
    previews[step.id] = buildPreview({
      style: step.templateStyle || "classic",
      stepNumber: step.stepNumber,
      settings,
      subject: step.subject,
    });
  }

  return {
    journey: {
      ...journey,
      exitCriteria: safeJson(journey.exitCriteria, []),
    },
    canvasNodes,
    settings: settings ?? {},
    stats,
    previews,
  };
};

function safeJson(s, fb) {
  try { return JSON.parse(s); } catch { return fb; }
}

/**
 * Convert stored JourneyStep[] (delay rows already in DB) into a canvas-ordered array:
 *   [{ kind: "trigger" }, { kind: "email", ... }, { kind: "delay", hours }, ..., { kind: "exit" }]
 *
 * Stored shape is already linear in positionY order — we just map nodeType to kind.
 */
function expandCanvasNodes(steps) {
  const nodes = [{ kind: "trigger", id: "trigger" }];
  for (const s of steps) {
    if (s.nodeType === "delay") {
      nodes.push({ kind: "delay", id: s.id, hours: s.delayHours });
    } else if (s.nodeType === "exit") {
      nodes.push({ kind: "exit", id: s.id });
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
      });
    }
  }
  // Ensure exit node exists at the end
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

    // nodes are in canvas order: trigger, email/delay..., exit.
    // Drop trigger; persist email/delay/exit.
    const stepsForSave = nodes
      .filter((n) => n.kind !== "trigger")
      .map((n) => {
        if (n.kind === "delay") {
          return { nodeType: "delay", delayHours: Number(n.hours) || 0 };
        }
        if (n.kind === "exit") {
          return { nodeType: "exit" };
        }
        return {
          nodeType: "email",
          subject: n.subject || "",
          previewText: n.previewText || "",
          emailName: n.emailName || "",
          templateStyle: n.templateStyle || "classic",
          discountPct: Number(n.discountPct) || 0,
          isEnabled: n.isEnabled !== false,
        };
      });

    await saveDraft(id, { name, entryFrequency, exitCriteria, steps: stepsForSave });
    return { ok: true, saved: true };
  }

  if (intent === "publish") {
    await publishJourney(id);
    return { ok: true, published: true };
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
  const { journey, canvasNodes: initialNodes, settings, stats, previews } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();

  const [nodes, setNodes] = useState(initialNodes);
  const [name, setName] = useState(journey.name);
  const [entryFrequency, setEntryFrequency] = useState(journey.entryFrequency || "no_reentry");
  const [exitCriteria, setExitCriteria] = useState(journey.exitCriteria || []);
  const [selectedId, setSelectedId] = useState("trigger");
  const [showAnalytics, setShowAnalytics] = useState(journey.status === "published");
  const [showPreview, setShowPreview] = useState(true);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(null); // insertAfterIndex

  const isDirty = useMemo(() => {
    return (
      name !== journey.name ||
      entryFrequency !== (journey.entryFrequency || "no_reentry") ||
      JSON.stringify(exitCriteria) !== JSON.stringify(journey.exitCriteria || []) ||
      JSON.stringify(nodes) !== JSON.stringify(initialNodes)
    );
  }, [name, entryFrequency, exitCriteria, nodes, journey, initialNodes]);

  const selected = nodes.find((n) => n.id === selectedId);

  useEffect(() => {
    if (fetcher.data?.published) {
      setShowPublishModal(false);
    }
  }, [fetcher.data]);

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
      const orig = arr[idx];
      const copy = { ...orig, id: `tmp-${Date.now()}` };
      const next = [...arr];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }

  function insertNode(afterIndex, kind) {
    const newNode = kind === "delay"
      ? { kind: "delay", id: `tmp-${Date.now()}`, hours: 24 }
      : {
          kind: "email",
          id: `tmp-${Date.now()}`,
          stepNumber: 0,
          emailName: "New email",
          subject: "Subject",
          previewText: "",
          templateStyle: "classic",
          discountPct: 0,
          isEnabled: true,
        };
    setNodes((arr) => {
      const next = [...arr];
      next.splice(afterIndex + 1, 0, newNode);
      return next;
    });
    setShowAddMenu(null);
    setSelectedId(newNode.id);
  }

  function saveDraftAction() {
    const fd = new FormData();
    fd.set("intent", "save-draft");
    fd.set("name", name);
    fd.set("entryFrequency", entryFrequency);
    fd.set("exitCriteria", JSON.stringify(exitCriteria));
    fd.set("nodes", JSON.stringify(nodes));
    fetcher.submit(fd, { method: "post" });
  }

  function publishAction() {
    // Save first if dirty, then publish
    if (isDirty) {
      saveDraftAction();
      setTimeout(() => {
        const fd = new FormData();
        fd.set("intent", "publish");
        fetcher.submit(fd, { method: "post" });
      }, 100);
    } else {
      const fd = new FormData();
      fd.set("intent", "publish");
      fetcher.submit(fd, { method: "post" });
    }
  }

  function pauseAction() {
    const fd = new FormData();
    fd.set("intent", "pause");
    fetcher.submit(fd, { method: "post" });
  }

  const tone = STATUS_TONE[journey.status] || STATUS_TONE.draft;
  const isPublished = journey.status === "published";
  const saving = fetcher.state !== "idle";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f6f6f7" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px", background: "#fff", borderBottom: "1px solid #e1e3e5",
        gap: 16, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => navigate(`/app/flows${location.search}`)}
            style={{ background: "none", border: "none", padding: 6, cursor: "pointer", fontSize: 16, color: "#6d7175" }}
            aria-label="Back"
          >←</button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              fontSize: 16, fontWeight: 600, border: "none", background: "transparent",
              padding: "4px 6px", color: "#202223", outline: "none", minWidth: 120, maxWidth: 320,
            }}
          />
          <span style={{
            display: "inline-block", padding: "2px 8px", borderRadius: 12,
            background: tone.bg, color: tone.color, fontSize: 12, fontWeight: 500,
          }}>{tone.label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <s-button onClick={() => navigate(`/app/automations/${journey.id}${location.search}`)}>
            Open simple editor
          </s-button>
          {isPublished && (
            <s-button onClick={pauseAction} disabled={saving}>
              Pause
            </s-button>
          )}
          <s-button onClick={saveDraftAction} disabled={!isDirty || saving}>
            {fetcher.data?.saved && !isDirty ? "Saved" : "Save draft"}
          </s-button>
          <s-button variant="primary" onClick={() => setShowPublishModal(true)} disabled={saving}>
            {isPublished ? "Publish changes" : "Publish flow"}
          </s-button>
        </div>
      </div>

      {/* Body: left rail / canvas / right inspector */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{
          width: 200, padding: 16, borderRight: "1px solid #e1e3e5",
          background: "#fff", flexShrink: 0,
        }}>
          <SideToggle
            label={showPreview ? "Hide preview" : "Show preview"}
            checked={showPreview}
            onChange={() => setShowPreview((v) => !v)}
          />
          {isPublished && (
            <SideToggle
              label={showAnalytics ? "Hide analytics" : "Show analytics"}
              checked={showAnalytics}
              onChange={() => setShowAnalytics((v) => !v)}
            />
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "40px 24px 80px" }}>
          <Canvas
            nodes={nodes}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDuplicate={duplicateNode}
            onDelete={deleteNode}
            stats={stats}
            previews={previews}
            showPreview={showPreview}
            showAnalytics={showAnalytics}
            showAddMenu={showAddMenu}
            setShowAddMenu={setShowAddMenu}
            insertNode={insertNode}
          />
        </div>

        <div style={{
          width: 360, background: "#fff", borderLeft: "1px solid #e1e3e5",
          overflowY: "auto", flexShrink: 0,
        }}>
          {selected?.kind === "trigger" ? (
            <TriggerInspector
              trigger={journey.trigger}
              entryFrequency={entryFrequency}
              setEntryFrequency={setEntryFrequency}
              exitCriteria={exitCriteria}
              setExitCriteria={setExitCriteria}
            />
          ) : selected?.kind === "email" ? (
            <EmailInspector
              node={selected}
              settings={settings}
              onChange={(patch) => updateNode(selected.id, patch)}
            />
          ) : selected?.kind === "delay" ? (
            <DelayInspector
              node={selected}
              onChange={(patch) => updateNode(selected.id, patch)}
            />
          ) : selected?.kind === "exit" ? (
            <div style={{ padding: 20, color: "#6d7175", fontSize: 13 }}>
              The contact exits the flow here. This step is automatic.
            </div>
          ) : (
            <div style={{ padding: 20, color: "#6d7175", fontSize: 13 }}>
              Select a node to edit its details.
            </div>
          )}
        </div>
      </div>

      {showPublishModal && (
        <PublishModal
          isPublished={isPublished}
          onCancel={() => setShowPublishModal(false)}
          onConfirm={publishAction}
          loading={saving}
        />
      )}
    </div>
  );
}

function SideToggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "8px 10px", marginBottom: 8, background: "#f6f6f7",
        border: "1px solid #e1e3e5", borderRadius: 6,
        cursor: "pointer", fontSize: 13, color: "#202223", textAlign: "left",
      }}
    >
      <span style={{ width: 14, textAlign: "center" }}>{checked ? "👁" : "👁"}</span>
      {label}
    </button>
  );
}

function Canvas({ nodes, selectedId, onSelect, onDuplicate, onDelete, stats, previews, showPreview, showAnalytics, showAddMenu, setShowAddMenu, insertNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
      {nodes.map((node, idx) => (
        <div key={node.id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <NodeCard
            node={node}
            selected={node.id === selectedId}
            onSelect={() => onSelect(node.id)}
            onDuplicate={() => onDuplicate(node.id)}
            onDelete={() => onDelete(node.id)}
            stats={stats?.[node.id]}
            previewHtml={previews?.[node.id]}
            showPreview={showPreview}
            showAnalytics={showAnalytics}
          />
          {/* Connector + insert button (skip after last "exit" node) */}
          {node.kind !== "exit" && (
            <div style={{ position: "relative", height: 50, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ width: 1, background: "#c9cccf", flex: 1 }} />
              <button
                type="button"
                onClick={() => setShowAddMenu(idx)}
                style={{
                  position: "absolute", top: "50%", left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 24, height: 24, borderRadius: 6,
                  background: "#fff", border: "1px solid #c9cccf",
                  cursor: "pointer", color: "#6d7175",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
                aria-label="Insert node"
              >+</button>
              {showAddMenu === idx && (
                <AddNodeMenu
                  onPick={(kind) => insertNode(idx, kind)}
                  onClose={() => setShowAddMenu(null)}
                />
              )}
              <div style={{ width: 1, background: "#c9cccf", flex: 1 }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function NodeCard({ node, selected, onSelect, onDuplicate, onDelete, stats, previewHtml, showPreview, showAnalytics }) {
  const baseStyle = {
    width: 320, background: "#fff", border: `1px solid ${selected ? "#0c5132" : "#e1e3e5"}`,
    borderRadius: 10, padding: 14, cursor: "pointer",
    boxShadow: selected ? "0 0 0 2px rgba(12,81,50,0.15)" : "0 1px 3px rgba(0,0,0,.04)",
    position: "relative",
  };

  if (node.kind === "trigger") {
    return (
      <div style={baseStyle} onClick={onSelect}>
        <CardHeader icon="↪" label="Trigger" />
        <div style={{ fontSize: 12, color: "#6d7175", marginTop: 8 }}>Enter flow when:</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#202223", marginTop: 2 }}>
          {/* trigger label shown via inspector; here keep it generic */}
          Configured trigger
        </div>
      </div>
    );
  }

  if (node.kind === "delay") {
    return (
      <div style={baseStyle} onClick={onSelect}>
        <CardHeader icon="⏱" label="Time Delay" actions onDuplicate={onDuplicate} onDelete={onDelete} />
        <div style={{ fontSize: 14, fontWeight: 600, color: "#202223", marginTop: 8 }}>
          Wait {formatHours(node.hours)}
        </div>
      </div>
    );
  }

  if (node.kind === "exit") {
    return (
      <div style={baseStyle} onClick={onSelect}>
        <CardHeader icon="⇥" label="Exit Flow" />
        <div style={{ fontSize: 12, color: "#6d7175", marginTop: 4 }}>The contact exits the flow.</div>
      </div>
    );
  }

  // Email
  return (
    <div style={baseStyle} onClick={onSelect}>
      <CardHeader icon="✉" label={node.emailName || `Email`} actions onDuplicate={onDuplicate} onDelete={onDelete} />
      <div style={{ fontSize: 12, color: "#6d7175", marginTop: 4 }}>
        Subject: <span style={{ color: "#202223" }}>{node.subject || "(no subject)"}</span>
      </div>
      {node.discountPct > 0 && (
        <div style={{ marginTop: 6 }}>
          <span style={{
            display: "inline-block", padding: "2px 8px", borderRadius: 10,
            background: "#fdf4e6", color: "#b25d00", fontSize: 11, fontWeight: 500,
          }}>{node.discountPct}% discount</span>
        </div>
      )}

      {showPreview && previewHtml && (
        <div style={{
          marginTop: 10, border: "1px solid #e1e3e5", borderRadius: 6,
          overflow: "hidden", background: "#f4f4f4",
        }}>
          <iframe
            srcDoc={previewHtml}
            title="Email preview"
            sandbox=""
            style={{ width: "100%", height: 200, border: "none", display: "block" }}
          />
        </div>
      )}

      {showAnalytics && stats && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: "1px solid #f1f2f3",
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px",
          fontSize: 12,
        }}>
          <Stat label="Delivered" value={stats.delivered} />
          <Stat label="Open Rate" value={`${stats.openRate}%`} />
          <Stat label="Click Rate" value={`${stats.clickRate}%`} />
          <Stat label="Completed" value={stats.completed} />
          <Stat label="Skipped" value={stats.skipped} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "#6d7175" }}>{label}</span>
      <span style={{ color: "#202223", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function CardHeader({ icon, label, actions, onDuplicate, onDelete }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 24, height: 24, borderRadius: 6, background: "#fdf4d8",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 13,
        }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#202223" }}>{label}</span>
      </div>
      {actions && (
        <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <IconButton title="Duplicate" onClick={onDuplicate}>⧉</IconButton>
          <IconButton title="Delete" onClick={onDelete} danger>🗑</IconButton>
        </div>
      )}
    </div>
  );
}

function IconButton({ children, onClick, title, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 22, height: 22, padding: 0, lineHeight: 1,
        background: "none", border: "none", cursor: "pointer",
        color: danger ? "#d72c0d" : "#6d7175", fontSize: 12,
      }}
    >{children}</button>
  );
}

function AddNodeMenu({ onPick, onClose }) {
  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 20,
          background: "transparent", border: "none", padding: 0, cursor: "default",
        }}
      />
      <div style={{
        position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
        zIndex: 21, marginTop: 6,
        background: "#fff", border: "1px solid #e1e3e5", borderRadius: 8,
        boxShadow: "0 6px 18px rgba(0,0,0,.08)", padding: 12, width: 260,
      }}>
        <MenuSection title="Actions">
          <MenuRow icon="✉" label="Add Email" onClick={() => onPick("email")} />
          <MenuRow icon="💬" label="Add SMS" disabled />
          <MenuRow icon="🏷" label="Tag Contact" disabled />
        </MenuSection>
        <MenuSection title="Timing">
          <MenuRow icon="⏱" label="Add Delay" onClick={() => onPick("delay")} />
        </MenuSection>
        <MenuSection title="Split">
          <MenuRow icon="↔" label="Split Flow" disabled />
        </MenuSection>
      </div>
    </>
  );
}

function MenuSection({ title, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "#6d7175", fontWeight: 500, marginBottom: 4, paddingLeft: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function MenuRow({ icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "8px 10px", background: "none", border: "none",
        cursor: disabled ? "not-allowed" : "pointer", borderRadius: 6,
        textAlign: "left", color: disabled ? "#a7acb1" : "#202223", fontSize: 13,
      }}
    >
      <span style={{
        width: 24, height: 24, borderRadius: 5, background: disabled ? "#f6f6f7" : "#fdf4d8",
        display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13,
      }}>{icon}</span>
      {label}{disabled && <span style={{ marginLeft: "auto", fontSize: 11, color: "#6d7175" }}>Soon</span>}
    </button>
  );
}

function TriggerInspector({ trigger, entryFrequency, setEntryFrequency, exitCriteria, setExitCriteria }) {
  function toggleCriterion(value) {
    setExitCriteria((arr) => (arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]));
  }

  const isDelayed = entryFrequency.startsWith("delayed_");
  const delayedHours = isDelayed ? Number(entryFrequency.slice("delayed_".length)) : 168;

  return (
    <div style={{ padding: 20 }}>
      <SectionTitle>Trigger</SectionTitle>
      <Field label="Type">
        <div style={readonlyValue}>{TRIGGER_LABELS[trigger] || trigger}</div>
      </Field>

      <Field label="Flow filters" hint="Coming soon">
        <div style={{ ...readonlyValue, color: "#a7acb1" }}>
          Only enter when criteria are met
        </div>
      </Field>

      <SectionTitle>Entry frequency</SectionTitle>
      <Radio
        label="Immediate re-entry"
        sub="Contacts can re-enter without delay."
        checked={entryFrequency === "immediate"}
        onChange={() => setEntryFrequency("immediate")}
      />
      <Radio
        label="Delayed re-entry"
        sub="Contacts can re-enter after a waiting period."
        checked={isDelayed}
        onChange={() => setEntryFrequency(`delayed_${delayedHours}`)}
      />
      {isDelayed && (
        <div style={{ marginLeft: 28, marginBottom: 12 }}>
          <input
            type="number"
            min="1"
            value={delayedHours}
            onChange={(e) => setEntryFrequency(`delayed_${Math.max(1, Number(e.target.value) || 1)}`)}
            style={textInput}
          />
          <span style={{ color: "#6d7175", fontSize: 12, marginLeft: 6 }}>hours</span>
        </div>
      )}
      <Radio
        label="No re-entry"
        sub="Contacts can never re-enter."
        checked={entryFrequency === "no_reentry"}
        onChange={() => setEntryFrequency("no_reentry")}
      />

      <SectionTitle>Exit criteria</SectionTitle>
      <div style={{ fontSize: 12, color: "#6d7175", marginBottom: 8 }}>
        Remove a contact from the flow when any of the following occur.
      </div>
      {EXIT_CRITERIA_OPTIONS.map((opt) => (
        <Checkbox
          key={opt.value}
          label={opt.label}
          checked={exitCriteria.includes(opt.value)}
          onChange={() => toggleCriterion(opt.value)}
        />
      ))}
    </div>
  );
}

function EmailInspector({ node, settings, onChange }) {
  return (
    <div style={{ padding: 20 }}>
      <SectionTitle>Email details</SectionTitle>
      <Field label="Email name" hint="Internal — not shown to contacts">
        <input
          value={node.emailName || ""}
          onChange={(e) => onChange({ emailName: e.target.value })}
          style={textInput}
        />
      </Field>
      <Field label="Subject">
        <input
          value={node.subject || ""}
          onChange={(e) => onChange({ subject: e.target.value })}
          style={textInput}
        />
      </Field>
      <Field label="Preview text">
        <input
          value={node.previewText || ""}
          onChange={(e) => onChange({ previewText: e.target.value })}
          style={textInput}
        />
      </Field>
      <Field label="Template style">
        <select
          value={node.templateStyle || "classic"}
          onChange={(e) => onChange({ templateStyle: e.target.value })}
          style={textInput}
        >
          <option value="classic">Classic</option>
          <option value="bold">Bold</option>
          <option value="minimal">Minimal</option>
        </select>
      </Field>
      <Field label="Discount %" hint="0 = no discount code">
        <input
          type="number"
          min="0"
          max="50"
          value={node.discountPct || 0}
          onChange={(e) => onChange({ discountPct: Number(e.target.value) || 0 })}
          style={textInput}
        />
      </Field>
      <Checkbox
        label="Step enabled"
        checked={node.isEnabled !== false}
        onChange={() => onChange({ isEnabled: node.isEnabled === false })}
      />

      <SectionTitle>Sender</SectionTitle>
      <div style={{ fontSize: 12, color: "#6d7175" }}>
        From: {settings?.senderName || "Your Store"} &lt;{settings?.senderEmail || "noreply@..."}&gt;
      </div>
      <div style={{ fontSize: 12, color: "#005c8a", marginTop: 4 }}>
        <a href="/app/settings" style={{ color: "inherit" }}>Edit sender details →</a>
      </div>
    </div>
  );
}

function DelayInspector({ node, onChange }) {
  const totalHours = Number(node.hours) || 0;
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours - days * 24;
  const [unit, setUnit] = useState(days > 0 && remHours === 0 ? "days" : "hours");

  function setValue(num) {
    const n = Math.max(0, Number(num) || 0);
    onChange({ hours: unit === "days" ? n * 24 : n });
  }

  const displayValue = unit === "days" ? totalHours / 24 : totalHours;

  return (
    <div style={{ padding: 20 }}>
      <SectionTitle>Time delay</SectionTitle>
      <Field label="Wait">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="number"
            min="0"
            value={displayValue}
            onChange={(e) => setValue(e.target.value)}
            style={{ ...textInput, flex: 1 }}
          />
          <select value={unit} onChange={(e) => setUnit(e.target.value)} style={{ ...textInput, width: 100 }}>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
      </Field>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 600, color: "#6d7175",
      textTransform: "uppercase", letterSpacing: 0.4,
      marginTop: 20, marginBottom: 12, paddingBottom: 4,
      borderBottom: "1px solid #f1f2f3",
    }}>{children}</div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: "#202223", marginBottom: 4 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: "#6d7175", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const textInput = {
  width: "100%", padding: "7px 10px",
  border: "1px solid #c9cccf", borderRadius: 6,
  fontSize: 13, color: "#202223", outline: "none",
  background: "#fff", boxSizing: "border-box",
};

const readonlyValue = {
  padding: "7px 10px", border: "1px solid #e1e3e5", borderRadius: 6,
  background: "#f6f6f7", color: "#202223", fontSize: 13,
};

function Radio({ label, sub, checked, onChange }) {
  return (
    <label style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      marginBottom: 10, cursor: "pointer",
    }}>
      <input type="radio" checked={checked} onChange={onChange} style={{ marginTop: 3 }} />
      <span style={{ fontSize: 13, color: "#202223" }}>
        <div style={{ fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ color: "#6d7175", fontSize: 12, marginTop: 2 }}>{sub}</div>}
      </span>
    </label>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer", fontSize: 13, color: "#202223" }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function PublishModal({ isPublished, onCancel, onConfirm, loading }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 480, padding: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: "#202223", marginBottom: 8 }}>
          {isPublished ? "Publish changes?" : "Publish flow?"}
        </div>
        <div style={{ fontSize: 14, color: "#6d7175", marginBottom: 24, lineHeight: 1.5 }}>
          {isPublished
            ? "Your changes will go live. New enrollments will use the updated flow."
            : "This will make the flow active and start sending messages to customers."}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <s-button onClick={onCancel} disabled={loading}>Cancel</s-button>
          <s-button variant="primary" onClick={onConfirm} disabled={loading}>
            {isPublished ? "Publish changes" : "Publish flow"}
          </s-button>
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
