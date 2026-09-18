import { useState, useRef, Fragment } from "react";
import { useLoaderData, useNavigate, useLocation, useFetcher, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import { canManage } from "../lib/auth/roles.js";
import { getFlowAttributionBatch } from "../lib/analytics/attribution.server.js";
import prisma from "../db.server.js";
import {
  seedJourneyTemplates,
  getJourneyTemplates,
  createJourneyFromTemplate,
  createBlankJourney,
} from "../lib/journey/journey-templates.server.js";
import Icons from "../components/ui/Icons.jsx";
import { TRIGGER_CONFIG, STATUS_PILL, timeAgo, triggersFor, defaultTriggerFor } from "../lib/triggerConfig.js";
import { isInternalShop } from "../lib/internal/tenant.js";
import { whatsappReadiness, flowsUsingWhatsapp } from "../lib/whatsapp/readiness.server.js";
import { WHATSAPP_PROBLEMS } from "../lib/whatsapp/problems.js";
import { requireQuota } from "../lib/billing/gate.server.js";
import {
  TEMPLATE_CATEGORIES,
  recommendTemplates,
  templateAvailable,
  templateChannels,
} from "../lib/journey/template-library.js";

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;

  await seedJourneyTemplates().catch(() => {});

  const [journeys, templates] = await Promise.all([
    prisma.journey.findMany({
      where: { shop, archivedAt: null, trigger: { not: "broadcast" } },
      include: {
        steps: { where: { isArchived: false }, orderBy: { stepNumber: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    getJourneyTemplates(),
  ]);

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // One grouped query for the whole table. This was three counts per journey,
  // so a shop with a dozen flows issued three dozen round trips to render a
  // list that shows three numbers per row.
  // `sent` means sentAt — the provider accepted the call. It was aliased and
  // labelled "delivered", which is a different and smaller number that
  // campaign.server.js tracks separately from deliveredAt.
  const statRows = journeys.length
    ? await prisma.$queryRaw`
        SELECT s."journeyId" AS "journeyId",
               COUNT(*) FILTER (WHERE j."sentAt"    IS NOT NULL) AS sent,
               COUNT(*) FILTER (WHERE j."openedAt"  IS NOT NULL) AS opened,
               COUNT(*) FILTER (WHERE j."clickedAt" IS NOT NULL) AS clicked
          FROM "JourneyJob" j
          JOIN "JourneyStep" s ON s.id = j."stepId"
         WHERE s."journeyId" = ANY(${journeys.map((j) => j.id)})
           AND j."sentAt" >= ${since}
         GROUP BY s."journeyId"`
    : [];
  const statsById = Object.fromEntries(
    statRows.map((r) => [
      r.journeyId,
      {
        id: r.journeyId,
        sent: Number(r.sent) || 0,
        opened: Number(r.opened) || 0,
        clicked: Number(r.clicked) || 0,
      },
    ]),
  );

  // One query for the whole table, same reason the counters above are grouped.
  const revenueByFlow = await getFlowAttributionBatch(
    shop,
    journeys.map((j) => j.id),
    since,
  );

  return {
    journeys: journeys.map((j) => ({
      ...j,
      emailStepCount: j.steps.filter((s) => s.nodeType === "email").length,
      stats: statsById[j.id] || { sent: 0, opened: 0, clicked: 0 },
      // Absent rather than zero when nothing was attributed — the column shows
      // a dash, so an unmeasured flow doesn't claim to have earned nothing.
      revenue: revenueByFlow.get(j.id) || null,
    })),
    // Only templates this workspace can run (a direct workspace has no carts
    // or orders; app-lifecycle templates are Growzar Internal's), each with
    // the channels it sends on — and the best next ones, with the reason.
    ...(await templateChoices(shop, ctx, templates, journeys)),
    // Published flows whose WhatsApp steps are being skipped right now because
    // the channel can't send. Empty when WhatsApp is fine or unused.
    whatsappAlert: await (async () => {
      const using = await flowsUsingWhatsapp(shop);
      if (!using.length) return null;
      const w = await whatsappReadiness(shop);
      return w.ready ? null : { problem: w.problem, flows: using };
    })(),
  };
};

/**
 * The templates this workspace can use, marked with their channels, whether
 * they need WhatsApp set up first, and which to recommend.
 *
 * Recommendations read what is actually true here: which triggers already
 * have a flow (so we never suggest a second cart flow), whether WhatsApp can
 * send, whether any browser has subscribed to push, and recent orders/carts
 * for the reason text.
 */
async function templateChoices(shop, ctx, templates, journeys) {
  const isInternal = isInternalShop(shop);
  const available = templates.filter((t) => templateAvailable(t, { isShopify: ctx.isShopify, isInternal }));
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [wa, pushSubscribers, orders, carts, contacts] = await Promise.all([
    whatsappReadiness(shop),
    ctx.isShopify ? prisma.pushSubscription.count({ where: { shop, isActive: true } }) : 0,
    ctx.isShopify ? prisma.order.count({ where: { shop, processedAt: { gte: since } } }) : 0,
    ctx.isShopify ? prisma.abandonedCart.count({ where: { shop, abandonedAt: { gte: since } } }) : 0,
    prisma.contact.count({ where: { shop, deletedAt: null } }),
  ]);
  // Connected and switched on is enough to recommend a WhatsApp template:
  // the merchant then picks (or creates) an approved template in the step.
  const whatsappReady = wa.connected && wa.enabled && !wa.blockedReason;
  const recommended = recommendTemplates(available, {
    existing: journeys.map((j) => ({
      trigger: j.trigger,
      triggerApp: j.triggerApp,
      triggerEvent: j.triggerEvent,
      triggerSegmentKey: j.triggerSegmentKey,
    })),
    whatsappReady,
    pushSubscribers,
    orders,
    carts,
    contacts,
  });
  const recKeys = new Map(recommended.map((r) => [r.key, r.reason]));
  return {
    templates: available.map((t) => ({
      ...t,
      channels: templateChannels(t),
      needsWhatsappSetup: (t.requires || []).includes("whatsapp") && !whatsappReady,
      recommendedReason: recKeys.get(t.key) || null,
    })),
    recommendedKeys: recommended.map((r) => r.key),
    showPushFilter: ctx.isShopify,
  };
}

export const action = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  // Archiving retires a flow: it pauses it, deactivates it, and takes it out of
  // the list. Building and editing stay open to members — ROLE_HELP promises a
  // member "can build and send" — but destroying someone else's work is not
  // building. Embedded Shopify sessions resolve to owner and are unaffected.
  if (intent === "archive" && !canManage(ctx.role)) {
    return { ok: false, error: "Only owners and admins can archive a flow." };
  }

  // Flow count is capped per plan. All three creation paths go through the same
  // check; archive/pause are never gated so a shop at its limit can still
  // reduce its own count.
  if (["create-from-template", "create-blank", "duplicate"].includes(intent)) {
    const denied = await requireQuota(shop, "flows", 1);
    if (denied) return denied;
  }

  if (intent === "create-from-template") {
    const key = String(fd.get("templateKey") || "");
    if (!key) return { ok: false, error: "Missing template key" };

    // The loader only offers templates this workspace can run; this is the
    // backstop for a posted key from a stale page or a crafted request.
    const tpl = (await getJourneyTemplates()).find((t) => t.key === key);
    if (!tpl) return { ok: false, error: "That template no longer exists." };
    if (!templateAvailable(tpl, { isShopify: ctx.isShopify, isInternal: isInternalShop(shop) })) {
      return { ok: false, error: "That template isn't available in this workspace." };
    }

    const journey = await createJourneyFromTemplate(shop, key);
    const url = new URL(request.url);
    return redirect(`/app/flows/${journey.id}${url.search}`);
  }

  if (intent === "create-blank") {
    // The workspace decides the default: a trigger that can fire here. A
    // direct workspace used to get "customer_created", which only Shopify's
    // webhook ever fires, so its blank flows could never start.
    const available = triggersFor(ctx.isShopify, { isInternal: isInternalShop(shop) });
    const requested = String(fd.get("trigger") || "");
    const trigger = available[requested]
      ? requested
      : defaultTriggerFor(ctx.isShopify, { isInternal: isInternalShop(shop) });
    const triggerSegmentKey = String(fd.get("triggerSegmentKey") || "") || null;
    const name = String(fd.get("name") || "") || undefined;
    // A segment trigger without its segment is allowed as a DRAFT: the
    // builder asks for it, the enrollment worker ignores drafts, and publish
    // validation refuses to publish without one.
    const journey = await createBlankJourney(shop, { name, trigger, triggerSegmentKey });
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
        // A segment-triggered flow is unusable without its segment — the
        // enrollment worker skips any flow whose triggerSegmentKey is null.
        triggerSegmentKey: src.triggerSegmentKey,
        // Enrollment bookkeeping is per-flow state, not content. The copy must
        // start with a clean slate so publishing it pins its own baseline
        // rather than inheriting the original's.
        lastEnrollmentAt: null,
        lastEnrollmentHash: null,
      },
    });
    if (src.steps.length) {
      await prisma.journeyStep.createMany({
        // Copy every authored field. Listing them individually is what caused
        // duplicates to come back with empty emails: emailBlocks, emailHtml and
        // the whole push/WhatsApp group were simply absent from the old list.
        // Spread-and-omit means a new column is carried by default instead of
        // being silently dropped until someone notices.
        data: src.steps.map((s) => {
          const {
            id: _id,
            journeyId: _journeyId,
            createdAt: _createdAt,
            updatedAt: _updatedAt,
            isArchived: _isArchived,
            // Omitted so the copy's steps get their own. stepKey is the
            // identity a step's send history hangs off; carrying it over would
            // make a brand new flow claim the original's numbers, and later
            // make the two indistinguishable in any report that keys on it.
            // This is the one field the spread must NOT carry.
            stepKey: _stepKey,
            ...fields
          } = s;
          return { ...fields, journeyId: copy.id, isArchived: false };
        }),
      });

      // The copy is a straight line, same as its source. Built here rather than
      // left for the merchant's first save, so a duplicated flow is a complete
      // flow the moment it exists.
      const live = await prisma.journeyStep.findMany({
        where: { journeyId: copy.id, isArchived: false },
        orderBy: [{ stepNumber: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      if (live.length > 1) {
        await prisma.journeyEdge.createMany({
          data: live.slice(0, -1).map((s, i) => ({
            journeyId: copy.id,
            fromStepId: s.id,
            toStepId: live[i + 1].id,
            branch: "next",
          })),
        });
      }
    }
    return { ok: true, duplicated: true, journeyId: copy.id };
  }

  return { ok: false };
};

export default function Flows() {
  const { journeys, templates, recommendedKeys = [], showPushFilter = false, whatsappAlert = null } = useLoaderData();
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
            recommendedKeys={recommendedKeys}
            showPushFilter={showPushFilter}
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
        whatsappAlert={whatsappAlert}
        onFixWhatsapp={() => navigate(`/app/whatsapp${location.search ? location.search + "&" : "?"}return=${encodeURIComponent("/app/flows")}`)}
        journeys={journeys}
        onCreate={() => setShowModal(true)}
        onOpen={(id) => navigate(`/app/flows/${id}${location.search}`)}
        onAnalytics={(id) => navigate(`/app/flows/${id}/analytics${location.search}`)}
        onDuplicate={(id) => fetcher.submit({ intent: "duplicate", journeyId: id }, { method: "post" })}
        onArchive={(id) => fetcher.submit({ intent: "archive", journeyId: id }, { method: "post" })}
      />
      {showModal && (
        <CreateFlowModal
          templates={templates}
          recommendedKeys={recommendedKeys}
          showPushFilter={showPushFilter}
          onClose={() => setShowModal(false)}
          fetcher={fetcher}
        />
      )}
    </>
  );
}

/**
 * Money in the currency the orders were taken in, compacted so a revenue column
 * stays narrow next to the rate columns. No currency code means no orders were
 * attributed, and callers show a dash instead of calling this.
 */
function fmtMoney(n, currency) {
  const value = Number(n) || 0;
  return new Intl.NumberFormat("en-US", {
    ...(currency ? { style: "currency", currency } : {}),
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10000 ? 1 : 0,
  }).format(value);
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

/**
 * Live flows are sending WhatsApp steps into a channel that can't deliver —
 * disconnected, switched off, or blocked at Meta. Those steps are skipped, so
 * the flows look healthy while half their messages go nowhere.
 */
function WhatsappFlowsAlert({ alert, onFix }) {
  if (!alert) return null;
  const copy = WHATSAPP_PROBLEMS[alert.problem];
  const n = alert.flows.length;
  return (
    <div
      role="alert"
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
        border: "1px solid var(--warn-ink)", background: "var(--warn-bg)", color: "var(--warn-ink)",
        borderRadius: "var(--r-3)", padding: "12px 16px", marginBottom: 20,
      }}
    >
      <div className="t-small" style={{ lineHeight: 1.5 }}>
        <strong>{copy.title}.</strong>{" "}
        {n} live flow{n === 1 ? "" : "s"} ({alert.flows.slice(0, 3).map((f) => f.name).join(", ")}
        {n > 3 ? ` and ${n - 3} more` : ""}) {n === 1 ? "has" : "have"} WhatsApp steps that are being skipped until this is fixed.
      </div>
      <button type="button" className="btn btn-primary btn-sm" onClick={onFix}>{copy.action}</button>
    </div>
  );
}

function FlowsList({ journeys, onCreate, onOpen, onAnalytics, onDuplicate, onArchive, whatsappAlert = null, onFixWhatsapp }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [openMenu, setOpenMenu] = useState(null);

  const totalSent = journeys.reduce((a, j) => a + j.stats.sent, 0);

  // Flows attributing in a single currency can be summed; a shop selling in
  // several cannot without FX rates we don't capture, so the tile steps aside
  // rather than adding unlike amounts together.
  const attributed = journeys.map((j) => j.revenue).filter(Boolean);
  const currencies = new Set(attributed.map((r) => r.currency).filter(Boolean));
  const totalRevenue =
    currencies.size === 1
      ? {
          revenue: attributed.reduce((a, r) => a + r.revenue, 0),
          currency: [...currencies][0],
        }
      : null;

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
      <WhatsappFlowsAlert alert={whatsappAlert} onFix={onFixWhatsapp} />

      <section className="rt-stats">
        <div className="rt-stat">
          <div className="t-micro muted">Live flows</div>
          <div className="rt-stat-value">{statusCounts.active}</div>
        </div>
        <div className="rt-stat">
          <div className="t-micro muted">Sent · last 30 days</div>
          <div className="rt-stat-value">{totalSent.toLocaleString()}</div>
        </div>
        <div className="rt-stat">
          <div className="t-micro muted">Revenue · last 30 days</div>
          <div className="rt-stat-value">
            {totalRevenue ? fmtMoney(totalRevenue.revenue, totalRevenue.currency) : "—"}
          </div>
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

      <div className="rt-table rt-table--flows">
        <div className="rt-thead">
          <div>Flow</div>
          <div>Status</div>
          <div>Updated</div>
          <div className="rt-tnum">Sent</div>
          <div className="rt-tnum">Open rate</div>
          <div className="rt-tnum">Click rate</div>
          <div className="rt-tnum">Revenue</div>
          <div />
        </div>

        {filtered.map((j) => {
          const trig = TRIGGER_CONFIG[j.trigger] || TRIGGER_CONFIG.customer_created;
          const TrigIcon = Icons[trig.icon];
          const pillClass = STATUS_PILL[j.status] || "draft";
          const pillLabel = pillClass === "active" ? "Active" : pillClass.charAt(0).toUpperCase() + pillClass.slice(1);
          const openRate = j.stats.sent
            ? ((j.stats.opened / j.stats.sent) * 100).toFixed(1) + "%"
            : "—";
          const clickRate = j.stats.sent
            ? ((j.stats.clicked / j.stats.sent) * 100).toFixed(1) + "%"
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
              <div className="rt-tnum t-mono">{j.stats.sent.toLocaleString()}</div>
              <div className="rt-tnum t-mono">{openRate}</div>
              <div className="rt-tnum t-mono">{clickRate}</div>
              <div className="rt-tnum t-mono">
                {j.revenue ? fmtMoney(j.revenue.revenue, j.revenue.currency) : "—"}
              </div>
              <div className="rt-tactions" onClick={(e) => e.stopPropagation()}>
                <RowMenu
                  open={openMenu === j.id}
                  onToggle={() => setOpenMenu(openMenu === j.id ? null : j.id)}
                  onClose={() => setOpenMenu(null)}
                  onView={() => { setOpenMenu(null); onOpen(j.id); }}
                  onAnalytics={() => { setOpenMenu(null); onAnalytics(j.id); }}
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

function RowMenu({ open, onToggle, onClose, onView, onAnalytics, onDuplicate, onArchive }) {
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
            <button onClick={onAnalytics}>
              <Icons.Chart size={14} /> Analytics
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

const STEP_ICON = { email: "Mail", whatsapp: "Whatsapp", push: "Bell" };
const STEP_LABEL = { email: "Email", whatsapp: "WhatsApp", push: "Push" };

function FlowMiniMap({ template }) {
  const nodes = (template.nodes || template.definition?.steps || []).filter((n) => (n.type || n.nodeType) !== "exit");
  const counts = {};
  return (
    <div className="rt-minimap">
      <div className="rt-minimap-node rt-mini-trigger">
        <Icons.Trigger size={10} />
        <span>Trigger</span>
      </div>
      <div className="rt-minimap-line" />
      {nodes.map((n, i) => {
        const type = n.type || n.nodeType;
        const Icon = Icons[STEP_ICON[type]];
        counts[type] = (counts[type] || 0) + 1;
        return (
          <Fragment key={n.id || i}>
            {STEP_ICON[type] && (
              <div className={`rt-minimap-node rt-mini-${type === "email" ? "email" : type}`}>
                {Icon && <Icon size={10} />}
                <span className="rt-minimap-label">{STEP_LABEL[type]} {counts[type]}</span>
              </div>
            )}
            {type === "delay" && (
              <div className="rt-minimap-delay">
                <Icons.Clock size={9} />
                <span className="tabular">{formatWait(n.hours || n.delayHours || 0)}</span>
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

/** "36 hours" reads worse than "1 day 12 h"; days from 48h up. */
function formatWait(h) {
  const n = Number(h) || 0;
  if (n < 48) return `${n}h`;
  const d = Math.floor(n / 24);
  const r = n % 24;
  return r ? `${d}d ${r}h` : `${d} days`;
}

function CreateFlowModal({ templates, recommendedKeys = [], showPushFilter = false, onClose, fetcher }) {
  // Recommended first, so the best next flow is what the window opens on.
  const ordered = [
    ...recommendedKeys.map((k) => templates.find((t) => t.key === k)).filter(Boolean),
    ...templates.filter((t) => !recommendedKeys.includes(t.key)),
  ];
  const [typeFilter, setTypeFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState(ordered[0]?.key || null);

  // The type filter compared "Welcome Series" against category ids like
  // "welcome", so every filter but "All" showed nothing. Filters now use the
  // category ids, with labels only for display.
  const categories = TEMPLATE_CATEGORIES.filter((c) => templates.some((t) => t.category === c.id));
  const channels = [
    { id: "all", label: "All channels", icon: null },
    { id: "email", label: "Email", icon: "Mail" },
    { id: "whatsapp", label: "WhatsApp", icon: "Whatsapp" },
    // Push is a real channel in the builder; it was listed here as "Soon".
    ...(showPushFilter ? [{ id: "push", label: "Push", icon: "Bell" }] : []),
  ].filter((c) => c.id === "all" || templates.some((t) => (t.channels || []).includes(c.id)));

  const matches = (t) =>
    (typeFilter === "all" || t.category === typeFilter) &&
    (channelFilter === "all" || (t.channels || []).includes(channelFilter));
  const filtered = ordered.filter(matches);
  const selected = ordered.find((t) => t.key === selectedKey) || filtered[0] || ordered[0];

  // No trigger sent for a blank flow: the server picks one that can fire in
  // this workspace.
  const startBlank = () => fetcher.submit({ intent: "create-blank" }, { method: "post" });
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
            <p className="muted t-small" style={{ margin: "8px 0 0", maxWidth: 520 }}>
              {recommendedKeys.length
                ? "We've put the flows that fit your store best first. Every template is fully editable."
                : "Templates are fully editable. Pick the closest match and shape it from there."}
            </p>
          </div>
          <div className="rt-modal-head-right">
            <button className="btn btn-secondary" onClick={startBlank} disabled={fetcher.state !== "idle"}>
              <Icons.Plus size={14} /> Start blank
            </button>
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <Icons.Close size={16} />
            </button>
          </div>
        </header>

        {fetcher.data?.ok === false && fetcher.data.error && (
          <div className="auth-notice auth-notice-warn" style={{ margin: "0 24px" }}>{fetcher.data.error}</div>
        )}

        <div className="rt-modal-body">
          {/* Filters */}
          <aside className="rt-cm-filters">
            <div className="t-micro muted rt-cm-filter-heading">Type</div>
            <div className="rt-cm-radio-list">
              {[{ id: "all", label: "All templates" }, ...categories].map((c) => {
                const count = c.id === "all" ? templates.length : templates.filter((x) => x.category === c.id).length;
                return (
                  <button key={c.id} className={`rt-cm-radio${typeFilter === c.id ? " rt-on" : ""}`} onClick={() => setTypeFilter(c.id)}>
                    <span className="rt-cm-radio-dot" />
                    <span>{c.label}</span>
                    <span className="rt-cm-radio-count">{count}</span>
                  </button>
                );
              })}
            </div>

            {channels.length > 2 && (
              <>
                <div className="t-micro muted rt-cm-filter-heading" style={{ marginTop: 28 }}>Channel</div>
                <div className="rt-cm-radio-list">
                  {channels.map((c) => {
                    const Icon = c.icon ? Icons[c.icon] : null;
                    const count = c.id === "all" ? templates.length : templates.filter((x) => (x.channels || []).includes(c.id)).length;
                    return (
                      <button key={c.id} className={`rt-cm-radio${channelFilter === c.id ? " rt-on" : ""}`} onClick={() => setChannelFilter(c.id)}>
                        <span className="rt-cm-radio-dot" />
                        {Icon && <Icon size={14} />}
                        <span>{c.label}</span>
                        <span className="rt-cm-radio-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </aside>

          {/* Gallery */}
          <div className="rt-cm-gallery">
            {filtered.length === 0 && (
              <p className="t-small muted" style={{ padding: 16 }}>No templates match these filters.</p>
            )}
            {filtered.map((t) => {
              const trig = TRIGGER_CONFIG[t.trigger] || TRIGGER_CONFIG.customer_created;
              const TrigIcon = Icons[trig.icon];
              const nodes = t.nodes || t.definition?.steps || [];
              return (
                <button
                  key={t.key}
                  className={`rt-tmpl-card${selectedKey === t.key ? " rt-on" : ""}${t.recommendedReason ? " rt-tmpl-rec" : ""}`}
                  onClick={() => setSelectedKey(t.key)}
                >
                  {t.recommendedReason && <span className="rt-tmpl-rec-badge">Recommended</span>}
                  <div className="rt-tmpl-top">
                    <span className={`rt-tmpl-trig rt-tint-${trig.tint}`}>
                      {TrigIcon && <TrigIcon size={12} />}
                      <span>{t.trigger === "api_event" ? `${t.triggerApp} · ${t.triggerEvent}` : trig.label}</span>
                    </span>
                    <span className="rt-tmpl-channels" aria-label={`Channels: ${(t.channels || []).join(", ")}`}>
                      {(t.channels || []).map((c) => {
                        const Icon = Icons[STEP_ICON[c]];
                        return Icon ? <Icon key={c} size={12} /> : null;
                      })}
                    </span>
                  </div>
                  <h3 className="rt-tmpl-name">{t.name}</h3>
                  <p className="rt-tmpl-desc">{t.recommendedReason || t.description}</p>
                  <div className="rt-tmpl-seq">
                    {nodes.filter((n) => (n.type || n.nodeType) !== "exit").slice(0, 6).map((n, i) => {
                      const type = n.type || n.nodeType;
                      return (
                        <span key={n.id || i} className={`rt-seq-dot rt-seq-${type}`} title={STEP_LABEL[type] || "Wait"}>
                          {type === "email" ? "✉" : type === "whatsapp" ? "W" : type === "push" ? "🔔" : "·"}
                        </span>
                      );
                    })}
                  </div>
                  {t.needsWhatsappSetup && (
                    <span className="t-small" style={{ color: "var(--warn-ink)", display: "block", marginTop: 8 }}>
                      Needs WhatsApp set up to send
                    </span>
                  )}
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
                  {TEMPLATE_CATEGORIES.find((c) => c.id === selected.category)?.label || "Template"}
                </div>
                <h3 className="t-h1" style={{ margin: "0 0 8px" }}>{selected.name}</h3>
                <p className="t-small muted" style={{ margin: "0 0 16px", lineHeight: 1.6 }}>{selected.description}</p>
                {selected.recommendedReason && (
                  <p className="t-small" style={{ margin: "0 0 16px", color: "var(--brand-700)", fontWeight: 600 }}>
                    Recommended: {selected.recommendedReason}
                  </p>
                )}
                {selected.needsWhatsappSetup && (
                  <p className="t-small" style={{ margin: "0 0 16px", color: "var(--warn-ink)" }}>
                    This flow sends on WhatsApp. You can build it now; it can be published once WhatsApp is connected
                    and you've picked an approved template for each WhatsApp step.
                  </p>
                )}
                {selected.trigger === "segment_entered" && !selected.triggerSegmentKey && (
                  <p className="t-small muted" style={{ margin: "0 0 16px" }}>You&rsquo;ll choose the segment that starts it.</p>
                )}

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

                <div className="t-micro muted rt-cm-detail-section">What&rsquo;s inside</div>
                <div className="rt-cm-inside">
                  {(() => {
                    let elapsed = 0;
                    return (selected.nodes || selected.definition?.steps || []).map((n, i) => {
                      const type = n.type || n.nodeType;
                      if (type === "delay") {
                        elapsed += Number(n.hours || n.delayHours || 0);
                        return (
                          <div key={n.id || i} className="rt-cm-inside-row rt-cm-inside-delay">
                            <span className="rt-cm-inside-dot rt-tint-delay"><Icons.Clock size={11} /></span>
                            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Wait {formatWait(n.hours || n.delayHours || 0)}</div>
                          </div>
                        );
                      }
                      if (!STEP_ICON[type]) return null;
                      const Icon = Icons[STEP_ICON[type]];
                      const name = type === "push" ? n.pushTitle : n.name || n.emailName || n.subject;
                      return (
                        <div key={n.id || i} className="rt-cm-inside-row">
                          <span className={`rt-cm-inside-dot rt-tint-${type}`}>{Icon && <Icon size={11} />}</span>
                          <div>
                            <div className="rt-cm-inside-name">{name || STEP_LABEL[type]}</div>
                            <div className="rt-cm-inside-time">
                              {STEP_LABEL[type]} · {elapsed === 0 ? "right away" : `after ${formatWait(elapsed)}`}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
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
