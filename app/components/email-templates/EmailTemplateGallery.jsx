// Retainify — Email Template Gallery
// Full-screen takeover for browsing predesigned email templates, grouped by
// vibe. Opens from the email editor's "Browse templates" top-bar button.
//
// Previews render through the editor's own BlockView so the gallery thumbnail
// is bit-for-bit what loads into the canvas when a template is applied.

import { useState, useMemo, useLayoutEffect, useRef } from "react";
import Icons from "../ui/Icons.jsx";
import { BlockView } from "../EmailEditor.jsx";
import {
  VIBES, VIBE_ORDER, JOURNEYS, TEMPLATES, TEMPLATE_ORDER,
} from "../../lib/email-templates/email-templates.js";

// ── Auto-fit wrapper (scales contents into parent) ──────────────────────
function FitEmail({ children, naturalWidth, naturalHeight, fillFactor = 0.96, align = "top" }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0.4);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      setScale(Math.min(w / naturalWidth, h / naturalHeight, 1) * fillFactor);
    };
    measure();
    let ro;
    try { ro = new ResizeObserver(measure); ro.observe(el); } catch { /* noop */ }
    window.addEventListener("resize", measure);
    return () => { ro && ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [naturalWidth, naturalHeight, fillFactor]);
  return (
    <div ref={wrapRef} className="rt-emt-fit" data-align={align}>
      <div style={{
        transform: `scale(${scale})`,
        transformOrigin: align === "top" ? "top center" : "center center",
        width: naturalWidth, height: naturalHeight, position: "relative",
      }}>
        {children}
      </div>
    </div>
  );
}

// ── Static email render (uses the editor's BlockView) ───────────────────
function RenderTemplateEmail({ template, width = 600 }) {
  return (
    <div className="rt-emt-paper" style={{ width, background: template.brand.bg }}>
      <div style={{ padding: "0 28px" }}>
        {template.blocks.map((b) => (
          <div key={b.id} className="rt-emt-block">
            <BlockView block={b} brand={template.brand} isPreview />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Template card (gallery thumb) ───────────────────────────────────────
function EmailTemplateCard({ template, onSelect, onUseTemplate }) {
  const journey = JOURNEYS[template.journey];
  const TrigIcon = Icons[journey.icon];
  return (
    <article className="rt-emt-card" onClick={() => onSelect(template.id)}>
      <div className="rt-emt-card-thumb">
        <div className="rt-emt-card-thumb-inner">
          <FitEmail naturalWidth={600} naturalHeight={1400} fillFactor={0.98} align="top">
            <RenderTemplateEmail template={template} />
          </FitEmail>
        </div>
        <div className="rt-emt-card-thumb-fade" />
        <div className="rt-emt-card-vibe-chip">{template.vibe}</div>
        {template.discount > 0 && (
          <div className="rt-emt-card-disc-chip">
            <span className="rt-emt-card-disc-num">{template.discount}%</span>
            <span className="rt-emt-card-disc-lbl">off</span>
          </div>
        )}
      </div>
      <div className="rt-emt-card-meta">
        <div className="rt-emt-card-persona-row">
          <span className={`rt-emt-card-trig rt-tint-${journey.tint}`}>
            {TrigIcon && <TrigIcon size={11} />}
            <span>Suited for {journey.name}</span>
          </span>
        </div>
        <h3 className="rt-emt-card-name">{template.name}</h3>
        <p className="rt-emt-card-desc">{template.oneliner}</p>
        <div className="rt-emt-card-foot">
          <div className="rt-emt-card-persona">
            <div className="rt-emt-card-persona-dot" style={{ background: template.brand.accent }} />
            <div>
              <div className="rt-emt-card-persona-name">{template.brandPersona}</div>
              <div className="rt-emt-card-persona-cat">{template.brandCategory}</div>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); onUseTemplate(template.id); }}>
            Use design {Icons.Arrow && <Icons.Arrow size={11} />}
          </button>
        </div>
      </div>
    </article>
  );
}

// ── Confirmation modal (shown before applying a template) ───────────────
function ReplaceConfirmModal({ template, onConfirm, onCancel }) {
  if (!template) return null;
  return (
    <div className="rt-emt-confirm-backdrop" onClick={onCancel}>
      <div className="rt-emt-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rt-emt-confirm-icon" style={{ background: template.brand.accent }}>
          <Icons.Refresh size={18} />
        </div>
        <h2 className="t-display-2" style={{ margin: "14px 0 8px" }}>Replace email design?</h2>
        <p className="t-body muted" style={{ margin: 0, lineHeight: 1.5, maxWidth: 380 }}>
          Applying <strong style={{ color: "var(--ink-1)" }}>{template.name}</strong> will overwrite your
          current blocks, brand kit (fonts, colors, logo), subject line and preview text.
        </p>
        <div className="rt-emt-confirm-stripe">
          <Icons.Bolt size={13} />
          <span>This can't be undone, but you can switch templates again from the top bar.</span>
        </div>
        <div className="rt-emt-confirm-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Keep current design</button>
          <button className="btn btn-primary" onClick={onConfirm}>
            Replace with {template.name} {Icons.Arrow && <Icons.Arrow size={12} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Preview modal ───────────────────────────────────────────────────────
function EmailTemplatePreview({ template, onUseTemplate, onClose }) {
  const journey = JOURNEYS[template.journey];
  const TrigIcon = Icons[journey.icon];
  const [viewport, setViewport] = useState("desktop");
  const emailWidth = viewport === "mobile" ? 360 : 600;
  const fromDomain = template.brandPersona.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    <div className="rt-emt-modal-backdrop" onClick={onClose}>
      <div className="rt-emt-modal" onClick={(e) => e.stopPropagation()}>
        {/* Preview pane (left, scrolling email) */}
        <div className="rt-emt-modal-preview">
          <div className="rt-emt-modal-preview-bar">
            <div className="rt-emt-modal-preview-inbox">
              <div className="rt-emt-modal-preview-from">{template.brandPersona} <span className="muted">· hello@{fromDomain}.co</span></div>
              <div className="rt-emt-modal-preview-subject">{template.subject}</div>
              <div className="rt-emt-modal-preview-preheader">{template.preview}</div>
            </div>
            <div className="rt-view-toggle">
              <button className={viewport === "desktop" ? "rt-vt-on" : ""} onClick={() => setViewport("desktop")}>
                <Icons.Desktop size={12} /> Desktop
              </button>
              <button className={viewport === "mobile" ? "rt-vt-on" : ""} onClick={() => setViewport("mobile")}>
                <Icons.Phone size={12} /> Mobile
              </button>
            </div>
          </div>
          <div className="rt-emt-modal-preview-scroll">
            <RenderTemplateEmail template={template} width={emailWidth} />
          </div>
        </div>

        {/* Detail (right) */}
        <aside className="rt-emt-modal-detail">
          <button className="btn btn-ghost btn-icon rt-emt-modal-close" onClick={onClose} aria-label="Close">
            <Icons.Close size={16} />
          </button>

          <div className="rt-emt-modal-detail-inner">
            <span className={`rt-emt-card-trig rt-tint-${journey.tint}`} style={{ alignSelf: "flex-start" }}>
              {TrigIcon && <TrigIcon size={11} />}
              <span>Suited for {journey.name}</span>
            </span>
            <div className="t-micro muted" style={{ marginTop: 18 }}>{template.vibe}</div>
            <h2 className="t-display-2" style={{ margin: "6px 0 12px" }}>{template.name}</h2>
            <p className="t-body muted" style={{ margin: "0 0 22px", lineHeight: 1.6 }}>{template.oneliner}</p>

            <div className="rt-emt-modal-persona">
              <div className="rt-emt-modal-persona-row">
                <div className="rt-emt-modal-persona-swatch" style={{ background: template.brand.accent }} />
                <div>
                  <div className="t-micro muted">Brand persona</div>
                  <div className="rt-emt-modal-persona-name">{template.brandPersona}</div>
                  <div className="t-small muted">{template.brandCategory}</div>
                </div>
              </div>
            </div>

            <div className="t-micro muted rt-emt-modal-section-h">What's in the box</div>
            <ul className="rt-emt-modal-inbox-list">
              <li>
                <Icons.Mail size={13} />
                <div>
                  <div className="rt-emt-modal-inbox-li-name">{template.subject}</div>
                  <div className="t-small muted">{template.preview}</div>
                </div>
              </li>
              {template.discount > 0 && (
                <li>
                  <Icons.Discount size={13} />
                  <div>
                    <div className="rt-emt-modal-inbox-li-name">{template.discount}% discount block</div>
                    <div className="t-small muted">Code generates per recipient at send time.</div>
                  </div>
                </li>
              )}
              <li>
                <Icons.Sparkles size={13} />
                <div>
                  <div className="rt-emt-modal-inbox-li-name">Branded type & color kit</div>
                  <div className="t-small muted">{template.vibe} · editable in the inspector.</div>
                </div>
              </li>
            </ul>

            <div className="t-micro muted rt-emt-modal-section-h">Tags</div>
            <div className="rt-emt-modal-tags">
              {template.tags.map((t) => <span key={t} className="rt-emt-modal-tag">{t}</span>)}
            </div>
          </div>

          {/* Sticky footer CTA — never scrolls over the email preview. */}
          <div className="rt-emt-modal-cta">
            <button className="btn btn-primary btn-lg" style={{ width: "100%" }} onClick={onUseTemplate}>
              Use this design {Icons.Arrow && <Icons.Arrow size={14} />}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Gallery (full-screen takeover from email editor) ────────────────────
export default function EmailTemplateGallery({ onClose, onUseTemplate }) {
  const [activeFilter, setActiveFilter] = useState("all");
  const [previewId, setPreviewId] = useState(null);
  const [pendingId, setPendingId] = useState(null);

  const visibleVibes = activeFilter === "all" ? VIBE_ORDER : [activeFilter];

  const templatesByVibe = useMemo(() => {
    const map = {};
    VIBE_ORDER.forEach((v) => { map[v] = []; });
    TEMPLATE_ORDER.forEach((id) => {
      const t = TEMPLATES[id];
      if (map[t.vibeGroup]) map[t.vibeGroup].push(t);
    });
    return map;
  }, []);

  const previewTemplate = previewId ? TEMPLATES[previewId] : null;
  const pendingTemplate = pendingId ? TEMPLATES[pendingId] : null;

  // Click "Use design" → opens confirmation modal.
  const requestUse = (templateId) => {
    setPreviewId(null);
    setPendingId(templateId);
  };
  const confirmUse = () => {
    const id = pendingId;
    setPendingId(null);
    onUseTemplate(id);
  };

  return (
    <div className="rt-emt-shell">
      {/* Top bar */}
      <header className="rt-emt-topbar">
        <div className="rt-emt-topbar-left">
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Back to editor">
            <Icons.ArrowBack size={16} />
          </button>
          <div>
            <div className="t-micro muted">Email designer</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1, marginTop: 2 }}>Browse templates</div>
          </div>
        </div>
        <div className="rt-emt-topbar-right">
          <span className="t-small muted" style={{ marginRight: 4 }}>
            Picking a template replaces your current email design.
          </span>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <Icons.Close size={16} />
          </button>
        </div>
      </header>

      <div className="rt-emt-body">
        {/* Left rail — vibes */}
        <aside className="rt-emt-rail">
          <div className="rt-emt-rail-h t-micro muted">Filter by style</div>
          <button
            className={`rt-emt-rail-item ${activeFilter === "all" ? "rt-on" : ""}`}
            onClick={() => setActiveFilter("all")}
          >
            <span className="rt-emt-rail-glyph"><Icons.List size={13} /></span>
            <span className="rt-emt-rail-name">All styles</span>
            <span className="rt-emt-rail-count">{TEMPLATE_ORDER.length}</span>
          </button>
          {VIBE_ORDER.map((vId) => {
            const v = VIBES[vId];
            const count = templatesByVibe[vId].length;
            return (
              <button
                key={vId}
                className={`rt-emt-rail-item ${activeFilter === vId ? "rt-on" : ""}`}
                onClick={() => setActiveFilter(vId)}
              >
                <span className={`rt-emt-rail-glyph rt-emt-rail-vibe-${vId}`} />
                <span className="rt-emt-rail-name">{v.name}</span>
                <span className="rt-emt-rail-count">{count}</span>
              </button>
            );
          })}

          <div className="rt-emt-rail-foot">
            <div className="t-micro muted" style={{ marginBottom: 6 }}>Channel</div>
            <button className="rt-emt-rail-item rt-on" disabled>
              <span className="rt-emt-rail-glyph rt-tint-email"><Icons.Mail size={13} /></span>
              <span className="rt-emt-rail-name">Email</span>
              <span className="rt-emt-rail-count">{TEMPLATE_ORDER.length}</span>
            </button>
            <button className="rt-emt-rail-item rt-locked" disabled>
              <span className="rt-emt-rail-glyph"><Icons.Sms size={13} /></span>
              <span className="rt-emt-rail-name">SMS</span>
              <span className="pill soon" style={{ height: 18, fontSize: 9, padding: "0 6px" }}>Soon</span>
            </button>
          </div>
        </aside>

        {/* Main — grouped grid */}
        <main className="rt-emt-main">
          <div className="rt-emt-hero">
            <div>
              <h1 className="t-display-2" style={{ margin: 0 }}>Pick a <em style={{ fontFamily: "var(--font-display)" }}>look</em>, then make it yours</h1>
              <p className="t-body muted" style={{ margin: "10px 0 0", maxWidth: 580 }}>
                Ten complete email designs across five vibes — each carries its own type pairing, palette and copy. Find the closest match; everything is editable from there.
              </p>
            </div>
            <div className="rt-emt-hero-stat">
              <div className="rt-emt-hero-stat-num">{TEMPLATE_ORDER.length}</div>
              <div className="rt-emt-hero-stat-label">designs ·<br />{VIBE_ORDER.length} vibes</div>
            </div>
          </div>

          {visibleVibes.map((vId) => {
            const v = VIBES[vId];
            const list = templatesByVibe[vId];
            if (!list || !list.length) return null;
            return (
              <section key={vId} className="rt-emt-section">
                <header className="rt-emt-section-head">
                  <div className="rt-emt-section-head-left">
                    <span className={`rt-emt-section-glyph rt-emt-section-vibe-${vId}`} />
                    <div>
                      <h2 className="rt-emt-section-h">{v.name}</h2>
                      <p className="rt-emt-section-sub">{v.oneliner}</p>
                    </div>
                  </div>
                  <div className="rt-emt-section-count">{list.length} {list.length === 1 ? "design" : "designs"}</div>
                </header>
                <div className="rt-emt-grid">
                  {list.map((t) => (
                    <EmailTemplateCard
                      key={t.id}
                      template={t}
                      onSelect={setPreviewId}
                      onUseTemplate={requestUse}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          <div className="rt-emt-blank-card">
            <div>
              <div className="t-micro muted" style={{ marginBottom: 8 }}>Want a clean slate?</div>
              <h3 className="t-h1" style={{ margin: "0 0 8px" }}>Keep your current design</h3>
              <p className="t-small muted" style={{ margin: 0, maxWidth: 480, lineHeight: 1.6 }}>
                Close this dialog to return to the editor. Your blocks stay exactly as they are.
              </p>
            </div>
            <button className="btn btn-secondary btn-lg" onClick={onClose}>
              <Icons.ArrowBack size={14} /> Back to editor
            </button>
          </div>
        </main>
      </div>

      {previewTemplate && (
        <EmailTemplatePreview
          template={previewTemplate}
          onUseTemplate={() => requestUse(previewTemplate.id)}
          onClose={() => setPreviewId(null)}
        />
      )}

      {pendingTemplate && (
        <ReplaceConfirmModal
          template={pendingTemplate}
          onConfirm={confirmUse}
          onCancel={() => setPendingId(null)}
        />
      )}
    </div>
  );
}
