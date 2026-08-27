/**
 * Column picker and saved-view switcher for the Contacts table.
 *
 * The picker is a modal, not a dropdown. The first version crammed two lists and
 * a set of per-row arrow buttons into a 280px menu, which was cramped and hard
 * to read. A two-panel modal is the familiar shape for this: pick on the left,
 * arrange on the right, with the relationship between the two visible at once.
 */
import { useState } from "react";
import Icons from "../ui/Icons.jsx";

export function ColumnsButton({ onClick }) {
  return (
    <button type="button" className="btn btn-secondary" onClick={onClick}>
      <Icons.Sliders size={14} /> Columns
    </button>
  );
}

export function ColumnsModal({
  builtins,
  groups,
  properties,
  propPrefix,
  columns,
  onChange,
  onSave,
  onClose,
  saving,
}) {
  // Edited locally so Cancel genuinely discards. The table behind updates live
  // as a preview; closing without saving restores the persisted layout on the
  // next load.
  const [draft, setDraft] = useState(columns);

  const propColumns = properties.map((p) => ({
    key: `${propPrefix}${p.key}`,
    label: p.label,
    group: "Your properties",
  }));
  const all = [...builtins, ...propColumns];
  const byKey = new Map(all.map((c) => [c.key, c]));
  const allGroups = [...groups, ...(propColumns.length ? ["Your properties"] : [])];

  const shown = draft.map((k) => byKey.get(k)).filter(Boolean);

  const toggle = (key) => {
    const def = byKey.get(key);
    if (def?.locked) return;
    setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  };

  const move = (key, delta) => {
    setDraft((d) => {
      const i = d.indexOf(key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div
        className="rt-save-modal rt-cols-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Configure columns"
      >
        <div className="rt-save-head">
          <div className="t-micro">Contacts</div>
          <h2 className="t-h1">Columns</h2>
        </div>

        <div className="rt-save-body rt-cols-body">
          {/* Left: everything available, grouped */}
          <div className="rt-cols-pane">
            <div className="rt-cols-pane-head">
              <span className="t-micro muted">Available</span>
              <span className="t-micro muted">{shown.length} of {all.length} shown</span>
            </div>
            <div className="rt-cols-scroll">
              {allGroups.map((group) => {
                const items = all.filter((c) => c.group === group);
                if (!items.length) return null;
                return (
                  <div key={group} className="rt-cols-group">
                    <div className="rt-cols-group-h">{group}</div>
                    {items.map((c) => {
                      const on = draft.includes(c.key);
                      return (
                        <label
                          key={c.key}
                          className={`rt-cols-opt${c.locked ? " is-locked" : ""}`}
                          title={c.locked ? "Always shown" : undefined}
                        >
                          <input
                            type="checkbox"
                            className="rt-checkbox"
                            checked={on}
                            disabled={c.locked}
                            onChange={() => toggle(c.key)}
                          />
                          <span>{c.label}</span>
                          {c.locked && <span className="rt-cols-lock">Always</span>}
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: the order they appear in */}
          <div className="rt-cols-pane">
            <div className="rt-cols-pane-head">
              <span className="t-micro muted">Order shown</span>
              <button
                className="rt-link t-micro"
                onClick={() => setDraft(columns)}
                disabled={JSON.stringify(draft) === JSON.stringify(columns)}
              >
                Reset
              </button>
            </div>
            <div className="rt-cols-scroll">
              {shown.map((c, i) => (
                <div key={c.key} className="rt-cols-row">
                  <span className="rt-cols-num">{i + 1}</span>
                  <span className="rt-cols-name">{c.label}</span>
                  <div className="rt-cols-actions">
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => move(c.key, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${c.label} earlier`}
                    >
                      <Icons.ArrowUp size={11} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => move(c.key, 1)}
                      disabled={i === shown.length - 1}
                      aria-label={`Move ${c.label} later`}
                    >
                      <Icons.ArrowDown size={11} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => toggle(c.key)}
                      disabled={c.locked}
                      aria-label={`Hide ${c.label}`}
                    >
                      <Icons.Close size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rt-save-foot">
          <div className="rt-save-foot-left">
            <span className="t-small muted">Saved for everyone on this store.</span>
          </div>
          <div className="rt-save-foot-right">
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => { onChange(draft); onSave(draft); }}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save columns"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tab strip of saved views, plus "save current" and delete. */
export function ViewsBar({ views, activeViewId, onSelect, onSaveNew, onDelete, dirty }) {
  return (
    <div className="rt-views-bar">
      <button
        className={`rt-chip${!activeViewId ? " rt-chip-on" : ""}`}
        onClick={() => onSelect(null)}
      >
        All contacts
      </button>
      {views.map((v) => (
        <span key={v.id} className="rt-view-chip-wrap">
          <button
            className={`rt-chip${activeViewId === v.id ? " rt-chip-on" : ""}`}
            onClick={() => onSelect(v.id)}
            title={v.name}
          >
            {v.name}
          </button>
          {activeViewId === v.id && (
            <button
              className="rt-view-chip-x"
              onClick={() => onDelete(v)}
              aria-label={`Delete view ${v.name}`}
              title="Delete this view"
            >
              <Icons.Close size={10} />
            </button>
          )}
        </span>
      ))}
      <button className="rt-link t-small rt-views-add" onClick={onSaveNew}>
        {dirty ? "Save current filters as a view" : "+ New view"}
      </button>
    </div>
  );
}
