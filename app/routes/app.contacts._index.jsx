import { useMemo, useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import Icons from "../components/ui/Icons.jsx";
import Avatar from "../components/contacts/Avatar.jsx";
import StatusPill from "../components/contacts/StatusPill.jsx";
import LifecyclePill from "../components/contacts/LifecyclePill.jsx";
import TagChip from "../components/contacts/TagChip.jsx";
import SoonPill from "../components/contacts/SoonPill.jsx";
import StatCard from "../components/contacts/StatCard.jsx";
import FilterDropdown from "../components/contacts/FilterDropdown.jsx";
import SyncModal from "../components/contacts/SyncModal.jsx";
import UnifyBanner from "../components/contacts/UnifyBanner.jsx";
import ContactsEmpty from "../components/contacts/ContactsEmpty.jsx";
import BulkBar from "../components/contacts/BulkBar.jsx";
import AddContactModal from "../components/contacts/AddContactModal.jsx";
import {
  SOURCE,
  TAG_PALETTE,
  fmtMoney,
  relativeTime,
} from "../components/contacts/constants.js";
import {
  computeLifecycle,
  createManualContact,
  getContactStats,
  listContacts,
  resubscribeContact,
  softDeleteContact,
  summarizeContacts,
  unsubscribeContact,
} from "../lib/contacts/contacts.server.js";
import { runContactsBackfillIfNeeded } from "../lib/contacts/backfill.server.js";
import { listTagsForShop, bulkApplyTag, upsertTag } from "../lib/contacts/tags.server.js";
import { getSyncProgress } from "../lib/contacts/shopifyCustomerSync.server.js";
import { createSegment } from "../lib/segments/segments.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const status = url.searchParams.get("status") || "all";
  const source = url.searchParams.get("source") || "all";
  const tagId = url.searchParams.get("tag") || "all";
  const search = url.searchParams.get("q") || "";

  const backfill = await runContactsBackfillIfNeeded(shop);

  const [{ rows }, summary, tags, sync] = await Promise.all([
    listContacts({ shop, status, source, tagId, search }),
    summarizeContacts(shop),
    listTagsForShop(shop),
    getSyncProgress(shop),
  ]);

  // Cheap on-demand lifecycle computation. We only need cart-abandon hints, so
  // batch one aggregate per contact in the current page.
  const enriched = await Promise.all(
    rows.map(async (c) => {
      const stats = await getContactStats(shop, c.email);
      return {
        id: c.id,
        email: c.email,
        name: c.name,
        firstSeenAt: c.firstSeenAt,
        lastSeenAt: c.lastSeenAt,
        source: c.source,
        subscriptionStatus: c.subscriptionStatus,
        lifecycleStage: computeLifecycle(c, stats),
        tags: c.tags.map((ct) => ({
          id: ct.tag.id,
          name: ct.tag.name,
          color: ct.tag.color,
        })),
        stats,
      };
    }),
  );

  return {
    contacts: enriched,
    summary,
    tags,
    sync,
    backfill,
    filters: { status, source, tagId, search },
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent === "add_contact") {
    const email = String(fd.get("email") || "");
    const name = String(fd.get("name") || "");
    await createManualContact(shop, { email, name });
    return { ok: true };
  }

  if (intent === "unsubscribe") {
    const id = String(fd.get("contactId") || "");
    const email = String(fd.get("email") || "");
    await unsubscribeContact(shop, email || id);
    return { ok: true };
  }

  if (intent === "delete") {
    const id = String(fd.get("contactId") || "");
    await softDeleteContact(shop, id);
    return { ok: true };
  }

  if (intent === "bulk_unsubscribe") {
    const emails = fd.getAll("email").map(String).filter(Boolean);
    for (const email of emails) {
      await unsubscribeContact(shop, email);
    }
    return { ok: true };
  }

  if (intent === "bulk_delete") {
    const ids = fd.getAll("contactId").map(String).filter(Boolean);
    for (const id of ids) {
      await softDeleteContact(shop, id);
    }
    return { ok: true };
  }

  if (intent === "bulk_apply_tag") {
    const ids = fd.getAll("contactId").map(String).filter(Boolean);
    const tagName = String(fd.get("tagName") || "").trim();
    if (!ids.length || !tagName) return { ok: false };
    const tag = await upsertTag(shop, tagName);
    if (tag) await bulkApplyTag(shop, ids, tag.id);
    return { ok: true };
  }

  if (intent === "resubscribe") {
    const email = String(fd.get("email") || "");
    await resubscribeContact(shop, email);
    return { ok: true };
  }

  if (intent === "bulk_save_as_segment") {
    const ids = fd.getAll("contactId").map(String).filter(Boolean);
    const name = String(fd.get("name") || "").trim();
    if (!ids.length || !name) return { ok: false };
    const seg = await createSegment(shop, {
      name,
      description: `Static segment of ${ids.length} contact${ids.length === 1 ? "" : "s"} saved from Contacts.`,
      kind: "static",
      filterTree: null,
      memberContactIds: ids,
    });
    return { ok: true, segmentId: seg.id };
  }

  return { ok: false };
};

export default function ContactsPage() {
  const { contacts, summary, tags, sync, backfill, filters } = useLoaderData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [selected, setSelected] = useState(new Set());
  const [syncOpen, setSyncOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [showUnify, setShowUnify] = useState(backfill?.didRun && backfill.added > 0);
  const [openMenu, setOpenMenu] = useState(null);

  const allChecked = contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const toggleAll = () => {
    const next = new Set(selected);
    if (allChecked) {
      for (const c of contacts) next.delete(c.id);
    } else {
      for (const c of contacts) next.add(c.id);
    }
    setSelected(next);
  };

  const toggleOne = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const tagCounts = useMemo(() => {
    const m = {};
    for (const t of tags) m[t.id] = t.contactCount;
    return m;
  }, [tags]);

  const showFullEmpty = summary.total === 0;

  if (showFullEmpty) {
    return (
      <div className="rt-page">
        <ContactsEmpty onSync={() => setSyncOpen(true)} onAdd={() => setAddOpen(true)} />
        <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} initialSync={sync} />
        <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
      </div>
    );
  }

  const submitBulk = (intent, extras = {}) => {
    const fd = new FormData();
    fd.set("intent", intent);
    for (const id of selected) {
      const c = contacts.find((x) => x.id === id);
      if (!c) continue;
      fd.append("contactId", id);
      fd.append("email", c.email);
    }
    for (const [k, v] of Object.entries(extras)) fd.set(k, v);
    fetcher.submit(fd, { method: "post" });
    setSelected(new Set());
  };

  const submitRowAction = (intent, contact) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("contactId", contact.id);
    fd.set("email", contact.email);
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>
            Retainify · Audience
          </div>
          <h1 className="t-display-2" style={{ margin: 0 }}>
            Contacts
          </h1>
          <p className="t-body muted" style={{ margin: "8px 0 0", maxWidth: 540 }}>
            Everyone who has touched your store — subscribers, buyers, cart abandoners,
            and push opt-ins, unified into a single profile.
          </p>
        </div>
        <div className="rt-page-actions">
          {sync.lastSyncedAt && (
            <div className="rt-sync-pill">
              <Icons.Clock size={12} />
              <span>Last synced {relativeTime(sync.lastSyncedAt)}</span>
            </div>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setSyncOpen(true)}
          >
            <Icons.Refresh size={14} /> Sync from Shopify
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setAddOpen(true)}
          >
            <Icons.Plus size={14} /> Add contact
          </button>
          <div className="rt-kebab-wrap">
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              onClick={() => setOpenMenu(openMenu === "pagekb" ? null : "pagekb")}
              aria-label="More"
            >
              <Icons.More size={16} />
            </button>
            {openMenu === "pagekb" && (
              <>
                <div className="rt-veil" onClick={() => setOpenMenu(null)} />
                <div className="rt-menu" style={{ right: 0, left: "auto" }}>
                  <button type="button" disabled className="rt-menu-soon">
                    <Icons.ArrowDown size={14} /> Import CSV <SoonPill />
                  </button>
                  <button type="button" disabled className="rt-menu-soon">
                    <Icons.ArrowUp size={14} /> Export CSV <SoonPill />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="rt-stats">
        <StatCard
          label="Total contacts"
          value={summary.total.toLocaleString()}
          sub="Updated just now"
        />
        <StatCard
          label="Active subscribers"
          value={summary.subscribed.toLocaleString()}
          sub={
            summary.total
              ? `${Math.round((summary.subscribed / summary.total) * 100)}% of all contacts`
              : "—"
          }
        />
        <StatCard
          label="New this week"
          value={summary.newThisWeek.toLocaleString()}
          sub={summary.newThisWeek ? "Recent signups" : "—"}
        />
        <StatCard
          label="Unsubscribed"
          value={summary.unsubscribed.toLocaleString()}
          sub={
            summary.total
              ? `${Math.round((summary.unsubscribed / summary.total) * 100)}% of all contacts`
              : "—"
          }
        />
      </section>

      {showUnify && (
        <UnifyBanner
          count={backfill.added}
          onDismiss={() => setShowUnify(false)}
          onSync={() => {
            setShowUnify(false);
            setSyncOpen(true);
          }}
        />
      )}

      <div className="rt-toolbar rt-toolbar-stack">
        <div className="rt-chips rt-chips-wrap">
          <button
            type="button"
            onClick={() => setFilter("status", "all")}
            className={`rt-chip ${filters.status === "all" ? "rt-chip-on" : ""}`}
          >
            All<span className="rt-chip-count">{summary.total}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter("status", "subscribed")}
            className={`rt-chip ${filters.status === "subscribed" ? "rt-chip-on" : ""}`}
          >
            Subscribed<span className="rt-chip-count">{summary.subscribed}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter("status", "unsubscribed")}
            className={`rt-chip ${filters.status === "unsubscribed" ? "rt-chip-on" : ""}`}
          >
            Unsubscribed<span className="rt-chip-count">{summary.unsubscribedOnly}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter("status", "bounced")}
            className={`rt-chip ${filters.status === "bounced" ? "rt-chip-on" : ""}`}
          >
            Bounced<span className="rt-chip-count">{summary.bounced}</span>
          </button>
          <span className="rt-chip-sep" />
          <FilterDropdown
            label="Tag"
            icon="Tag"
            value={filters.tagId}
            onChange={(v) => setFilter("tag", v)}
            options={[
              { id: "all", label: "Any tag" },
              ...tags.map((t) => ({
                id: t.id,
                label: t.name,
                swatch: TAG_PALETTE[t.color]?.bg,
                count: tagCounts[t.id] || 0,
              })),
            ]}
          />
          <FilterDropdown
            label="Source"
            icon="Refresh"
            value={filters.source}
            onChange={(v) => setFilter("source", v)}
            options={[
              { id: "all", label: "Any source" },
              ...Object.entries(SOURCE).map(([k, v]) => ({ id: k, label: v })),
            ]}
          />
        </div>
        <div className="rt-toolbar-right">
          <div className="rt-search">
            <Icons.Search size={14} />
            <input
              placeholder="Search by email, name, or tag…"
              defaultValue={filters.search}
              onChange={(e) => {
                const v = e.target.value;
                clearTimeout(window.__rtSearchT);
                window.__rtSearchT = setTimeout(() => setFilter("q", v), 250);
              }}
            />
          </div>
          {(filters.status !== "all" || filters.source !== "all" || filters.tagId !== "all") && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const p = new URLSearchParams();
                p.set("from", "filters");
                if (filters.status !== "all") p.set("status", filters.status);
                if (filters.source !== "all") p.set("source", filters.source);
                if (filters.tagId !== "all") p.set("tag", filters.tagId);
                navigate(`/app/segments/new?${p.toString()}`);
              }}
            >
              <Icons.Sliders size={14} /> Save as segment
            </button>
          )}
        </div>
      </div>

      <div className="rt-ctable">
        <div className="rt-cthead">
          <div className="rt-ctcheck">
            <input
              type="checkbox"
              className="rt-checkbox"
              checked={allChecked}
              onChange={toggleAll}
              aria-label="Select all"
            />
          </div>
          <div>Contact</div>
          <div>Status</div>
          <div>Lifecycle</div>
          <div>Tags</div>
          <div className="rt-tnum">Carts</div>
          <div className="rt-tnum">Last seen</div>
          <div />
        </div>
        {contacts.map((c) => {
          const isOn = selected.has(c.id);
          return (
            <div
              key={c.id}
              className={`rt-ctrow ${isOn ? "rt-on" : ""}`}
              onClick={(e) => {
                if (
                  e.target.closest(".rt-ctcheck") ||
                  e.target.closest(".rt-tactions") ||
                  e.target.closest(".rt-menu")
                )
                  return;
                navigate(`/app/contacts/${c.id}`);
              }}
            >
              <div className="rt-ctcheck" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  className="rt-checkbox"
                  checked={isOn}
                  onChange={() => toggleOne(c.id)}
                  aria-label={`Select ${c.email}`}
                />
              </div>
              <div className="rt-cname">
                <Avatar name={c.name} email={c.email} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div className="rt-cname-email">{c.email}</div>
                  <div className="rt-cname-name">{c.name || "—"}</div>
                </div>
              </div>
              <div>
                <StatusPill status={c.subscriptionStatus} />
              </div>
              <div>
                <LifecyclePill stage={c.lifecycleStage} />
              </div>
              <div className="rt-ctags">
                {c.tags.slice(0, 2).map((t) => (
                  <TagChip key={t.id} tag={t} />
                ))}
                {c.tags.length > 2 && (
                  <span className="rt-tag-overflow">+{c.tags.length - 2}</span>
                )}
                {c.tags.length === 0 && <span className="muted t-small">—</span>}
              </div>
              <div className="rt-tnum rt-tmoney">
                {c.stats.cartAbandonCount
                  ? `${c.stats.cartAbandonCount} · ${fmtMoney(c.stats.lastCartValue)}`
                  : <span className="muted">—</span>}
              </div>
              <div className="rt-tnum rt-tdate">{relativeTime(c.lastSeenAt)}</div>
              <div className="rt-tactions">
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenu(openMenu === c.id ? null : c.id);
                  }}
                  aria-label="Row actions"
                >
                  <Icons.More size={16} />
                </button>
                {openMenu === c.id && (
                  <>
                    <div className="rt-veil" onClick={() => setOpenMenu(null)} />
                    <div className="rt-menu">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenu(null);
                          navigate(`/app/contacts/${c.id}`);
                        }}
                      >
                        <Icons.Eye size={14} /> View profile
                      </button>
                      <div className="rt-menu-sep" />
                      {c.subscriptionStatus !== "unsubscribed" && (
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            submitRowAction("unsubscribe", c);
                          }}
                        >
                          <Icons.Close size={14} /> Unsubscribe
                        </button>
                      )}
                      <button
                        type="button"
                        className="rt-menu-danger"
                        onClick={() => {
                          setOpenMenu(null);
                          submitRowAction("delete", c);
                        }}
                      >
                        <Icons.Trash size={14} /> Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {contacts.length === 0 && (
          <div className="rt-empty-row">
            No contacts match. Try adjusting your filters.{" "}
            <button
              type="button"
              className="rt-link"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      <div className="rt-table-foot">
        <span className="muted">
          Showing <strong style={{ color: "var(--ink-1)" }}>{contacts.length}</strong> of{" "}
          {summary.total} contacts
        </span>
        <span className="muted">·</span>
        <span className="muted">Sorted by last seen, newest first</span>
      </div>

      <BulkBar
        selectedCount={selected.size}
        onAddTag={() => {
          const name = window.prompt("Tag name");
          if (name) submitBulk("bulk_apply_tag", { tagName: name });
        }}
        onSaveAsSegment={() => {
          const name = window.prompt(
            `Save these ${selected.size} contact(s) as a static segment. Name?`,
          );
          if (name && name.trim()) {
            submitBulk("bulk_save_as_segment", { name: name.trim() });
          }
        }}
        onUnsubscribe={() => submitBulk("bulk_unsubscribe")}
        onDelete={() => {
          if (window.confirm(`Delete ${selected.size} contact(s)?`)) {
            submitBulk("bulk_delete");
          }
        }}
        onClear={() => setSelected(new Set())}
      />

      <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} initialSync={sync} />
      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
