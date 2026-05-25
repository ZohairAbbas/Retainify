// Retainify — Popups page
// Three views: overview (active popup), gallery (5 templates), editor (per-template).

const { useState: useStatePop, useEffect: useEffectPop, useMemo: useMemoPop } = React;

// ── Storefront browser frame ──────────────────────────────────────────
function StorefrontFrame({ children, device = 'desktop', dim = true }) {
  return (
    <div className={`rt-store-frame ${device}`}>
      <div className="rt-store-bar">
        <div className="rt-store-dots"><span/><span/><span/></div>
        <div className="rt-store-url">
          <span className="rt-store-url-lock"/>
          northhill.shop
        </div>
        <div style={{ width: 36 }} />
      </div>
      <div className="rt-store-body">
        <div className="rt-store-page">
          <div className="rt-store-topnav">
            <div className="rt-store-brand">Northhill & Co.</div>
            <div className="rt-store-nav-links">
              <span>Shop</span><span>Journal</span><span>About</span>
            </div>
            <div className="rt-store-icons"><span/><span/><span/></div>
          </div>
          <div className="rt-store-hero">
            <div className="rt-store-hero-left" />
            <div className="rt-store-hero-right">
              <div className="rt-store-hero-h">Quiet objects, <em>well made.</em></div>
              <div className="rt-store-hero-p">A small studio in upstate New York making linen, ceramics and small leather goods one batch at a time.</div>
              <div className="rt-store-hero-cta">Shop the studio</div>
            </div>
          </div>
        </div>
        <div className={`rt-store-dim ${dim ? '' : 'no-dim'}`}>{children}</div>
      </div>
    </div>
  );
}

// ── Gallery view ──────────────────────────────────────────────────────
function PopupGallery({ activeId, onSelect, onUseTemplate }) {
  const { TEMPLATES, TEMPLATE_ORDER } = window.PopupTemplates;
  return (
    <div>
      <div className="rt-pop-gallery-head">
        <div>
          <h2 className="rt-pop-gallery-h">Template library</h2>
          <p className="rt-pop-gallery-sub">Five distinct popups, each with its own personality and template-specific settings. Pick one to make it live — only one popup runs at a time.</p>
        </div>
        <div className="rt-pop-preview-tab" style={{ cursor: 'default' }}>
          <Icons.Sparkles size={12} /> 5 templates
        </div>
      </div>
      <div className="rt-pop-gallery">
        {TEMPLATE_ORDER.map(id => {
          const t = TEMPLATES[id];
          const isActive = activeId === id;
          return (
            <article
              key={id}
              className={`rt-pop-card ${isActive ? 'is-active' : ''}`}
              onClick={() => onSelect(id)}
            >
              <div className="rt-pop-card-thumb">
                <ThumbStage template={t} />
              </div>
              <div className="rt-pop-card-meta">
                <span className="rt-pop-card-vibe">{t.vibe}</span>
                <h3 className="rt-pop-card-name">{t.name}</h3>
                <p className="rt-pop-card-desc">{t.oneliner}</p>
                <div className="rt-pop-card-tags">
                  {t.tags.map(tag => <span key={tag} className="rt-pop-card-tag">{tag}</span>)}
                </div>
              </div>
              <div className="rt-pop-card-foot">
                {isActive
                  ? <span className="rt-pop-card-active-mark">Currently live</span>
                  : <span className="t-small muted">Click to preview</span>}
                <button
                  className={isActive ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
                  onClick={(e) => { e.stopPropagation(); onUseTemplate(id); }}
                >
                  {isActive ? 'Edit' : 'Use template'} <Icons.Arrow size={11}/>
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

// Render a template scaled down for the gallery / overview thumbs.
// Uses FitToParent so it always fits the card thumb cleanly.
function ThumbStage({ template, naturalWidth = 600, naturalHeight = 420 }) {
  const { Render, defaults } = template;
  const bg = {
    editorial: 'linear-gradient(135deg, #6B7A6F 0%, #4A5B52 100%)',
    brutalist: 'linear-gradient(135deg, #2A2A2A 0%, #0E0E0E 100%)',
    wheel:     'linear-gradient(155deg, #2A1B4E 0%, #4E2570 100%)',
    sticker:   'linear-gradient(135deg, #FFB8B8 0%, #FFD93D 100%)',
    holiday:   'linear-gradient(180deg, #1A2E1F 0%, #0A1410 100%)',
  }[template.id];
  return (
    <div className="rt-pop-card-thumb-inner" style={{ background: bg, inset: 0 }}>
      <FitToParent naturalWidth={naturalWidth} naturalHeight={naturalHeight}>
        <div style={{ width: naturalWidth, height: naturalHeight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Render data={defaults} />
        </div>
      </FitToParent>
    </div>
  );
}

// ── Overview view ─────────────────────────────────────────────────────
function PopupOverview({ popup, onEdit, onBrowse, onToggle, onSelectTemplate }) {
  const { TEMPLATES, TEMPLATE_ORDER } = window.PopupTemplates;
  if (!popup) {
    // No popup chosen yet — direct to gallery
    return (
      <div style={{ background: 'var(--paper-3)', border: '1px solid var(--hair-1)', borderRadius: 'var(--r-4)', padding: 40, textAlign: 'center', marginBottom: 20 }}>
        <Icons.Megaphone size={28} />
        <h2 className="t-display-2" style={{ margin: '12px 0 8px' }}>You don't have a popup live yet.</h2>
        <p className="t-body muted" style={{ margin: '0 auto 22px', maxWidth: 460 }}>
          Pick one of five templates below — each can be customized to match your brand. Only one popup runs on your storefront at a time.
        </p>
      </div>
    );
  }

  const template = TEMPLATES[popup.template];

  return (
    <div className="rt-pop-overview">
      <div className="rt-pop-overview-left">
        <div className="rt-pop-statusbar">
          <span className={`rt-pop-statusbar-dot ${popup.enabled ? '' : 'off'}`} />
          <div className="rt-pop-statusbar-text">
            <div className="rt-pop-statusbar-title">{popup.enabled ? 'Live on storefront' : 'Paused'}</div>
            <div className="rt-pop-statusbar-sub">
              {popup.enabled
                ? `Showing to first-time visitors · ${triggerSummary(popup)}`
                : 'Not appearing to any visitors. Toggle on to go live.'}
            </div>
          </div>
          <label className="rt-toggle">
            <input type="checkbox" checked={popup.enabled} onChange={e => onToggle(e.target.checked)} />
            <span className="rt-toggle-switch"/>
          </label>
        </div>

        <div className="rt-pop-current">
          <div className="rt-pop-current-thumb">
            <FitToParent naturalWidth={600} naturalHeight={420}>
              <div style={{ width: 600, height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <template.Render data={popup} />
              </div>
            </FitToParent>
          </div>
          <div>
            <div className="rt-pop-current-vibe">{template.vibe}</div>
            <h3 className="rt-pop-current-name">{template.name}</h3>
            <p className="t-small muted" style={{ margin: 0, lineHeight: 1.6 }}>{template.oneliner}</p>
            <div className="rt-pop-current-stats">
              <div>
                <div className="rt-pop-stat-num">12.4%</div>
                <div className="rt-pop-stat-label">Conversion</div>
              </div>
              <div>
                <div className="rt-pop-stat-num">847</div>
                <div className="rt-pop-stat-label">Subscribers</div>
              </div>
              <div>
                <div className="rt-pop-stat-num">$4.2k</div>
                <div className="rt-pop-stat-label">Attributed rev.</div>
              </div>
            </div>
            <div className="rt-pop-current-actions">
              <button className="btn btn-primary btn-sm" onClick={onEdit}>
                <Icons.Sliders size={12} /> Customize
              </button>
              <button className="btn btn-secondary btn-sm" onClick={onBrowse}>
                Browse templates
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rt-pop-preview-card">
        <div className="rt-pop-preview-head">
          <span className="rt-pop-preview-head-title">Storefront preview</span>
          <span className="t-small muted">northhill.shop</span>
        </div>
        <div className="rt-pop-preview-stage">
          <FitToParent naturalWidth={720} naturalHeight={520}>
            <div style={{ width: 720, height: 520 }}>
              <StorefrontFrame>
                <template.Render data={popup} />
              </StorefrontFrame>
            </div>
          </FitToParent>
        </div>
      </div>
    </div>
  );
}

function triggerSummary(popup) {
  if (popup.trigger === 'exit') return 'on exit intent';
  if (popup.trigger === 'scroll') return 'after 50% scroll';
  return `after ${popup.delay}s`;
}

// Auto-fitting wrapper: scales contents to fit parent box.
function FitToParent({ children, naturalWidth, naturalHeight, fillFactor = 0.94 }) {
  const wrapRef = React.useRef(null);
  const [scale, setScale] = useStatePop(0.4);
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const sx = w / naturalWidth;
      const sy = h / naturalHeight;
      setScale(Math.min(sx, sy, 1) * fillFactor);
    };
    measure();
    let ro;
    try {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    } catch {}
    window.addEventListener('resize', measure);
    return () => {
      ro && ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [naturalWidth, naturalHeight, fillFactor]);
  return (
    <div ref={wrapRef} className="rt-pop-fit">
      <div className="rt-pop-fit-inner" style={{ transform: `scale(${scale})`, width: naturalWidth, height: naturalHeight, position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}

// ── Editor view ───────────────────────────────────────────────────────
function PopupEditor({ popup, onSave, onBack, onSwitchTemplate }) {
  const { TEMPLATES } = window.PopupTemplates;
  const [draft, setDraft] = useStatePop(popup);
  const [device, setDevice] = useStatePop('desktop');
  const [showSwitcher, setShowSwitcher] = useStatePop(false);
  const template = TEMPLATES[draft.template];

  const update = (patch) => setDraft(d => ({ ...d, ...patch }));

  // Natural storefront dimensions (matches CSS)
  const nw = device === 'mobile' ? 320 : 720;
  const nh = device === 'mobile' ? Math.round(320 * 16 / 9) : Math.round(720 / 1.4);

  return (
    <div className="rt-pop-editor-wrap">
      <div className="rt-pop-editor-topbar">
        <div className="rt-pop-editor-topbar-left">
          <button className="btn btn-ghost btn-icon" onClick={onBack} aria-label="Back">
            <Icons.ArrowBack size={16} />
          </button>
          <div className="rt-pop-editor-topbar-meta">
            <div className="t-micro muted">Popup · {template.vibe}</div>
            <div className="rt-pop-editor-topbar-row">
              <span className="rt-pop-editor-topbar-name">{template.name}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSwitcher(s => !s)}>
                Switch <Icons.ChevronDown size={12} />
              </button>
            </div>
          </div>
        </div>
        <div className="rt-pop-editor-actions">
          <div className="rt-pop-seg" style={{ width: 180 }}>
            <button className={device === 'desktop' ? 'rt-on' : ''} onClick={() => setDevice('desktop')}>
              <Icons.Desktop size={12} /> Desktop
            </button>
            <button className={device === 'mobile' ? 'rt-on' : ''} onClick={() => setDevice('mobile')}>
              <Icons.Phone size={12} /> Mobile
            </button>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onBack}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={() => onSave(draft)}>
            Save & publish
          </button>
        </div>
      </div>

      {showSwitcher && (
        <TemplateSwitcher
          activeId={draft.template}
          onPick={(id) => { setShowSwitcher(false); onSwitchTemplate(id); }}
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

function TemplateSwitcher({ activeId, onPick, onClose }) {
  const { TEMPLATES, TEMPLATE_ORDER } = window.PopupTemplates;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,32,26,0.4)', zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--paper-3)', borderRadius: 'var(--r-4)', padding: 32,
          maxWidth: 1080, width: '100%', maxHeight: '85vh', overflow: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
          <div>
            <h2 className="t-display-2" style={{ margin: 0 }}>Switch template</h2>
            <p className="t-small muted" style={{ margin: '6px 0 0' }}>Your headline & copy will move to the new template where possible.</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><Icons.Close size={14}/></button>
        </div>
        <div className="rt-pop-gallery">
          {TEMPLATE_ORDER.map(id => {
            const t = TEMPLATES[id];
            const isActive = activeId === id;
            return (
              <article
                key={id}
                className={`rt-pop-card ${isActive ? 'is-active' : ''}`}
                onClick={() => !isActive && onPick(id)}
              >
                <div className="rt-pop-card-thumb"><ThumbStage template={t}/></div>
                <div className="rt-pop-card-meta">
                  <span className="rt-pop-card-vibe">{t.vibe}</span>
                  <h3 className="rt-pop-card-name">{t.name}</h3>
                </div>
                <div className="rt-pop-card-foot">
                  {isActive ? <span className="rt-pop-card-active-mark">Current</span> : <span className="t-small muted">Click to switch</span>}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Top-level Popups page (overview + gallery, single scrolling page) ──
function PopupsPage({ popup, onUpdate, onEnterEditor, onSwitchTemplate }) {
  const galleryRef = React.useRef(null);
  return (
    <div className="rt-pop-page">
      <header className="rt-pop-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify · On-site</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Popups</h1>
          <p className="rt-pop-lede">Capture emails, recover exits, and run seasonal moments — all from a single, focused popup. Pick a template, customize, ship.</p>
        </div>
      </header>

      <PopupOverview
        popup={popup}
        onEdit={() => onEnterEditor(popup.template)}
        onBrowse={() => {
          galleryRef.current && galleryRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        onToggle={(enabled) => onUpdate({ ...popup, enabled })}
      />

      <div ref={galleryRef}>
        <PopupGallery
          activeId={popup?.template}
          onSelect={() => {}}
          onUseTemplate={onSwitchTemplate}
        />
      </div>
    </div>
  );
}

window.PopupComponents = { PopupsPage, PopupEditor };
