/**
 * Content library.
 *
 * A place to upload images and PDFs once and reuse them everywhere — with a
 * copyable CDN link, which is what the custom-HTML email editor needs. Before
 * this, an image could only enter an email through the visual editor's image
 * block, so anyone writing their own HTML had nowhere to host an <img src>.
 */
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAccount } from "../lib/auth/require.server.js";
import Icons from "../components/ui/Icons.jsx";
import { ConfirmDialog, Toast } from "../components/ui/Dialog.jsx";
import {
  formatBytes,
  listAssets,
  removeAsset,
  updateAsset,
} from "../lib/media/media.server.js";

const KINDS = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "document", label: "Documents" },
];

export const loader = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const url = new URL(request.url);

  const kind = KINDS.some((k) => k.id === url.searchParams.get("kind"))
    ? url.searchParams.get("kind")
    : "all";
  const search = url.searchParams.get("q") || "";
  const cursor = url.searchParams.get("cursor") || null;

  const { rows, nextCursor, total } = await listAssets({ shop, kind, search, cursor });

  return {
    assets: rows.map((a) => ({
      id: a.id,
      url: a.url,
      filename: a.filename,
      mimeType: a.mimeType,
      size: formatBytes(a.byteSize),
      width: a.width,
      height: a.height,
      alt: a.alt,
      isImage: a.mimeType.startsWith("image/"),
      createdAt: a.createdAt,
    })),
    nextCursor,
    total,
    filters: { kind, search },
  };
};

export const action = async ({ request }) => {
  const ctx = await requireAccount(request);
  const { shop } = ctx;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent === "update_alt") {
    await updateAsset(shop, String(fd.get("id") || ""), { alt: String(fd.get("alt") || "") });
    return { ok: true, updated: true };
  }

  if (intent === "remove") {
    await removeAsset(shop, String(fd.get("id") || ""));
    return { ok: true, removed: true };
  }

  return { ok: false };
};

export default function ContentLibrary() {
  const { assets, nextCursor, total, filters } = useLoaderData();
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const fileRef = useRef(null);

  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [toast, setToast] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [editing, setEditing] = useState(null);
  const [altDraft, setAltDraft] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    next.delete("cursor");
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploadError("");
    setUploading(files.length);

    let failed = 0;
    for (const file of files) {
      const body = new FormData();
      body.append("file", file);
      body.append("source", "library");
      try {
        const resp = await fetch("/app/api/upload", { method: "POST", body });
        const json = await resp.json();
        if (!json.ok) {
          failed++;
          setUploadError(json.message || json.error || "Upload failed.");
        }
      } catch {
        failed++;
        setUploadError("The connection dropped during upload.");
      }
      setUploading((n) => n - 1);
    }

    setUploading(0);
    if (fileRef.current) fileRef.current.value = "";
    const ok = files.length - failed;
    if (ok > 0) setToast(`Uploaded ${ok} ${ok === 1 ? "file" : "files"}.`);
    revalidator.revalidate();
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      setToast("Link copied.");
    } catch {
      // Clipboard access can be denied inside the admin iframe; fall back to
      // selecting the text so the merchant can copy it manually.
      setToast("Press Ctrl/Cmd+C to copy the selected link.");
    }
  }

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      if (fetcher.data.removed) setToast("Removed from your library.");
      if (fetcher.data.updated) setToast("Alt text saved.");
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify · Content</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Content library</h1>
          <p className="t-body muted" style={{ margin: "8px 0 0", maxWidth: 560 }}>
            Upload images and files once, then reuse them across emails and popups.
            Every file gets a permanent link you can paste straight into custom HTML.
          </p>
        </div>
        <div className="rt-page-actions">
          <button
            className="btn btn-primary"
            onClick={() => fileRef.current?.click()}
            disabled={uploading > 0}
          >
            <Icons.Plus size={14} /> {uploading > 0 ? `Uploading ${uploading}…` : "Upload files"}
          </button>
        </div>
      </header>

      {/* Drop zone */}
      <div
        className={`rt-emb-uploader${dragOver ? " rt-emb-uploader-drag" : ""}`}
        style={{ marginBottom: 20, cursor: "pointer" }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
      >
        <Icons.Image size={20} />
        <div className="t-small" style={{ marginTop: 8 }}>
          Drop files here, or click to browse
        </div>
        <div className="field-help" style={{ marginTop: 6 }}>
          JPG, PNG, GIF, WebP, SVG or PDF · up to 10MB each
        </div>
      </div>
      {uploadError && <div className="rt-emb-uploader-error" style={{ marginBottom: 16 }}>{uploadError}</div>}

      <div className="rt-toolbar">
        <div className="rt-chips">
          {KINDS.map((k) => (
            <button
              key={k.id}
              className={`rt-chip${filters.kind === k.id ? " rt-chip-on" : ""}`}
              onClick={() => setParam("kind", k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="rt-search">
          <Icons.Search size={14} />
          <input
            placeholder="Search by filename or alt text…"
            defaultValue={filters.search}
            onChange={(e) => {
              const v = e.target.value;
              clearTimeout(window.__rtMediaSearchT);
              window.__rtMediaSearchT = setTimeout(() => setParam("q", v), 250);
            }}
          />
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: "center", padding: "48px 16px" }}>
          <div className="t-h3" style={{ marginBottom: 6 }}>
            {filters.search ? "Nothing matches that search" : "Your library is empty"}
          </div>
          <div className="t-small muted">
            {filters.search
              ? "Try a different filename."
              : "Upload an image to use it in an email, a popup, or anywhere you write custom HTML."}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 16,
          }}
        >
          {assets.map((a) => (
            <div key={a.id} className="card" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  height: 140,
                  background: "var(--paper-2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {a.isImage ? (
                  <img
                    src={a.url}
                    alt={a.alt || a.filename}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                    loading="lazy"
                  />
                ) : (
                  <div style={{ textAlign: "center", color: "var(--ink-3)" }}>
                    <Icons.Code size={24} />
                    <div className="t-micro" style={{ marginTop: 6 }}>PDF</div>
                  </div>
                )}
              </div>

              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                <div
                  className="t-small"
                  style={{ fontWeight: 500, wordBreak: "break-word", lineHeight: 1.35 }}
                  title={a.filename}
                >
                  {a.filename || "Untitled"}
                </div>
                <div className="t-micro muted">
                  {a.size}
                  {a.width ? ` · ${a.width}×${a.height}` : ""}
                </div>

                {editing === a.id ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      className="input"
                      value={altDraft}
                      autoFocus
                      placeholder="Describe the image"
                      onChange={(e) => setAltDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(null);
                        if (e.key === "Enter") {
                          fetcher.submit(
                            { intent: "update_alt", id: a.id, alt: altDraft },
                            { method: "post" },
                          );
                          setEditing(null);
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button
                    className="rt-link t-micro"
                    style={{ textAlign: "left" }}
                    onClick={() => { setEditing(a.id); setAltDraft(a.alt); }}
                  >
                    {a.alt ? `Alt: ${a.alt}` : "Add alt text"}
                  </button>
                )}

                <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 6 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => copyLink(a.url)}
                  >
                    <Icons.Copy size={12} /> Copy link
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => setConfirmRemove(a)}
                    aria-label={`Remove ${a.filename}`}
                  >
                    <Icons.Trash size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rt-table-foot">
        <span className="muted">
          Showing <strong style={{ color: "var(--ink-1)" }}>{assets.length}</strong> of {total} files
        </span>
      </div>

      {nextCursor && (
        <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
          <button
            className="btn btn-secondary"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("cursor", nextCursor);
              setParams(next);
            }}
          >
            Load more
          </button>
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Remove from library?"
          body={`"${confirmRemove.filename}" disappears from this library, but the link keeps working — emails already sent that use this image will still display it correctly.`}
          confirmLabel="Remove"
          destructive
          loading={fetcher.state !== "idle"}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => {
            fetcher.submit({ intent: "remove", id: confirmRemove.id }, { method: "post" });
            setConfirmRemove(null);
          }}
        />
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml,application/pdf"
        style={{ display: "none" }}
        onChange={(e) => uploadFiles(e.target.files)}
      />
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
