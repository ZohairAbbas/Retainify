/**
 * Campaign report for a single flow.
 *
 * Route name uses the `$id_` escape so it does NOT nest inside
 * app.flows.$id.jsx — the builder is a full-page takeover with no <Outlet />.
 *
 * Replaces the previous "analytics" affordance, which was a toggle that
 * overlaid three numbers on email nodes, appeared only on published flows in
 * canvas view, and covered neither push nor WhatsApp.
 */
import { useEffect, useState } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useRouteError,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import Icons from "../components/ui/Icons.jsx";
import { STATUS_PILL, TRIGGER_CONFIG } from "../lib/triggerConfig.js";
import {
  RANGE_OPTIONS,
  countCampaignRecipients,
  getCampaignOverview,
  getCampaignStepBreakdown,
  listCampaignRecipients,
  resolveRange,
} from "../lib/analytics/campaign.server.js";
import { ATTRIBUTION_WINDOW_DAYS } from "../lib/analytics/attribution.server.js";


const PAGE_SIZE = 100;

const RECIPIENT_FILTERS = [
  { id: "all", label: "All" },
  { id: "opened", label: "Opened" },
  { id: "clicked", label: "Clicked" },
  { id: "unopened", label: "Not opened" },
];

export const loader = async ({ request, params }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const { id } = params;

  const url = new URL(request.url);
  const days = resolveRange(url.searchParams.get("range"));
  const filter = RECIPIENT_FILTERS.some((f) => f.id === url.searchParams.get("filter"))
    ? url.searchParams.get("filter")
    : "all";
  const cursor = url.searchParams.get("cursor") || null;

  const overview = await getCampaignOverview(shop, id, days);
  if (!overview) throw new Response("Not found", { status: 404 });

  const [steps, recipients, recipientTotal] = await Promise.all([
    getCampaignStepBreakdown(shop, id, days),
    listCampaignRecipients({ shop, journeyId: id, days, cursor, limit: PAGE_SIZE, filter }),
    countCampaignRecipients({ shop, journeyId: id, days, filter }),
  ]);

  return {
    overview,
    steps,
    recipients: recipients.rows,
    nextCursor: recipients.nextCursor,
    recipientTotal,
    days,
    filter,
    ranges: RANGE_OPTIONS,
    // Through the loader rather than imported into the component: the module is
    // .server.js and is stripped from the client bundle.
    attributionWindowDays: ATTRIBUTION_WINDOW_DAYS,
  };
};

// ── Presentation helpers ───────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);
const pct = (n) => `${(Number(n) || 0).toFixed(1)}%`;

/**
 * Format money in the currency the orders were actually taken in.
 *
 * The currency was hardcoded to USD, which for a store selling in PKR rendered
 * every figure with the wrong symbol and off by a factor of roughly 280.
 * Falls back to plain digits when we have no code rather than guessing one.
 */
function money(n, currency) {
  const value = Number(n) || 0;
  if (!currency) return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function when(value) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className="rt-stat">
      <div className="t-micro muted">{label}</div>
      <div className="rt-stat-value" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="rt-stat-delta muted">{sub}</div>}
    </div>
  );
}

const CHANNEL_LABEL = { email: "Email", push: "Push", whatsapp: "WhatsApp" };

export default function CampaignAnalytics() {
  const {
    overview,
    steps,
    recipients,
    nextCursor,
    recipientTotal,
    days,
    filter,
    ranges,
    attributionWindowDays,
  } = useLoaderData();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const moreFetcher = useFetcher();

  // Accumulated pages of recipients. Reset whenever the query that produced
  // them changes, which is what the key comparison below detects.
  const queryKey = `${days}:${filter}`;
  const [pageKey, setPageKey] = useState(queryKey);
  const [rows, setRows] = useState(recipients);
  const [cursor, setCursor] = useState(nextCursor);

  if (pageKey !== queryKey) {
    setPageKey(queryKey);
    setRows(recipients);
    setCursor(nextCursor);
  }

  // Append each loaded page. Deduped by id so a double-fire cannot repeat rows.
  useEffect(() => {
    if (moreFetcher.state !== "idle" || !moreFetcher.data?.recipients) return;
    const incoming = moreFetcher.data.recipients;
    if (!incoming.length) return;
    setRows((prev) => {
      const ids = new Set(prev.map((r) => r.id));
      const added = incoming.filter((r) => !ids.has(r.id));
      return added.length ? [...prev, ...added] : prev;
    });
    setCursor(moreFetcher.data.nextCursor);
  }, [moreFetcher.state, moreFetcher.data]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    next.delete("cursor");
    if (!value || value === "all") next.delete(key);
    else next.set(key, String(value));
    setParams(next, { replace: true });
  };

  const loadMore = () => {
    if (!cursor) return;
    const next = new URLSearchParams(params);
    next.set("cursor", cursor);
    moreFetcher.load(`/app/flows/${overview.journey.id}/analytics?${next.toString()}`);
  };

  const exportUrl = `/app/flows/${overview.journey.id}/analytics/export?range=${days}&filter=${filter}`;

  const trig = TRIGGER_CONFIG[overview.journey.trigger] || TRIGGER_CONFIG.customer_created;
  const pillClass = STATUS_PILL[overview.journey.status] || "draft";
  const pillLabel = pillClass === "active" ? "Active" : pillClass.charAt(0).toUpperCase() + pillClass.slice(1);

  const hasAnySend =
    overview.email.sent > 0 || overview.push.sent > 0 || overview.whatsapp.sent > 0;

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginBottom: 10 }}
            onClick={() => navigate(`/app/flows/${overview.journey.id}${location.search}`)}
          >
            <Icons.ArrowBack size={14} /> Back to flow
          </button>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>
            Retainify · Campaign report
          </div>
          <h1 className="t-display-2" style={{ margin: 0 }}>{overview.journey.name}</h1>
          <p className="t-body muted" style={{ margin: "8px 0 0" }}>
            {trig.label} · <span className={`pill ${pillClass}`}>{pillLabel}</span>
          </p>
        </div>
        <div className="rt-page-actions">
          <select
            className="select"
            value={days}
            onChange={(e) => setParam("range", e.target.value)}
            aria-label="Date range"
          >
            {ranges.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {/* A plain link, not a fetch — the response is a streamed file
              download and must be handled by the browser, not by JS. */}
          <a className="btn btn-secondary" href={exportUrl} download>
            <Icons.ArrowUp size={14} /> Export CSV
          </a>
        </div>
      </header>

      {!hasAnySend && (
        <div className="card card-pad" style={{ marginBottom: 24 }}>
          <div className="t-h3" style={{ marginBottom: 6 }}>Nothing sent in this period</div>
          <div className="t-small muted">
            {overview.journey.status === "published"
              ? "This flow is live but hasn't sent anything in the selected range. Try a longer range."
              : "This flow isn't live, so it isn't enrolling anyone. Publish it to start sending."}
          </div>
        </div>
      )}

      {/* Audience */}
      <div className="t-micro muted" style={{ marginBottom: 12 }}>Audience</div>
      <section className="rt-stats" style={{ marginBottom: 24 }}>
        <Stat label="Entered flow" value={fmt(overview.enrolled)} sub={`Last ${days} days`} />
        <Stat label="Completed" value={fmt(overview.completed)} sub="Reached the end" />
        <Stat label="Exited early" value={fmt(overview.exited)} sub="Met an exit criterion" />
        <Stat label="Still in progress" value={fmt(overview.inProgress)} sub="Messages queued" />
      </section>

      {/* Email */}
      <div className="t-micro muted" style={{ marginBottom: 12 }}>Email performance</div>
      <section className="rt-stats" style={{ marginBottom: 24 }}>
        <Stat
          label="Sent"
          value={fmt(overview.email.sent)}
          sub={overview.email.failed ? `${fmt(overview.email.failed)} failed` : "No failures"}
        />
        {/* Delivery is only shown for windows we can actually measure. Sends
            made before delivery events were subscribed carry no delivery data,
            and printing "0 delivered" for them would misreport healthy email as
            a total failure. */}
        {overview.email.deliveryTracked && (
          <Stat
            label="Delivered"
            value={fmt(overview.email.delivered)}
            sub={`${pct(overview.email.deliveryRate)} of sends reached the inbox`}
          />
        )}
        <Stat label="Open rate" value={pct(overview.email.openRate)} sub={`${fmt(overview.email.opened)} opened`} />
        <Stat label="Click rate" value={pct(overview.email.clickRate)} sub={`${fmt(overview.email.clicked)} clicked`} />
        <Stat
          label="Unsubscribed"
          value={fmt(overview.unsubscribed)}
          sub={`${pct(overview.unsubscribeRate)} of sends`}
        />
      </section>

      {/* Other channels, shown only when the flow uses them */}
      {(overview.push.sent > 0 || overview.whatsapp.sent > 0) && (
        <>
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Other channels</div>
          <section className="rt-stats" style={{ marginBottom: 24 }}>
            {overview.push.sent > 0 && (
              <>
                <Stat label="Push sent" value={fmt(overview.push.sent)} />
                <Stat label="Push click rate" value={pct(overview.push.clickRate)} sub={`${fmt(overview.push.clicked)} clicked`} />
              </>
            )}
            {overview.whatsapp.sent > 0 && (
              <>
                <Stat label="WhatsApp sent" value={fmt(overview.whatsapp.sent)} sub={`${fmt(overview.whatsapp.delivered)} delivered`} />
                <Stat label="WhatsApp read rate" value={pct(overview.whatsapp.readRate)} sub={`${fmt(overview.whatsapp.read)} read`} />
              </>
            )}
          </section>
        </>
      )}

      {/* Revenue — every trigger, credited to the last click before the order */}
      <div className="t-micro muted" style={{ marginBottom: 12 }}>Attributed revenue</div>
      <section className="rt-stats" style={{ marginBottom: 24 }}>
        {overview.revenue.tracked ? (
          <>
            <Stat
              label="Revenue"
              value={money(overview.revenue.revenue, overview.revenue.currency)}
              sub={`${fmt(overview.revenue.orders)} ${overview.revenue.orders === 1 ? "order" : "orders"} within ${attributionWindowDays} days of a click`}
              tone="var(--brand-700)"
            />
            {overview.revenue.mixed && (
              <Stat
                label="Multiple currencies"
                value={overview.revenue.currency}
                sub="Orders in other currencies are not included in this total"
              />
            )}
          </>
        ) : (
          <Stat
            label="Revenue"
            value="Not tracked"
            sub="This flow's messages went out before click tracking was active, so revenue can't be measured for this period."
          />
        )}
      </section>

      {/* Per-step */}
      <div className="t-micro muted" style={{ marginBottom: 12 }}>Step by step</div>
      <div className="tscroll" style={{ overflowX: "auto", marginBottom: 32 }}>
        <div className="rt-table rt-table--steps" style={{ minWidth: 900 }}>
          <div className="rt-thead">
            <div>Step</div>
            <div>Channel</div>
            <div className="rt-tnum">Sent</div>
            <div className="rt-tnum">Opened</div>
            <div className="rt-tnum">Clicked</div>
            <div className="rt-tnum">Open rate</div>
            <div className="rt-tnum">Click rate</div>
            <div className="rt-tnum">Orders</div>
            <div className="rt-tnum">Revenue</div>
          </div>
          {steps.length === 0 && (
            <div className="rt-empty-row">This flow has no sendable steps yet.</div>
          )}
          {steps.map((s) => (
            <div key={s.stepId} className="rt-trow">
              <div>
                <div className="rt-flow-name">{s.label}</div>
                {s.subject && <div className="rt-flow-meta">{s.subject}</div>}
                {s.removed ? (
                  <div className="rt-flow-meta">Removed from the flow · past sends</div>
                ) : (
                  !s.isEnabled && <div className="rt-flow-meta">Disabled</div>
                )}
              </div>
              <div>{CHANNEL_LABEL[s.channel] || s.channel}</div>
              <div className="rt-tnum t-mono">{fmt(s.sent)}</div>
              <div className="rt-tnum t-mono">
                {s.channel === "email" ? fmt(s.opened) : "—"}
              </div>
              <div className="rt-tnum t-mono">
                {s.channel === "whatsapp" ? "—" : fmt(s.clicked)}
              </div>
              <div className="rt-tnum t-mono">
                {s.channel === "email" && s.sent ? pct(s.openRate) : "—"}
              </div>
              <div className="rt-tnum t-mono">
                {s.channel !== "whatsapp" && s.sent ? pct(s.clickRate) : "—"}
              </div>
              {/* WhatsApp records no click, so it can never carry credit under
                  a click-based model — a dash, not a zero. */}
              <div className="rt-tnum t-mono">
                {s.channel === "whatsapp" || s.orders === null ? "—" : fmt(s.orders)}
              </div>
              <div className="rt-tnum t-mono">
                {s.channel === "whatsapp" || s.revenue === null
                  ? "—"
                  : money(s.revenue, s.currency)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recipients */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div className="t-micro muted">Recipients</div>
        <div className="rt-chips" style={{ marginLeft: "auto" }}>
          {RECIPIENT_FILTERS.map((f) => (
            <button
              key={f.id}
              className={`rt-chip${filter === f.id ? " rt-chip-on" : ""}`}
              onClick={() => setParam("filter", f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="tscroll" style={{ overflowX: "auto" }}>
        <div className="rt-table" style={{ minWidth: 760 }}>
          <div className="rt-thead">
            <div>Contact</div>
            <div>Step</div>
            <div>Sent</div>
            <div>Opened</div>
            <div>Clicked</div>
            <div>Status</div>
          </div>
          {rows.length === 0 && (
            <div className="rt-empty-row">
              No recipients match this filter in the selected range.
            </div>
          )}
          {rows.map((r) => (
            <div key={r.id} className="rt-trow">
              <div>
                <div className="rt-flow-name">{r.email}</div>
                {r.name && <div className="rt-flow-meta">{r.name}</div>}
              </div>
              <div>{r.step}</div>
              <div className="rt-tdate">{when(r.sentAt) || "—"}</div>
              <div className="rt-tdate">
                {r.openedAt ? (
                  <span className="rt-yes"><Icons.Check size={12} /> {when(r.openedAt)}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
              <div className="rt-tdate">
                {r.clickedAt ? (
                  <span className="rt-yes"><Icons.Check size={12} /> {when(r.clickedAt)}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
              <div>
                {r.status === "failed" ? (
                  <span className="pill" title={r.error}>Failed</span>
                ) : (
                  <span className="muted t-small">Delivered</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rt-table-foot">
        <span className="muted">
          Showing <strong style={{ color: "var(--ink-1)" }}>{fmt(rows.length)}</strong> of{" "}
          {fmt(recipientTotal)} · One row per message sent
        </span>
      </div>

      {cursor && (
        <div style={{ display: "flex", justifyContent: "center", padding: "16px 0 8px" }}>
          <button
            className="btn btn-secondary"
            onClick={loadMore}
            disabled={moreFetcher.state !== "idle"}
          >
            {moreFetcher.state !== "idle"
              ? "Loading…"
              : `Load more · ${fmt(Math.max(0, recipientTotal - rows.length))} remaining`}
          </button>
        </div>
      )}

      <div className="t-small muted" style={{ marginTop: 28, maxWidth: "68ch", lineHeight: 1.6 }}>
        Opens are counted when a mail client loads the tracking pixel, so
        privacy-protecting clients under-report them. Unsubscribes are attributed
        to this campaign when they happen after one of its sends.{" "}
        <Link to={`/app/flows/${overview.journey.id}${location.search}`}>Edit this flow →</Link>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
