import Icons from "../ui/Icons.jsx";
import { TEMPLATES, TEMPLATE_ORDER } from "../../lib/popup-templates/index.js";
import FitToParent from "./FitToParent.jsx";

function ThumbStage({ template, naturalWidth = 600, naturalHeight = 420 }) {
  const { Render, defaults } = template;
  const bg = {
    editorial: "linear-gradient(135deg, #6B7A6F 0%, #4A5B52 100%)",
    brutalist: "linear-gradient(135deg, #2A2A2A 0%, #0E0E0E 100%)",
    wheel: "linear-gradient(155deg, #2A1B4E 0%, #4E2570 100%)",
    sticker: "linear-gradient(135deg, #FFB8B8 0%, #FFD93D 100%)",
    holiday: "linear-gradient(180deg, #1A2E1F 0%, #0A1410 100%)",
  }[template.id];
  return (
    <div className="rt-pop-card-thumb-inner" style={{ background: bg, inset: 0 }}>
      <FitToParent naturalWidth={naturalWidth} naturalHeight={naturalHeight}>
        <div style={{ width: naturalWidth, height: naturalHeight, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Render data={defaults} />
        </div>
      </FitToParent>
    </div>
  );
}

export { ThumbStage };

export default function TemplateSwitcher({ activeId, onPick, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,32,26,0.4)",
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--paper-3)",
          borderRadius: "var(--r-4)",
          padding: 32,
          maxWidth: 1080,
          width: "100%",
          maxHeight: "85vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 }}>
          <div>
            <h2 className="t-display-2" style={{ margin: 0 }}>Switch template</h2>
            <p className="t-small muted" style={{ margin: "6px 0 0" }}>
              Your headline & copy will move to the new template where possible.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <Icons.Close size={14} />
          </button>
        </div>
        <div className="rt-pop-gallery">
          {TEMPLATE_ORDER.map((id) => {
            const t = TEMPLATES[id];
            const isActive = activeId === id;
            return (
              <article
                key={id}
                className={`rt-pop-card ${isActive ? "is-active" : ""}`}
                onClick={() => !isActive && onPick(id)}
              >
                <div className="rt-pop-card-thumb"><ThumbStage template={t} /></div>
                <div className="rt-pop-card-meta">
                  <span className="rt-pop-card-vibe">{t.vibe}</span>
                  <h3 className="rt-pop-card-name">{t.name}</h3>
                </div>
                <div className="rt-pop-card-foot">
                  {isActive
                    ? <span className="rt-pop-card-active-mark">Current</span>
                    : <span className="t-small muted">Click to switch</span>}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
