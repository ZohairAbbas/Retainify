import { useEffect, useRef, useState } from "react";
import { Form, Outlet, redirect, useLoaderData, useLocation, useRouteError, useRouteLoaderData } from "react-router";
import { Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import Icons, { IconChevron } from "../components/ui/Icons.jsx";
import { getOnboardingState } from "../lib/onboarding/onboarding.server.js";
import { syncSubscription } from "../lib/billing/sync.server.js";
import { requireAccount } from "../lib/auth/require.server.js";
import { listWorkspaces } from "../lib/auth/accounts.server.js";
import { switchAccount } from "../lib/auth/session.server.js";
import prisma from "../db.server.js";

export const loader = async ({ request }) => {
  // The seam. Resolves an embedded Shopify request and a direct signed-in
  // request to the same shape, so everything below this line is identical for
  // both.
  const ctx = await requireAccount(request);
  const { shop, isShopify, billing } = ctx;

  // Billing reconciliation. This lives in the PARENT /app loader (not the plans
  // page) because Shopify's post-approval redirect lands on whatever welcome
  // link the plan defines — in practice /app?charge_id=…&plan_handle=… — so a
  // plans-page-only sync would miss it and leave entitlement stale for the
  // 10-minute TTL right after the merchant has paid.
  //
  // Only Shopify workspaces have a billing object; a direct workspace isn't
  // billed by Shopify and has nothing to reconcile.
  if (billing) {
    const url = new URL(request.url);
    const planHandle = url.searchParams.get("plan_handle");
    const justCharged = !!url.searchParams.get("charge_id") || !!planHandle;
    await syncSubscription(billing, shop, { planHandle, force: justCharged }).catch((err) => {
      // Never block app load on a billing sync failure.
      console.error("[billing] sync failed in /app loader", err);
    });
  }

  // Setup-guide nav item + dashboard banner are shown only until every setup
  // task is resolved (done or skipped). Cheap enough to compute per app load.
  const state = await getOnboardingState(shop).catch(() => null);

  // The workspace switcher only means something for a direct login, where one
  // person can belong to several. An embedded session is scoped to one store.
  const workspaces = ctx.user ? await listWorkspaces(ctx.user.id) : [];

  return {
    // eslint-disable-next-line no-undef
    apiKey: isShopify ? process.env.SHOPIFY_API_KEY || "" : "",
    embedded: isShopify,
    setupComplete: state ? state.setupComplete : true,
    activated: state ? state.activated : true,
    account: { key: shop, name: ctx.account?.name || shop, kind: ctx.account?.kind || "direct" },
    user: ctx.user ? { name: ctx.user.name, email: ctx.user.email } : null,
    role: ctx.role || "owner",
    workspaces,
  };
};

/**
 * Switch workspace from the sidebar. Posting to the layout route keeps the
 * switcher available on every page without a dedicated screen.
 */
export const action = async ({ request }) => {
  const ctx = await requireAccount(request);
  // The switcher form posts with reloadDocument, so this response is rendered
  // by the browser as a page. A JSON body would be shown to the person as raw
  // text — every outcome here has to be a redirect.
  if (!ctx.session || !ctx.user) {
    // An embedded Shopify session has exactly one workspace; there is nothing
    // to switch to and no session row to update.
    return redirect("/app");
  }

  const fd = await request.formData();
  const accountId = String(fd.get("accountId") || "");

  // Membership is the authorization check — never trust the posted id alone.
  const membership = await prisma.membership.findFirst({
    where: { userId: ctx.user.id, accountId },
  });
  if (!membership) {
    // Silently stay put rather than 403. The only way to reach this is a stale
    // page listing a workspace you have since been removed from, and the honest
    // outcome of that is "you are still where you were".
    console.warn(`[auth] user ${ctx.user.id} tried to switch into account ${accountId} without membership`);
    return redirect("/app");
  }

  await switchAccount(ctx.session.id, accountId);
  // Redirect rather than returning data: the form posts with reloadDocument, so
  // every loader re-runs against the new workspace and nothing from the old one
  // is left on screen.
  return redirect("/app");
};

/**
 * Navigation.
 *
 * `shopifyOnly` marks features that depend on a storefront: the exit-intent
 * popup and the web-push service worker are injected by the theme extension,
 * and WhatsApp opt-in capture is a theme block. A direct workspace has no
 * storefront, so these are hidden rather than shown broken — the server-side
 * backstop is requireShopifyAdmin, which 409s.
 *
 * Plans is deliberately NOT shopifyOnly: both workspace kinds have a plan and
 * usage worth seeing. Only the checkout differs, which the page handles via its
 * billing-provider seam.
 */
const NAV_ACTIVE = [
  { id: "home",      label: "Dashboard", href: "/app",           icon: "Home" },
  { id: "flows",     label: "Flows",     href: "/app/flows",     icon: "Flow" },
  { id: "campaigns", label: "Campaigns", href: "/app/campaigns", icon: "Send" },
  { id: "push",      label: "Push",      href: "/app/push",      icon: "Bell",     shopifyOnly: true },
  { id: "whatsapp",  label: "WhatsApp",  href: "/app/whatsapp",  icon: "Whatsapp", shopifyOnly: true },
  { id: "contacts",  label: "Contacts",  href: "/app/contacts",  icon: "Users" },
  { id: "segments",  label: "Segments",  href: "/app/segments",  icon: "Sliders" },
  { id: "popup",     label: "Popup",     href: "/app/popup",     icon: "Tab",      shopifyOnly: true },
  { id: "content",   label: "Content",   href: "/app/content",   icon: "Image" },
  { id: "team",      label: "Team",      href: "/app/team",      icon: "Users",    directOnly: true },
  { id: "plans",     label: "Plans",     href: "/app/plans",     icon: "Ticket" },
  { id: "settings",  label: "Settings",  href: "/app/settings",  icon: "Settings" },
];

const NAV_SOON = [
  { id: "coupons",   label: "Coupons" },
  { id: "analytics", label: "Analytics" },
];

function AppNav({ currentPath, showSetup, isShopify, account, user, workspaces }) {
  const [collapsed, setCollapsed] = useState(false);

  const navItems = [
    ...(showSetup
      ? [{ id: "setup", label: "Setup guide", href: "/app/setup", icon: "Sparkles" }]
      : []),
    ...NAV_ACTIVE.filter((n) => {
      if (n.shopifyOnly && !isShopify) return false;
      if (n.directOnly && isShopify) return false;
      return true;
    }),
  ];

  return (
    <aside style={{
      width: collapsed ? 48 : 220,
      background: "var(--paper-2)",
      borderRight: "1px solid var(--hair-1)",
      display: "flex",
      flexDirection: "column",
      // Sticky at exactly one viewport tall, NOT minHeight:100vh.
      //
      // As a flex child, minHeight let the sidebar stretch to match the tallest
      // sibling — so on a long page (Settings is the worst offender) the nav
      // grew to the full scroll height of the content. That pushed the account
      // block, which sits at the bottom, hundreds of pixels below the fold, and
      // left a long empty column beside the page.
      //
      // height + sticky pins it to the viewport instead, and overflowY lets the
      // nav itself scroll on a short screen rather than clipping items.
      position: "sticky",
      top: 0,
      height: "100vh",
      overflowY: "auto",
      overflowX: "hidden",
      padding: "12px 4px",
      flexShrink: 0,
      transition: "width 0.2s ease",
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
              className={`rt-subnav-item${active ? " rt-on" : ""}${collapsed ? " rt-collapsed" : ""}`}
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

      {/* Account block. Only for a direct login — inside the Shopify admin the
          identity and the store switcher already live in Shopify's own chrome,
          and duplicating them there would be confusing, not helpful. */}
      {user && !collapsed && (
        <AccountMenu account={account} user={user} workspaces={workspaces} />
      )}

      {/* Collapse toggle */}
      <div style={{ marginTop: user && !collapsed ? 8 : 16, paddingTop: 12, borderTop: "1px solid var(--hair-1)" }}>
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

/**
 * Who you are, which workspace you're in, and how to leave either.
 *
 * Pinned to the bottom of the sidebar (`marginTop: auto`) so it sits below the
 * nav however many items that nav happens to have.
 */
function AccountMenu({ account, user, workspaces }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click and on Escape — a menu that can only be closed by
  // clicking the same button again is a small but constant irritation.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();
  const others = workspaces.filter((w) => w.key !== account.key);

  return (
    <div ref={ref} style={{ marginTop: "auto", position: "relative", padding: "0 4px" }}>
      {open && (
        <div className="rt-account-pop">
          <div className="rt-account-pop-head">
            <div style={{ fontWeight: 500, color: "var(--ink-1)" }}>{user.name || user.email}</div>
            {user.name && <div className="t-micro muted">{user.email}</div>}
          </div>

          {others.length > 0 && (
            <>
              <div className="t-micro muted" style={{ padding: "8px 12px 4px" }}>
                Switch workspace
              </div>
              {others.map((w) => (
                /* A full document POST, not a fetcher: switching workspace
                   invalidates every loader on the page, and a hard navigation
                   is the only way to be sure none of the old tenant's data is
                   left rendered. */
                <Form method="post" action="/app" key={w.id} reloadDocument>
                  <input type="hidden" name="accountId" value={w.id} />
                  <button type="submit" className="rt-account-item">
                    <span>{w.name}</span>
                    <span className="t-micro muted" style={{ marginLeft: "auto" }}>{w.role}</span>
                  </button>
                </Form>
              ))}
              <div className="rt-account-sep" />
            </>
          )}

          <Link to="/app/team" className="rt-account-item" onClick={() => setOpen(false)}>
            Team &amp; invitations
          </Link>
          <Link to="/app/settings" className="rt-account-item" onClick={() => setOpen(false)}>
            Workspace settings
          </Link>
          <div className="rt-account-sep" />
          <Form method="post" action="/logout">
            <button type="submit" className="rt-account-item">Sign out</button>
          </Form>
        </div>
      )}

      <button
        type="button"
        className="rt-account-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="rt-account-avatar">{initial}</span>
        <span style={{ minWidth: 0, textAlign: "left" }}>
          <span className="rt-account-ws">{account.name}</span>
          <span className="rt-account-email">{user.email}</span>
        </span>
        <IconChevron size={13} style={{ marginLeft: "auto", flexShrink: 0, transform: "rotate(-90deg)" }} />
      </button>
    </div>
  );
}

export default function App() {
  const { apiKey, embedded, setupComplete, activated, account, user, workspaces } = useLoaderData();
  const location = useLocation();

  // Hide the whole shell while the pre-activation onboarding takeover is on
  // screen — it renders its own full-bleed chrome.
  const isOnboarding = location.pathname.startsWith("/app/onboarding");
  const showSetup = activated && !setupComplete;

  const shell = isOnboarding ? (
    <main style={{ minHeight: "100vh", background: "var(--paper-1)" }}>
      <Outlet />
    </main>
  ) : (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "flex-start" }}>
      <AppNav
        currentPath={location.pathname}
        showSetup={showSetup}
        isShopify={embedded}
        account={account}
        user={user}
        workspaces={workspaces}
      />
      <main style={{ flex: 1, minWidth: 0, background: "var(--paper-1)" }}>
        <Outlet />
      </main>
    </div>
  );

  // AppProvider wires App Bridge, which only exists inside the Shopify admin.
  // Rendering it on our own domain would look for a bridge that never loads.
  if (!embedded) return shell;

  return (
    <AppProvider embedded apiKey={apiKey}>
      {shell}
    </AppProvider>
  );
}

/**
 * Shopify's boundary helper renders an ErrorResponse as raw, unstyled HTML and
 * rethrows anything else — behaviour tuned for a frame inside the Shopify admin,
 * where the admin's own chrome surrounds it. On our own domain that is a bare
 * white page, so standalone gets a real error screen instead.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const root = useRouteLoaderData("root");

  if (root?.embedded) return boundary.error(error);

  const status = error?.status;
  const detail =
    typeof error?.data === "string" && error.data
      ? error.data
      : error?.statusText || "";

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="auth-card">
          <h1 className="auth-title">
            {status === 404 ? "Page not found" : "Something went wrong"}
          </h1>
          <p className="auth-sub">
            {status
              ? `${status}${detail ? ` — ${detail}` : ""}`
              : "An unexpected error stopped this page from loading."}
          </p>
          <div style={{ marginTop: 24, display: "flex", gap: 8 }}>
            <a className="btn btn-primary" href="/app">Back to dashboard</a>
            <a className="btn btn-secondary" href="/login">Sign in again</a>
          </div>
        </div>
      </div>
      <aside className="auth-aside" aria-hidden="true" />
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
