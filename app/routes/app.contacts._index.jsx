import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import Icons from "../components/ui/Icons.jsx";
import Avatar from "../components/contacts/Avatar.jsx";
import StatusPill from "../components/contacts/StatusPill.jsx";
import LifecyclePill from "../components/contacts/LifecyclePill.jsx";
import TagChip from "../components/contacts/TagChip.jsx";
import StatCard from "../components/contacts/StatCard.jsx";
import FilterDropdown from "../components/contacts/FilterDropdown.jsx";
import SyncModal from "../components/contacts/SyncModal.jsx";
import UnifyBanner from "../components/contacts/UnifyBanner.jsx";
import ContactsEmpty from "../components/contacts/ContactsEmpty.jsx";
import BulkBar from "../components/contacts/BulkBar.jsx";
import AddContactModal from "../components/contacts/AddContactModal.jsx";
import ImportCsvModal from "../components/contacts/ImportCsvModal.jsx";
import UpgradeNotice from "../components/billing/UpgradeNotice.jsx";
import { ConfirmDialog, PromptDialog, Toast } from "../components/ui/Dialog.jsx";
import { ColumnsButton, ColumnsModal, ViewsBar } from "../components/contacts/ColumnsMenu.jsx";
import PropertiesModal from "../components/contacts/PropertiesModal.jsx";
import { quotaState } from "../lib/billing/gate.server.js";
import {
  SOURCE,
  TAG_PALETTE,
  fmtMoney,
  relativeTime,
} from "../components/contacts/constants.js";
import {
  bulkSoftDelete,
  bulkUnsubscribe,
  computeLifecycle,
  createManualContact,
  emptyContactStats,
  listContacts,
  listAllContactIds,
  resubscribeContact,
  softDeleteContact,
  summarizeContacts,
  getContactStatsBatch,
  unsubscribeContact,
} from "../lib/contacts/contacts.server.js";
import { importContactRows, MAX_ROWS_PER_BATCH } from "../lib/contacts/import.server.js";
import { runContactsBackfillIfNeeded } from "../lib/contacts/backfill.server.js";
import { runOrdersBackfillIfNeeded } from "../lib/orders/backfill.server.js";
import { listTagsForShop, bulkApplyTag, upsertTag } from "../lib/contacts/tags.server.js";
import { getSyncProgress } from "../lib/contacts/shopifyCustomerSync.server.js";
import { createSegment } from "../lib/segments/segments.server.js";
import {
  createProperty,
  deleteProperty,
  listProperties,
  PROP_PREFIX,
  updateProperty,
} from "../lib/contacts/properties.server.js";
import {
  BUILTIN_COLUMNS,
  COLUMN_GROUPS,
  createView,
  deleteView,
  getDefaultColumns,
  listViews,
  sanitizeColumns,
  setDefaultColumns,
  updateView,
} from "../lib/contacts/views.server.js";

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const url = new URL(request.url);

  const status = url.searchParams.get("status") || "all";
  const source = url.searchParams.get("source") || "all";
  const tagId = url.searchParams.get("tag") || "all";
  const search = url.searchParams.get("q") || "";
  const cursor = url.searchParams.get("cursor") || undefined;

  // Unifies contacts already in our own tables (popup signups, cart
  // abandoners, push subscribers). Purely local, so it is correct for every
  // workspace kind.
  const backfill = await runContactsBackfillIfNeeded(shop);

  // Historical orders, so purchase columns aren't empty for an existing shop.
  // Resumable and self-limiting; never blocks the page on a failure.
  //
  // Shopify only. Without a store this reaches for an Admin API client that
  // does not exist and fails on every single page load — caught and logged, but
  // pure noise and wasted work for a workspace that has no orders by definition.
  if (ctx.isShopify) {
    runOrdersBackfillIfNeeded(shop).catch((err) =>
      console.error("[contacts] orders backfill failed:", err.message),
    );
  }

  const [{ rows, nextCursor, filteredTotal }, summary, tags, sync, properties, views, savedColumns] =
    await Promise.all([
      listContacts({ shop, status, source, tagId, search, cursor }),
      summarizeContacts(shop),
      listTagsForShop(shop),
      getSyncProgress(shop),
      listProperties(shop),
      listViews(shop),
      getDefaultColumns(shop),
    ]);

  // A stored column list can reference a property that has since been deleted,
  // so it is sanitized on read as well as write — rendering a column with no
  // definition behind it would throw.
  const columns = sanitizeColumns(savedColumns, properties);

  // Per-contact stats for the page, in a fixed number of grouped queries.
  // This was one getContactStats() call per row — six queries per contact — so
  // a 50-row page issued around 300 round trips to render one screen.
  const statsByEmail = await getContactStatsBatch(shop, rows.map((c) => c.email));
  const enriched = rows.map((c) => {
    const stats = statsByEmail.get(c.email) || emptyContactStats();
    return {
      id: c.id,
      email: c.email,
      name: c.name,
      firstSeenAt: c.firstSeenAt,
      lastSeenAt: c.lastSeenAt,
      source: c.source,
      subscriptionStatus: c.subscriptionStatus,
      phone: c.phone || "",
      customProps: c.customProps || {},
      lifecycleStage: computeLifecycle(c, stats),
      tags: c.tags.map((ct) => ({
        id: ct.tag.id,
        name: ct.tag.name,
        color: ct.tag.color,
      })),
      stats,
    };
  });

  // SOFT cap by design. We keep accepting contacts past the limit and only
  // prompt — silently dropping a merchant's signups to enforce billing would
  // cost them real revenue. Email sends are the hard gate instead.
  const contactQuota = await quotaState(shop, "contacts");

  return {
    contacts: enriched,
    summary,
    tags,
    sync,
    isShopify: ctx.isShopify,
    backfill,
    contactQuota,
    properties,
    // Named views exclude the nameless row that stores the default column
    // layout — it is configuration, not something to show in a view switcher.
    views: views.filter((v) => !v.isDefault),
    columns,
    builtinColumns: BUILTIN_COLUMNS,
    columnGroups: COLUMN_GROUPS,
    propPrefix: PROP_PREFIX,
    nextCursor: nextCursor || null,
    filteredTotal,
    filters: { status, source, tagId, search },
  };
};

export const action = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  // Declared inside the action deliberately. React Router only strips
  // server-only code from `loader`/`action`/`headers`/`middleware` exports — a
  // module-scope helper touching a *.server module gets pulled into the client
  // bundle and fails the build.
  const bulkFilters = () => ({
    status: String(fd.get("filterStatus") || "all"),
    source: String(fd.get("filterSource") || "all"),
    tagId: String(fd.get("filterTagId") || "all"),
    search: String(fd.get("filterSearch") || ""),
  });
  const selectAllFiltered = fd.get("selectAllFiltered") === "1";
  const resolveBulkEmails = async () => {
    if (!selectAllFiltered) return fd.getAll("email").map(String).filter(Boolean);
    const all = await listAllContactIds({ shop, ...bulkFilters() });
    return all.map((c) => c.email);
  };
  const resolveBulkIds = async () => {
    if (!selectAllFiltered) return fd.getAll("contactId").map(String).filter(Boolean);
    const all = await listAllContactIds({ shop, ...bulkFilters() });
    return all.map((c) => c.id);
  };

  // ── Custom properties, saved views, column layout ────────────────────────
  if (intent === "create_property") {
    return createProperty(shop, {
      label: String(fd.get("label") || ""),
      type: String(fd.get("type") || "text"),
      options: String(fd.get("options") || "")
        .split(/[\n,]/)
        .map((o) => o.trim())
        .filter(Boolean),
    });
  }

  if (intent === "update_property") {
    return updateProperty(shop, String(fd.get("id") || ""), {
      label: fd.get("label") !== null ? String(fd.get("label")) : undefined,
      options:
        fd.get("options") !== null
          ? String(fd.get("options")).split(/[\n,]/).map((o) => o.trim()).filter(Boolean)
          : undefined,
    });
  }

  if (intent === "delete_property") {
    return deleteProperty(shop, String(fd.get("id") || ""));
  }

  if (intent === "save_columns") {
    let columns = [];
    try { columns = JSON.parse(String(fd.get("columns") || "[]")); } catch { columns = []; }
    const defs = await listProperties(shop);
    await setDefaultColumns(shop, sanitizeColumns(columns, defs));
    return { ok: true, columnsSaved: true };
  }

  if (intent === "create_view") {
    let columns = [];
    let filters = {};
    try { columns = JSON.parse(String(fd.get("columns") || "[]")); } catch { columns = []; }
    try { filters = JSON.parse(String(fd.get("filters") || "{}")); } catch { filters = {}; }
    return createView(shop, { name: String(fd.get("name") || ""), filters, columns });
  }

  if (intent === "update_view") {
    let columns;
    let filters;
    if (fd.get("columns") !== null) {
      try { columns = JSON.parse(String(fd.get("columns"))); } catch { columns = undefined; }
    }
    if (fd.get("filters") !== null) {
      try { filters = JSON.parse(String(fd.get("filters"))); } catch { filters = undefined; }
    }
    return updateView(shop, String(fd.get("id") || ""), {
      name: fd.get("name") !== null ? String(fd.get("name")) : undefined,
      filters,
      columns,
    });
  }

  if (intent === "delete_view") {
    return deleteView(shop, String(fd.get("id") || ""));
  }

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

  // Both bulk paths below used to run one await per contact. With "select all
  // matching filter" on a large list that is tens of thousands of sequential
  // round trips inside a single request — it times out partway and leaves the
  // operation half-applied. Set-based writes make the cost independent of the
  // selection size.
  if (intent === "bulk_unsubscribe") {
    const emails = await resolveBulkEmails();
    if (!emails.length) return { ok: false, error: "No contacts selected." };
    const count = await bulkUnsubscribe(shop, emails);
    return { ok: true, bulk: "unsubscribe", count };
  }

  if (intent === "bulk_delete") {
    const ids = await resolveBulkIds();
    if (!ids.length) return { ok: false, error: "No contacts selected." };
    const count = await bulkSoftDelete(shop, ids);
    return { ok: true, bulk: "delete", count };
  }

  if (intent === "bulk_apply_tag") {
    const tagName = String(fd.get("tagName") || "").trim();
    if (!tagName) return { ok: false, error: "Enter a tag name." };
    const tag = await upsertTag(shop, tagName);
    if (!tag) return { ok: false, error: "Could not create that tag." };

    const ids = await resolveBulkIds();
    if (!ids.length) return { ok: false, error: "No contacts selected." };
    await bulkApplyTag(shop, ids, tag.id);
    return { ok: true, bulk: "tag", count: ids.length, tagName };
  }

  if (intent === "resubscribe") {
    const email = String(fd.get("email") || "");
    await resubscribeContact(shop, email);
    return { ok: true };
  }

  // One CHUNK of an import. The client slices the file and posts batches in
  // sequence, so a large list arrives as many small requests instead of one
  // oversized body that blows the request limit or times out mid-write.
  if (intent === "import_csv") {
    let rows;
    try {
      rows = JSON.parse(String(fd.get("rows") || "[]"));
    } catch {
      return {
        intent: "import_csv",
        ok: false,
        error: "That batch could not be read. Please retry the import.",
      };
    }
    if (!Array.isArray(rows)) {
      return { intent: "import_csv", ok: false, error: "Unexpected import payload." };
    }
    if (rows.length > MAX_ROWS_PER_BATCH) {
      return {
        intent: "import_csv",
        ok: false,
        error: `Batches are limited to ${MAX_ROWS_PER_BATCH} rows.`,
      };
    }

    // The merchant has ticked the box confirming these people opted in. Without
    // it contacts import as non-marketable rather than being handed a
    // fabricated consent timestamp.
    const consent = fd.get("consent") === "1";

    const counts = await importContactRows(shop, rows, { consent });
    return { intent: "import_csv", ok: true, ...counts };
  }

  if (intent === "bulk_save_as_segment") {
    const name = String(fd.get("name") || "").trim();
    if (!name) return { ok: false, error: "Give the segment a name." };

    // "Select all matching filter" sends no contactId fields, only the filters.
    // The old version read contactId exclusively, found none, and returned
    // { ok: false } — so the merchant was prompted for a name, submitted, and
    // nothing happened, with no error anywhere. resolveBulkIds handles both
    // shapes, exactly as the other bulk intents do.
    const ids = await resolveBulkIds();
    if (!ids.length) return { ok: false, error: "No contacts selected." };

    const seg = await createSegment(shop, {
      name,
      description: `Static segment of ${ids.length} contact${ids.length === 1 ? "" : "s"} saved from Contacts.`,
      kind: "static",
      filterTree: null,
      memberContactIds: ids,
    });
    return { ok: true, segmentId: seg.id, segmentName: name, memberCount: ids.length };
  }

  return { ok: false };
};

/**
 * Rendering rules per column key.
 *
 * `width` feeds the grid track list; `numeric` right-aligns; `cellClass` carries
 * the existing row styling so a reordered table still looks like the old one.
 * Custom properties are handled separately below — they share one presentation.
 */
const COLUMN_SPEC = {
  contact:   { width: "2.2fr",  cellClass: "rt-cname" },
  status:    { width: "1.05fr" },
  lifecycle: { width: "1.05fr" },
  tags:      { width: "1.4fr",  cellClass: "rt-ctags" },
  carts:     { width: "0.95fr", numeric: true, cellClass: "rt-tnum rt-tmoney" },
  lastSeen:  { width: "0.95fr", numeric: true, cellClass: "rt-tnum rt-tdate" },
  firstSeen: { width: "0.95fr", numeric: true, cellClass: "rt-tnum rt-tdate" },
  source:    { width: "1fr" },
  phone:     { width: "1.1fr" },
  emails:    { width: "0.8fr",  numeric: true, cellClass: "rt-tnum t-mono" },
  opens:     { width: "0.8fr",  numeric: true, cellClass: "rt-tnum t-mono" },
  orders:    { width: "0.7fr",  numeric: true, cellClass: "rt-tnum t-mono" },
  spent:     { width: "0.9fr",  numeric: true, cellClass: "rt-tnum rt-tmoney" },
  lastOrder: { width: "0.95fr", numeric: true, cellClass: "rt-tnum rt-tdate" },
};

const DASH = <span className="muted">—</span>;

export default function ContactsPage() {
  const loaderData = useLoaderData();
  const {
    summary, tags, sync, backfill, filters, contactQuota, isShopify,
    properties = [], views = [], builtinColumns = [], columnGroups = [], propPrefix = "prop:",
  } = loaderData;
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
  // Which confirm/prompt dialog is open, replacing window.confirm/prompt.
  const [dialog, setDialog] = useState(null);
  // Column layout is server-persisted; local state lets the merchant rearrange
  // before committing with "Save layout".
  const [columns, setColumns] = useState(loaderData.columns);
  const [activeViewId, setActiveViewId] = useState(null);
  const [propsOpen, setPropsOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const busy = fetcher.state !== "idle";

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

  const bulkCount = selectAllFiltered ? filteredTotal : selected.size;

  // The export honours whatever filters are active, so "export what I'm
  // looking at" does what it says.
  const exportQuery = new URLSearchParams();
  if (filters.status !== "all") exportQuery.set("status", filters.status);
  if (filters.source !== "all") exportQuery.set("source", filters.source);
  if (filters.tagId !== "all") exportQuery.set("tag", filters.tagId);
  if (filters.search) exportQuery.set("q", filters.search);
  const exportHref = `/app/contacts/export?${exportQuery.toString()}`;

  // Bulk actions used to complete with no feedback whatsoever — the page simply
  // re-rendered, giving no sign that 1,200 contacts had just been unsubscribed.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const d = fetcher.data;
    if (d.ok === false && d.error) {
      setToast(d.error);
      return;
    }
    if (!d.ok) return;
    const n = (d.count || 0).toLocaleString();
    if (d.bulk === "unsubscribe") setToast(`Unsubscribed ${n} contacts.`);
    else if (d.bulk === "delete") setToast(`Deleted ${n} contacts.`);
    else if (d.bulk === "tag") setToast(`Tagged ${n} contacts as "${d.tagName}".`);
    else if (d.segmentId) setToast(`Segment "${d.segmentName}" created with ${(d.memberCount || 0).toLocaleString()} contacts.`);
  }, [fetcher.state, fetcher.data]);

  // Resolve the saved column keys into render-ready descriptors. Anything that
  // no longer resolves (a deleted property) is dropped rather than throwing.
  const propByKey = new Map(properties.map((pr) => [pr.key, pr]));
  const activeColumns = columns
    .map((key) => {
      if (key.startsWith(propPrefix)) {
        const def = propByKey.get(key.slice(propPrefix.length));
        if (!def) return null;
        return {
          key,
          label: def.label,
          width: "1fr",
          propKey: def.key,
          propType: def.type,
          cellClass: "t-small",
        };
      }
      const builtin = builtinColumns.find((b) => b.key === key);
      if (!builtin) return null;
      const spec = COLUMN_SPEC[key] || { width: "1fr" };
      return { key, label: builtin.label, ...spec };
    })
    .filter(Boolean);

  // checkbox + configured columns + row-actions gutter
  const gridTemplate = `40px ${activeColumns.map((c) => c.width).join(" ")} 44px`;

  function renderCell(col, c) {
    if (col.propKey) {
      const raw = c.customProps?.[col.propKey];
      if (raw === undefined || raw === null || raw === "") return DASH;
      if (col.propType === "boolean") return raw ? "Yes" : "No";
      if (col.propType === "date") {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? DASH : d.toLocaleDateString();
      }
      if (col.propType === "number") return Number(raw).toLocaleString();
      return String(raw);
    }

    switch (col.key) {
      case "contact":
        return (
          <>
            <Avatar name={c.name} email={c.email} size={32} />
            <div style={{ minWidth: 0 }}>
              <div className="rt-cname-email">{c.email}</div>
              <div className="rt-cname-name">{c.name || "—"}</div>
            </div>
          </>
        );
      case "status":
        return <StatusPill status={c.subscriptionStatus} />;
      case "lifecycle":
        return <LifecyclePill stage={c.lifecycleStage} />;
      case "tags":
        return (
          <>
            {c.tags.slice(0, 2).map((t) => <TagChip key={t.id} tag={t} />)}
            {c.tags.length > 2 && <span className="rt-tag-overflow">+{c.tags.length - 2}</span>}
            {c.tags.length === 0 && <span className="muted t-small">—</span>}
          </>
        );
      case "carts":
        return c.stats.cartAbandonCount
          ? `${c.stats.cartAbandonCount} · ${fmtMoney(c.stats.lastCartValue)}`
          : DASH;
      case "lastSeen":
        return relativeTime(c.lastSeenAt);
      case "firstSeen":
        return relativeTime(c.firstSeenAt);
      case "source":
        return SOURCE[c.source] || c.source;
      case "phone":
        return c.phone || DASH;
      case "emails":
        return c.stats.emailsSent ? c.stats.emailsSent.toLocaleString() : DASH;
      case "opens":
        return c.stats.emailsSent ? `${c.stats.openRate.toFixed(0)}%` : DASH;
      case "orders":
        return c.stats.orderCount ? c.stats.orderCount.toLocaleString() : DASH;
      case "spent":
        return c.stats.orderCount ? fmtMoney(c.stats.totalSpent) : DASH;
      case "lastOrder":
        return c.stats.lastOrderAt ? relativeTime(c.stats.lastOrderAt) : DASH;
      default:
        return null;
    }
  }

  const showFullEmpty = summary.total === 0;

  if (showFullEmpty) {
    return (
      <div className="rt-page">
        <ContactsEmpty
          onSync={isShopify ? () => setSyncOpen(true) : null}
          onAdd={() => setAddOpen(true)}
          onImport={() => setImportOpen(true)}
        />
        <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} initialSync={sync} />
        <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
        <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} properties={properties} />
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
            {isShopify
              ? "Everyone who has touched your store — subscribers, buyers, cart abandoners, and push opt-ins, unified into a single profile."
              : "Everyone on your list, with every field you import and every send they've received, unified into a single profile."}
          </p>
        </div>
        <div className="rt-page-actions">
          {/* Nothing to sync from without a connected store. */}
          {isShopify && sync.lastSyncedAt && (
            <div className="rt-sync-pill">
              <Icons.Clock size={12} />
              <span>Last synced {relativeTime(sync.lastSyncedAt)}</span>
            </div>
          )}
          {isShopify && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSyncOpen(true)}
            >
              <Icons.Refresh size={14} /> Sync from Shopify
            </button>
          )}
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
                  {/* A real link, not a fetcher — the response is a streamed
                      file download the browser must handle itself. Carries the
                      current filters so it exports what's on screen. */}
                  <a href={exportHref} download onClick={() => setOpenMenu(null)}>
                    <Icons.ArrowUp size={14} /> Export CSV
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Soft cap: we keep accepting contacts past the limit — this only
          prompts. Shown once enforcement is on and the shop is over. */}
      {contactQuota?.atLimit && contactQuota?.enforced && (
        <UpgradeNotice
          title={`You're over your contact limit (${contactQuota.used.toLocaleString()} of ${contactQuota.limit.toLocaleString()}).`}
          body="We're still collecting every new contact — nothing is being dropped. Upgrade to keep emailing your full list."
          planName={contactQuota.upgradeToName}
          compact
        />
      )}

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

      {isShopify && showUnify && (
        <UnifyBanner
          count={backfill.added}
          onDismiss={() => setShowUnify(false)}
          onSync={() => {
            setShowUnify(false);
            setSyncOpen(true);
          }}
        />
      )}

      <ViewsBar
        views={views}
        activeViewId={activeViewId}
        dirty={activeViewId === null && (filters.status !== "all" || filters.source !== "all" || filters.tagId !== "all")}
        onSelect={(id) => {
          setActiveViewId(id);
          const view = views.find((v) => v.id === id);
          const next = new URLSearchParams();
          if (view?.filters) {
            for (const [k, v] of Object.entries(view.filters)) {
              if (v && v !== "all") next.set(k === "tagId" ? "tag" : k === "search" ? "q" : k, String(v));
            }
          }
          setParams(next, { replace: true });
          if (Array.isArray(view?.columns) && view.columns.length) setColumns(view.columns);
        }}
        onSaveNew={() => setDialog({ kind: "save-view" })}
        onDelete={(v) => setDialog({ kind: "delete-view", view: v })}
      />

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
          <ColumnsButton onClick={() => setColumnsOpen(true)} />
          <button className="btn btn-secondary" onClick={() => setPropsOpen(true)}>
            <Icons.Tag size={14} /> Properties
          </button>
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

      <div className="rt-ctable" style={{ "--rt-ct-cols": gridTemplate }}>
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
          {activeColumns.map((col) => (
            <div key={col.key} className={col.numeric ? "rt-tnum" : undefined}>
              {col.label}
            </div>
          ))}
          <div />
        </div>

        {/* Select-all-filtered banner — sits directly under the column headers */}
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
              {activeColumns.map((col) => (
                <div key={col.key} className={col.cellClass}>
                  {renderCell(col, c)}
                </div>
              ))}
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
                          // Row delete had no confirmation at all — one stray
                          // click removed a contact with no undo.
                          setDialog({ kind: "delete-one", contact: c });
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
          {filteredTotal.toLocaleString()} contacts · Sorted by last seen, newest first
        </span>
      </div>

      {nextCursor && (
        <div style={{ display: "flex", justifyContent: "center", padding: "16px 0 8px" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadMore}
            disabled={moreFetcher.state !== "idle"}
          >
            {moreFetcher.state !== "idle" ? "Loading…" : `Load more · ${(filteredTotal - contacts.length).toLocaleString()} remaining`}
          </button>
        </div>
      )}

      <BulkBar
        selectedCount={bulkCount}
        onAddTag={() => setDialog({ kind: "tag" })}
        onSaveAsSegment={() => setDialog({ kind: "segment" })}
        // Unsubscribing in bulk is as consequential as deleting — it is
        // irreversible from the shopper's side and permanently shrinks the
        // sendable list — so it gets a confirmation too. Only delete had one.
        onUnsubscribe={() => setDialog({ kind: "unsubscribe" })}
        onDelete={() => setDialog({ kind: "delete" })}
        onClear={() => { setSelected(new Set()); setSelectAllFiltered(false); }}
        onExport={exportHref}
      />

      {dialog?.kind === "tag" && (
        <PromptDialog
          title="Add a tag"
          body={`Applies to ${bulkCount.toLocaleString()} selected ${bulkCount === 1 ? "contact" : "contacts"}. Existing tags are reused.`}
          label="Tag name"
          placeholder="e.g. VIP"
          confirmLabel="Add tag"
          loading={busy}
          onCancel={() => setDialog(null)}
          onConfirm={(tagName) => { submitBulk("bulk_apply_tag", { tagName }); setDialog(null); }}
        />
      )}

      {dialog?.kind === "segment" && (
        <PromptDialog
          title="Save as segment"
          body={`Creates a static segment containing the ${bulkCount.toLocaleString()} selected ${bulkCount === 1 ? "contact" : "contacts"}.`}
          label="Segment name"
          placeholder="e.g. Spring launch list"
          confirmLabel="Create segment"
          loading={busy}
          onCancel={() => setDialog(null)}
          onConfirm={(name) => { submitBulk("bulk_save_as_segment", { name }); setDialog(null); }}
        />
      )}

      {dialog?.kind === "unsubscribe" && (
        <ConfirmDialog
          title={`Unsubscribe ${bulkCount.toLocaleString()} ${bulkCount === 1 ? "contact" : "contacts"}?`}
          body="They stop receiving marketing email immediately and are added to your suppression list. Only they can opt back in."
          confirmLabel="Unsubscribe"
          destructive
          loading={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => { submitBulk("bulk_unsubscribe"); setDialog(null); }}
        />
      )}

      {dialog?.kind === "delete-one" && (
        <ConfirmDialog
          title="Delete this contact?"
          body={`${dialog.contact.email} will be removed from your list and from every segment.`}
          confirmLabel="Delete"
          destructive
          loading={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => { submitRowAction("delete", dialog.contact); setDialog(null); }}
        />
      )}

      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${bulkCount.toLocaleString()} ${bulkCount === 1 ? "contact" : "contacts"}?`}
          body="They're removed from your list and from every segment. Their suppression history is kept, so a deleted contact who had unsubscribed stays unsubscribed."
          confirmLabel="Delete"
          destructive
          loading={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => { submitBulk("bulk_delete"); setDialog(null); }}
        />
      )}

      {dialog?.kind === "save-view" && (
        <PromptDialog
          title="Save this view"
          body="Remembers the current filters and column layout so you can come back to them in one click."
          label="View name"
          placeholder="e.g. Unsubscribed this month"
          confirmLabel="Save view"
          loading={busy}
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            fetcher.submit(
              {
                intent: "create_view",
                name,
                filters: JSON.stringify(filters),
                columns: JSON.stringify(columns),
              },
              { method: "post" },
            );
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "delete-view" && (
        <ConfirmDialog
          title={`Delete the "${dialog.view.name}" view?`}
          body="Only the saved filters and layout are removed. No contacts are affected."
          confirmLabel="Delete view"
          destructive
          loading={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            fetcher.submit({ intent: "delete_view", id: dialog.view.id }, { method: "post" });
            if (activeViewId === dialog.view.id) setActiveViewId(null);
            setDialog(null);
          }}
        />
      )}

      {columnsOpen && (
        <ColumnsModal
          builtins={builtinColumns}
          groups={columnGroups}
          properties={properties}
          propPrefix={propPrefix}
          columns={columns}
          onChange={setColumns}
          saving={busy}
          onClose={() => setColumnsOpen(false)}
          onSave={(next) => {
            fetcher.submit(
              { intent: "save_columns", columns: JSON.stringify(next) },
              { method: "post" },
            );
            setColumnsOpen(false);
          }}
        />
      )}

      <PropertiesModal
        open={propsOpen}
        onClose={() => setPropsOpen(false)}
        properties={properties}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />

      <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} initialSync={sync} />
      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} properties={properties} />
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
