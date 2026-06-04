// Retainify — Segment detail page
// Editorial header → CTA → summary stats → tabs (Contacts / Rules / Activity / Flows)

const { useState: useStateSD, useMemo: useMemoSD } = React;

// ── Read-only rule rendering ─────────────────────────────────────────────
function RulesReadonly({ group, isRoot = true }) {
  const { FIELD_BY_ID, formatRuleValue, opLabel } = window.RetainifySegments;
  const isAny = group.match === 'any';
  return (
    <div className="rt-rd-grp">
      <div className={`rt-rd-grp-head ${isAny ? 'rt-any' : ''}`}>
        {isRoot ? 'Match' : 'Or'} {isAny ? 'any' : 'all'} of:
      </div>
      <div className="rt-rd-grp-body">
        {(group.children || []).map((c, i) => {
          if (c.type === 'rule') {
            const f = FIELD_BY_ID[c.field];
            return (
              <div key={c.id || i} className="rt-rd-rule">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)', marginRight: 4 }}>{String(i + 1).padStart(2, '0')}</span>
                <span className="rt-rd-rule-field">{f?.label || c.field}</span>
                <span className="rt-rd-rule-op">{opLabel(c)}</span>
                <span className="rt-rd-rule-val">{formatRuleValue(c)}</span>
              </div>
            );
          }
          return (
            <div key={c.id || i} style={{ marginTop: 8 }}>
              <RulesReadonly group={c} isRoot={false} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Activity tab (mock chart) ────────────────────────────────────────────
function ActivityChart({ points }) {
  // Simple area chart, 320x120
  const w = 540, h = 140, pad = 12;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const dx = (w - pad * 2) / (points.length - 1);
  const pts = points.map((p, i) => [pad + i * dx, h - pad - ((p - min) / span) * (h - pad * 2)]);
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const areaPath = `${linePath} L ${pts[pts.length - 1][0]} ${h - pad} L ${pts[0][0]} ${h - pad} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="rt-act-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1F3D2F" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#1F3D2F" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#rt-act-grad)" />
      <path d={linePath} fill="none" stroke="#1F3D2F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => i % 3 === 0 && <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="#1F3D2F" />)}
    </svg>
  );
}

// ── Membership churn rows ────────────────────────────────────────────────
function MembershipRow({ direction, name, email, when, reason }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 10, alignItems: 'center',
      padding: '10px 0', borderBottom: '1px solid var(--hair-1)',
    }}>
      <span style={{
        width: 24, height: 24, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: direction === 'in' ? 'var(--brand-50)' : 'var(--status-paused-bg)',
        color: direction === 'in' ? 'var(--brand-700)' : 'var(--status-paused-ink)',
      }}>
        {direction === 'in' ? <Icons.ArrowDown size={11} /> : <Icons.ArrowUp size={11} />}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-1)', fontWeight: 500 }}>{email}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{reason}</div>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{when}</div>
    </div>
  );
}

// ── Main detail ──────────────────────────────────────────────────────────
function SegmentDetail({ segment, onBack, onEdit, onUseInFlow }) {
  const [tab, setTab] = useStateSD('contacts');
  const [openMenu, setOpenMenu] = useStateSD(false);
  const { CONTACTS, fmtMoney, LIFECYCLE } = window.RetainifyContacts;
  const { FIELD_BY_ID } = window.RetainifySegments;

  // Pick a representative contact subset for the contacts tab
  const sampleContacts = useMemoSD(() => {
    // For demo, just take the first N matching by tag-ish heuristic
    return CONTACTS.slice(0, Math.min(8, CONTACTS.length));
  }, [segment.id]);

  const isSystem = !!segment.system;

  // Synthetic activity (last 30 days of size)
  const activity = useMemoSD(() => {
    const seed = segment.id || '';
    let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const arr = [];
    let v = segment.contactCount * 0.78;
    for (let i = 0; i < 30; i++) {
      const noise = (((h * (i + 1)) >>> 0) % 200) / 1000;
      v *= 1 + 0.005 + noise - 0.07;
      arr.push(Math.max(1, Math.round(v)));
    }
    arr[arr.length - 1] = segment.contactCount;
    return arr;
  }, [segment.id, segment.contactCount]);

  const lifecycleBreakdown = useMemoSD(() => {
    const seed = segment.id;
    let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const r = (s) => (((h * (s + 7)) >>> 0) % 100);
    const stages = [
      { id: 'active',  label: 'Active',  color: '#1F3D2F' },
      { id: 'new',     label: 'New',     color: '#25406A' },
      { id: 'at_risk', label: 'At-risk', color: '#6B5018' },
      { id: 'churned', label: 'Churned', color: '#5A3F38' },
    ];
    let weights = stages.map((_, i) => 10 + r(i));
    const sum = weights.reduce((a, b) => a + b, 0);
    return stages.map((s, i) => ({ ...s, pct: weights[i] / sum, count: Math.round(segment.contactCount * weights[i] / sum) }));
  }, [segment.id, segment.contactCount]);

  // Stats
  const avgAOV = useMemoSD(() => 80 + ((segment.id || '').length * 7), [segment.id]);
  const totalRevenue = segment.contactCount * avgAOV;
  const openRate = 32 + (((segment.id || '').length * 3) % 18);

  return (
    <div className="rt-page rt-sd">
      {/* Top bar */}
      <div className="rt-sd-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="rt-bld-back" onClick={onBack} aria-label="Back"><Icons.ArrowBack size={16} /></button>
          <div className="rt-bld-crumb">
            <span onClick={onBack} style={{ cursor: 'pointer' }}>Segments</span>
            <span style={{ margin: '0 8px', color: 'var(--ink-4)' }}>/</span>
            <span className="rt-bld-crumb-active">{segment.name}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isSystem && <button className="btn btn-secondary" onClick={() => onEdit(segment)}><Icons.Sliders size={14} /> Edit rules</button>}
          <button className="btn btn-primary" onClick={() => onUseInFlow(segment)}><Icons.Send size={14} /> Use in a flow</button>
          <div className="rt-kebab-wrap">
            <button className="btn btn-secondary btn-icon" onClick={() => setOpenMenu(!openMenu)} aria-label="More"><Icons.More size={16} /></button>
            {openMenu && (
              <>
                <div className="rt-veil" onClick={() => setOpenMenu(false)} />
                <div className="rt-menu" style={{ right: 0, left: 'auto' }}>
                  <button><Icons.Copy size={14} /> Duplicate</button>
                  <button><Icons.Refresh size={14} /> Recalculate now</button>
                  <button disabled className="rt-menu-soon"><Icons.ArrowUp size={14} /> Export CSV <SoonPill /></button>
                  <button disabled className="rt-menu-soon"><Icons.Eye size={14} /> Compare to another segment <SoonPill /></button>
                  {!isSystem && <><div className="rt-menu-sep" /><button className="rt-menu-danger"><Icons.Trash size={14} /> Delete segment</button></>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Editorial head */}
      <header className="rt-sd-head">
        <div className="rt-sd-head-left">
          <div className={`rt-sd-icon ${segment.kind === 'static' ? 'static' : ''}`}>
            {isSystem ? <Icons.Lock size={22} /> : segment.kind === 'static' ? <Icons.Lock size={22} /> : <Icons.Sliders size={22} />}
          </div>
          <h1 className="rt-sd-title">{segment.name}</h1>
          <p className="rt-sd-desc">{segment.description}</p>
          <div className="rt-sd-pills">
            {isSystem && <span className="rt-pill" style={{ background: 'var(--paper-2)', color: 'var(--ink-2)', border: '1px solid var(--hair-2)' }}>Built-in</span>}
            {!isSystem && (
              <span className={`rt-seg-kind-pill rt-seg-kind-${segment.kind}`}>
                {segment.kind === 'dynamic' ? <><Icons.Refresh size={10} /> Dynamic</> : <><Icons.Lock size={10} /> Static</>}
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
              Last updated {segment.updated || 'just now'}
            </span>
            {!isSystem && segment.kind === 'dynamic' && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                · Recalculating continuously
              </span>
            )}
          </div>
        </div>
        <div className="rt-sd-stat-card">
          <span className="t-micro">Contacts in segment</span>
          <div className="rt-sd-stat-card-big">
            <em style={{ fontStyle: 'italic' }}>{segment.contactCount.toLocaleString()}</em>
            <span className="rt-sd-stat-card-big-unit">people</span>
          </div>
          <div className="rt-sd-stat-card-delta">{segment.delta}</div>
          <div style={{ marginTop: 4 }}>
            <Sparkline points={segment.sparkline || activity.slice(-11)} w={300} h={36} color="var(--brand-700)" />
          </div>
        </div>
      </header>

      {/* Use-in-flow CTA */}
      {!isSystem && segment.flows.length === 0 && (
        <div className="rt-sd-cta">
          <div className="rt-sd-cta-icon"><Icons.Flow size={18} /></div>
          <div>
            <div className="rt-sd-cta-title">This segment isn't used in any flow yet.</div>
            <div className="rt-sd-cta-sub">Turn it into a trigger — automatically reach everyone who matches, now and in the future.</div>
          </div>
          <button className="btn btn-accent" onClick={() => onUseInFlow(segment)}>
            Build a flow <Icons.Arrow size={13} />
          </button>
        </div>
      )}

      {/* Summary stats */}
      <section className="rt-sd-summary">
        <StatCard label="Avg. order value" value={fmtMoney(avgAOV)} sub={`Across ${segment.contactCount.toLocaleString()} contacts`} />
        <StatCard label="Lifetime revenue" value={fmtMoney(totalRevenue, 0)} sub="From this segment" />
        <StatCard label="Email open rate" value={`${openRate}%`} sub="Last 30 days" />
        <StatCard label="In active flows" value={segment.flows.length} sub={segment.flows.length ? 'Driving recurring sends' : 'Not driving any sends'} />
      </section>

      {/* Tabs */}
      <div className="rt-sd-tabwrap">
        <div className="rt-chips">
          <button onClick={() => setTab('contacts')} className={`rt-chip ${tab === 'contacts' ? 'rt-chip-on' : ''}`}>
            <Icons.Users size={13} /> Contacts<span className="rt-chip-count">{segment.contactCount.toLocaleString()}</span>
          </button>
          <button onClick={() => setTab('rules')} className={`rt-chip ${tab === 'rules' ? 'rt-chip-on' : ''}`}>
            <Icons.Sliders size={13} /> Rules
          </button>
          <button onClick={() => setTab('activity')} className={`rt-chip ${tab === 'activity' ? 'rt-chip-on' : ''}`}>
            <Icons.Chart size={13} /> Activity
          </button>
          <button onClick={() => setTab('flows')} className={`rt-chip ${tab === 'flows' ? 'rt-chip-on' : ''}`}>
            <Icons.Flow size={13} /> Flows<span className="rt-chip-count">{segment.flows.length}</span>
          </button>
        </div>
        {tab === 'contacts' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="rt-search" style={{ width: 240 }}>
              <Icons.Search size={14} />
              <input placeholder="Search in segment…" />
            </div>
            <button className="btn btn-secondary btn-sm"><Icons.ArrowUp size={13} /> Export</button>
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="rt-seg-table">
        {tab === 'contacts' && (
          <>
            <div className="rt-cthead">
              <div className="rt-ctcheck"><input type="checkbox" className="rt-checkbox" aria-label="Select all" /></div>
              <div>Contact</div>
              <div>Lifecycle</div>
              <div>Tags</div>
              <div className="rt-tnum">Total spent</div>
              <div className="rt-tnum">Last seen</div>
              <div className="rt-tnum">Why match?</div>
              <div />
            </div>
            {sampleContacts.map(c => (
              <div key={c.id} className="rt-ctrow">
                <div className="rt-ctcheck"><input type="checkbox" className="rt-checkbox" aria-label={`Select ${c.email}`} /></div>
                <div className="rt-cname">
                  <Avatar name={c.name} email={c.email} size={32} />
                  <div style={{ minWidth: 0 }}>
                    <div className="rt-cname-email">{c.email}</div>
                    <div className="rt-cname-name">{c.name || '—'}</div>
                  </div>
                </div>
                <div><LifecyclePill stage={c.lifecycleStage} /></div>
                <div className="rt-ctags">
                  {(c.tags || []).slice(0, 2).map(t => <TagChip key={t} tagId={t} />)}
                  {(c.tags || []).length > 2 && <span className="rt-tag-overflow">+{(c.tags || []).length - 2}</span>}
                </div>
                <div className="rt-tnum rt-tmoney">{c.stats.totalSpent ? fmtMoney(c.stats.totalSpent) : <span className="muted">—</span>}</div>
                <div className="rt-tnum rt-tdate">{c.lastSeenAt}</div>
                <div className="rt-tnum">
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--brand-700)',
                    background: 'var(--brand-50)', padding: '2px 6px', borderRadius: 'var(--r-pill)',
                  }}>
                    {segment.kind === 'static' ? 'Added manually' : 'Rule match'}
                  </span>
                </div>
                <div className="rt-tactions">
                  <button className="btn btn-ghost btn-icon" aria-label="More"><Icons.More size={16} /></button>
                </div>
              </div>
            ))}
            <div className="rt-table-foot" style={{ padding: '14px 22px', borderTop: '1px solid var(--hair-1)' }}>
              <span className="muted">Showing <strong style={{ color: 'var(--ink-1)' }}>{sampleContacts.length}</strong> of {segment.contactCount.toLocaleString()} matching contacts</span>
              <span className="muted">·</span>
              <button className="rt-link">Load more</button>
            </div>
          </>
        )}

        {tab === 'rules' && (
          <div className="rt-sd-rules">
            {isSystem ? (
              <div style={{ padding: 24, background: 'var(--paper-2)', borderRadius: 'var(--r-3)', border: '1px solid var(--hair-1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Icons.Lock size={14} />
                  <span className="t-micro">System rule</span>
                </div>
                <div style={{ fontSize: 14, color: 'var(--ink-1)', lineHeight: 1.6 }}>
                  {segment.description}. This is a built-in segment maintained by Retainify — its rule can't be edited, but you can duplicate it as a starting point for your own.
                </div>
              </div>
            ) : segment.kind === 'static' ? (
              <div style={{ padding: 24, background: 'var(--paper-2)', borderRadius: 'var(--r-3)', border: '1px solid var(--hair-1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Icons.Lock size={14} />
                  <span className="t-micro">Static segment</span>
                </div>
                <div style={{ fontSize: 14, color: 'var(--ink-1)', lineHeight: 1.6 }}>
                  This is a frozen list of {segment.contactCount} contact{segment.contactCount === 1 ? '' : 's'}. It doesn't have rules — members are added or removed manually. <a href="#" className="rt-link" onClick={e => { e.preventDefault(); onEdit(segment); }}>Manage members</a>.
                </div>
              </div>
            ) : segment.rules ? (
              <>
                <RulesReadonly group={segment.rules} />
                <div className="rt-sd-rules-meta">
                  <span><Icons.Refresh size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} /> Recalculated every minute</span>
                  <span>·</span>
                  <span><strong>{(segment.rules.children || []).length}</strong> top-level rule{(segment.rules.children || []).length === 1 ? '' : 's'}</span>
                  <span>·</span>
                  <span>Match <strong>{segment.rules.match}</strong></span>
                  <span style={{ marginLeft: 'auto' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => onEdit(segment)}><Icons.Sliders size={12} /> Edit rules</button>
                  </span>
                </div>
              </>
            ) : (
              <div style={{ padding: 24, color: 'var(--ink-3)' }}>No rules defined.</div>
            )}
          </div>
        )}

        {tab === 'activity' && (
          <div className="rt-sd-activity">
            <div className="rt-sd-act-card">
              <div className="rt-sd-act-title">Segment size, last 30 days</div>
              <ActivityChart points={activity} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                <span>30 days ago · {activity[0].toLocaleString()}</span>
                <span>Today · {activity[activity.length - 1].toLocaleString()}</span>
              </div>
            </div>
            <div className="rt-sd-act-card">
              <div className="rt-sd-act-title">Lifecycle mix</div>
              <div className="rt-prev-stack" style={{ height: 16 }}>
                {lifecycleBreakdown.map(s => (
                  <div key={s.id} className="rt-prev-stack-seg" style={{ width: `${s.pct * 100}%`, background: s.color }} title={`${s.label}: ${s.count}`} />
                ))}
              </div>
              <div className="rt-prev-stack-legend" style={{ marginTop: 14, gridTemplateColumns: '1fr' }}>
                {lifecycleBreakdown.map(s => (
                  <div key={s.id} className="rt-prev-stack-leg" style={{ padding: '4px 0', borderBottom: '1px solid var(--hair-1)' }}>
                    <span className="rt-prev-stack-leg-dot" style={{ background: s.color }} />
                    <span>{s.label}</span>
                    <span className="rt-prev-stack-leg-num">{s.count} <span style={{ color: 'var(--ink-4)' }}>· {Math.round(s.pct * 100)}%</span></span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rt-sd-act-card">
              <div className="rt-sd-act-title">Recently entered</div>
              <MembershipRow direction="in" name="Maren Holloway" email="maren.holloway@gmail.com" reason="Total spent crossed $1,000" when="2 hours ago" />
              <MembershipRow direction="in" name="Hugh Bertelsen" email="hugh@bertelsen.studio" reason="Subscribed via popup" when="6 hours ago" />
              <MembershipRow direction="in" name="Reema Khan" email="reema.k@reemandco.com" reason="Total spent crossed $1,000" when="yesterday" />
              <MembershipRow direction="in" name="Tomas Veiga" email="tveiga@oficinaveiga.pt" reason="Re-subscribed" when="yesterday" />
            </div>
            <div className="rt-sd-act-card">
              <div className="rt-sd-act-title">Recently left</div>
              <MembershipRow direction="out" name="Jamie Park" email="jamie.park@gmail.com" reason="Unsubscribed" when="3 hours ago" />
              <MembershipRow direction="out" name="Lin Yao" email="lin.yao@studio-yao.com" reason="No longer matches rule" when="yesterday" />
              <MembershipRow direction="out" name="Adi Sopher" email="adi@sopherstudio.de" reason="Bounced" when="2 days ago" />
            </div>
          </div>
        )}

        {tab === 'flows' && (
          <div style={{ padding: 24 }}>
            {segment.flows.length === 0 ? (
              <div style={{
                padding: '40px 24px', textAlign: 'center',
                border: '1px dashed var(--hair-2)', borderRadius: 'var(--r-4)',
                background: 'var(--paper-2)',
              }}>
                <Icons.Flow size={28} style={{ color: 'var(--ink-4)', marginBottom: 12 }} />
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--ink-1)', fontStyle: 'italic', marginBottom: 8 }}>Not used in any flow yet</div>
                <div style={{ fontSize: 14, color: 'var(--ink-3)', maxWidth: 420, margin: '0 auto 18px' }}>
                  Turn this segment into a flow trigger — anyone who matches will enter automatically.
                </div>
                <button className="btn btn-primary" onClick={() => onUseInFlow(segment)}>
                  <Icons.Plus size={14} /> Build a flow from this segment
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {segment.flows.map((f, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 16, alignItems: 'center',
                    padding: '14px 18px',
                    background: 'var(--paper-2)', border: '1px solid var(--hair-1)',
                    borderRadius: 'var(--r-3)',
                  }}>
                    <span style={{
                      width: 36, height: 36, borderRadius: 'var(--r-2)',
                      background: 'var(--brand-50)', color: 'var(--brand-700)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icons.Flow size={16} />
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-1)' }}>{f}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                        Triggers on <strong style={{ color: 'var(--ink-1)' }}>Entered segment "{segment.name}"</strong>
                      </div>
                    </div>
                    <span className="rt-pill rt-pill-status" style={{ background: 'var(--success-bg)', color: 'var(--success-ink)' }}>
                      <span className="rt-pill-dot" style={{ background: 'var(--success-ink)' }} /> Live
                    </span>
                    <button className="btn btn-secondary btn-sm">Open flow <Icons.Arrow size={12} /></button>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => onUseInFlow(segment)}>
                  <Icons.Plus size={13} /> Use in another flow
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { SegmentDetail });
