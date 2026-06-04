import { useState } from "react";
import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import Icons, { IconChevron } from "../components/ui/Icons.jsx";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

const NAV_ACTIVE = [
  { id: "home",     label: "Dashboard", href: "/app",          icon: "Home" },
  { id: "flows",    label: "Flows",     href: "/app/flows",    icon: "Flow" },
  { id: "push",     label: "Push",      href: "/app/push",     icon: "Bell" },
  { id: "contacts", label: "Contacts",  href: "/app/contacts", icon: "Users" },
  { id: "segments", label: "Segments",  href: "/app/segments", icon: "Sliders" },
  { id: "popup",    label: "Popup",     href: "/app/popup",    icon: "Tab" },
  { id: "settings", label: "Settings",  href: "/app/settings", icon: "Settings" },
];

const NAV_SOON = [
  { id: "coupons",   label: "Coupons" },
  { id: "analytics", label: "Analytics" },
];

function AppNav({ currentPath }) {
  const [collapsed, setCollapsed] = useState(false);

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
        {NAV_ACTIVE.map((n) => {
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
  const { apiKey } = useLoaderData();
  const location = useLocation();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <AppNav currentPath={location.pathname} />
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
