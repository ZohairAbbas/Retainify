import { useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import Icons from "../components/ui/Icons.jsx";
import StatCard from "../components/contacts/StatCard.jsx";
import SoonPill from "../components/contacts/SoonPill.jsx";
import SegmentKindPill from "../components/segments/SegmentKindPill.jsx";
import Sparkline from "../components/segments/Sparkline.jsx";
import SegmentsEmpty from "../components/segments/SegmentsEmpty.jsx";
import { relativeTime } from "../components/contacts/constants.js";
import {
  listSegments,
  duplicateSegment,
  softDeleteSegment,
} from "../lib/segments/segments.server.js";
import { listSystemSegmentsWithCounts } from "../lib/segments/systemSegments.server.js";
import { TEMPLATES } from "../lib/segments/fields.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [segments, systemSegments] = await Promise.all([
    listSegments(shop),
    listSystemSegmentsWithCounts(shop),
  ]);
  const dynamicCount = segments.filter((s) => s.kind === "dynamic").length;
  return Response.json({
    segments,
    systemSegments,
    templates: TEMPLATES,
    totals: {
      total: segments.length,
      dynamic: dynamicCount,
      inFlows: 0, // wired up when segment_entered trigger ships
    },
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  const id = String(fd.get("id") || "");

  if (intent === "duplicate" && id) {
    await duplicateSegment(shop, id);
    return Response.json({ ok: true });
  }
  if (intent === "delete" && id) {
    try {
      await softDeleteSegment(shop, id);
      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ ok: false, error: e.message }, { status: 409 });
    }
  }
  return Response.json({ ok: false }, { status: 400 });
};

export default function SegmentsListPage() {
  const { segments, systemSegments, templates, totals } = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [openMenu, setOpenMenu] = useState(null);
  const [kindFilter, setKindFilter] = useState("all");
  const [q, setQ] = useState("");

  const filtered = segments.filter((s) => {
    if (kindFilter !== "all" && s.kind !== kindFilter) return false;
    if (q && !`${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const showEmpty = segments.length === 0;

  const submitRow = (intent, id) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("id", id);
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>
            Retainify · Audience
          </div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Segments</h1>
          <p className="t-body muted" style={{ margin: "8px 0 0", maxWidth: 540 }}>
            Group contacts by what they've done — abandoned a cart, opened an email,
            joined this week — and use those groups to trigger flows or browse audiences.
          </p>
        </div>
        <div className="rt-page-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/app/segments/new")}
          >
            <Icons.Plus size={14} /> Create segment
          </button>
        </div>
      </header>

      {!showEmpty && (
        <section className="rt-stats rt-stats-3">
          <StatCard label="Total segments" value={totals.total.toLocaleString()} sub="Across all kinds" />
          <StatCard label="Dynamic segments" value={totals.dynamic.toLocaleString()} sub="Update automatically" />
          <StatCard label="Active in flows" value={totals.inFlows.toLocaleString()} sub="Powering published journeys" />
        </section>
      )}

      {showEmpty ? (
        <SegmentsEmpty templates={templates} />
      ) : (
        <>
          {/* Slim templates row — always visible so merchants can spin up
              a new segment from a template even after they have some saved. */}
          <div className="rt-tpl-row rt-tpl-row-slim">
            <div className="rt-tpl-head">
              <div>
                <h2>Start from a <em>template</em></h2>
                <div className="rt-tpl-head-sub">
                  Common groupings, pre-wired. Tweak the rules after.
                </div>
              </div>
            </div>
            <div className="rt-tpl-cards">
              {templates.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className="rt-tpl-card"
                  onClick={() => navigate(`/app/segments/new?template=${t.id}`)}
                >
                  <div className="rt-tpl-card-top">
                    <span
                      className="rt-tpl-icon"
                      style={{ background: t.accent, color: t.accentInk }}
                    >
                      <Icons.Sparkles size={12} />
                    </span>
                    <span className="rt-tpl-card-name">{t.name}</span>
                  </div>
                  <div className="rt-tpl-card-desc">{t.description}</div>
                  <div className="rt-tpl-card-foot">
                    <strong>Use template</strong>
                    <Icons.Arrow size={10} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Quick views rail — system segments */}
          <div className="rt-qv-rail">
            <div className="rt-qv-rail-label">
              <Icons.Lock size={12} /> Quick views
            </div>
            <div className="rt-qv-scroll">
              {systemSegments.map((s) => {
                const Icon = Icons[s.icon] || Icons.Sliders;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="rt-qv-item"
                    onClick={() => navigate(`/app/segments/${s.id}`)}
                  >
                    <span className="rt-qv-icon"><Icon size={14} /></span>
                    <span className="rt-qv-body">
                      <span className="rt-qv-name">{s.name}</span>
                      <span className="rt-qv-count">
                        <strong>{s.contactCount.toLocaleString()}</strong> contacts
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Filter bar */}
          <div className="rt-toolbar rt-toolbar-stack">
            <div className="rt-chips rt-chips-wrap">
              <button
                type="button"
                onClick={() => setKindFilter("all")}
                className={`rt-chip ${kindFilter === "all" ? "rt-chip-on" : ""}`}
              >
                All<span className="rt-chip-count">{segments.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setKindFilter("dynamic")}
                className={`rt-chip ${kindFilter === "dynamic" ? "rt-chip-on" : ""}`}
              >
                Dynamic<span className="rt-chip-count">{totals.dynamic}</span>
              </button>
              <button
                type="button"
                onClick={() => setKindFilter("static")}
                className={`rt-chip ${kindFilter === "static" ? "rt-chip-on" : ""}`}
              >
                Static<span className="rt-chip-count">{segments.length - totals.dynamic}</span>
              </button>
            </div>
            <div className="rt-toolbar-right">
              <div className="rt-search">
                <Icons.Search size={14} />
                <input
                  placeholder="Search segments…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="rt-seg-table">
            <div className="rt-seg-thead">
              <div>Segment</div>
              <div>Type</div>
              <div>Contacts</div>
              <div>Used in flows</div>
              <div>Updated</div>
              <div />
            </div>
            {filtered.map((seg) => (
              <div
                key={seg.id}
                className="rt-seg-row"
                onClick={(e) => {
                  if (e.target.closest(".rt-tactions") || e.target.closest(".rt-menu")) return;
                  navigate(`/app/segments/${seg.id}`);
                }}
              >
                <div className="rt-seg-name-cell">
                  <span className={`rt-seg-name-icon ${seg.kind === "static" ? "static" : ""}`}>
                    {seg.kind === "static" ? <Icons.Lock size={14} /> : <Icons.Sliders size={14} />}
                  </span>
                  <div className="rt-seg-name">
                    <div className="rt-seg-name-main">{seg.name}</div>
                    {seg.description && (
                      <div className="rt-seg-name-sub">{seg.description}</div>
                    )}
                  </div>
                </div>
                <div>
                  <SegmentKindPill kind={seg.kind} />
                </div>
                <div className="rt-seg-count">
                  <span className="rt-seg-count-num">{seg.contactCount.toLocaleString()}</span>
                  <Sparkline values={fakeSpark(seg.contactCount)} />
                </div>
                <div className="rt-seg-flows">
                  <span className="rt-seg-flow-none">Not used</span>
                </div>
                <div className="rt-seg-updated">{relativeTime(seg.updatedAt)}</div>
                <div className="rt-tactions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenu(openMenu === seg.id ? null : seg.id);
                    }}
                    aria-label="Row actions"
                  >
                    <Icons.More size={16} />
                  </button>
                  {openMenu === seg.id && (
                    <>
                      <div className="rt-veil" onClick={() => setOpenMenu(null)} />
                      <div className="rt-menu" style={{ right: 0, left: "auto" }}>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            navigate(`/app/segments/${seg.id}`);
                          }}
                        >
                          <Icons.Eye size={14} /> View
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            navigate(`/app/segments/${seg.id}/edit`);
                          }}
                        >
                          <Icons.Sliders size={14} /> Edit rules
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            submitRow("duplicate", seg.id);
                          }}
                        >
                          <Icons.Copy size={14} /> Duplicate
                        </button>
                        <div className="rt-menu-sep" />
                        <button type="button" disabled className="rt-menu-soon">
                          <Icons.ArrowUp size={14} /> Export CSV <SoonPill />
                        </button>
                        <div className="rt-menu-sep" />
                        <button
                          type="button"
                          className="rt-menu-danger"
                          onClick={() => {
                            setOpenMenu(null);
                            if (window.confirm(`Delete "${seg.name}"? This can't be undone.`)) {
                              submitRow("delete", seg.id);
                            }
                          }}
                        >
                          <Icons.Trash size={14} /> Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="rt-empty-row">
                No segments match. Try adjusting your filters.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function fakeSpark(count) {
  // Until we record segment-size history, render a faint upward sweep based
  // on the current count. Real history will replace this in a follow-up.
  if (!count) return [0, 0, 0, 0, 0, 0];
  const c = count;
  return [c * 0.86, c * 0.9, c * 0.93, c * 0.95, c * 0.98, c];
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
