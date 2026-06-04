// Retainify — Segments list page
// Header → 3 stats → templates row → system segments → user segments table → footer
// Includes empty state.

const { useState: useStateSL, useMemo: useMemoSL } = React;

// ── Tiny sparkline (used in row + detail) ────────────────────────────────
function Sparkline({ points, w = 64, h = 20, color = 'var(--brand-600)' }) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const dx = w / (points.length - 1);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * dx} ${h - ((p - min) / span) * (h - 2) - 1}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ display: 'block' }}>
      <path d={d} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Template card ────────────────────────────────────────────────────────
function TemplateCard({ template, onPick }) {
  const Icon = window.Icons[template.icon] || window.Icons.Sliders;
  return (
    <button className="rt-tpl-card" onClick={() => onPick(template)}>
      <div className="rt-tpl-card-top">
        <span className="rt-tpl-icon" style={{ background: template.accent, color: template.accentInk }}>
          <Icon size={14} />
        </span>
        <span className="rt-tpl-card-name">{template.name}</span>
      </div>
      <div className="rt-tpl-card-desc">{template.description}</div>
      <div className="rt-tpl-card-foot">
        <span>Start from template</span>
        <Icons.Arrow size={11} />
      </div>
    </button>
  );
}

// ── Quick view rail item (replaces SystemSegCard) ───────────────────────
// Built-in segments are quick-views, not feature cards. One slim horizontal
// rail above the segments table.
function QuickViewItem({ seg, onOpen }) {
  const Icon = window.Icons[seg.icon] || window.Icons.Users;
  return (
    <button className="rt-qv-item" onClick={() => onOpen(seg)} title={seg.description}>
      <span className="rt-qv-icon"><Icon size={12} /></span>
      <span className="rt-qv-body">
        <span className="rt-qv-name">{seg.name}</span>
        <span className="rt-qv-count"><strong>{seg.contactCount.toLocaleString()}</strong> contacts</span>
      </span>
    </button>
  );
}
// ── Empty state ──────────────────────────────────────────────────────────
function SegmentsEmpty({ onCreate, onPickTemplate, templates }) {
  return (
    <div className="rt-sg-empty">
      <div className="rt-sg-empty-art">
        <svg width="220" height="140" viewBox="0 0 220 140" fill="none" aria-hidden>
          <circle cx="80" cy="74" r="46" fill="#FBF7EA" stroke="#D2C9B0" />
          <circle cx="140" cy="74" r="46" fill="#FBF7EA" stroke="#D2C9B0" />
          <path d="M80 28a46 46 0 0 1 0 92" fill="#F1E4C5" opacity="0.55" />
          <path d="M140 28a46 46 0 0 0 0 92" fill="#DCE7DF" opacity="0.55" />
          <circle cx="80" cy="74" r="46" fill="none" stroke="#1F3D2F" strokeWidth="1" />
          <circle cx="140" cy="74" r="46" fill="none" stroke="#1F3D2F" strokeWidth="1" />
          <text x="60" y="78" fontFamily="Geist Mono" fontSize="10" fill="#1F3D2F" letterSpacing="0.08em">SPENT&gt;$200</text>
          <text x="124" y="78" fontFamily="Geist Mono" fontSize="10" fill="#1F3D2F" letterSpacing="0.08em">TAG=VIP</text>
        </svg>
      </div>
      <h2 className="t-display-2" style={{ margin: 0, color: 'var(--ink-1)' }}>
        Smaller groups, <em style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', color: 'var(--brand-700)' }}>better messages</em>.
      </h2>
      <p className="rt-empty-lede" style={{ marginLeft: 'auto', marginRight: 'auto' }}>
        Segments are living lists of contacts that match a rule — your VIPs, your cart-abandoners, your “engaged but never bought” crew.
        Build one, then use it to target a flow, send a broadcast, or just understand who's in there.
      </p>
      <div className="rt-empty-actions">
        <button className="btn btn-primary btn-lg" onClick={onCreate}><Icons.Plus size={14} /> Create your first segment</button>
        <a href="#" className="btn btn-ghost btn-lg" onClick={(e) => e.preventDefault()}>Watch 90-sec tour</a>
      </div>
      <div className="rt-sg-empty-cards">
        {templates.map(t => <TemplateCard key={t.id} template={t} onPick={onPickTemplate} />)}
      </div>
    </div>
  );
}

// ── Segments list ────────────────────────────────────────────────────────
function SegmentsList({ onOpenBuilder, onOpenDetail, onPickTemplate, showEmpty }) {
  const { SYSTEM_SEGMENTS, USER_SEGMENTS, TEMPLATES } = window.RetainifySegments;
  const [query, setQuery] = useStateSL('');
  const [kindFilter, setKindFilter] = useStateSL('all'); // all | dynamic | static
  const [openMenu, setOpenMenu] = useStateSL(null);
  const [sortBy, setSortBy] = useStateSL('updated'); // updated | name | size

  if (showEmpty) {
    return (
      <SegmentsEmpty
        onCreate={() => onOpenBuilder(null)}
        onPickTemplate={(t) => onPickTemplate(t)}
        templates={TEMPLATES.slice(0, 3)}
      />
    );
  }

  const userSegs = USER_SEGMENTS.filter(s => {
    if (kindFilter !== 'all' && s.kind !== kindFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!`${s.name} ${s.description}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Aggregate stats
  const totalSegments = USER_SEGMENTS.length + SYSTEM_SEGMENTS.length;
  const dynamicCount = USER_SEGMENTS.filter(s => s.kind === 'dynamic').length;
  const usedInFlows = USER_SEGMENTS.reduce((sum, s) => sum + s.flows.length, 0);

  return (
    <div className="rt-page">
      {/* Header */}
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify · Audience</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Segments</h1>
          <p className="t-body muted" style={{ margin: '8px 0 0', maxWidth: 560 }}>
            Group contacts by behaviour and attributes — then use those groups to target flows, broadcasts, and reports.
            Dynamic segments update themselves; static ones are frozen lists.
          </p>
        </div>
        <div className="rt-page-actions">
          <button className="btn btn-secondary"><Icons.Tag size={14} /> Manage tags</button>
          <button className="btn btn-primary" onClick={() => onOpenBuilder(null)}><Icons.Plus size={14} /> Create segment</button>
          <div className="rt-kebab-wrap">
            <button className="btn btn-secondary btn-icon" onClick={() => setOpenMenu(openMenu === 'pagekb' ? null : 'pagekb')} aria-label="More"><Icons.More size={16} /></button>
            {openMenu === 'pagekb' && (
              <>
                <div className="rt-veil" onClick={() => setOpenMenu(null)} />
                <div className="rt-menu" style={{ right: 0, left: 'auto' }}>
                  <button disabled className="rt-menu-soon"><Icons.ArrowDown size={14} /> Import CSV as segment <SoonPill /></button>
                  <button disabled className="rt-menu-soon"><Icons.Sparkles size={14} /> Describe with AI <SoonPill /></button>
                  <div className="rt-menu-sep" />
                  <button><Icons.Eye size={14} /> View audience overlap</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Stats — 3-wide */}
      <section className="rt-stats rt-stats-3">
        <StatCard label="Segments" value={totalSegments} sub={`${USER_SEGMENTS.length} custom · ${SYSTEM_SEGMENTS.length} built-in`} />
        <StatCard label="Dynamic segments" value={dynamicCount} sub="Recalculated continuously" />
        <StatCard label="In active flows" value={usedInFlows} sub={`Across ${USER_SEGMENTS.filter(s => s.flows.length > 0).length} segments`} />
      </section>

      {/* Templates row — slim variant */}
      <section className="rt-tpl-row rt-tpl-row-slim">
        <div className="rt-tpl-head">
          <div>
            <h2>Start from a <em>template</em></h2>
            <div className="rt-tpl-head-sub">Common segments — pre-built rules you can tweak.</div>
          </div>
          <button className="btn btn-ghost btn-sm">See all templates <Icons.Arrow size={12} /></button>
        </div>
        <div className="rt-tpl-cards">
          {TEMPLATES.map(t => <TemplateCard key={t.id} template={t} onPick={onPickTemplate} />)}
        </div>
      </section>

      {/* Quick views rail — built-in segments as nav, not cards */}
      <div className="rt-qv-rail">
        <div className="rt-qv-rail-label">
          <Icons.Lock size={11} />
          <span>Quick views</span>
        </div>
        <div className="rt-qv-scroll">
          {SYSTEM_SEGMENTS.map(s => <QuickViewItem key={s.id} seg={s} onOpen={() => onOpenDetail(s)} />)}
        </div>
      </div>

      {/* Your segments heading */}
      <div className="rt-table-heading">
        <div>
          <h2><em>Your</em> segments</h2>
          <div className="rt-table-heading-sub">Custom rule-based and static segments you've created.</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="rt-toolbar rt-toolbar-stack" style={{ marginTop: 8 }}>
        <div className="rt-chips rt-chips-wrap">
          <button onClick={() => setKindFilter('all')} className={`rt-chip ${kindFilter === 'all' ? 'rt-chip-on' : ''}`}>
            All<span className="rt-chip-count">{USER_SEGMENTS.length}</span>
          </button>
          <button onClick={() => setKindFilter('dynamic')} className={`rt-chip ${kindFilter === 'dynamic' ? 'rt-chip-on' : ''}`}>
            Dynamic<span className="rt-chip-count">{USER_SEGMENTS.filter(s => s.kind === 'dynamic').length}</span>
          </button>
          <button onClick={() => setKindFilter('static')} className={`rt-chip ${kindFilter === 'static' ? 'rt-chip-on' : ''}`}>
            Static<span className="rt-chip-count">{USER_SEGMENTS.filter(s => s.kind === 'static').length}</span>
          </button>
        </div>
        <div className="rt-toolbar-right">
          <div className="rt-search">
            <Icons.Search size={14} />
            <input placeholder="Search segments…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setSortBy(sortBy === 'updated' ? 'size' : 'updated')}>
            <Icons.Sliders size={13} /> Sort: {sortBy === 'updated' ? 'Recently updated' : 'Segment size'}
          </button>
        </div>
      </div>

      {/* User segments table */}
      <div className="rt-seg-table">
        <div className="rt-seg-thead">
          <div>Segment</div>
          <div>Type</div>
          <div>Contacts</div>
          <div>Used in flows</div>
          <div>Updated</div>
          <div />
        </div>
        {userSegs.map(s => (
          <div key={s.id} className="rt-seg-row" onClick={(e) => {
            if (e.target.closest('.rt-tactions') || e.target.closest('.rt-menu')) return;
            onOpenDetail(s);
          }}>
            <div className="rt-seg-name-cell">
              <span className={`rt-seg-name-icon ${s.kind === 'static' ? 'static' : ''}`}>
                <Icons.Sliders size={14} />
              </span>
              <div className="rt-seg-name">
                <span className="rt-seg-name-main">{s.name}</span>
                <span className="rt-seg-name-sub">{s.description}</span>
              </div>
            </div>
            <div>
              <span className={`rt-seg-kind-pill rt-seg-kind-${s.kind}`}>
                {s.kind === 'dynamic' ? <><Icons.Refresh size={10} /> Dynamic</> : <><Icons.Lock size={10} /> Static</>}
              </span>
            </div>
            <div className="rt-seg-count">
              <span className="rt-seg-count-num">{s.contactCount.toLocaleString()}</span>
              <span className="rt-seg-spark"><Sparkline points={s.sparkline} w={60} h={18} /></span>
              <span className={`rt-seg-count-delta ${s.kind === 'static' ? 'muted' : ''}`}>{s.delta}</span>
            </div>
            <div className="rt-seg-flows">
              {s.flows.length === 0 && <span className="rt-seg-flow-none">— Not used</span>}
              {s.flows.slice(0, 2).map((f, i) => (
                <span key={i} className="rt-seg-flow-chip"><Icons.Flow size={10} /> {f}</span>
              ))}
              {s.flows.length > 2 && <span className="rt-seg-flow-chip">+{s.flows.length - 2}</span>}
            </div>
            <div className="rt-seg-updated">{s.updated}</div>
            <div className="rt-tactions">
              <button className="btn btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === s.id ? null : s.id); }} aria-label="Row actions"><Icons.More size={16} /></button>
              {openMenu === s.id && (
                <>
                  <div className="rt-veil" onClick={() => setOpenMenu(null)} />
                  <div className="rt-menu">
                    <button onClick={() => { setOpenMenu(null); onOpenDetail(s); }}><Icons.Eye size={14} /> View segment</button>
                    <button onClick={() => { setOpenMenu(null); onOpenBuilder(s); }}><Icons.Sliders size={14} /> Edit rules</button>
                    <button><Icons.Send size={14} /> Use in a flow</button>
                    <button><Icons.Copy size={14} /> Duplicate</button>
                    <div className="rt-menu-sep" />
                    <button disabled className="rt-menu-soon"><Icons.ArrowUp size={14} /> Export to CSV <SoonPill /></button>
                    <button className="rt-menu-danger"><Icons.Trash size={14} /> Delete</button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
        {userSegs.length === 0 && (
          <div className="rt-empty-row">
            No segments match. <button className="rt-link" onClick={() => { setKindFilter('all'); setQuery(''); }}>Clear filters</button>
          </div>
        )}
      </div>

      <div className="rt-table-foot">
        <span className="muted">Showing <strong style={{ color: 'var(--ink-1)' }}>{userSegs.length}</strong> of {USER_SEGMENTS.length} custom segments</span>
        <span className="muted">·</span>
        <span className="muted">Plus {SYSTEM_SEGMENTS.length} built-in</span>
      </div>
    </div>
  );
}

Object.assign(window, { SegmentsList, Sparkline });
