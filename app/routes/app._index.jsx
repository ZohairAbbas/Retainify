import { useLoaderData, useLocation } from "react-router";
import { Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { getCartRescueStats, getEmailBreakdown } from "../lib/analytics/stats.server.js";
import { seedJourneyTemplates } from "../lib/journey/journey-templates.server.js";
import { getOnboardingState } from "../lib/onboarding/onboarding.server.js";
import { OtherAppsCarousel } from "../components/OtherAppsCarousel.jsx";
import Icons from "../components/ui/Icons.jsx";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [settings, stats, breakdown, onboarding] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop } }),
    getCartRescueStats(shop, 30),
    getEmailBreakdown(shop, 30),
    getOnboardingState(shop),
  ]);

  if (!settings || settings.onboardingStep < 2) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/app/onboarding")) {
      throw new Response(null, {
        status: 302,
        headers: { Location: `/app/onboarding${url.search}` },
      });
    }
  }

  await seedJourneyTemplates().catch((err) =>
    console.error("[dashboard] seed templates failed:", err.message),
  );

  const setupRemaining = Object.keys(onboarding.done).filter(
    (id) => !onboarding.done[id] && !onboarding.skipped[id],
  ).length;

  return {
    settings,
    stats,
    breakdown,
    setupComplete: onboarding.setupComplete,
    setupRemaining,
  };
};

function fmt(n) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n) {
  return `${n.toFixed(1)}%`;
}

function fmtRevenue(n) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function HeroStat({ label, value, sub }) {
  return (
    <div className="rt-stat">
      <div className="t-micro muted">{label}</div>
      <div className="rt-stat-value">{value}</div>
      {sub && <div className="rt-stat-delta muted">{sub}</div>}
    </div>
  );
}

function FunnelCell({ count, label, color }) {
  return (
    <div className="card card-pad" style={{ flex: 1, textAlign: "center" }}>
      <div className="t-micro muted" style={{ marginBottom: 6 }}>{label}</div>
      <div className="rt-stat-value" style={{ color }}>{count}</div>
    </div>
  );
}

export default function Dashboard() {
  const { settings, stats, breakdown, setupComplete, setupRemaining } = useLoaderData();
  const location = useLocation();

  const hasEmailData = breakdown.some((row) => row.sent > 0);

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Dashboard</h1>
        </div>
      </header>

      {!setupComplete && (
        <Link
          to={`/app/setup${location.search}`}
          className="ob-banner"
          style={{ textDecoration: "none" }}
        >
          <span className="ob-banner-ic"><Icons.Sparkles size={20} /></span>
          <span className="ob-banner-body">
            <span className="ob-banner-title" style={{ display: "block" }}>Finish setting up Retainify</span>
            <span className="ob-banner-sub">
              {setupRemaining} {setupRemaining === 1 ? "step" : "steps"} left — publish a popup, launch a flow, and more.
            </span>
          </span>
          <span className="ob-banner-progress">{setupRemaining} left</span>
          <span className="ob-banner-cta">Open guide <Icons.Arrow size={14} /></span>
        </Link>
      )}

      {!settings?.isActive && (
        <div style={{
          background: "var(--warn-bg, #fff8e1)",
          color: "var(--warn-ink, #7a4f00)",
          borderRadius: "var(--r-3)",
          padding: "14px 18px",
          marginBottom: 24,
          display: "flex",
          gap: 10,
          alignItems: "center",
          border: "1px solid var(--warn-border, #f5d78e)",
        }}>
          <span>⚠</span>
          <span>
            Your flow is currently paused.{" "}
            <Link to={`/app/flows${location.search}`} style={{ color: "inherit", textDecoration: "underline" }}>
              Go to Flows →
            </Link>
          </span>
        </div>
      )}

      {/* Stats row */}
      <section className="rt-stats" style={{ marginBottom: 24 }}>
        <HeroStat
          label="Recovery rate"
          value={fmtPct(stats.recoveryRate)}
          sub={`${fmt(stats.recoveredCount)} recovered`}
        />
        <HeroStat
          label="Revenue recovered"
          value={fmtRevenue(stats.recoveredRevenue)}
          sub={`${fmt(stats.recoveredCount)} carts`}
        />
        <HeroStat
          label="Emails sent"
          value={fmt(stats.sent)}
          sub={`Open ${fmtPct(stats.openRate)} · Click ${fmtPct(stats.clickRate)}`}
        />
        <HeroStat
          label="Subscribers"
          value={fmt(stats.signups)}
          sub={`${fmt(stats.suppressions)} unsubscribed`}
        />
      </section>

      {/* Funnel */}
      <section style={{ marginBottom: 24 }}>
        <div className="t-micro muted" style={{ marginBottom: 12 }}>Last 30 days · Funnel</div>
        <div style={{ display: "flex", gap: 12 }}>
          <FunnelCell count={fmt(stats.abandoned)} label="Abandoned" color="var(--ink-2)" />
          <FunnelCell count={fmt(stats.pendingJobs)} label="In journey" color="var(--ink-2)" />
          <FunnelCell count={fmt(stats.recoveredCount)} label="Recovered" color="var(--brand-700)" />
          <FunnelCell count={fmt(stats.suppressions)} label="Unsubscribed" color="var(--ink-3)" />
        </div>
      </section>

      {/* Email breakdown table */}
      <section>
        <div className="t-micro muted" style={{ marginBottom: 12 }}>Email performance</div>
        {hasEmailData ? (
          <div className="rt-table">
            <div className="rt-thead">
              <div>Email</div>
              <div className="rt-tnum">Sent</div>
              <div className="rt-tnum">Opened</div>
              <div className="rt-tnum">Clicked</div>
              <div className="rt-tnum">CTR</div>
            </div>
            {breakdown.map((row) => (
              <div key={row.stepId} className="rt-trow">
                <div>{row.label}</div>
                <div className="rt-tnum t-mono">{fmt(row.sent)}</div>
                <div className="rt-tnum t-mono">{fmt(row.opened)}</div>
                <div className="rt-tnum t-mono">{fmt(row.clicked)}</div>
                <div className="rt-tnum t-mono">
                  {row.sent > 0 ? fmtPct((row.clicked / row.sent) * 100) : "—"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card card-pad" style={{ textAlign: "center", padding: "40px 16px" }}>
            <div className="t-h3" style={{ marginBottom: 6 }}>No data yet</div>
            <div className="t-small muted">
              Once your first abandoned cart triggers the journey, performance will appear here.
            </div>
          </div>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <div className="t-micro muted" style={{ marginBottom: 12 }}>More apps from our team</div>
        <OtherAppsCarousel currentHandle="retainify" />
      </section>
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
