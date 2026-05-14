import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import Icons from "../components/ui/Icons.jsx";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

const NAV_ACTIVE = [
  { id: "home",     label: "Dashboard", href: "/app",          icon: "Home" },
  { id: "flows",    label: "Flows",     href: "/app/flows",    icon: "Flow" },
  { id: "popup",    label: "Popup",     href: "/app/popup",    icon: "Tab" },
  { id: "settings", label: "Settings", href: "/app/settings", icon: "Settings" },
];

const NAV_SOON = [
  { id: "contacts",  label: "Contacts" },
  { id: "segments",  label: "Segments" },
  { id: "coupons",   label: "Coupons" },
  { id: "analytics", label: "Analytics" },
];

function AppNav({ currentPath }) {
  return (
    <aside style={{
      width: 220,
      background: "var(--paper-2)",
      borderRight: "1px solid var(--hair-1)",
      display: "flex",
      flexDirection: "column",
      minHeight: "100vh",
      padding: "12px 8px",
      flexShrink: 0,
    }}>
      {/* App mark */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 16px" }}>
        <span className="rt-app-mark">R</span>
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--ink-1)" }}>Retainify</span>
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
              className={`rt-subnav-item${active ? " rt-on" : ""}`}
            >
              {Icon && <Icon size={15} />}
              <span>{n.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Soon items */}
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
