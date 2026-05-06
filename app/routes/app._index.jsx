import { useLoaderData, useNavigate, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { getCartRescueStats, getEmailBreakdown } from "../lib/analytics/stats.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [settings, stats, breakdown] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop } }),
    getCartRescueStats(shop, 30),
    getEmailBreakdown(shop, 30),
  ]);

  if (!settings || settings.onboardingStep < 3) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/app/onboarding")) {
      throw new Response(null, {
        status: 302,
        headers: { Location: `/app/onboarding${url.search}` },
      });
    }
  }

  return { settings, stats, breakdown };
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

const TONE_COLORS = {
  critical: "#d72c0d",
  warning: "#b25d00",
  success: "#0c5132",
  info: "#005c8a",
};

function HeroStat({ label, value, sub, tone }) {
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      padding: "20px",
      background: "#fff",
      border: "1px solid #e1e3e5",
      borderRadius: "12px",
    }}>
      <div style={{
        fontSize: "11px", fontWeight: 600, color: "#6d7175",
        textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "10px",
      }}>
        {label}
      </div>
      <div style={{
        fontSize: "32px", fontWeight: 700, color: TONE_COLORS[tone] || "#202223",
        lineHeight: 1, marginBottom: sub ? "8px" : 0,
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "13px", color: "#6d7175" }}>{sub}</div>}
    </div>
  );
}

function FunnelCell({ count, label, color, bg }) {
  return (
    <div style={{
      flex: 1,
      padding: "16px",
      background: bg,
      borderRadius: "8px",
      textAlign: "center",
    }}>
      <div style={{ fontSize: "28px", fontWeight: 700, color, lineHeight: 1, marginBottom: "4px" }}>
        {count}
      </div>
      <div style={{ fontSize: "13px", color: "#6d7175" }}>{label}</div>
    </div>
  );
}

function QuickActions({ onNavigate, currentPath }) {
  const items = [
    { label: "Dashboard", path: "/app" },
    { label: "Cart Rescue", path: "/app/journey" },
    { label: "Popup", path: "/app/popup" },
    { label: "Settings", path: "/app/settings" },
  ];
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e1e3e5",
      borderRadius: "12px",
      padding: "16px",
    }}>
      <div style={{ fontSize: "15px", fontWeight: 600, color: "#202223", marginBottom: "12px" }}>
        Quick Actions
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {items.map((item) => {
          const active = currentPath === item.path;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => onNavigate(item.path)}
              style={{
                textAlign: "left",
                padding: "10px 14px",
                background: active ? "#5b5dec" : "transparent",
                color: active ? "#fff" : "#202223",
                border: "none",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = "#f6f6f7";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = "transparent";
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { settings, stats, breakdown } = useLoaderData();
  const navigate = useNavigate();
  const location = useLocation();

  const hasEmailData = breakdown.some((row) => row.sent > 0);

  return (
    <s-page heading="Dashboard">
      {!settings?.isActive && (
        <s-banner tone="warning" title="Cart Rescue is paused">
          <s-paragraph>Your journey is not active. Go to Cart Rescue settings to turn it on.</s-paragraph>
          <s-button slot="primaryAction" onClick={() => navigate("/app/journey")}>Go to Cart Rescue</s-button>
        </s-banner>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "20px", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <s-section heading="Last 30 days">
            <div style={{ display: "flex", gap: "12px", flexWrap: "nowrap" }}>
              <HeroStat
                label="Recovery rate"
                value={fmtPct(stats.recoveryRate)}
                sub={`${fmt(stats.recoveredCount)} recovered`}
                tone="critical"
              />
              <HeroStat
                label="Revenue recovered"
                value={fmtRevenue(stats.recoveredRevenue)}
                sub={`${fmt(stats.recoveredCount)} carts`}
                tone="warning"
              />
              <HeroStat
                label="Emails sent"
                value={fmt(stats.sent)}
                sub={`Open ${fmtPct(stats.openRate)} · Click ${fmtPct(stats.clickRate)}`}
                tone="info"
              />
              <HeroStat
                label="Subscribers"
                value={fmt(stats.signups)}
                sub={`${fmt(stats.suppressions)} unsubscribed`}
                tone="success"
              />
            </div>

            <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
              <FunnelCell count={fmt(stats.abandoned)} label="Abandoned" color="#005c8a" bg="#ebf5fa" />
              <FunnelCell count={fmt(stats.pendingJobs)} label="In journey" color="#b25d00" bg="#fff5e1" />
              <FunnelCell count={fmt(stats.recoveredCount)} label="Recovered" color="#0c5132" bg="#e8f5ee" />
              <FunnelCell count={fmt(stats.suppressions)} label="Unsubscribed" color="#d72c0d" bg="#fdf1f0" />
            </div>
          </s-section>

          <s-section heading="Email performance">
            {hasEmailData ? (
              <s-data-table
                column-content-types="text,numeric,numeric,numeric,numeric"
                headings={JSON.stringify(["Email", "Sent", "Opened", "Clicked", "CTR"])}
                rows={JSON.stringify(
                  breakdown.map((row) => [
                    `Email ${row.emailNumber}`,
                    fmt(row.sent),
                    fmt(row.opened),
                    fmt(row.clicked),
                    row.sent > 0 ? fmtPct((row.clicked / row.sent) * 100) : "—",
                  ])
                )}
              />
            ) : (
              <div style={{
                padding: "40px 16px",
                textAlign: "center",
                color: "#6d7175",
              }}>
                <div style={{ fontSize: "16px", fontWeight: 600, marginBottom: "6px", color: "#202223" }}>
                  No data yet
                </div>
                <div style={{ fontSize: "13px" }}>
                  Once your first abandoned cart triggers the journey, performance will appear here.
                </div>
              </div>
            )}
          </s-section>
        </div>

        <QuickActions onNavigate={navigate} currentPath={location.pathname} />
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
