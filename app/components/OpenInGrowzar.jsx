import { useEffect, useState } from "react";
import Icons from "./ui/Icons.jsx";

/**
 * "Open in Growzar" (D-10) — embedded Shopify admin only.
 *
 * Two clicks, deliberately. The first mints a claim token on our server
 * (POST /app/growzar/claim, authenticated by App Bridge's session token). The
 * second is a plain link to Growzar with the token in the fragment. Opening a
 * window straight after the async mint would be a popup opened without a user
 * gesture, which browsers block, and App Bridge's window.open shim inside the
 * admin iframe does not reliably get around that. A real <a> clicked by the
 * merchant always opens.
 *
 * The token lives five minutes; the link resets itself before then so a stale
 * one is never offered. It is never written to the console or storage.
 */
const LINK_LIFETIME_MS = 4 * 60 * 1000;

export default function OpenInGrowzar({ collapsed = false }) {
  const [state, setState] = useState({ phase: "idle", url: null, error: null });

  useEffect(() => {
    if (state.phase !== "ready") return undefined;
    const t = setTimeout(() => setState({ phase: "idle", url: null, error: null }), LINK_LIFETIME_MS);
    return () => clearTimeout(t);
  }, [state.phase]);

  async function mint() {
    setState({ phase: "loading", url: null, error: null });
    try {
      const res = await fetch("/app/growzar/claim", { method: "POST", headers: { Accept: "application/json" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Could not connect to Growzar. Try again.");
      setState({ phase: "ready", url: data.url, error: null });
    } catch (err) {
      setState({ phase: "idle", url: null, error: err.message });
    }
  }

  const Icon = Icons.Share;

  if (state.phase === "ready") {
    return (
      <a
        href={state.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`rt-subnav-item${collapsed ? " rt-collapsed" : ""}`}
        title="Continue to Growzar"
        onClick={() => setTimeout(() => setState({ phase: "idle", url: null, error: null }), 0)}
      >
        {Icon && <Icon size={15} style={{ flexShrink: 0 }} />}
        {!collapsed && <span style={{ fontWeight: 600 }}>Continue to Growzar →</span>}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={mint}
        disabled={state.phase === "loading"}
        className={`rt-subnav-item${collapsed ? " rt-collapsed" : ""}`}
        title={collapsed ? "Open in Growzar" : undefined}
        style={{ background: "none", border: "none", width: "100%", textAlign: "left", fontFamily: "inherit" }}
      >
        {Icon && <Icon size={15} style={{ flexShrink: 0 }} />}
        {!collapsed && <span>{state.phase === "loading" ? "Connecting…" : "Open in Growzar"}</span>}
      </button>
      {state.error && !collapsed && (
        <div className="t-micro" role="alert" style={{ color: "var(--danger, #b42318)", padding: "2px 12px 6px" }}>
          {state.error}
        </div>
      )}
    </>
  );
}
