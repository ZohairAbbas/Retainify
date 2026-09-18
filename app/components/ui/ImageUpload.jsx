/**
 * Upload an image, see it, replace or remove it — with "paste a URL" as the
 * fallback rather than the only option.
 *
 * Used for the brand logo (Settings), the workspace push icon (Push) and a
 * push step's own icon (flow builder). Every one of those used to be a bare
 * URL text box, which asks a merchant to already have their logo hosted
 * somewhere and to know its address.
 *
 * Uploads go to /app/api/upload, which stores the file in Shopify Files for a
 * Shopify workspace and on our own media store for a direct one; the response
 * shape is the same either way.
 */
import { useRef, useState } from "react";

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = /^image\/(jpeg|png|gif|webp|svg\+xml)$/;

/**
 * Shared upload plumbing. Also used by the email editor's image block and
 * brand-kit logo.
 */
export function useImageUpload({ alt = "", source = "library", onUploaded }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function uploadFile(file) {
    if (!file) return;
    setError("");
    if (file.size > MAX_BYTES) { setError("File is larger than 4MB."); return; }
    if (!TYPES.test(file.type)) {
      setError("Use JPG, PNG, GIF, WebP or SVG.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("alt", alt);
      fd.append("source", source);
      const resp = await fetch("/app/api/upload", { method: "POST", body: fd });
      const json = await resp.json();
      if (!resp.ok || !json.ok) throw new Error(json.message || json.error || "Upload failed");
      onUploaded(json);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return { fileInputRef, uploading, error, setError, uploadFile };
}

/**
 * @param {object} props
 * @param {string} props.value        current image URL ("" for none)
 * @param {(url: string) => void} props.onChange
 * @param {string} [props.label]
 * @param {string} [props.help]       one line under the control
 * @param {"wide"|"square"} [props.shape]  how the preview is framed
 * @param {string} [props.source]     recorded on the media asset
 * @param {boolean} [props.disabled]
 */
export default function ImageUpload({
  value,
  onChange,
  label,
  help,
  shape = "wide",
  source = "library",
  disabled = false,
  id,
}) {
  const [showUrl, setShowUrl] = useState(false);
  const { fileInputRef, uploading, error, uploadFile } = useImageUpload({
    alt: label || "",
    source,
    onUploaded: (json) => onChange(json.url || ""),
  });
  const box = shape === "square"
    ? { width: 64, height: 64 }
    : { width: 160, height: 64 };

  return (
    <div>
      {label && <label className="field-label" htmlFor={id}>{label}</label>}
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <div
          style={{
            ...box, flexShrink: 0, borderRadius: "var(--r-3)",
            border: `1px ${value ? "solid" : "dashed"} var(--hair-2)`,
            background: value ? "var(--paper-pure)" : "var(--paper-2)",
            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
          }}
        >
          {value
            ? <img src={value} alt={label || ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            : <span className="t-small muted">No image</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={disabled || uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading…" : value ? "Replace" : "Upload image"}
            </button>
            {value && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || uploading} onClick={() => onChange("")}>
                Remove
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => setShowUrl((v) => !v)}>
              {showUrl ? "Hide URL" : "Use a URL"}
            </button>
          </div>
          {error && <div className="t-small" style={{ color: "var(--danger-ink)" }}>{error}</div>}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          style={{ display: "none" }}
          onChange={(e) => { uploadFile(e.target.files?.[0]); e.target.value = ""; }}
        />
      </div>
      {showUrl && (
        <input
          id={id}
          className="input"
          style={{ marginTop: 8 }}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="https://…/logo.png"
        />
      )}
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}
