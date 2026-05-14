// Retainify — Flows list page
// Header with title, filter chips, search, primary CTA, then a table of flows.

const { useState: useStateList } = React;

function FlowsListEmpty({ onCreate }) {
  return (
    <div className="rt-empty">
      <div className="rt-empty-art">
        <svg width="160" height="120" viewBox="0 0 160 120" fill="none">
          <rect x="20" y="20" width="50" height="34" rx="6" fill="#FDFBF5" stroke="#D2C9B0"/>
          <rect x="28" y="30" width="34" height="3" rx="1.5" fill="#D2C9B0"/>
          <rect x="28" y="38" width="22" height="3" rx="1.5" fill="#E4DDCB"/>
          <rect x="90" y="44" width="50" height="34" rx="6" fill="#FDFBF5" stroke="#D2C9B0"/>
          <rect x="98" y="54" width="34" height="3" rx="1.5" fill="#D2C9B0"/>
          <rect x="98" y="62" width="22" height="3" rx="1.5" fill="#E4DDCB"/>
          <rect x="20" y="70" width="50" height="34" rx="6" fill="#DCE7DF" stroke="#1F3D2F"/>
          <rect x="28" y="80" width="34" height="3" rx="1.5" fill="#1F3D2F"/>
          <rect x="28" y="88" width="22" height="3" rx="1.5" fill="#356A53"/>
          <path d="M70 37 L88 60" stroke="#1F3D2F" strokeWidth="1.2" strokeDasharray="3 3"/>
          <path d="M70 87 L88 64" stroke="#1F3D2F" strokeWidth="1.2" strokeDasharray="3 3"/>
        </svg>
      </div>
      <h2 className="t-display-2" style={{ margin: 0, color: 'var(--ink-1)' }}>Your retention engine, <em style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-700)' }}>starts here</em>.</h2>
      <p className="rt-empty-lede">Build the email sequences that follow your customers from first hello to long-term loyalty. Start from a tested template or compose your own.</p>
      <div className="rt-empty-actions">
        <button className="btn btn-primary btn-lg" onClick={onCreate}>
          <Icons.Plus size={14} /> Create a flow
        </button>
        <button className="btn btn-ghost btn-lg">Watch the 90-second tour</button>
      </div>
      <div className="rt-empty-tips">
        <div className="rt-empty-tip">
          <Icons.Sparkles size={16} />
          <div><strong>Welcome Series</strong><br/><span className="muted">For new subscribers</span></div>
        </div>
        <div className="rt-empty-tip">
          <Icons.Cart size={16} />
          <div><strong>Abandoned Cart</strong><br/><span className="muted">Recover lost revenue</span></div>
        </div>
        <div className="rt-empty-tip">
          <Icons.Heart size={16} />
          <div><strong>Post-Purchase</strong><br/><span className="muted">Earn the second order</span></div>
        </div>
        <div className="rt-empty-tip">
          <Icons.Refresh size={16} />
          <div><strong>Win-back</strong><br/><span className="muted">Bring lapsed customers home</span></div>
        </div>
      </div>
    </div>
  );
}

function FlowsList({ flows, onCreate, onOpenFlow, showEmpty }) {
  const [filter, setFilter] = useStateList('all');
  const [query, setQuery] = useStateList('');
  const [openMenu, setOpenMenu] = useStateList(null);

  if (showEmpty) return <FlowsListEmpty onCreate={onCreate} />;

  const counts = {
    all: flows.length,
    active: flows.filter(f => f.status === 'active').length,
    paused: flows.filter(f => f.status === 'paused').length,
    draft: flows.filter(f => f.status === 'draft').length,
  };
  const filtered = flows
    .filter(f => filter === 'all' || f.status === filter)
    .filter(f => !query || f.name.toLowerCase().includes(query.toLowerCase()));

  const { TRIGGERS, countSteps, fmtNum, fmtPct } = window.RetainifyData;

  return (
    <div className="rt-page">
      {/* Page header */}
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify · Automation</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Flows</h1>
          <p className="t-body muted" style={{ margin: '8px 0 0', maxWidth: 540 }}>
            Automated email sequences that follow your customers from first signal to repeat order.
          </p>
        </div>
        <div className="rt-page-actions">
          <button className="btn btn-secondary"><Icons.Help size={14} /> Docs</button>
          <button className="btn btn-primary" onClick={onCreate}><Icons.Plus size={14} /> Create flow</button>
        </div>
      </header>

      {/* Summary stats */}
      <section className="rt-stats">
        <div className="rt-stat">
          <div className="t-micro muted">Live flows</div>
          <div className="rt-stat-value">{counts.active}</div>
          <div className="rt-stat-delta">↑ 1 this week</div>
        </div>
        <div className="rt-stat">
          <div className="t-micro muted">Delivered · last 30 days</div>
          <div className="rt-stat-value">{fmtNum(flows.reduce((a, f) => a + (f.sent || 0), 0))}</div>
          <div className="rt-stat-delta">↑ 12.4% vs. prior</div>
        </div>
        <div className="rt-stat">
          <div className="t-micro muted">Avg. open rate</div>
          <div className="rt-stat-value">41.3<span className="rt-stat-unit">%</span></div>
          <div className="rt-stat-delta muted">— industry avg. 24%</div>
        </div>
        <div className="rt-stat rt-stat-feature">
          <div className="t-micro" style={{ color: 'var(--accent-ink)' }}>Recovered · last 30 days</div>
          <div className="rt-stat-value" style={{ color: 'var(--brand-ink)' }}>$24,180</div>
          <div className="rt-stat-delta" style={{ color: 'var(--brand-600)' }}>↑ 28.2% vs. prior</div>
        </div>
      </section>

      {/* Toolbar */}
      <div className="rt-toolbar">
        <div className="rt-chips">
          {['all', 'active', 'paused', 'draft'].map(k => (
            <button key={k} onClick={() => setFilter(k)} className={`rt-chip ${filter === k ? 'rt-chip-on' : ''}`}>
              <span style={{ textTransform: 'capitalize' }}>{k}</span>
              <span className="rt-chip-count">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="rt-search">
          <Icons.Search size={14} />
          <input placeholder="Search flows" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="rt-table">
        <div className="rt-thead">
          <div>Flow</div>
          <div>Status</div>
          <div>Updated</div>
          <div className="rt-tnum">Delivered</div>
          <div className="rt-tnum">Open rate</div>
          <div className="rt-tnum">Click rate</div>
          <div />
        </div>
        {filtered.map(f => {
          const trig = TRIGGERS[f.trigger];
          const TrigIcon = Icons[trig.glyph];
          return (
            <div key={f.id} className="rt-trow" onClick={() => onOpenFlow(f.id)}>
              <div className="rt-tcell-name">
                <div className={`rt-trig-dot rt-tint-${trig.tint}`}><TrigIcon size={14} /></div>
                <div>
                  <div className="rt-flow-name">{f.name}</div>
                  <div className="rt-flow-meta">
                    {trig.label} · {countSteps(f)} emails
                  </div>
                </div>
              </div>
              <div><span className={`pill ${f.status}`}>{f.status}</span></div>
              <div className="rt-tdate">{f.updated}</div>
              <div className="rt-tnum t-mono">{fmtNum(f.sent)}</div>
              <div className="rt-tnum t-mono">{fmtPct(f.openRate)}</div>
              <div className="rt-tnum t-mono">{fmtPct(f.clickRate)}</div>
              <div className="rt-tactions">
                <button className="btn btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === f.id ? null : f.id); }}>
                  <Icons.More size={16} />
                </button>
                {openMenu === f.id && (
                  <div className="rt-menu" onClick={e => e.stopPropagation()}>
                    <button><Icons.Eye size={14} /> View</button>
                    <button><Icons.Copy size={14} /> Duplicate</button>
                    <button><Icons.Pause size={14} /> Pause</button>
                    <button className="rt-menu-danger"><Icons.Trash size={14} /> Archive</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="rt-empty-row">
            No flows match this filter. <button className="rt-link" onClick={() => { setFilter('all'); setQuery(''); }}>Clear</button>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { FlowsList, FlowsListEmpty });
