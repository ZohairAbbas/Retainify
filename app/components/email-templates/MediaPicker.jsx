/**
 * Content-library picker for the email editor.
 *
 * Two entry points need it: the image block (pick instead of re-uploading the
 * same photo for the fifth time) and the custom-HTML editor (copy a link to
 * paste into an <img src>, which previously had no way to host an image at all).
 *
 * Loads from /app/content via a fetcher, so the library stays a single source
 * of truth rather than being duplicated into the editor's own state.
 */
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import Icons from "../ui/Icons.jsx";

export default function MediaPicker({ onSelect, onClose, mode = "select" }) {
  const fetcher = useFetcher();
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(null);

  // Load on open, and again whenever the search term settles.
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams({ kind: "image" });
      if (search) params.set("q", search);
      fetcher.load(`/app/content?${params.toString()}`);
    }, search ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const assets = fetcher.data?.assets || [];
  const loading = fetcher.state !== "idle";

  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div
        className="rt-save-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 720, maxHeight: "82vh", display: "flex", flexDirection: "column" }}
      >
        <div className="rt-save-head">
          <div className="t-micro">Content library</div>
          <h2 className="t-h1">{mode === "copy" ? "Copy an image link" : "Choose an image"}</h2>
        </div>

        <div className="rt-save-body" style={{ overflowY: "auto" }}>
          <div className="rt-search" style={{ marginBottom: 16 }}>
            <Icons.Search size={14} />
            <input
              placeholder="Search your library…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          {loading && assets.length === 0 && (
            <div className="t-small muted" style={{ padding: "24px 0", textAlign: "center" }}>
              Loading…
            </div>
          )}

          {!loading && assets.length === 0 && (
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <div className="t-h3" style={{ marginBottom: 6 }}>Nothing here yet</div>
              <div className="t-small muted">
                Upload images from the Content page, then reuse them anywhere.
              </div>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: 12,
            }}
          >
            {assets.map((a) => (
              <div key={a.id} className="card" style={{ overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() =>
                    mode === "copy" ? copy(a.url) : onSelect({ url: a.url, alt: a.alt, width: a.width, height: a.height })
                  }
                  style={{
                    display: "block",
                    width: "100%",
                    height: 110,
                    background: "var(--paper-2)",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                  title={mode === "copy" ? "Copy link" : "Use this image"}
                >
                  <img
                    src={a.url}
                    alt={a.alt || a.filename}
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    loading="lazy"
                  />
                </button>
                <div style={{ padding: "8px 10px" }}>
                  <div className="t-micro" style={{ wordBreak: "break-word", lineHeight: 1.3 }}>
                    {a.filename || "Untitled"}
                  </div>
                  {mode === "copy" && (
                    <button
                      className="rt-link t-micro"
                      style={{ marginTop: 4 }}
                      onClick={() => copy(a.url)}
                    >
                      {copied === a.url ? "Copied ✓" : "Copy link"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rt-save-foot">
          <div className="rt-save-foot-left">
            <a className="rt-link" href="/app/content" target="_blank" rel="noreferrer">
              Manage library →
            </a>
          </div>
          <div className="rt-save-foot-right">
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
