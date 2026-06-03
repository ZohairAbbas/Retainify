import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import Icons from "../ui/Icons.jsx";
import { relativeTime } from "./constants.js";

const POLL_INTERVAL = 2000;

export default function SyncModal({ open, onClose, initialSync }) {
  const fetcher = useFetcher();
  const startFetcher = useFetcher();
  const [includeNonOptIn, setIncludeNonOptIn] = useState(
    initialSync?.includeNonOptIn || false,
  );

  // Poll the sync route while running.
  const sync = fetcher.data?.sync ?? initialSync ?? { status: "idle" };
  const status = sync.status || "idle";

  useEffect(() => {
    if (!open) return undefined;
    // Trigger an initial fetch on open.
    fetcher.load("/app/contacts/sync");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || status !== "running") return undefined;
    const id = setInterval(() => fetcher.load("/app/contacts/sync"), POLL_INTERVAL);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status]);

  if (!open) return null;

  const start = () => {
    const fd = new FormData();
    fd.set("intent", "start");
    fd.set("includeNonOptIn", includeNonOptIn ? "1" : "0");
    startFetcher.submit(fd, { method: "post", action: "/app/contacts/sync" });
  };

  const isRunning = status === "running";
  const isFailed = status === "failed";
  const isDoneRecently = status === "idle" && sync.lastSyncedAt;

  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div className="rt-sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rt-sync-head">
          <div>
            <div className="t-micro muted">Sync</div>
            <h2 className="t-h1" style={{ margin: "4px 0 0" }}>
              Sync from Shopify
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="Close"
          >
            <Icons.Close size={14} />
          </button>
        </div>
        <div className="rt-sync-body">
          {!isRunning && !isFailed && (
            <>
              <p style={{ color: "var(--ink-2)", marginTop: 0 }}>
                We'll pull your Shopify customer list and add anyone not already in
                Retainify. <strong>No emails will be sent.</strong>
              </p>
              <label className="rt-toggle" style={{ marginTop: 16 }}>
                <input
                  type="checkbox"
                  checked={includeNonOptIn}
                  onChange={(e) => setIncludeNonOptIn(e.target.checked)}
                />
                <span className="rt-toggle-switch" />
                <span>Include customers who haven't accepted marketing</span>
              </label>
              <div className="rt-sync-meta">
                <div>
                  <span className="t-micro muted">Last sync</span>
                  <div>{sync.lastSyncedAt ? relativeTime(sync.lastSyncedAt) : "Never"}</div>
                </div>
                {isDoneRecently && sync.total != null && (
                  <div>
                    <span className="t-micro muted">Last imported</span>
                    <div>{sync.total.toLocaleString()}</div>
                  </div>
                )}
              </div>
            </>
          )}
          {isRunning && (
            <>
              <p style={{ color: "var(--ink-2)", marginTop: 0 }}>
                Importing <strong>{(sync.done ?? 0).toLocaleString()}</strong> customers
                so far…
              </p>
              <div className="rt-progress">
                <div
                  className="rt-progress-bar"
                  style={{ width: `${Math.min(100, Math.max(8, ((sync.done || 0) % 1000) / 10))}%` }}
                />
              </div>
              <p className="t-small muted" style={{ marginTop: 12 }}>
                You can close this — we'll keep going in the background.
              </p>
            </>
          )}
          {isFailed && (
            <div className="rt-sync-done">
              <div
                className="rt-sync-check"
                style={{ background: "var(--danger-bg)", color: "var(--danger-ink)" }}
              >
                <Icons.Close size={20} />
              </div>
              <div>
                <div className="t-h2">Sync failed</div>
                <div className="muted">{sync.lastError || "Something went wrong."}</div>
              </div>
            </div>
          )}
        </div>
        <div className="rt-sync-foot">
          {!isRunning && (
            <>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                {isFailed ? "Close" : "Cancel"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={start}
                disabled={startFetcher.state !== "idle"}
              >
                <Icons.Refresh size={14} /> {isFailed ? "Retry" : "Start sync"}
              </button>
            </>
          )}
          {isRunning && (
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Run in background
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
