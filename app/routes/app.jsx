import { useState } from "react";
import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import Icons, { IconChevron } from "../components/ui/Icons.jsx";
import { getOnboardingState } from "../lib/onboarding/onboarding.server.js";
import { syncSubscription } from "../lib/billing/sync.server.js";

export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);

  // Billing reconciliation. This lives in the PARENT /app loader (not the plans
  // page) because Shopify's post-approval redirect lands on whatever welcome
  // link the plan defines — in practice /app?charge_id=…&plan_handle=… — so a
  // plans-page-only sync would miss it and leave entitlement stale for the
  // 10-minute TTL right after the merchant has paid.
  //
  // Normal loads are throttled inside syncSubscription; only a redirect
  // carrying charge_id/plan_handle forces a fresh check.
  const url = new URL(request.url);
  const planHandle = url.searchParams.get("plan_handle");
  const justCharged = !!url.searchParams.get("charge_id") || !!planHandle;
  await syncSubscription(billing, session.shop, {
    planHandle,
    force: justCharged,
  }).catch((err) => {
    // Never block app load on a billing sync failure.
    console.error("[billing] sync failed in /app loader", err);
  });

  // Setup-guide nav item + dashboard banner are shown only until every setup
  // task is resolved (done or skipped). Cheap enough to compute per app load.
  const state = await getOnboardingState(session.shop).catch(() => null);
  return {
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    setupComplete: state ? state.setupComplete : true,
    activated: state ? state.activated : true,
  };
};

const NAV_ACTIVE = [
  { id: "home",     label: "Dashboard", href: "/app",          icon: "Home" },
  { id: "flows",    label: "Flows",     href: "/app/flows",    icon: "Flow" },
  { id: "push",     label: "Push",      href: "/app/push",     icon: "Bell" },
  { id: "whatsapp", label: "WhatsApp",  href: "/app/whatsapp", icon: "Whatsapp" },
  { id: "contacts", label: "Contacts",  href: "/app/contacts", icon: "Users" },
  { id: "segments", label: "Segments",  href: "/app/segments", icon: "Sliders" },
  { id: "popup",    label: "Popup",     href: "/app/popup",    icon: "Tab" },
  { id: "plans",    label: "Plans",     href: "/app/plans",    icon: "Ticket" },
  { id: "settings", label: "Settings",  href: "/app/settings", icon: "Settings" },
];

const NAV_SOON = [
  { id: "coupons",   label: "Coupons" },
  { id: "analytics", label: "Analytics" },
];

function AppNav({ currentPath, showSetup }) {
  const [collapsed, setCollapsed] = useState(false);

  const navItems = showSetup
    ? [{ id: "setup", label: "Setup guide", href: "/app/setup", icon: "Sparkles" }, ...NAV_ACTIVE]
    : NAV_ACTIVE;

  return (
    <aside style={{
      width: collapsed ? 48 : 220,
      background: "var(--paper-2)",
      borderRight: "1px solid var(--hair-1)",
      display: "flex",
      flexDirection: "column",
      minHeight: "100vh",
      padding: "12px 4px",
      flexShrink: 0,
      transition: "width 0.2s ease",
      overflow: "hidden",
    }}>
      {/* App mark */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 6px 16px",
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}>
        <span className="rt-app-mark" style={{ flexShrink: 0 }}>R</span>
        {!collapsed && (
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--ink-1)" }}>Retainify</span>
        )}
      </div>

      {/* Active nav items */}
      <div className="rt-retainify-subnav">
        {navItems.map((n) => {
          const Icon = Icons[n.icon];
          const active =
            n.href === "/app"
              ? currentPath === "/app"
              : currentPath.startsWith(n.href);
          return (
            <Link
              key={n.id}
              to={n.href}
              title={collapsed ? n.label : undefined}
              className={`rt-subnav-item${active ? " rt-on" : ""}`}
              style={collapsed ? { justifyContent: "center", padding: "8px 0" } : undefined}
            >
              {Icon && <Icon size={15} style={{ flexShrink: 0 }} />}
              {!collapsed && <span>{n.label}</span>}
            </Link>
          );
        })}
      </div>

      {/* Soon items */}
      {!collapsed && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--hair-1)" }}>
          <div className="t-micro muted" style={{ padding: "4px 10px 8px" }}>Coming soon</div>
          {NAV_SOON.map((n) => (
            <span
              key={n.id}
              className="rt-subnav-item"
              style={{ color: "var(--ink-4)", cursor: "default" }}
            >
              <span>{n.label}</span>
              <span
                className="pill soon"
                style={{ marginLeft: "auto", height: 16, fontSize: 9, padding: "0 5px" }}
              >
                Soon
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Collapse toggle */}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--hair-1)" }}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: collapsed ? "center" : "flex-start",
            width: "100%",
            padding: collapsed ? "8px 0" : "8px 10px",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--ink-3)",
            borderRadius: "var(--r-2)",
            fontSize: 13,
            fontFamily: "inherit",
          }}
        >
          <IconChevron
            size={15}
            style={{
              transform: collapsed ? "rotate(0deg)" : "rotate(180deg)",
              transition: "transform 0.2s ease",
              flexShrink: 0,
            }}
          />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

export default function App() {
  const { apiKey, setupComplete, activated } = useLoaderData();
  const location = useLocation();

  // Hide the whole shell while the pre-activation onboarding takeover is on
  // screen — it renders its own full-bleed chrome.
  const isOnboarding = location.pathname.startsWith("/app/onboarding");
  const showSetup = activated && !setupComplete;

  if (isOnboarding) {
    return (
      <AppProvider embedded apiKey={apiKey}>
        <main style={{ minHeight: "100vh", background: "var(--paper-1)" }}>
          <Outlet />
        </main>
      </AppProvider>
    );
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <AppNav currentPath={location.pathname} showSetup={showSetup} />
        <main style={{ flex: 1, minWidth: 0, background: "var(--paper-1)" }}>
          <Outlet />
        </main>
      </div>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
