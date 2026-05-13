import { useState } from "react";
import { useLoaderData, useNavigate, useLocation, useFetcher, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import {
  seedJourneyTemplates,
  getJourneyTemplates,
  createJourneyFromTemplate,
  createBlankJourney,
} from "../lib/journey/journey-templates.server.js";

const TRIGGER_LABELS = {
  customer_created: "Subscribed to Marketing",
  cart_abandoned: "Cart Abandoned",
  order_placed: "Order Placed",
  win_back: "Inactive for 90 days",
};

const STATUS_TONE = {
  draft: { label: "Draft", bg: "#f1f8fd", color: "#005c8a" },
  published: { label: "Active", bg: "#e6f3ec", color: "#0c5132" },
  paused: { label: "Paused", bg: "#fdf4e6", color: "#b25d00" },
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Make sure templates table is populated for the gallery
  await seedJourneyTemplates().catch(() => {});

  const [journeys, templates] = await Promise.all([
    prisma.journey.findMany({
      where: { shop, archivedAt: null },
      include: {
        steps: { orderBy: { stepNumber: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    getJourneyTemplates(),
  ]);

  // Aggregate per-journey stats for the table (last 30d)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const stats = await Promise.all(
    journeys.map(async (j) => {
      const [delivered, opened, clicked] = await Promise.all([
        prisma.journeyJob.count({ where: { step: { journeyId: j.id }, sentAt: { gte: since, not: null } } }),
        prisma.journeyJob.count({ where: { step: { journeyId: j.id }, openedAt: { gte: since, not: null } } }),
        prisma.journeyJob.count({ where: { step: { journeyId: j.id }, clickedAt: { gte: since, not: null } } }),
      ]);
      return { id: j.id, delivered, opened, clicked };
    }),
  );
  const statsById = Object.fromEntries(stats.map((s) => [s.id, s]));

  return {
    journeys: journeys.map((j) => ({
      ...j,
      emailStepCount: j.steps.filter((s) => s.nodeType === "email").length,
      stats: statsById[j.id] || { delivered: 0, opened: 0, clicked: 0 },
    })),
    templates,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent === "create-from-template") {
    const key = String(fd.get("templateKey") || "");
    if (!key) return { ok: false, error: "Missing template key" };
    const journey = await createJourneyFromTemplate(shop, key);
    const url = new URL(request.url);
    return redirect(`/app/flows/${journey.id}${url.search}`);
  }

  if (intent === "create-blank") {
    const trigger = String(fd.get("trigger") || "customer_created");
    const journey = await createBlankJourney(shop, { trigger });
    const url = new URL(request.url);
    return redirect(`/app/flows/${journey.id}${url.search}`);
  }

  if (intent === "archive") {
    const id = String(fd.get("journeyId") || "");
    await prisma.journey.updateMany({
      where: { id, shop },
      data: { archivedAt: new Date(), status: "paused", isActive: false },
    });
    return { ok: true };
  }

  if (intent === "duplicate") {
    const id = String(fd.get("journeyId") || "");
    const src = await prisma.journey.findFirst({
      where: { id, shop },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    });
    if (!src) return { ok: false };
    const copy = await prisma.journey.create({
      data: {
        shop,
        name: `${src.name} (copy)`,
        trigger: src.trigger,
        status: "draft",
        isActive: false,
        source: "flows",
        entryFrequency: src.entryFrequency,
        exitCriteria: src.exitCriteria,
      },
    });
    if (src.steps.length) {
      await prisma.journeyStep.createMany({
        data: src.steps.map((s) => ({
          journeyId: copy.id,
          stepNumber: s.stepNumber,
          positionY: s.positionY,
          nodeType: s.nodeType,
          delayHours: s.delayHours,
          subject: s.subject,
          previewText: s.previewText,
          emailName: s.emailName,
          templateStyle: s.templateStyle,
          discountPct: s.discountPct,
          isEnabled: s.isEnabled,
        })),
      });
    }
    return { ok: true };
  }

  return { ok: false };
};

export default function Flows() {
  const { journeys, templates } = useLoaderData();
  const navigate = useNavigate();
  const location = useLocation();
  const fetcher = useFetcher();
  const [showModal, setShowModal] = useState(false);

  return (
    <s-page heading="Flows">
      <div slot="primary-action">
        <s-button variant="primary" onClick={() => setShowModal(true)}>
          Create Flow
        </s-button>
      </div>

      {journeys.length === 0 ? (
        <EmptyState onCreate={() => setShowModal(true)} />
      ) : (
        <s-section>
          <FlowsTable
            journeys={journeys}
            onOpen={(id) => navigate(`/app/flows/${id}${location.search}`)}
            onDuplicate={(id) => fetcher.submit({ intent: "duplicate", journeyId: id }, { method: "post" })}
            onArchive={(id) => fetcher.submit({ intent: "archive", journeyId: id }, { method: "post" })}
          />
        </s-section>
      )}

      {showModal && (
        <CreateFlowModal
          templates={templates}
          onClose={() => setShowModal(false)}
        />
      )}
    </s-page>
  );
}

function EmptyState({ onCreate }) {
  return (
    <s-section>
      <div style={{ padding: "80px 24px", textAlign: "center" }}>
        <div style={{
          width: 56, height: 56, borderRadius: 12,
          background: "#f6f6f7", margin: "0 auto 20px",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 26,
        }}>⇆</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: "#202223", marginBottom: 8 }}>
          Build your first flow
        </div>
        <div style={{ fontSize: 14, color: "#6d7175", maxWidth: 520, margin: "0 auto 24px", lineHeight: 1.5 }}>
          Create automated email sequences that welcome new subscribers, recover abandoned carts, follow up on
          purchases, and win back lost customers. Deliver the right message at the right time.
        </div>
        <s-button variant="primary" onClick={onCreate}>
          Create Flow
        </s-button>
      </div>
    </s-section>
  );
}

function FlowsTable({ journeys, onOpen, onDuplicate, onArchive }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #e1e3e5", color: "#6d7175", textAlign: "left" }}>
            <th style={th}>Name</th>
            <th style={th}>Status</th>
            <th style={th}>Updated</th>
            <th style={thNum}>Delivered</th>
            <th style={thNum}>Opens</th>
            <th style={thNum}>Clicks</th>
            <th style={{ ...th, width: 60 }}></th>
          </tr>
        </thead>
        <tbody>
          {journeys.map((j) => {
            const tone = STATUS_TONE[j.status] || STATUS_TONE.draft;
            const openPct = j.stats.delivered ? (j.stats.opened / j.stats.delivered) * 100 : 0;
            const clickPct = j.stats.delivered ? (j.stats.clicked / j.stats.delivered) * 100 : 0;
            return (
              <tr key={j.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                <td style={td}>
                  <button
                    type="button"
                    onClick={() => onOpen(j.id)}
                    style={{
                      background: "none", border: "none", padding: 0,
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "#202223" }}>{j.name}</div>
                    <div style={{ color: "#6d7175", marginTop: 2, fontSize: 12 }}>
                      {TRIGGER_LABELS[j.trigger] || j.trigger} · {j.emailStepCount} {j.emailStepCount === 1 ? "email" : "emails"}
                    </div>
                  </button>
                </td>
                <td style={td}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px", borderRadius: 12,
                    background: tone.bg, color: tone.color, fontSize: 12, fontWeight: 500,
                  }}>{tone.label}</span>
                </td>
                <td style={{ ...td, color: "#6d7175" }}>
                  {new Date(j.updatedAt).toLocaleDateString()}
                </td>
                <td style={tdNum}>{j.stats.delivered}</td>
                <td style={tdNum}>{j.stats.delivered ? `${openPct.toFixed(1)}%` : "—"}</td>
                <td style={tdNum}>{j.stats.delivered ? `${clickPct.toFixed(1)}%` : "—"}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  <RowMenu
                    onEdit={() => onOpen(j.id)}
                    onDuplicate={() => onDuplicate(j.id)}
                    onArchive={() => onArchive(j.id)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const th = { padding: "12px 12px", fontWeight: 500, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 };
const thNum = { ...th, textAlign: "right" };
const td = { padding: "14px 12px", verticalAlign: "middle" };
const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

function RowMenu({ onEdit, onDuplicate, onArchive }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "none", border: "none", padding: "4px 8px",
          cursor: "pointer", color: "#6d7175", fontSize: 18, lineHeight: 1,
        }}
        aria-label="Row actions"
      >⋯</button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 10,
              background: "transparent", border: "none", padding: 0, cursor: "default",
            }}
          />
          <div style={{
            position: "absolute", right: 0, top: "100%", marginTop: 4,
            background: "#fff", border: "1px solid #e1e3e5", borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,.08)", minWidth: 140, zIndex: 11,
            overflow: "hidden",
          }}>
            <MenuItem label="Edit" onClick={() => { setOpen(false); onEdit(); }} />
            <MenuItem label="Duplicate" onClick={() => { setOpen(false); onDuplicate(); }} />
            <MenuItem label="Archive" danger onClick={() => { setOpen(false); onArchive(); }} />
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        padding: "8px 12px", background: "none", border: "none",
        cursor: "pointer", fontSize: 13,
        color: danger ? "#d72c0d" : "#202223",
      }}
    >{label}</button>
  );
}

function CreateFlowModal({ templates, onClose }) {
  const [typeFilter, setTypeFilter] = useState(""); // category key
  const [selectedKey, setSelectedKey] = useState(null);
  const fetcher = useFetcher();

  const filtered = typeFilter
    ? templates.filter((t) => t.category === typeFilter)
    : templates;

  const selected = templates.find((t) => t.key === selectedKey);

  const startFromScratch = () => {
    const form = new FormData();
    form.set("intent", "create-blank");
    form.set("trigger", "customer_created");
    fetcher.submit(form, { method: "post" });
  };

  const customizeTemplate = () => {
    if (!selected) return;
    const form = new FormData();
    form.set("intent", "create-from-template");
    form.set("templateKey", selected.key);
    fetcher.submit(form, { method: "post" });
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        background: "#fff", borderRadius: 12, width: "100%", maxWidth: 1100,
        maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{
          padding: "20px 24px", borderBottom: "1px solid #e1e3e5",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#202223" }}>
              Start with a pre-configured Flow
            </div>
            <div style={{ fontSize: 13, color: "#6d7175", marginTop: 2 }}>
              Be confident your contacts receive the right message at the right time. Every template is fully customizable.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <s-button onClick={startFromScratch} disabled={fetcher.state !== "idle"}>
              Start From Scratch
            </s-button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "none", border: "none", fontSize: 22,
                cursor: "pointer", color: "#6d7175", padding: "0 4px",
              }}
              aria-label="Close"
            >×</button>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{
            width: 200, borderRight: "1px solid #e1e3e5",
            padding: "16px 12px", overflowY: "auto", flexShrink: 0,
          }}>
            <div style={filterHeader}>TYPE</div>
            <FilterItem label="All" active={typeFilter === ""} onClick={() => setTypeFilter("")} />
            <FilterItem label="Welcome Series" active={typeFilter === "welcome"} onClick={() => setTypeFilter("welcome")} />
            <FilterItem label="Abandoned Cart" active={typeFilter === "cart"} onClick={() => setTypeFilter("cart")} />
            <FilterItem label="Post Purchase" active={typeFilter === "post_purchase"} onClick={() => setTypeFilter("post_purchase")} />
            <FilterItem label="Win-back" active={typeFilter === "winback"} onClick={() => setTypeFilter("winback")} />

            <div style={{ ...filterHeader, marginTop: 16 }}>CHANNEL</div>
            <FilterItem label="Email" active />
            <FilterItem label="SMS — Coming soon" disabled />
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 16,
            }}>
              {filtered.map((t) => {
                const stepCount = (t.definition.steps || []).filter((s) => s.nodeType === "email" || !s.nodeType).length;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setSelectedKey(t.key)}
                    style={{
                      textAlign: "left", background: "#fff",
                      border: `1px solid ${selectedKey === t.key ? "#0c5132" : "#e1e3e5"}`,
                      borderRadius: 8, padding: 16, cursor: "pointer",
                      boxShadow: selectedKey === t.key ? "0 0 0 2px rgba(12,81,50,0.15)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ fontWeight: 600, color: "#202223" }}>{t.name}</div>
                      <div style={{ color: "#6d7175", fontSize: 12 }}>{stepCount} ✉</div>
                    </div>
                    <div style={{ fontSize: 12, color: "#6d7175", lineHeight: 1.4 }}>
                      {t.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {selected && (
            <div style={{
              width: 320, borderLeft: "1px solid #e1e3e5",
              padding: 20, overflowY: "auto", flexShrink: 0,
              display: "flex", flexDirection: "column",
            }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#202223", marginBottom: 4 }}>
                {selected.name}
              </div>
              <div style={{ fontSize: 13, color: "#6d7175", marginBottom: 16, lineHeight: 1.5 }}>
                {selected.description}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6d7175", letterSpacing: 0.4, marginBottom: 8 }}>
                BEST FOR
              </div>
              <ul style={{ paddingLeft: 18, margin: 0, color: "#202223", fontSize: 13, lineHeight: 1.7 }}>
                {selected.bestFor.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
              <div style={{ flex: 1 }} />
              <div style={{ marginTop: 24 }}>
                <s-button variant="primary" onClick={customizeTemplate} disabled={fetcher.state !== "idle"}>
                  Customize Flow →
                </s-button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const filterHeader = {
  fontSize: 11, fontWeight: 600, color: "#6d7175",
  letterSpacing: 0.4, marginBottom: 6, paddingLeft: 8,
};

function FilterItem({ label, active, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "block", width: "100%", textAlign: "left",
        padding: "6px 8px", background: active ? "#f1f8fd" : "transparent",
        color: disabled ? "#a7acb1" : active ? "#005c8a" : "#202223",
        border: "none", borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer", fontSize: 13,
        fontWeight: active ? 500 : 400,
      }}
    >{label}</button>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
