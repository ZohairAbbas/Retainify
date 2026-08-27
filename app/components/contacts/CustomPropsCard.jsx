/**
 * Custom properties on a contact profile.
 *
 * Replaces a locked card that showed a padlock and a "Soon" pill. Values are
 * edited inline and saved per-field, so a merchant on a support call can set one
 * without a form submit round trip through the whole profile.
 */
import { useState } from "react";
import { useFetcher } from "react-router";
import Icons from "../ui/Icons.jsx";

export default function CustomPropsCard({ properties = [], values = {} }) {
  const fetcher = useFetcher();
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");

  const save = (def) => {
    fetcher.submit(
      { intent: "set_property", key: def.key, value: draft },
      { method: "post" },
    );
    setEditing(null);
  };

  if (properties.length === 0) {
    return (
      <div className="rt-rail-card">
        <div className="rt-rail-head">
          <span className="t-micro">Custom properties</span>
        </div>
        <div className="t-small muted" style={{ lineHeight: 1.6 }}>
          Track things like VIP tier or referral source on every contact. Add
          your first one from <b>Contacts → Properties</b>.
        </div>
      </div>
    );
  }

  return (
    <div className="rt-rail-card">
      <div className="rt-rail-head">
        <span className="t-micro">Custom properties</span>
        <span className="rt-rail-count">{properties.length}</span>
      </div>

      {properties.map((def) => {
        const raw = values?.[def.key];
        const isEditing = editing === def.key;

        return (
          <div key={def.key} className="rt-rail-row">
            <div className="rt-rail-row-left">
              <span>{def.label}</span>
            </div>
            <div className="rt-rail-row-right" style={{ minWidth: 0 }}>
              {isEditing ? (
                <PropertyInput
                  def={def}
                  value={draft}
                  onChange={setDraft}
                  onCommit={() => save(def)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <button
                  className="rt-rail-row-val"
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: raw === undefined || raw === null || raw === "" ? "var(--ink-4)" : undefined,
                  }}
                  onClick={() => {
                    setEditing(def.key);
                    setDraft(raw === undefined || raw === null ? "" : String(raw));
                  }}
                  title="Click to edit"
                >
                  {formatValue(def, raw) || "Set"}
                </button>
              )}
            </div>
          </div>
        );
      })}

      <div className="t-micro muted" style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
        <Icons.Bolt size={11} /> Clear a field to remove it from this contact.
      </div>
    </div>
  );
}

function PropertyInput({ def, value, onChange, onCommit, onCancel }) {
  const common = {
    autoFocus: true,
    className: "input",
    style: { fontSize: 13, padding: "4px 8px", height: 28 },
    onBlur: onCommit,
    onKeyDown: (e) => {
      if (e.key === "Enter") onCommit();
      if (e.key === "Escape") onCancel();
    },
  };

  if (def.type === "boolean") {
    return (
      <select
        {...common}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Not set</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  if (def.type === "select") {
    return (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not set</option>
        {(def.options || []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      {...common}
      type={def.type === "number" ? "number" : def.type === "date" ? "date" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function formatValue(def, value) {
  if (value === undefined || value === null || value === "") return "";
  if (def.type === "boolean") return value ? "Yes" : "No";
  if (def.type === "date") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
  }
  if (def.type === "number") return Number(value).toLocaleString();
  return String(value);
}
