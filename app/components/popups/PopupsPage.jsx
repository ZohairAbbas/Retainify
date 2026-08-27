import { useRef } from "react";
import Icons from "../ui/Icons.jsx";
import { TEMPLATES, TEMPLATE_ORDER } from "../../lib/popup-templates/index.js";
import FitToParent from "./FitToParent.jsx";
import StorefrontFrame from "./StorefrontFrame.jsx";
import { ThumbStage } from "./TemplateSwitcher.jsx";

function triggerSummary(popup) {
  if (popup.trigger === "exit") return "on exit intent";
  if (popup.trigger === "scroll") return "after 50% scroll";
  const delay = popup.delay ?? "3";
  return `after ${delay}s`;
}

function PopupOverview({ popup, signupCount, storeDomain, storeName, onEdit, onBrowse, onToggle }) {
  if (!popup || !popup.template) {
    return (
      <div
        style={{
          background: "var(--paper-3)",
          border: "1px solid var(--hair-1)",
          borderRadius: "var(--r-4)",
          padding: 40,
          textAlign: "center",
          marginBottom: 20,
        }}
      >
        <Icons.Megaphone size={28} />
        <h2 className="t-display-2" style={{ margin: "12px 0 8px" }}>You don't have a popup live yet.</h2>
        <p className="t-body muted" style={{ margin: "0 auto 22px", maxWidth: 460 }}>
          Pick one of five templates below — each can be customized to match your brand. Only one popup runs on your storefront at a time.
        </p>
      </div>
    );
  }

  const template = TEMPLATES[popup.template] || TEMPLATES.editorial;
  const config = popup.config || {};

  return (
    <div className="rt-pop-overview">
      <div className="rt-pop-overview-left">
        <div className="rt-pop-statusbar">
          <span className={`rt-pop-statusbar-dot ${popup.enabled ? "" : "off"}`} />
          <div className="rt-pop-statusbar-text">
            <div className="rt-pop-statusbar-title">{popup.enabled ? "Live on storefront" : "Paused"}</div>
            <div className="rt-pop-statusbar-sub">
              {popup.enabled
                ? `Showing to first-time visitors · ${triggerSummary(config)}`
                : "Not appearing to any visitors. Toggle on to go live."}
            </div>
          </div>
          <label className="rt-toggle">
            <input type="checkbox" checked={popup.enabled} onChange={(e) => onToggle(e.target.checked)} />
            <span className="rt-toggle-switch" />
          </label>
        </div>

        <div className="rt-pop-current">
          <div className="rt-pop-current-thumb">
            <FitToParent naturalWidth={600} naturalHeight={420}>
              <div style={{ width: 600, height: 420, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <template.Render data={config} />
              </div>
            </FitToParent>
          </div>
          <div>
            <div className="rt-pop-current-vibe">{template.vibe}</div>
            <h3 className="rt-pop-current-name">{template.name}</h3>
            <p className="t-small muted" style={{ margin: 0, lineHeight: 1.6 }}>{template.oneliner}</p>
            {/* Conversion rate and attributed revenue used to sit here as
                permanent em-dashes: the storefront script sends no impression
                events, so neither could ever be computed. Showing what we do
                measure beats two placeholders that never fill in. */}
            <div className="rt-pop-current-stats">
              <div>
                <div className="rt-pop-stat-num">{signupCount.total.toLocaleString()}</div>
                <div className="rt-pop-stat-label">Signups</div>
              </div>
              <div>
                <div className="rt-pop-stat-num">{signupCount.confirmed.toLocaleString()}</div>
                <div className="rt-pop-stat-label">Confirmed</div>
              </div>
              <div>
                <div className="rt-pop-stat-num">{signupCount.last30.toLocaleString()}</div>
                <div className="rt-pop-stat-label">Last 30 days</div>
              </div>
            </div>
            <div className="rt-pop-current-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={onEdit}>
                <Icons.Sliders size={12} /> Customize
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onBrowse}>
                Browse templates
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rt-pop-preview-card">
        <div className="rt-pop-preview-head">
          <span className="rt-pop-preview-head-title">Storefront preview</span>
          {/* Was hardcoded to a fictional store name for every merchant. */}
          <span className="t-small muted">{storeDomain}</span>
        </div>
        <div className="rt-pop-preview-stage">
          <FitToParent naturalWidth={720} naturalHeight={520}>
            <div style={{ width: 720, height: 520 }}>
              <StorefrontFrame dim={popup.template !== "custom"} storeDomain={storeDomain} storeName={storeName}>
                <template.Render data={config} />
              </StorefrontFrame>
            </div>
          </FitToParent>
        </div>
      </div>
    </div>
  );
}

function PopupGallery({ activeId, onUseTemplate }) {
  return (
    <div>
      <div className="rt-pop-gallery-head">
        <div>
          <h2 className="rt-pop-gallery-h">Template library</h2>
          <p className="rt-pop-gallery-sub">
            Five distinct popups, each with its own personality and template-specific settings. Pick one to make it live — only one popup runs at a time.
          </p>
        </div>
        <div className="rt-pop-preview-tab" style={{ cursor: "default" }}>
          <Icons.Sparkles size={12} /> 5 templates
        </div>
      </div>
      <div className="rt-pop-gallery">
        {TEMPLATE_ORDER.map((id) => {
          const t = TEMPLATES[id];
          const isActive = activeId === id;
          return (
            <article
              key={id}
              className={`rt-pop-card ${isActive ? "is-active" : ""}`}
              onClick={() => onUseTemplate(id)}
            >
              <div className="rt-pop-card-thumb">
                <ThumbStage template={t} />
              </div>
              <div className="rt-pop-card-meta">
                <span className="rt-pop-card-vibe">{t.vibe}</span>
                <h3 className="rt-pop-card-name">{t.name}</h3>
                <p className="rt-pop-card-desc">{t.oneliner}</p>
                <div className="rt-pop-card-tags">
                  {t.tags.map((tag) => <span key={tag} className="rt-pop-card-tag">{tag}</span>)}
                </div>
              </div>
              <div className="rt-pop-card-foot">
                {isActive
                  ? <span className="rt-pop-card-active-mark">Currently live</span>
                  : <span className="t-small muted">Click to preview</span>}
                <button
                  type="button"
                  className={isActive ? "btn btn-secondary btn-sm" : "btn btn-primary btn-sm"}
                  onClick={(e) => { e.stopPropagation(); onUseTemplate(id); }}
                >
                  {isActive ? "Edit" : "Use template"} <Icons.Arrow size={11} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export default function PopupsPage({ popup, signupCount, storeDomain, storeName, onEnterEditor, onToggle, onUseTemplate }) {
  const galleryRef = useRef(null);
  return (
    <div className="rt-pop-page">
      <header className="rt-pop-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify · On-site</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Popups</h1>
          <p className="rt-pop-lede">
            Capture emails, recover exits, and run seasonal moments — all from a single, focused popup. Pick a template, customize, ship.
          </p>
        </div>
      </header>

      <PopupOverview
        popup={popup}
        signupCount={signupCount}
        storeDomain={storeDomain}
        storeName={storeName}
        onEdit={() => onEnterEditor(popup?.template)}
        onBrowse={() => galleryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        onToggle={onToggle}
      />

      <div ref={galleryRef}>
        <PopupGallery activeId={popup?.template} onUseTemplate={onUseTemplate} />
      </div>
    </div>
  );
}
