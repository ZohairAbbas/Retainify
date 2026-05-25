import { useState } from "react";
import Icons from "../ui/Icons.jsx";
import { TEMPLATES } from "../../lib/popup-templates/index.js";
import FitToParent from "./FitToParent.jsx";
import StorefrontFrame from "./StorefrontFrame.jsx";
import TemplateSwitcher from "./TemplateSwitcher.jsx";

export default function PopupEditor({ initialDraft, onSave, onCancel, onSwitchTemplate, saving }) {
  const [draft, setDraft] = useState(initialDraft);
  const [device, setDevice] = useState("desktop");
  const [showSwitcher, setShowSwitcher] = useState(false);
  const template = TEMPLATES[draft.template] || TEMPLATES.editorial;

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const nw = device === "mobile" ? 320 : 720;
  const nh = device === "mobile" ? Math.round((320 * 16) / 9) : Math.round(720 / 1.4);

  return (
    <div className="rt-pop-editor-wrap">
      <div className="rt-pop-editor-topbar">
        <div className="rt-pop-editor-topbar-left">
          <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel} aria-label="Back">
            <Icons.ArrowBack size={16} />
          </button>
          <div className="rt-pop-editor-topbar-meta">
            <div className="t-micro muted">Popup · {template.vibe}</div>
            <div className="rt-pop-editor-topbar-row">
              <span className="rt-pop-editor-topbar-name">{template.name}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSwitcher((s) => !s)}>
                Switch <Icons.ChevronDown size={12} />
              </button>
            </div>
          </div>
        </div>
        <div className="rt-pop-editor-actions">
          <div className="rt-pop-seg" style={{ width: 180 }}>
            <button type="button" className={device === "desktop" ? "rt-on" : ""} onClick={() => setDevice("desktop")}>
              <Icons.Desktop size={12} /> Desktop
            </button>
            <button type="button" className={device === "mobile" ? "rt-on" : ""} onClick={() => setDevice("mobile")}>
              <Icons.Phone size={12} /> Mobile
            </button>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave(draft)} disabled={saving}>
            {saving ? "Saving…" : "Save & publish"}
          </button>
        </div>
      </div>

      {showSwitcher && (
        <TemplateSwitcher
          activeId={draft.template}
          onPick={(id) => {
            setShowSwitcher(false);
            const next = onSwitchTemplate(id, draft);
            if (next) setDraft(next);
          }}
          onClose={() => setShowSwitcher(false)}
        />
      )}

      <div className="rt-pop-editor">
        <aside className="rt-pop-editor-side">
          <template.Editor data={draft} onUpdate={update} />
        </aside>
        <main className="rt-pop-editor-main">
          <div className="rt-pop-preview-shell">
            <div className="rt-pop-preview-stage-big">
              <FitToParent naturalWidth={nw} naturalHeight={nh}>
                <div style={{ width: nw, height: nh }}>
                  <StorefrontFrame device={device}>
                    <template.Render data={draft} />
                  </StorefrontFrame>
                </div>
              </FitToParent>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
