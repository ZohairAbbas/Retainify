import { useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import Icons from "../components/ui/Icons.jsx";
import Avatar from "../components/contacts/Avatar.jsx";
import StatusPill from "../components/contacts/StatusPill.jsx";
import LifecyclePill from "../components/contacts/LifecyclePill.jsx";
import TagChip from "../components/contacts/TagChip.jsx";
import SoonPill from "../components/contacts/SoonPill.jsx";
import StatCard from "../components/contacts/StatCard.jsx";
import SegmentKindPill from "../components/segments/SegmentKindPill.jsx";
import Sparkline from "../components/segments/Sparkline.jsx";
import ReadOnlyRules from "../components/segments/ReadOnlyRules.jsx";
import RecentMovement from "../components/segments/RecentMovement.jsx";
import { relativeTime, fmtMoney } from "../components/contacts/constants.js";
import { evaluateSegment } from "../lib/segments/evaluator.server.js";
import {
  getSegmentById,
  softDeleteSegment,
  duplicateSegment,
  listStaticMemberIds,
  listFlowsUsingSegment,
  addStaticMember,
  removeStaticMember,
  updateSegment,
} from "../lib/segments/segments.server.js";
import { getSystemSegmentById, isSystemSegmentId } from "../lib/segments/systemSegments.server.js";
import { listTagsForShop } from "../lib/contacts/tags.server.js";
import { computeLifecycle, getContactStats } from "../lib/contacts/contacts.server.js";
import { FIELDS } from "../lib/segments/fields.server.js";
import prisma from "../db.server.js";

export const loader = async ({ params, request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const id = params.id;

  let segment = null;
  let system = false;
  if (isSystemSegmentId(id)) {
    segment = { ...getSystemSegmentById(id), shop };
    system = true;
  } else {
    segment = await getSegmentById(shop, id);
    if (!segment) throw new Response("Not found", { status: 404 });
  }

  const [{ count, sample, lifecycleMix }, tags] = await Promise.all([
    evaluateSegment(shop, segment, { sampleSize: 50 }),
    listTagsForShop(shop),
  ]);

  // Build the contacts table from the sample. For dynamic, the evaluator
  // already returned a representative slice; for static, augment with rows.
  // Static lists use cursor pagination so very large lists don't blow up
  // the loader. `?after=<id>` skips to the page after that contact.
  const url = new URL(request.url);
  const after = url.searchParams.get("after") || null;
  const PAGE_SIZE = 50;
  let contactRows = [];
  let nextCursor = null;
  if (segment.kind === "static" && !system) {
    const memberIds = await listStaticMemberIds(segment.id);
    const contacts = await prisma.contact.findMany({
      where: { id: { in: memberIds }, shop, deletedAt: null },
      include: { tags: { include: { tag: true } } },
      take: PAGE_SIZE + 1,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
    });
    if (contacts.length > PAGE_SIZE) {
      const last = contacts.pop();
      nextCursor = last.id;
    }
    contactRows = await Promise.all(
      contacts.map(async (c) => {
        const stats = await getContactStats(shop, c.email);
        return {
          id: c.id, email: c.email, name: c.name,
          subscriptionStatus: c.subscriptionStatus,
          lifecycle: computeLifecycle(c, stats),
          tags: c.tags.map((ct) => ({ id: ct.tag.id, name: ct.tag.name, color: ct.tag.color })),
          stats,
          lastSeenAt: c.lastSeenAt,
        };
      }),
    );
  } else {
    // Dynamic: hydrate the sample with full contact rows.
    const ids = sample.map((s) => s.id);
    if (ids.length) {
      const contacts = await prisma.contact.findMany({
        where: { id: { in: ids }, shop, deletedAt: null },
        include: { tags: { include: { tag: true } } },
      });
      contactRows = await Promise.all(
        contacts.map(async (c) => {
          const stats = await getContactStats(shop, c.email);
          return {
            id: c.id, email: c.email, name: c.name,
            subscriptionStatus: c.subscriptionStatus,
            lifecycle: computeLifecycle(c, stats),
            tags: c.tags.map((ct) => ({ id: ct.tag.id, name: ct.tag.name, color: ct.tag.color })),
            stats,
            lastSeenAt: c.lastSeenAt,
          };
        }),
      );
    }
  }

  // Activity tab data: 30-day snapshot series + last 7 days of entry/exit
  // log rows. `segmentKey` is the same id whether system or user.
  const segmentKey = segment.id;
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [snapshots, enteredRows, leftRows, flowsUsing] = await Promise.all([
    prisma.segmentSnapshot.findMany({
      where: { shop, segmentKey, takenAt: { gte: cutoff30d } },
      orderBy: { takenAt: "asc" },
      select: { takenAt: true, count: true },
    }),
    prisma.segmentEntryLog.findMany({
      where: { shop, segmentKey, enteredAt: { gte: cutoff7d } },
      orderBy: { enteredAt: "desc" },
      take: 25,
      select: { id: true, contactId: true, enteredAt: true },
    }),
    prisma.segmentEntryLog.findMany({
      where: { shop, segmentKey, leftAt: { gte: cutoff7d } },
      orderBy: { leftAt: "desc" },
      take: 25,
      select: { id: true, contactId: true, leftAt: true },
    }),
    listFlowsUsingSegment(shop, segmentKey),
  ]);

  // Hydrate contact emails/names for the movement rows in one query.
  const movementIds = [
    ...new Set([...enteredRows, ...leftRows].map((r) => r.contactId)),
  ];
  let contactById = {};
  if (movementIds.length) {
    const rows = await prisma.contact.findMany({
      where: { id: { in: movementIds }, shop },
      select: { id: true, email: true, name: true },
    });
    contactById = Object.fromEntries(rows.map((c) => [c.id, c]));
  }
  const enrich = (r, key) => ({
    id: r.id,
    contactId: r.contactId,
    email: contactById[r.contactId]?.email || "(deleted)",
    name: contactById[r.contactId]?.name || "",
    [key]: r[key],
  });

  return Response.json({
    segment,
    system,
    count,
    lifecycleMix,
    contactRows,
    tags,
    fields: FIELDS,
    snapshots: snapshots.map((s) => ({ takenAt: s.takenAt, count: s.count })),
    recentEntered: enteredRows.map((r) => enrich(r, "enteredAt")),
    recentLeft: leftRows.map((r) => enrich(r, "leftAt")),
    flowsUsing,
    nextCursor,
  });
};

export const action = async ({ params, request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  const id = params.id;

  if (intent === "delete") {
    try {
      await softDeleteSegment(shop, id);
      return Response.json({ ok: true, redirect: "/app/segments" });
    } catch (e) {
      return Response.json({ ok: false, error: e.message }, { status: 409 });
    }
  }
  if (intent === "duplicate") {
    const copy = await duplicateSegment(shop, id);
    return Response.json({ ok: true, redirect: `/app/segments/${copy.id}` });
  }
  if (intent === "update_name") {
    const name = String(fd.get("name") || "").trim();
    if (!name) return Response.json({ ok: false, error: "Name is required" }, { status: 400 });
    await updateSegment(shop, id, { name });
    return Response.json({ ok: true });
  }
  if (intent === "update_description") {
    const description = String(fd.get("description") || "").trim();
    await updateSegment(shop, id, { description });
    return Response.json({ ok: true });
  }
  if (intent === "add_static_member") {
    const contactId = String(fd.get("contactId") || "");
    if (!contactId) return Response.json({ ok: false }, { status: 400 });
    await addStaticMember(shop, id, contactId);
    return Response.json({ ok: true });
  }
  if (intent === "remove_static_member") {
    const contactId = String(fd.get("contactId") || "");
    if (!contactId) return Response.json({ ok: false }, { status: 400 });
    await removeStaticMember(shop, id, contactId);
    return Response.json({ ok: true });
  }
  return Response.json({ ok: false }, { status: 400 });
};

export default function SegmentDetailPage() {
  const {
    segment, system, count, lifecycleMix, contactRows, tags, fields,
    snapshots = [], recentEntered = [], recentLeft = [], flowsUsing = [],
    nextCursor,
  } = useLoaderData();

  // Snapshot series → sparkline values. Append the live count so the
  // rightmost point matches the big stat card. When there are no snapshots
  // yet, fall back to the synthetic curve so the card isn't blank.
  const snapshotSeries =
    snapshots.length > 0
      ? [...snapshots.map((s) => s.count), count]
      : fakeSpark(count);
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [tab, setTab] = useState("contacts");
  const [openKebab, setOpenKebab] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [nameDraft, setNameDraft] = useState(segment.name);
  const [descDraft, setDescDraft] = useState(segment.description || "");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState([]);

  const submitField = (intent, key, value) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set(key, value);
    fetcher.submit(fd, { method: "post" });
  };
  const submitMember = (intent, contactId) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("contactId", contactId);
    fetcher.submit(fd, { method: "post" });
  };

  // Redirect on fetcher result.
  if (fetcher.data?.redirect && fetcher.state === "idle") {
    navigate(fetcher.data.redirect);
  }

  const Icon = Icons[segment.icon] || (segment.kind === "static" ? Icons.Lock : Icons.Sliders);
  const updatedAt = segment.updatedAt || segment.lastComputedAt || null;

  return (
    <div className="rt-sd">
      <div className="rt-sd-bar">
        <button
          type="button"
          className="rt-bld-back"
          onClick={() => navigate("/app/segments")}
          aria-label="Back to segments"
        >
          <Icons.ArrowBack size={16} />
        </button>
        <div className="rt-bld-top-actions">
          {!system && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate(`/app/segments/${segment.id}/edit`)}
              >
                <Icons.Sliders size={14} /> Edit rules
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate("/app/flows")}
              >
                <Icons.Flow size={14} /> Use in a flow
              </button>
              <div className="rt-kebab-wrap">
                <button
                  type="button"
                  className="btn btn-secondary btn-icon"
                  onClick={() => setOpenKebab(!openKebab)}
                  aria-label="More"
                >
                  <Icons.More size={16} />
                </button>
                {openKebab && (
                  <>
                    <div className="rt-veil" onClick={() => setOpenKebab(false)} />
                    <div className="rt-menu" style={{ right: 0, left: "auto" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenKebab(false);
                          const fd = new FormData();
                          fd.set("intent", "duplicate");
                          fetcher.submit(fd, { method: "post" });
                        }}
                      >
                        <Icons.Copy size={14} /> Duplicate
                      </button>
                      <button type="button" disabled className="rt-menu-soon">
                        <Icons.ArrowUp size={14} /> Export CSV <SoonPill />
                      </button>
                      <div className="rt-menu-sep" />
                      <button
                        type="button"
                        className="rt-menu-danger"
                        onClick={() => {
                          setOpenKebab(false);
                          if (window.confirm(`Delete "${segment.name}"? This can't be undone.`)) {
                            const fd = new FormData();
                            fd.set("intent", "delete");
                            fetcher.submit(fd, { method: "post" });
                          }
                        }}
                      >
                        <Icons.Trash size={14} /> Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rt-sd-head">
        <div className="rt-sd-head-left">
          <div className={`rt-sd-icon ${segment.kind === "static" ? "static" : ""}`}>
            <Icon size={28} />
          </div>
          {editingName && !system ? (
            <input
              className="input"
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                if (nameDraft.trim() && nameDraft.trim() !== segment.name) {
                  submitField("update_name", "name", nameDraft.trim());
                }
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") { setNameDraft(segment.name); setEditingName(false); }
              }}
              style={{ fontSize: 48, fontWeight: 400, fontFamily: "var(--font-display)" }}
            />
          ) : (
            <h1
              className="rt-sd-title"
              onClick={() => !system && setEditingName(true)}
              style={!system ? { cursor: "text" } : undefined}
              title={!system ? "Click to rename" : undefined}
            >
              {segment.name}
            </h1>
          )}
          {editingDesc && !system ? (
            <input
              className="input"
              autoFocus
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={() => {
                if (descDraft.trim() !== (segment.description || "")) {
                  submitField("update_description", "description", descDraft.trim());
                }
                setEditingDesc(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") { setDescDraft(segment.description || ""); setEditingDesc(false); }
              }}
              style={{ marginTop: 12, maxWidth: 540 }}
            />
          ) : (
            <p
              className="rt-sd-desc"
              onClick={() => !system && setEditingDesc(true)}
              style={!system ? { cursor: "text" } : undefined}
              title={!system ? "Click to edit description" : undefined}
            >
              {segment.description || (!system ? "Add a description…" : null)}
            </p>
          )}
          <div className="rt-sd-pills">
            {system && <span className="pill" style={{ background: "var(--paper-2)", color: "var(--ink-3)" }}>Built-in</span>}
            <SegmentKindPill kind={segment.kind} />
            {updatedAt && (
              <span className="t-mono muted">Updated {relativeTime(updatedAt)}</span>
            )}
            {segment.kind === "dynamic" && !system && (
              <span className="t-mono muted">· Recalculating continuously</span>
            )}
          </div>
        </div>
        <div className="rt-sd-stat-card">
          <span className="t-micro">Contacts in segment</span>
          <span className="rt-sd-stat-card-big">
            {count.toLocaleString()}
            <span className="rt-sd-stat-card-big-unit">contacts</span>
          </span>
          <Sparkline values={snapshotSeries} w={300} h={36} />
        </div>
      </div>

      {!system && (
        <section className="rt-sd-summary">
          <StatCard label="Avg. order value" value="—" sub="Order data not connected" />
          <StatCard label="Lifetime revenue" value="—" sub="Order data not connected" />
          <StatCard label="Email open rate" value="—" sub="Last 30 days" />
          <StatCard
            label="In active flows"
            value={String(flowsUsing.length)}
            sub={flowsUsing.length === 0 ? "Not used yet" : "Powering published journeys"}
          />
        </section>
      )}

      <div className="rt-sd-tabwrap">
        <div className="rt-chips">
          {(segment.kind === "static" && !system
            ? ["contacts", "members", "rules", "activity", "flows"]
            : ["contacts", "rules", "activity", "flows"]
          ).map((t) => (
            <button
              key={t}
              type="button"
              className={`rt-chip ${tab === t ? "rt-chip-on" : ""}`}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {tab === "contacts" && (
        <div className="rt-ctable">
          <div className="rt-cthead">
            <div>Contact</div>
            <div>Status</div>
            <div>Lifecycle</div>
            <div>Tags</div>
            <div className="rt-tnum">Carts</div>
            <div className="rt-tnum">Last seen</div>
            <div />
          </div>
          {contactRows.map((c) => (
            <div
              key={c.id}
              className="rt-ctrow"
              onClick={() => navigate(`/app/contacts/${c.id}`)}
            >
              <div className="rt-cname">
                <Avatar name={c.name} email={c.email} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div className="rt-cname-email">{c.email}</div>
                  <div className="rt-cname-name">{c.name || "—"}</div>
                </div>
              </div>
              <div><StatusPill status={c.subscriptionStatus} /></div>
              <div><LifecyclePill stage={c.lifecycle} /></div>
              <div className="rt-ctags">
                {c.tags.slice(0, 2).map((t) => <TagChip key={t.id} tag={t} />)}
                {c.tags.length > 2 && <span className="rt-tag-overflow">+{c.tags.length - 2}</span>}
                {c.tags.length === 0 && <span className="muted t-small">—</span>}
              </div>
              <div className="rt-tnum rt-tmoney">
                {c.stats.cartAbandonCount
                  ? `${c.stats.cartAbandonCount} · ${fmtMoney(c.stats.lastCartValue)}`
                  : <span className="muted">—</span>}
              </div>
              <div className="rt-tnum rt-tdate">{relativeTime(c.lastSeenAt)}</div>
              <div />
            </div>
          ))}
          {contactRows.length === 0 && (
            <div className="rt-empty-row">
              No contacts in this segment yet.
            </div>
          )}
          {nextCursor && (
            <div className="rt-table-foot">
              <button
                type="button"
                className="rt-link"
                onClick={() => navigate(`/app/segments/${segment.id}?after=${nextCursor}`)}
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "members" && segment.kind === "static" && !system && (
        <div className="rt-sd-rules">
          <div className="rt-stm-add">
            <div className="rt-search" style={{ flex: 1 }}>
              <Icons.Search size={14} />
              <input
                placeholder="Search by email or name to add a contact…"
                value={memberSearch}
                onChange={async (e) => {
                  const q = e.target.value;
                  setMemberSearch(q);
                  if (q.trim().length < 2) { setMemberResults([]); return; }
                  try {
                    const res = await fetch(`/app/segments/search?q=${encodeURIComponent(q.trim())}`);
                    if (res.ok) {
                      const data = await res.json();
                      // Hide contacts already in the segment.
                      const existing = new Set(contactRows.map((r) => r.id));
                      setMemberResults((data.contacts || []).filter((c) => !existing.has(c.id)));
                    }
                  } catch (_e) { /* noop */ }
                }}
              />
            </div>
          </div>
          {memberResults.length > 0 && (
            <div
              className="rt-sel-menu"
              style={{ position: "static", boxShadow: "none", marginBottom: 12 }}
            >
              {memberResults.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className="rt-sel-item"
                  onClick={() => {
                    submitMember("add_static_member", r.id);
                    setMemberSearch("");
                    setMemberResults([]);
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{r.email}</span>
                  {r.name && (
                    <span style={{ color: "var(--ink-3)", marginLeft: 8 }}>· {r.name}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {contactRows.length === 0 ? (
            <div className="rt-stm-empty">
              No contacts in this segment yet. Search above to add some.
            </div>
          ) : (
            <div className="rt-stm-list">
              {contactRows.map((c) => (
                <div className="rt-stm-row" key={c.id}>
                  <Avatar name={c.name} email={c.email} size={28} />
                  <div className="rt-cname-email">
                    {c.email}
                    {c.name && <span style={{ color: "var(--ink-3)" }}>  ·  {c.name}</span>}
                  </div>
                  <button
                    type="button"
                    className="rt-rule-x"
                    onClick={() => submitMember("remove_static_member", c.id)}
                    aria-label="Remove member"
                  >
                    <Icons.Close size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="rt-stm-bulk">
            <Icons.Sparkles size={14} />
            <span>
              {count.toLocaleString()} contact{count === 1 ? "" : "s"} in this segment.
            </span>
          </div>
        </div>
      )}

      {tab === "rules" && (
        <div className="rt-sd-rules">
          {segment.kind === "static" ? (
            <div className="t-body muted">
              This is a static segment — members are added manually rather than by rule.
            </div>
          ) : segment.filterTree ? (
            <ReadOnlyRules tree={segment.filterTree} fields={fields} tags={tags} />
          ) : (
            <div className="t-body muted">No rules — matches everyone in your shop.</div>
          )}
          {segment.kind === "dynamic" && !system && (
            <div className="rt-sd-rules-meta">
              <strong>Match {segment.filterTree?.match || "all"}</strong>
              <span>· Recalculated on read</span>
              <span style={{ marginLeft: "auto" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigate(`/app/segments/${segment.id}/edit`)}
                >
                  Edit rules
                </button>
              </span>
            </div>
          )}
        </div>
      )}

      {tab === "activity" && (
        <div className="rt-sd-activity">
          <div className="rt-sd-act-card">
            <div className="rt-sd-act-title">Segment size — last 30 days</div>
            <Sparkline values={snapshotSeries} w={520} h={180} />
            <div className="t-small muted" style={{ marginTop: 12 }}>
              {snapshots.length === 0
                ? "Daily history starts recording after the next nightly snapshot."
                : `Showing ${snapshots.length} day${snapshots.length === 1 ? "" : "s"} of history.`}
            </div>
          </div>
          <div className="rt-sd-act-card">
            <div className="rt-sd-act-title">Lifecycle mix</div>
            {lifecycleMix ? (
              <LifecycleSummary mix={lifecycleMix} />
            ) : (
              <div className="t-small muted">No data yet.</div>
            )}
          </div>
          <RecentMovement
            title="Recently entered"
            rows={recentEntered}
            kind="entered"
          />
          <RecentMovement
            title="Recently left"
            rows={recentLeft}
            kind="left"
          />
        </div>
      )}

      {tab === "flows" && (
        <div className="rt-sd-rules">
          {flowsUsing.length === 0 ? (
            <div className="rt-sd-cta">
              <div className="rt-sd-cta-icon"><Icons.Flow size={18} /></div>
              <div>
                <div className="rt-sd-cta-title">This segment isn't powering a flow yet.</div>
                <div className="rt-sd-cta-sub">
                  Build a flow that triggers when contacts enter this segment — useful for
                  welcome series, win-backs, or VIP-only drops.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate("/app/flows")}
              >
                Build a flow
              </button>
            </div>
          ) : (
            <div className="rt-prev-used" style={{ padding: 20 }}>
              {flowsUsing.map((f) => (
                <a
                  key={f.id}
                  href={`/app/flows/${f.id}`}
                  className="rt-prev-used-flow"
                  style={{ textDecoration: "none" }}
                >
                  <Icons.Flow size={14} />
                  <span>{f.name}</span>
                  <span className="rt-prev-used-flow-status">{f.status}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LifecycleSummary({ mix }) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  const order = ["new", "active", "at_risk", "churned", "never_purchased"];
  const labels = { new: "New", active: "Active", at_risk: "At-risk", churned: "Churned", never_purchased: "Never purchased" };
  if (!total) return <div className="t-small muted">No data.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {order.map((k) => {
        const v = mix[k] || 0;
        const pct = total ? Math.round((v / total) * 100) : 0;
        return (
          <div key={k} className="rt-prev-stack-leg">
            <span className="rt-prev-stack-leg-dot" style={{ background: "var(--brand-700)" }} />
            {labels[k]}
            <span className="rt-prev-stack-leg-num">{v} · {pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function fakeSpark(count) {
  if (!count) return [0, 0, 0, 0, 0, 0];
  return [count * 0.86, count * 0.9, count * 0.93, count * 0.95, count * 0.98, count];
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
