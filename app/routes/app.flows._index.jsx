import { useState, useRef, Fragment } from "react";
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
import Icons from "../components/ui/Icons.jsx";
import { TRIGGER_CONFIG, STATUS_PILL, timeAgo } from "../lib/triggerConfig.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  await seedJourneyTemplates().catch(() => {});

  const [journeys, templates] = await Promise.all([
    prisma.journey.findMany({
      where: { shop, archivedAt: null },
      include: {
        steps: { where: { isArchived: false }, orderBy: { stepNumber: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    getJourneyTemplates(),
  ]);

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
      include: { steps: { where: { isArchived: false }, orderBy: { stepNumber: "asc" } } },
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

  if (journeys.length === 0) {
    return (
      <>
        <FlowsListEmpty onCreate={() => setShowModal(true)} />
        {showModal && (
          <CreateFlowModal
            templates={templates}
            onClose={() => setShowModal(false)}
            fetcher={fetcher}
          />
        )}
      </>
    );
  }

  return (
    <>
      <FlowsList
        journeys={journeys}
        onCreate={() => setShowModal(true)}
        onOpen={(id) => navigate(`/app/flows/${id}${location.search}`)}
        onDuplicate={(id) => fetcher.submit({ intent: "duplicate", journeyId: id }, { method: "post" })}
        onArchive={(id) => fetcher.submit({ intent: "archive", journeyId: id }, { method: "post" })}
      />
      {showModal && (
        <CreateFlowModal
          templates={templates}
          onClose={() => setShowModal(false)}
          fetcher={fetcher}
        />
      )}
    </>
  );
}

function FlowsListEmpty({ onCreate }) {
  return (
    <div className="rt-empty">
      <div className="rt-empty-art">
        <svg width="160" height="120" viewBox="0 0 160 120" fill="none">
          <rect x="20" y="20" width="50" height="34" rx="6" fill="#FDFBF5" stroke="#D2C9B0"/>
          <rect x="28" y="30" width="34" height="3" rx="1.5" fill="#D2C9B0"/>
          <rect x="28" y="38" width="22" height="3" rx="1.5" fill="#E4DDCB"/>
          <rect x="90" y="44" width="50" height="34" rx="6" fill="#FDFBF5" stroke="#D2C9B0"/>
          <rect x="98" y="54" width="34" height="3" rx="1.5" fill="#D2C9B0"/>
          <rect x="98" y="62" width="22" height="3" rx="1.5" fill="#E4DDCB"/>
          <rect x="20" y="70" width="50" height="34" rx="6" fill="#DCE7DF" stroke="#1F3D2F"/>
          <rect x="28" y="80" width="34" height="3" rx="1.5" fill="#1F3D2F"/>
          <rect x="28" y="88" width="22" height="3" rx="1.5" fill="#356A53"/>
          <path d="M70 37 L88 60" stroke="#1F3D2F" strokeWidth="1.2" strokeDasharray="3 3"/>
          <path d="M70 87 L88 64" stroke="#1F3D2F" strokeWidth="1.2" strokeDasharray="3 3"/>
        </svg>
      </div>
      <h2 className="t-display-2" style={{ margin: 0, color: "var(--ink-1)" }}>
        Your retention engine,{" "}
        <em style={{ fontFamily: "var(--font-display)", color: "var(--brand-700)" }}>starts here</em>.
      </h2>
      <p className="rt-empty-lede">
        Build the email sequences that follow your customers from first hello to long-term loyalty.
        Start from a tested template or compose your own.
      </p>
      <div className="rt-empty-actions">
        <button className="btn btn-primary btn-lg" onClick={onCreate}>
          <Icons.Plus size={14} /> Create a flow
        </button>
      </div>
      <div className="rt-empty-tips">
        <div className="rt-empty-tip">
          <Icons.Sparkles size={16} />
          <div><strong>Welcome Series</strong><br /><span className="muted">For new subscribers</span></div>
        </div>
        <div className="rt-empty-tip">
          <Icons.Cart size={16} />
          <div><strong>Abandoned Cart</strong><br /><span className="muted">Recover lost revenue</span></div>
        </div>
        <div className="rt-empty-tip">
          <Icons.Heart size={16} />
          <div><strong>Post-Purchase</strong><br /><span className="muted">Earn the second order</span></div>
        </div>
        <div className="rt-empty-tip">
          <Icons.Refresh size={16} />
          <div><strong>Win-back</strong><br /><span className="muted">Bring lapsed customers home</span></div>
        </div>
      </div>
    </div>
  );
}

function FlowsList({ journeys, onCreate, onOpen, onDuplicate, onArchive }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [openMenu, setOpenMenu] = useState(null);

  const totalDelivered = journeys.reduce((a, j) => a + j.stats.delivered, 0);

  const statusCounts = {
    all: journeys.length,
    active: journeys.filter((j) => j.status === "published").length,
    paused: journeys.filter((j) => j.status === "paused").length,
    draft: journeys.filter((j) => j.status === "draft").length,
  };

  const filtered = journeys
    .filter((j) => {
      if (filter === "all") return true;
      if (filter === "active") return j.status === "published";
      return j.status === filter;
    })
    .filter((j) => !query || j.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify · Automation</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Flows</h1>
          <p className="t-body muted" style={{ margin: "8px 0 0", maxWidth: 540 }}>
            Automated email sequences that follow your customers from first signal to repeat order.
          </p>
        </div>
        <div className="rt-page-actions">
          <button className="btn btn-primary" onClick={onCreate}>
            <Icons.Plus size={14} /> Create flow
          </button>
        </div>
      </header>

      <section className="rt-stats">
        <div className="rt-stat">
          <div className="t-micro muted">Live flows</div>
          <div className="rt-stat-value">{statusCounts.active}</div>
        </div>
        <div className="rt-stat">
          <div className="t-micro muted">Delivered · last 30 days</div>
          <div className="rt-stat-value">{totalDelivered.toLocaleString()}</div>
        </div>
        <div className="rt-stat">
          <div className="t-micro muted">Total flows</div>
          <div className="rt-stat-value">{journeys.length}</div>
        </div>
      </section>

      <div className="rt-toolbar">
        <div className="rt-chips">
          {[
            { key: "all", label: "All" },
            { key: "active", label: "Active" },
            { key: "paused", label: "Paused" },
            { key: "draft", label: "Draft" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rt-chip${filter === key ? " rt-chip-on" : ""}`}
            >
              <span>{label}</span>
              <span className="rt-chip-count">{statusCounts[key]}</span>
            </button>
          ))}
        </div>
        <div className="rt-search">
          <Icons.Search size={14} />
          <input
            placeholder="Search flows"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="rt-table">
        <div className="rt-thead">
          <div>Flow</div>
          <div>Status</div>
          <div>Updated</div>
          <div className="rt-tnum">Delivered</div>
          <div className="rt-tnum">Open rate</div>
          <div className="rt-tnum">Click rate</div>
          <div />
        </div>

        {filtered.map((j) => {
          const trig = TRIGGER_CONFIG[j.trigger] || TRIGGER_CONFIG.customer_created;
          const TrigIcon = Icons[trig.icon];
          const pillClass = STATUS_PILL[j.status] || "draft";
          const pillLabel = pillClass === "active" ? "Active" : pillClass.charAt(0).toUpperCase() + pillClass.slice(1);
          const openRate = j.stats.delivered
            ? ((j.stats.opened / j.stats.delivered) * 100).toFixed(1) + "%"
            : "—";
          const clickRate = j.stats.delivered
            ? ((j.stats.clicked / j.stats.delivered) * 100).toFixed(1) + "%"
            : "—";

          return (
            <div
              key={j.id}
              className="rt-trow"
              onClick={() => { setOpenMenu(null); onOpen(j.id); }}
              style={{ cursor: "pointer" }}
            >
              <div className="rt-tcell-name">
                <div className={`rt-trig-dot rt-tint-${trig.tint}`}>
                  {TrigIcon && <TrigIcon size={14} />}
                </div>
                <div>
                  <div className="rt-flow-name">{j.name}</div>
                  <div className="rt-flow-meta">
                    {trig.label} · {j.emailStepCount} {j.emailStepCount === 1 ? "email" : "emails"}
                  </div>
                </div>
              </div>
              <div><span className={`pill ${pillClass}`}>{pillLabel}</span></div>
              <div className="rt-tdate">{timeAgo(j.updatedAt)}</div>
              <div className="rt-tnum t-mono">{j.stats.delivered.toLocaleString()}</div>
              <div className="rt-tnum t-mono">{openRate}</div>
              <div className="rt-tnum t-mono">{clickRate}</div>
              <div className="rt-tactions" onClick={(e) => e.stopPropagation()}>
                <RowMenu
                  open={openMenu === j.id}
                  onToggle={() => setOpenMenu(openMenu === j.id ? null : j.id)}
                  onClose={() => setOpenMenu(null)}
                  onView={() => { setOpenMenu(null); onOpen(j.id); }}
                  onDuplicate={() => { setOpenMenu(null); onDuplicate(j.id); }}
                  onArchive={() => { setOpenMenu(null); onArchive(j.id); }}
                />
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="rt-empty-row">
            No flows match this filter.{" "}
            <button className="rt-link" onClick={() => { setFilter("all"); setQuery(""); }}>
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RowMenu({ open, onToggle, onClose, onView, onDuplicate, onArchive }) {
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);

  function handleToggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    onToggle();
  }

  return (
    <>
      <button
        ref={btnRef}
        className="btn btn-ghost btn-icon"
        onClick={handleToggle}
        aria-label="Row actions"
      >
        <Icons.More size={16} />
      </button>
      {open && pos && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            style={{
              position: "fixed", inset: 0, zIndex: 50,
              background: "transparent", border: "none", padding: 0, cursor: "default",
            }}
          />
          <div
            className="rt-menu"
            style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 51 }}
          >
            <button onClick={onView}>
              <Icons.Eye size={14} /> View
            </button>
            <button onClick={onDuplicate}>
              <Icons.Copy size={14} /> Duplicate
            </button>
            <button className="rt-menu-danger" onClick={onArchive}>
              <Icons.Trash size={14} /> Archive
            </button>
          </div>
        </>
      )}
    </>
  );
}

function FlowMiniMap({ template }) {
  const nodes = template.nodes || template.definition?.steps || [];
  return (
    <div className="rt-minimap">
      <div className="rt-minimap-node rt-mini-trigger">
        <Icons.Trigger size={10} />
        <span>Trigger</span>
      </div>
      <div className="rt-minimap-line" />
      {nodes.map((n, i) => {
        const type = n.type || n.nodeType;
        return (
          <Fragment key={n.id || i}>
            {type === "email" && (
              <div className="rt-minimap-node rt-mini-email">
                <Icons.Mail size={10} />
                <span className="rt-minimap-label">
                  Email {nodes.slice(0, i).filter((x) => (x.type || x.nodeType) === "email").length + 1}
                </span>
              </div>
            )}
            {type === "delay" && (
              <div className="rt-minimap-delay">
                <Icons.Clock size={9} />
                <span className="t-mono">{n.hours || n.delayHours || 0}h</span>
              </div>
            )}
            <div className="rt-minimap-line" />
          </Fragment>
        );
      })}
      <div className="rt-minimap-node rt-mini-exit">
        <Icons.Exit size={10} />
        <span>Exit</span>
      </div>
    </div>
  );
}

function CreateFlowModal({ templates, onClose, fetcher }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("email");
  const [selectedKey, setSelectedKey] = useState(templates[0]?.key || null);

  const typeOptions = ["all", "Welcome Series", "Abandoned Cart", "Post Purchase", "Win-back"];

  const filtered = templates.filter(
    (t) => typeFilter === "all" || t.category === typeFilter || t.type === typeFilter,
  );

  const selected = templates.find((t) => t.key === selectedKey) || templates[0];

  const startBlank = () => {
    fetcher.submit({ intent: "create-blank", trigger: "customer_created" }, { method: "post" });
  };

  const useTemplate = () => {
    if (!selected) return;
    fetcher.submit({ intent: "create-from-template", templateKey: selected.key }, { method: "post" });
  };

  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div className="rt-modal rt-create-modal" onClick={(e) => e.stopPropagation()}>
        <header className="rt-modal-head">
          <div>
            <div className="t-micro muted" style={{ marginBottom: 6 }}>New flow</div>
            <h2 className="t-display-2" style={{ margin: 0 }}>
              Start with a <em style={{ fontFamily: "var(--font-display)" }}>tested</em> sequence
            </h2>
            <p className="muted t-small" style={{ margin: "8px 0 0", maxWidth: 480 }}>
              Templates are fully editable. Pick the closest match and shape it from there.
            </p>
          </div>
          <div className="rt-modal-head-right">
            <button
              className="btn btn-secondary"
              onClick={startBlank}
              disabled={fetcher.state !== "idle"}
            >
              <Icons.Plus size={14} /> Start blank
            </button>
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <Icons.Close size={16} />
            </button>
          </div>
        </header>

        <div className="rt-modal-body">
          {/* Filters */}
          <aside className="rt-cm-filters">
            <div className="t-micro muted rt-cm-filter-heading">Type</div>
            <div className="rt-cm-radio-list">
              {typeOptions.map((t) => {
                const count =
                  t === "all"
                    ? templates.length
                    : templates.filter((x) => x.category === t || x.type === t).length;
                return (
                  <button
                    key={t}
                    className={`rt-cm-radio${typeFilter === t ? " rt-on" : ""}`}
                    onClick={() => setTypeFilter(t)}
                  >
                    <span className="rt-cm-radio-dot" />
                    <span>{t === "all" ? "All templates" : t}</span>
                    <span className="rt-cm-radio-count">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="t-micro muted rt-cm-filter-heading" style={{ marginTop: 28 }}>Channel</div>
            <div className="rt-cm-radio-list">
              <button
                className={`rt-cm-radio${channelFilter === "email" ? " rt-on" : ""}`}
                onClick={() => setChannelFilter("email")}
              >
                <span className="rt-cm-radio-dot" />
                <Icons.Mail size={14} />
                <span>Email</span>
                <span className="rt-cm-radio-count">{templates.length}</span>
              </button>
              <button className="rt-cm-radio rt-locked">
                <span className="rt-cm-radio-dot" />
                <Icons.Sms size={14} />
                <span>SMS</span>
                <span className="pill soon" style={{ height: 18, fontSize: 9, padding: "0 6px" }}>Soon</span>
              </button>
              <button className="rt-cm-radio rt-locked">
                <span className="rt-cm-radio-dot" />
                <Icons.Bell size={14} />
                <span>Push</span>
                <span className="pill soon" style={{ height: 18, fontSize: 9, padding: "0 6px" }}>Soon</span>
              </button>
            </div>

            <div className="rt-cm-foot">
              <div className="t-micro muted">Need something custom?</div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={startBlank}
                style={{ marginTop: 8 }}
                disabled={fetcher.state !== "idle"}
              >
                Start from a blank canvas →
              </button>
            </div>
          </aside>

          {/* Gallery */}
          <div className="rt-cm-gallery">
            {filtered.map((t) => {
              const trig = TRIGGER_CONFIG[t.trigger] || TRIGGER_CONFIG.customer_created;
              const TrigIcon = Icons[trig.icon];
              const nodes = t.nodes || t.definition?.steps || [];
              const emailCount = nodes.filter((n) => (n.type || n.nodeType) === "email").length;
              return (
                <button
                  key={t.key}
                  className={`rt-tmpl-card${selectedKey === t.key ? " rt-on" : ""}`}
                  onClick={() => setSelectedKey(t.key)}
                >
                  <div className="rt-tmpl-top">
                    <span className={`rt-tmpl-trig rt-tint-${trig.tint}`}>
                      {TrigIcon && <TrigIcon size={12} />}
                      <span>{trig.label}</span>
                    </span>
                    <span className="rt-tmpl-emails t-mono">{emailCount} ✉</span>
                  </div>
                  <h3 className="rt-tmpl-name">{t.name}</h3>
                  <p className="rt-tmpl-desc">{t.description}</p>
                  <div className="rt-tmpl-seq">
                    {nodes.slice(0, 5).map((n, i) => {
                      const type = n.type || n.nodeType;
                      return (
                        <span
                          key={n.id || i}
                          className={`rt-seq-dot rt-seq-${type}`}
                          title={type}
                        >
                          {type === "email" ? "✉" : type === "delay" ? "·" : "○"}
                        </span>
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail */}
          {selected && (
            <aside className="rt-cm-detail">
              <div className="rt-cm-detail-illustration">
                <FlowMiniMap template={selected} />
              </div>
              <div className="rt-cm-detail-body">
                <div className="t-micro muted" style={{ marginBottom: 6 }}>
                  {selected.category || selected.type || "Template"}
                </div>
                <h3 className="t-h1" style={{ margin: "0 0 8px" }}>{selected.name}</h3>
                <p className="t-small muted" style={{ margin: "0 0 20px", lineHeight: 1.6 }}>
                  {selected.description}
                </p>

                {selected.bestFor && selected.bestFor.length > 0 && (
                  <>
                    <div className="t-micro muted rt-cm-detail-section">Best for</div>
                    <ul className="rt-cm-best">
                      {selected.bestFor.map((b, i) => (
                        <li key={i}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 12l5 5 11-11" />
                          </svg>
                          {b}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <div className="t-micro muted rt-cm-detail-section">What's inside</div>
                <div className="rt-cm-inside">
                  {(selected.nodes || selected.definition?.steps || []).map((n, i) => {
                    const type = n.type || n.nodeType;
                    if (type === "email") {
                      return (
                        <div key={n.id || i} className="rt-cm-inside-row">
                          <span className="rt-cm-inside-dot rt-tint-email">
                            <Icons.Mail size={11} />
                          </span>
                          <div>
                            <div className="rt-cm-inside-name">{n.name || n.emailName || n.subject || "Email"}</div>
                            <div className="t-mono rt-cm-inside-time">
                              {(n.after || n.delayHours) === 0
                                ? "immediately"
                                : `+${n.after || n.delayHours} ${n.afterUnit || "hours"}`}
                            </div>
                          </div>
                          {(n.discount || n.discountPct) > 0 && (
                            <span className="rt-discount">{n.discount || n.discountPct}% off</span>
                          )}
                        </div>
                      );
                    }
                    if (type === "delay") {
                      return (
                        <div key={n.id || i} className="rt-cm-inside-row rt-cm-inside-delay">
                          <span className="rt-cm-inside-dot rt-tint-delay">
                            <Icons.Clock size={11} />
                          </span>
                          <div className="t-mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                            Wait {n.hours || n.delayHours || 0} hours
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>

                <button
                  className="btn btn-primary btn-lg"
                  style={{ width: "100%", marginTop: 24 }}
                  onClick={useTemplate}
                  disabled={fetcher.state !== "idle"}
                >
                  Use this template <Icons.Arrow size={14} />
                </button>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
