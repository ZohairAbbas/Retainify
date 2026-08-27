/**
 * Custom contact properties manager.
 *
 * Replaces the locked "Custom properties — Soon" card that sat on every contact
 * profile. A property defined here becomes: a column you can show in the
 * contacts table, a field on the contact profile, and a target you can map a
 * CSV column onto during import.
 */
import { useState } from "react";
import { useFetcher } from "react-router";
import Icons from "../ui/Icons.jsx";
import { ConfirmDialog } from "../ui/Dialog.jsx";

const TYPES = [
  { id: "text", label: "Text" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "boolean", label: "Yes / no" },
  { id: "select", label: "Choice list" },
];

export default function PropertiesModal({ open, onClose, properties = [] }) {
  const fetcher = useFetcher();
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [options, setOptions] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const busy = fetcher.state !== "idle";
  const error = fetcher.data?.ok === false ? fetcher.data.error : null;

  if (!open) return null;

  const create = () => {
    if (!label.trim()) return;
    fetcher.submit(
      { intent: "create_property", label: label.trim(), type, options },
      { method: "post" },
    );
    setLabel("");
    setOptions("");
  };

  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div
        className="rt-save-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 580, maxHeight: "84vh", display: "flex", flexDirection: "column" }}
      >
        <div className="rt-save-head">
          <div className="t-micro">Contacts</div>
          <h2 className="t-h1">Custom properties</h2>
        </div>

        <div className="rt-save-body" style={{ overflowY: "auto" }}>
          <p className="t-small muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
            Track anything your store cares about — VIP tier, preferred store,
            referral source. Properties become table columns, profile fields, and
            CSV import targets.
          </p>

          {properties.length > 0 && (
            <div style={{ margin: "20px 0" }}>
              {properties.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 0",
                    borderBottom: "1px solid var(--hair-1)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t-small" style={{ fontWeight: 500 }}>{p.label}</div>
                    <div className="t-micro muted" style={{ fontFamily: "var(--font-mono)" }}>
                      {p.key} · {TYPES.find((t) => t.id === p.type)?.label || p.type}
                      {p.type === "select" && Array.isArray(p.options) && p.options.length
                        ? ` · ${p.options.length} choices`
                        : ""}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => setConfirmDelete(p)}
                    aria-label={`Delete ${p.label}`}
                  >
                    <Icons.Trash size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="t-micro muted" style={{ margin: "20px 0 12px" }}>Add a property</div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="field-label" htmlFor="prop-label">Name</label>
              <input
                id="prop-label"
                className="input"
                value={label}
                placeholder="e.g. VIP tier"
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") create(); }}
              />
            </div>
            <div style={{ width: 150 }}>
              <label className="field-label" htmlFor="prop-type">Type</label>
              <select
                id="prop-type"
                className="select"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {TYPES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {type === "select" && (
            <div style={{ marginTop: 12 }}>
              <label className="field-label" htmlFor="prop-options">Choices</label>
              <textarea
                id="prop-options"
                className="input"
                rows={3}
                value={options}
                placeholder="One per line, or comma separated"
                onChange={(e) => setOptions(e.target.value)}
              />
            </div>
          )}

          <div className="field-help" style={{ marginTop: 8 }}>
            The type is fixed once created — it decides how values sort and compare.
          </div>

          {error && (
            <div
              className="t-small"
              style={{
                marginTop: 12,
                background: "var(--danger-bg)",
                color: "var(--danger-ink)",
                padding: "8px 12px",
                borderRadius: "var(--r-2)",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="rt-save-foot">
          <div className="rt-save-foot-left" />
          <div className="rt-save-foot-right">
            <button className="btn btn-secondary" onClick={onClose}>Done</button>
            <button className="btn btn-primary" onClick={create} disabled={busy || !label.trim()}>
              {busy ? "Adding…" : "Add property"}
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.label}"?`}
          body="The column disappears from your table, but the values stay on your contacts — recreating a property with the same name brings them straight back."
          confirmLabel="Delete property"
          destructive
          loading={busy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            fetcher.submit({ intent: "delete_property", id: confirmDelete.id }, { method: "post" });
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}
