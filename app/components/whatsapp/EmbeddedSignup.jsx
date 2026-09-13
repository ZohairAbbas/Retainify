import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

/**
 * Meta WhatsApp Embedded Signup — opened in a top-level tab.
 *
 * ── Why not in place ───────────────────────────────────────────────────────
 * This used to run inside the page with Meta's JavaScript SDK. That stopped
 * working when the SDK began defaulting to the browser's FedCM flow: FedCM
 * called from a cross-origin iframe needs allow="identity-credentials-get" on
 * every parent frame, and for an embedded Shopify app that attribute is set by
 * Shopify's admin, not by us. The request was refused within milliseconds — no
 * window, nothing in the console, and a callback carrying no code, which is
 * indistinguishable from a merchant closing the dialog. The SDK's documented
 * opt-out (use_fedcm_for_login) was ignored by the build Meta serves.
 *
 * So the flow runs in its own tab, through a plain OAuth redirect with no SDK
 * at all: nothing to block, nothing to refuse, and no third-party cookie to
 * lose. The server mints the signed link — lib/whatsapp/connect-link.server.js.
 *
 * ── Why this polls ─────────────────────────────────────────────────────────
 * The other tab cannot talk back to this one: it is a separate top-level
 * context, and cross-tab messaging is exactly what browsers have been closing
 * down. So this asks its own server instead, which is the authority anyway —
 * the account either exists now or it does not.
 */
export default function EmbeddedSignup({ connectUrl, connected = false }) {
  const revalidator = useRevalidator();
  const [waiting, setWaiting] = useState(false);
  const stopAt = useRef(0);

  // Poll while the other tab is open. Stops as soon as the account appears, or
  // after ten minutes, so a merchant who wandered off is not polled forever.
  useEffect(() => {
    if (!waiting) return undefined;
    if (connected) {
      setWaiting(false);
      return undefined;
    }
    const id = setInterval(() => {
      if (Date.now() > stopAt.current) {
        setWaiting(false);
        return;
      }
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 4000);
    return () => clearInterval(id);
  }, [waiting, connected, revalidator]);

  if (!connectUrl) {
    return (
      <div
        className="t-small"
        style={{
          background: "var(--danger-bg)",
          color: "var(--danger-ink)",
          padding: "8px 12px",
          borderRadius: "var(--r-2)",
        }}
      >
        WhatsApp isn&rsquo;t configured on this server yet, so the connection can&rsquo;t be started.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <a
        className="btn btn-primary"
        href={connectUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          // Open through window.open rather than letting the link navigate.
          // App Bridge v4 proxies window.open out of the admin iframe into a
          // real top-level tab, which is documented; how it treats a plain
          // target="_blank" link to the app's own origin is not, and treated
          // as in-app navigation it would load inside the iframe — where
          // Meta refuses to be framed. The href stays as the fallback for a
          // browser where window.open is unavailable.
          if (typeof window !== "undefined" && typeof window.open === "function") {
            event.preventDefault();
            window.open(connectUrl, "_blank", "noopener,noreferrer");
          }
          stopAt.current = Date.now() + 10 * 60 * 1000;
          setWaiting(true);
        }}
        style={{
          background: "var(--node-whatsapp-ink)",
          borderColor: "var(--node-whatsapp-ink)",
          textDecoration: "none",
          justifyContent: "center",
        }}
      >
        Connect WhatsApp
      </a>

      <div className="t-small muted">
        {waiting
          ? "Finish the steps in the new tab. This page updates by itself when it's done."
          : "Opens Meta's sign-up in a new tab. Come back here when it's finished."}
      </div>

      {waiting && (
        <button
          type="button"
          className="btn"
          onClick={() => revalidator.revalidate()}
          disabled={revalidator.state !== "idle"}
        >
          {revalidator.state === "idle" ? "Check now" : "Checking…"}
        </button>
      )}
    </div>
  );
}
