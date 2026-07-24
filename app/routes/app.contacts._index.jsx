import { useEffect, useMemo, useRef, useState } from "react";
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
import ImportCsvModal from "../components/contacts/ImportCsvModal.jsx";
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
  listAllContactIds,
  resubscribeContact,
  softDeleteContact,
  summarizeContacts,
  unsubscribeContact,
  upsertContact,
  normalizeEmail,
} from "../lib/contacts/contacts.server.js";
import { runContactsBackfillIfNeeded } from "../lib/contacts/backfill.server.js";
import { listTagsForShop, bulkApplyTag, upsertTag, applyTagByName } from "../lib/contacts/tags.server.js";
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
  const cursor = url.searchParams.get("cursor") || undefined;

  const backfill = await runContactsBackfillIfNeeded(shop);

  const [{ rows, nextCursor, filteredTotal }, summary, tags, sync] = await Promise.all([
    listContacts({ shop, status, source, tagId, search, cursor }),
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
    nextCursor: nextCursor || null,
    filteredTotal,
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
    const selectAllFiltered = fd.get("selectAllFiltered") === "1";
    if (selectAllFiltered) {
      const filterStatus = String(fd.get("filterStatus") || "all");
      const filterSource = String(fd.get("filterSource") || "all");
      const filterTagId = String(fd.get("filterTagId") || "all");
      const filterSearch = String(fd.get("filterSearch") || "");
      const all = await listAllContactIds({ shop, status: filterStatus, source: filterSource, tagId: filterTagId, search: filterSearch });
      for (const { email } of all) await unsubscribeContact(shop, email);
    } else {
      const emails = fd.getAll("email").map(String).filter(Boolean);
      for (const email of emails) await unsubscribeContact(shop, email);
    }
    return { ok: true };
  }

  if (intent === "bulk_delete") {
    const selectAllFiltered = fd.get("selectAllFiltered") === "1";
    if (selectAllFiltered) {
      const filterStatus = String(fd.get("filterStatus") || "all");
      const filterSource = String(fd.get("filterSource") || "all");
      const filterTagId = String(fd.get("filterTagId") || "all");
      const filterSearch = String(fd.get("filterSearch") || "");
      const all = await listAllContactIds({ shop, status: filterStatus, source: filterSource, tagId: filterTagId, search: filterSearch });
      for (const { id } of all) await softDeleteContact(shop, id);
    } else {
      const ids = fd.getAll("contactId").map(String).filter(Boolean);
      for (const id of ids) await softDeleteContact(shop, id);
    }
    return { ok: true };
  }

  if (intent === "bulk_apply_tag") {
    const selectAllFiltered = fd.get("selectAllFiltered") === "1";
    const tagName = String(fd.get("tagName") || "").trim();
    if (!tagName) return { ok: false };
    const tag = await upsertTag(shop, tagName);
    if (!tag) return { ok: false };
    if (selectAllFiltered) {
      const filterStatus = String(fd.get("filterStatus") || "all");
      const filterSource = String(fd.get("filterSource") || "all");
      const filterTagId = String(fd.get("filterTagId") || "all");
      const filterSearch = String(fd.get("filterSearch") || "");
      const all = await listAllContactIds({ shop, status: filterStatus, source: filterSource, tagId: filterTagId, search: filterSearch });
      await bulkApplyTag(shop, all.map((c) => c.id), tag.id);
    } else {
      const ids = fd.getAll("contactId").map(String).filter(Boolean);
      if (!ids.length) return { ok: false };
      await bulkApplyTag(shop, ids, tag.id);
    }
    return { ok: true };
  }

  if (intent === "resubscribe") {
    const email = String(fd.get("email") || "");
    await resubscribeContact(shop, email);
    return { ok: true };
  }

  if (intent === "import_csv") {
    let rows;
    try {
      rows = JSON.parse(String(fd.get("rows") || "[]"));
    } catch {
      return { intent: "import_csv", ok: false, imported: 0, skippedDuplicate: 0, skippedInvalid: 0 };
    }
    let imported = 0;
    let skippedDuplicate = 0;
    let skippedInvalid = 0;
    for (const row of rows) {
      const email = normalizeEmail(row.email);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        skippedInvalid++;
        continue;
      }
      const { contact, created, revived } = await upsertContact({
        shop,
        email,
        name: row.name || "",
        source: "csv_import",
        subscriptionStatus: "subscribed",
        marketingConsentAt: new Date(),
        revive: true,
      });
      // A revived contact was deleted and is now back in the list, so it counts
      // as imported rather than as a duplicate that was left untouched.
      if (contact && (created || revived)) {
        imported++;
        if (Array.isArray(row.tags)) {
          for (const tagName of row.tags) {
            if (tagName) await applyTagByName(shop, contact.id, tagName);
          }
        }
      } else {
        skippedDuplicate++;
      }
    }
    return { intent: "import_csv", ok: true, imported, skippedDuplicate, skippedInvalid };
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
  const loaderData = useLoaderData();
  const { summary, tags, sync, backfill, filters } = loaderData;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const moreFetcher = useFetcher();

  // Accumulate pages. Reset when filters change (tracked via a serialized key).
  const filtersKey = JSON.stringify(filters);
  const filtersKeyRef = useRef(filtersKey);
  const [allContacts, setAllContacts] = useState(loaderData.contacts);
  const [nextCursor, setNextCursor] = useState(loaderData.nextCursor);
  const filteredTotal = loaderData.filteredTotal;

  // When the filter key changes (user changed a filter chip), reset to the
  // fresh loader data. When "load more" completes, append.
  useEffect(() => {
    if (filtersKey !== filtersKeyRef.current) {
      filtersKeyRef.current = filtersKey;
      setAllContacts(loaderData.contacts);
      setNextCursor(loaderData.nextCursor);
      setSelected(new Set());
      setSelectAllFiltered(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, loaderData.contacts, loaderData.nextCursor]);

  useEffect(() => {
    if (moreFetcher.state === "idle" && moreFetcher.data?.contacts) {
      setAllContacts((prev) => [...prev, ...moreFetcher.data.contacts]);
      setNextCursor(moreFetcher.data.nextCursor);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreFetcher.state, moreFetcher.data]);

  const contacts = allContacts;

  const loadMore = () => {
    if (!nextCursor) return;
    const next = new URLSearchParams(params);
    next.set("cursor", nextCursor);
    moreFetcher.load(`/app/contacts?${next.toString()}`);
  };

  const [selected, setSelected] = useState(new Set());
  // selectAllFiltered = true means the user chose "select all N matching filter"
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [showUnify, setShowUnify] = useState(backfill?.didRun && backfill.added > 0);
  const [openMenu, setOpenMenu] = useState(null);

  const allPageChecked = contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  // Show "select all N" banner when the full page is checked but not everything is selected yet
  const showSelectAllBanner = allPageChecked && !selectAllFiltered && filteredTotal > contacts.length;

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    next.delete("cursor");
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
    setSelectAllFiltered(false);
  };

  const toggleAll = () => {
    if (selectAllFiltered) {
      setSelectAllFiltered(false);
      setSelected(new Set());
      return;
    }
    const next = new Set(selected);
    if (allPageChecked) {
      for (const c of contacts) next.delete(c.id);
      setSelectAllFiltered(false);
    } else {
      for (const c of contacts) next.add(c.id);
    }
    setSelected(next);
  };

  const toggleOne = (id) => {
    setSelectAllFiltered(false);
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
        <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} />
      </div>
    );
  }

  const submitBulk = (intent, extras = {}) => {
    const fd = new FormData();
    fd.set("intent", intent);
    if (selectAllFiltered) {
      fd.set("selectAllFiltered", "1");
      fd.set("filterStatus", filters.status || "all");
      fd.set("filterSource", filters.source || "all");
      fd.set("filterTagId", filters.tagId || "all");
      fd.set("filterSearch", filters.search || "");
    } else {
      for (const id of selected) {
        const c = contacts.find((x) => x.id === id);
        if (!c) continue;
        fd.append("contactId", id);
        fd.append("email", c.email);
      }
    }
    for (const [k, v] of Object.entries(extras)) fd.set(k, v);
    fetcher.submit(fd, { method: "post" });
    setSelected(new Set());
    setSelectAllFiltered(false);
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
                  <button
                    type="button"
                    onClick={() => { setOpenMenu(null); setImportOpen(true); }}
                  >
                    <Icons.ArrowDown size={14} /> Import CSV
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
          <button
            type="button"
            className="rt-link"
            onClick={() => navigate("/app/contacts/tags")}
            title="Rename, recolor, or delete tags"
            style={{ marginLeft: 4 }}
          >
            Manage tags
          </button>
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
              checked={allPageChecked || selectAllFiltered}
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

      {/* Select-all-filtered banner */}
      {showSelectAllBanner && (
        <div className="rt-select-all-banner">
          All <strong>{contacts.length}</strong> contacts on this page are selected.{" "}
          <button
            type="button"
            className="rt-link"
            onClick={() => setSelectAllFiltered(true)}
          >
            Select all {filteredTotal.toLocaleString()} contacts matching this filter
          </button>
        </div>
      )}
      {selectAllFiltered && (
        <div className="rt-select-all-banner rt-select-all-banner--active">
          All <strong>{filteredTotal.toLocaleString()}</strong> contacts matching this filter are selected.{" "}
          <button
            type="button"
            className="rt-link"
            onClick={() => { setSelectAllFiltered(false); setSelected(new Set()); }}
          >
            Clear selection
          </button>
        </div>
      )}

      <div className="rt-table-foot">
        <span className="muted">
          Showing <strong style={{ color: "var(--ink-1)" }}>{contacts.length}</strong> of{" "}
          {filteredTotal.toLocaleString()} contacts
        </span>
        <span className="muted">·</span>
        <span className="muted">Sorted by last seen, newest first</span>
        {nextCursor && (
          <>
            <span className="muted">·</span>
            <button
              type="button"
              className="rt-link"
              onClick={loadMore}
              disabled={moreFetcher.state !== "idle"}
            >
              {moreFetcher.state !== "idle" ? "Loading…" : "Load more"}
            </button>
          </>
        )}
      </div>

      <BulkBar
        selectedCount={selectAllFiltered ? filteredTotal : selected.size}
        onAddTag={() => {
          const name = window.prompt("Tag name");
          if (name) submitBulk("bulk_apply_tag", { tagName: name });
        }}
        onSaveAsSegment={() => {
          const count = selectAllFiltered ? filteredTotal : selected.size;
          const name = window.prompt(
            `Save these ${count} contact(s) as a static segment. Name?`,
          );
          if (name && name.trim()) {
            submitBulk("bulk_save_as_segment", { name: name.trim() });
          }
        }}
        onUnsubscribe={() => submitBulk("bulk_unsubscribe")}
        onDelete={() => {
          const count = selectAllFiltered ? filteredTotal : selected.size;
          if (window.confirm(`Delete ${count} contact(s)?`)) {
            submitBulk("bulk_delete");
          }
        }}
        onClear={() => setSelected(new Set())}
      />

      <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} initialSync={sync} />
      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
