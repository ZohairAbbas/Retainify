// Retainify — Contacts List page
// Header → 4 stats → filter chip bar + search → table → floating bulk capsule.

const { useState: useStateContacts, useMemo: useMemoContacts } = React;

// ── Avatar ────────────────────────────────────────────────────────────────
function Avatar({ name, email, size = 28 }) {
  const { initials } = window.RetainifyContacts;
  const seed = (name || email || '').toLowerCase();
  // Deterministic warm-tone background per seed
  const HUES = ['#DCE7DF', '#F1E4C5', '#EAD6EA', '#E4DAD7', '#DCE4ED', '#EED9D2', '#E7E4D8'];
  const INKS = ['#1F3D2F', '#6B5018', '#5A2E5A', '#5A3F38', '#25406A', '#7A2E1F', '#4A4736'];
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const idx = h % HUES.length;
  return (
    <div className="rt-avatar" style={{ width: size, height: size, background: HUES[idx], color: INKS[idx], fontSize: Math.round(size * 0.42) }}>
      {initials(name || email)}
    </div>
  );
}

// ── Pills ─────────────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const { STATUS } = window.RetainifyContacts;
  const s = STATUS[status];
  if (!s) return null;
  return <span className="rt-pill rt-pill-status" style={{ background: s.bg, color: s.ink }}><span className="rt-pill-dot" style={{ background: s.ink }} />{s.label}</span>;
}

function LifecyclePill({ stage, tooltip = true }) {
  const { LIFECYCLE } = window.RetainifyContacts;
  const l = LIFECYCLE[stage];
  if (!l) return null;
  return (
    <span className="rt-pill rt-pill-lifecycle" style={{ background: l.bg, color: l.ink }} title={tooltip ? l.rule : undefined}>
      {l.label}
    </span>
  );
}

function TagChip({ tagId, removable, onRemove }) {
  const { TAGS, TAG_PALETTE } = window.RetainifyContacts;
  const t = TAGS.find(x => x.id === tagId);
  if (!t) return null;
  const p = TAG_PALETTE[t.color] || TAG_PALETTE.tan;
  return (
    <span className="rt-tag-chip" style={{ background: p.bg, color: p.ink }}>
      {t.name}
      {removable && <button className="rt-tag-x" onClick={onRemove} aria-label={`Remove ${t.name}`}><Icons.Close size={10} /></button>}
    </span>
  );
}

// ── Coming soon affordance ────────────────────────────────────────────────
function SoonPill() {
  return <span className="rt-soon-pill">Soon</span>;
}

// ── Stat card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, unit, sub, feature }) {
  return (
    <div className={`rt-stat ${feature ? 'rt-stat-feature' : ''}`}>
      <div className="t-micro muted" style={feature ? { color: 'var(--accent-ink)' } : null}>{label}</div>
      <div className="rt-stat-value" style={feature ? { color: 'var(--brand-ink)' } : null}>
        {value}{unit && <span className="rt-stat-unit">{unit}</span>}
      </div>
      <div className="rt-stat-delta" style={feature ? { color: 'var(--brand-600)' } : null}>{sub}</div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────
function ContactsEmpty({ onSync }) {
  return (
    <div className="rt-empty">
      <div className="rt-empty-art">
        <svg width="180" height="120" viewBox="0 0 180 120" fill="none">
          <rect x="20" y="40" width="48" height="60" rx="6" fill="#FDFBF5" stroke="#D2C9B0"/>
          <circle cx="44" cy="60" r="9" fill="#DCE7DF" stroke="#1F3D2F"/>
          <rect x="28" y="74" width="32" height="3" rx="1.5" fill="#D2C9B0"/>
          <rect x="28" y="82" width="20" height="3" rx="1.5" fill="#E4DDCB"/>
          <rect x="66" y="20" width="48" height="60" rx="6" fill="#FDFBF5" stroke="#D2C9B0"/>
          <circle cx="90" cy="40" r="9" fill="#F1E4C5" stroke="#6B5018"/>
          <rect x="74" y="54" width="32" height="3" rx="1.5" fill="#D2C9B0"/>
          <rect x="74" y="62" width="20" height="3" rx="1.5" fill="#E4DDCB"/>
          <rect x="112" y="40" width="48" height="60" rx="6" fill="#FDFBF5" stroke="#D2C9B0"/>
          <circle cx="136" cy="60" r="9" fill="#DCE4ED" stroke="#25406A"/>
          <rect x="120" y="74" width="32" height="3" rx="1.5" fill="#D2C9B0"/>
          <rect x="120" y="82" width="20" height="3" rx="1.5" fill="#E4DDCB"/>
        </svg>
      </div>
      <h2 className="t-display-2" style={{ margin: 0, color: 'var(--ink-1)' }}>
        Everyone you’ve met, <em style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-700)' }}>in one place</em>.
      </h2>
      <p className="rt-empty-lede">Contacts appear here when someone subscribes through your popup, abandons a cart, places an order, or opts in to push. Sync your Shopify customers to get started.</p>
      <div className="rt-empty-actions">
        <button className="btn btn-primary btn-lg" onClick={onSync}><Icons.Refresh size={14} /> Sync from Shopify</button>
        <button className="btn btn-ghost btn-lg"><Icons.Plus size={14} /> Add a contact</button>
      </div>
      <div className="rt-empty-tips">
        <div className="rt-empty-tip"><Icons.Mail size={16} /><div><strong>Popups</strong><br/><span className="muted">New subscribers land here automatically.</span></div></div>
        <div className="rt-empty-tip"><Icons.Cart size={16} /><div><strong>Carts</strong><br/><span className="muted">Anyone who reaches checkout gets a record.</span></div></div>
        <div className="rt-empty-tip"><Icons.Bell size={16} /><div><strong>Push</strong><br/><span className="muted">Anonymous push subscribers, too.</span></div></div>
        <div className="rt-empty-tip"><Icons.Refresh size={16} /><div><strong>Shopify sync</strong><br/><span className="muted">Backfill all existing customers in one go.</span></div></div>
      </div>
    </div>
  );
}

// ── Sync banner (one-time roll-up of disconnected sources) ────────────────
function UnifyBanner({ onDismiss, onSync }) {
  return (
    <div className="rt-unify">
      <div className="rt-unify-icon"><Icons.Sparkle size={18} /></div>
      <div className="rt-unify-body">
        <div className="rt-unify-head">
          We found <strong>1,247 people</strong> across your popup, carts, push subscribers, and Shopify customers.
        </div>
        <div className="rt-unify-sub muted">Unify them into a single Contacts list. We won’t send anything — this is just data clean-up.</div>
      </div>
      <div className="rt-unify-actions">
        <button className="btn btn-ghost btn-sm" onClick={onDismiss}>Later</button>
        <button className="btn btn-primary btn-sm" onClick={onSync}><Icons.Refresh size={14} /> Unify now</button>
      </div>
    </div>
  );
}

// ── Dropdown filter ───────────────────────────────────────────────────────
function FilterDropdown({ label, options, value, onChange, icon }) {
  const [open, setOpen] = useStateContacts(false);
  const selected = options.find(o => o.id === value);
  const active = value && value !== 'all';
  return (
    <div className="rt-fdrop">
      <button className={`rt-chip ${active ? 'rt-chip-on' : ''}`} onClick={() => setOpen(o => !o)}>
        {icon && React.createElement(Icons[icon], { size: 13 })}
        <span>{active ? selected?.label : label}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="rt-veil" onClick={() => setOpen(false)} />
          <div className="rt-fdrop-menu">
            {options.map(o => (
              <button key={o.id} className={`rt-fdrop-item ${value === o.id ? 'rt-on' : ''}`} onClick={() => { onChange(o.id); setOpen(false); }}>
                {o.swatch && <span className="rt-fdrop-swatch" style={{ background: o.swatch }} />}
                <span>{o.label}</span>
                {o.count != null && <span className="rt-fdrop-count">{o.count}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Sync from Shopify modal ───────────────────────────────────────────────
function SyncModal({ open, onClose }) {
  const [includeUnmarketed, setIncludeUnmarketed] = useStateContacts(false);
  const [phase, setPhase] = useStateContacts('idle'); // idle | running | done
  const [progress, setProgress] = useStateContacts(0);
  React.useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => {
      setProgress(p => {
        const next = Math.min(p + Math.random() * 80, 1247);
        if (next >= 1247) { clearInterval(id); setPhase('done'); }
        return next;
      });
    }, 80);
    return () => clearInterval(id);
  }, [phase]);
  if (!open) return null;
  const start = () => { setProgress(0); setPhase('running'); };
  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div className="rt-sync-modal" onClick={e => e.stopPropagation()}>
        <div className="rt-sync-head">
          <div>
            <div className="t-micro muted">Sync</div>
            <h2 className="t-h1" style={{ margin: '4px 0 0' }}>Sync from Shopify</h2>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><Icons.Close size={14} /></button>
        </div>
        <div className="rt-sync-body">
          {phase === 'idle' && (
            <>
              <p style={{ color: 'var(--ink-2)', marginTop: 0 }}>We’ll pull your Shopify customer list and add anyone not already in Retainify. <strong>No emails will be sent.</strong></p>
              <label className="rt-toggle" style={{ marginTop: 16 }}>
                <input type="checkbox" checked={includeUnmarketed} onChange={e => setIncludeUnmarketed(e.target.checked)} />
                <span className="rt-toggle-switch" />
                <span>Include customers who haven’t accepted marketing</span>
              </label>
              <div className="rt-sync-meta">
                <div><span className="t-micro muted">Last sync</span><div>3 hours ago</div></div>
                <div><span className="t-micro muted">Customers in Shopify</span><div>1,247</div></div>
                <div><span className="t-micro muted">Already in Retainify</span><div>234</div></div>
              </div>
            </>
          )}
          {phase === 'running' && (
            <>
              <p style={{ color: 'var(--ink-2)', marginTop: 0 }}>Importing <strong>{Math.round(progress).toLocaleString()}</strong> of 1,247 customers…</p>
              <div className="rt-progress"><div className="rt-progress-bar" style={{ width: `${(progress / 1247) * 100}%` }} /></div>
              <p className="t-small muted" style={{ marginTop: 12 }}>You can close this — we’ll keep going in the background.</p>
            </>
          )}
          {phase === 'done' && (
            <>
              <div className="rt-sync-done">
                <div className="rt-sync-check"><Icons.Check size={20} /></div>
                <div>
                  <div className="t-h2">Imported 1,013 new contacts</div>
                  <div className="muted">234 already existed and were updated.</div>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="rt-sync-foot">
          {phase === 'idle' && <><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={start}><Icons.Refresh size={14} /> Start sync</button></>}
          {phase === 'running' && <button className="btn btn-ghost" onClick={onClose}>Run in background</button>}
          {phase === 'done' && <button className="btn btn-primary" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  );
}

// ── Main list ─────────────────────────────────────────────────────────────
function ContactsList({ contacts, showEmpty, onOpenContact }) {
  const {
    TAGS, summarizeContacts, fmtMoney, LIFECYCLE,
  } = window.RetainifyContacts;

  const [statusFilter, setStatusFilter] = useStateContacts('all');
  const [tagFilter, setTagFilter] = useStateContacts('all');
  const [lifecycleFilter, setLifecycleFilter] = useStateContacts('all');
  const [sourceFilter, setSourceFilter] = useStateContacts('all');
  const [query, setQuery] = useStateContacts('');
  const [selected, setSelected] = useStateContacts(new Set());
  const [openMenu, setOpenMenu] = useStateContacts(null);
  const [showUnify, setShowUnify] = useStateContacts(true);
  const [syncOpen, setSyncOpen] = useStateContacts(false);

  if (showEmpty) return <>
    <ContactsEmpty onSync={() => setSyncOpen(true)} />
    <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} />
  </>;

  // Sort: most recently seen first (simple — order is already authored).
  const summary = useMemoContacts(() => summarizeContacts(contacts), [contacts]);
  const tagCounts = useMemoContacts(() => {
    const m = {}; for (const c of contacts) for (const t of (c.tags || [])) m[t] = (m[t] || 0) + 1; return m;
  }, [contacts]);

  // Apply filters.
  const filtered = contacts.filter(c => {
    if (statusFilter !== 'all') {
      if (statusFilter === 'subscribed' && c.subscriptionStatus !== 'subscribed') return false;
      if (statusFilter === 'unsubscribed' && !(c.subscriptionStatus === 'unsubscribed')) return false;
      if (statusFilter === 'bounced' && !(c.subscriptionStatus === 'bounced')) return false;
    }
    if (tagFilter !== 'all' && !(c.tags || []).includes(tagFilter)) return false;
    if (lifecycleFilter !== 'all' && c.lifecycleStage !== lifecycleFilter) return false;
    if (sourceFilter !== 'all' && c.source !== sourceFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      const tagNames = (c.tags || []).map(t => (TAGS.find(x => x.id === t)?.name || '')).join(' ').toLowerCase();
      if (!`${c.email} ${c.name} ${tagNames}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const allChecked = filtered.length > 0 && filtered.every(c => selected.has(c.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allChecked) for (const c of filtered) next.delete(c.id);
    else for (const c of filtered) next.add(c.id);
    setSelected(next);
  };
  const toggle = (id) => {
    const next = new Set(selected); next.has(id) ? next.delete(id) : next.add(id); setSelected(next);
  };

  const filtersActive = statusFilter !== 'all' || tagFilter !== 'all' || lifecycleFilter !== 'all' || sourceFilter !== 'all' || query;

  return (
    <div className="rt-page">
      {/* Header */}
      <header className="rt-page-head">
        <div>
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Retainify · Audience</div>
          <h1 className="t-display-2" style={{ margin: 0 }}>Contacts</h1>
          <p className="t-body muted" style={{ margin: '8px 0 0', maxWidth: 540 }}>
            Everyone who has touched your store — subscribers, buyers, cart abandoners, and push opt-ins, unified into a single profile.
          </p>
        </div>
        <div className="rt-page-actions">
          <div className="rt-sync-pill">
            <Icons.Clock size={12} />
            <span>Last synced 3h ago</span>
          </div>
          <button className="btn btn-secondary" onClick={() => setSyncOpen(true)}><Icons.Refresh size={14} /> Sync from Shopify</button>
          <button className="btn btn-secondary"><Icons.Plus size={14} /> Add contact</button>
          <div className="rt-kebab-wrap">
            <button className="btn btn-secondary btn-icon" onClick={() => setOpenMenu(openMenu === 'pagekb' ? null : 'pagekb')} aria-label="More"><Icons.More size={16} /></button>
            {openMenu === 'pagekb' && (
              <>
                <div className="rt-veil" onClick={() => setOpenMenu(null)} />
                <div className="rt-menu" style={{ right: 0, left: 'auto' }}>
                  <button disabled className="rt-menu-soon"><Icons.ArrowDown size={14} /> Import CSV <SoonPill /></button>
                  <button disabled className="rt-menu-soon"><Icons.ArrowUp size={14} /> Export CSV <SoonPill /></button>
                  <div className="rt-menu-sep" />
                  <button><Icons.Tag size={14} /> Manage tags</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Stats */}
      <section className="rt-stats">
        <StatCard label="Total contacts" value={summary.total.toLocaleString()} sub="Updated just now" />
        <StatCard label="Active subscribers" value={summary.subscribed.toLocaleString()} sub={`${Math.round((summary.subscribed / summary.total) * 100)}% of all contacts`} />
        <StatCard label="New this week" value={summary.newThisWeek.toLocaleString()} sub="↑ 32% vs. prior week" />
        <StatCard label="Unsubscribed" value={summary.unsubscribed.toLocaleString()} sub={`${Math.round((summary.unsubscribed / summary.total) * 100)}% of all contacts`} />
      </section>

      {/* Unify banner */}
      {showUnify && <UnifyBanner onDismiss={() => setShowUnify(false)} onSync={() => setSyncOpen(true)} />}

      {/* Filter bar */}
      <div className="rt-toolbar rt-toolbar-stack">
        <div className="rt-chips rt-chips-wrap">
          <button onClick={() => setStatusFilter('all')} className={`rt-chip ${statusFilter === 'all' ? 'rt-chip-on' : ''}`}>All<span className="rt-chip-count">{contacts.length}</span></button>
          <button onClick={() => setStatusFilter('subscribed')} className={`rt-chip ${statusFilter === 'subscribed' ? 'rt-chip-on' : ''}`}>Subscribed<span className="rt-chip-count">{summary.subscribed}</span></button>
          <button onClick={() => setStatusFilter('unsubscribed')} className={`rt-chip ${statusFilter === 'unsubscribed' ? 'rt-chip-on' : ''}`}>Unsubscribed<span className="rt-chip-count">{contacts.filter(c => c.subscriptionStatus === 'unsubscribed').length}</span></button>
          <button onClick={() => setStatusFilter('bounced')} className={`rt-chip ${statusFilter === 'bounced' ? 'rt-chip-on' : ''}`}>Bounced<span className="rt-chip-count">{contacts.filter(c => c.subscriptionStatus === 'bounced').length}</span></button>
          <span className="rt-chip-sep" />
          <FilterDropdown
            label="Tag"
            icon="Tag"
            value={tagFilter}
            onChange={setTagFilter}
            options={[
              { id: 'all', label: 'Any tag' },
              ...TAGS.map(t => ({ id: t.id, label: t.name, swatch: window.RetainifyContacts.TAG_PALETTE[t.color]?.bg, count: tagCounts[t.id] || 0 })),
            ]}
          />
          <FilterDropdown
            label="Lifecycle"
            icon="Heart"
            value={lifecycleFilter}
            onChange={setLifecycleFilter}
            options={[
              { id: 'all', label: 'Any stage' },
              ...Object.values(LIFECYCLE).map(l => ({ id: l.id, label: l.label, swatch: l.bg })),
            ]}
          />
          <FilterDropdown
            label="Source"
            icon="Refresh"
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[
              { id: 'all', label: 'Any source' },
              ...Object.entries(window.RetainifyContacts.SOURCE).map(([k, v]) => ({ id: k, label: v })),
            ]}
          />
        </div>
        <div className="rt-toolbar-right">
          <div className="rt-search">
            <Icons.Search size={14} />
            <input placeholder="Search by email, name, or tag…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <button className="btn btn-accent btn-sm" disabled={!filtersActive} style={!filtersActive ? { opacity: 0.4, cursor: 'not-allowed' } : null}>
            <Icons.Sliders size={13} /> Save as segment
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rt-ctable">
        <div className="rt-cthead">
          <div className="rt-ctcheck">
            <input type="checkbox" className="rt-checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
          </div>
          <div>Contact</div>
          <div>Status</div>
          <div>Lifecycle</div>
          <div>Tags</div>
          <div className="rt-tnum">Total spent</div>
          <div className="rt-tnum">Last seen</div>
          <div />
        </div>
        {filtered.map(c => {
          const isOn = selected.has(c.id);
          return (
            <div key={c.id} className={`rt-ctrow ${isOn ? 'rt-on' : ''}`} onClick={(e) => {
              if (e.target.closest('.rt-ctcheck') || e.target.closest('.rt-tactions') || e.target.closest('.rt-menu')) return;
              onOpenContact(c.id);
            }}>
              <div className="rt-ctcheck" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="rt-checkbox" checked={isOn} onChange={() => toggle(c.id)} aria-label={`Select ${c.email}`} />
              </div>
              <div className="rt-cname">
                <Avatar name={c.name} email={c.email} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div className="rt-cname-email">{c.email}</div>
                  <div className="rt-cname-name">{c.name || '—'}</div>
                </div>
              </div>
              <div><StatusPill status={c.subscriptionStatus} /></div>
              <div><LifecyclePill stage={c.lifecycleStage} /></div>
              <div className="rt-ctags">
                {(c.tags || []).slice(0, 2).map(t => <TagChip key={t} tagId={t} />)}
                {(c.tags || []).length > 2 && <span className="rt-tag-overflow">+{(c.tags || []).length - 2}</span>}
                {(!c.tags || c.tags.length === 0) && <span className="muted t-small">—</span>}
              </div>
              <div className="rt-tnum rt-tmoney">{c.stats.totalSpent ? fmtMoney(c.stats.totalSpent) : <span className="muted">—</span>}</div>
              <div className="rt-tnum rt-tdate">{c.lastSeenAt}</div>
              <div className="rt-tactions">
                <button className="btn btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === c.id ? null : c.id); }} aria-label="Row actions"><Icons.More size={16} /></button>
                {openMenu === c.id && (
                  <>
                    <div className="rt-veil" onClick={() => setOpenMenu(null)} />
                    <div className="rt-menu">
                      <button onClick={() => { setOpenMenu(null); onOpenContact(c.id); }}><Icons.Eye size={14} /> View profile</button>
                      <button><Icons.Tag size={14} /> Add tag</button>
                      <button><Icons.Sliders size={14} /> Add to segment</button>
                      <div className="rt-menu-sep" />
                      <button><Icons.Close size={14} /> Unsubscribe</button>
                      <button disabled className="rt-menu-soon"><Icons.ArrowUp size={14} /> Export <SoonPill /></button>
                      <button className="rt-menu-danger"><Icons.Trash size={14} /> Delete</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="rt-empty-row">
            No contacts match. Try adjusting your filters. <button className="rt-link" onClick={() => { setStatusFilter('all'); setTagFilter('all'); setLifecycleFilter('all'); setSourceFilter('all'); setQuery(''); }}>Clear filters</button>
          </div>
        )}
      </div>

      {/* Footer row count */}
      <div className="rt-table-foot">
        <span className="muted">Showing <strong style={{ color: 'var(--ink-1)' }}>{filtered.length}</strong> of {contacts.length} contacts</span>
        <span className="muted">·</span>
        <span className="muted">Sorted by last seen, newest first</span>
      </div>

      {/* Floating bulk capsule */}
      {selected.size > 0 && (
        <div className="rt-bulkbar">
          <div className="rt-bulkbar-count">
            <span className="rt-bulkbar-num">{selected.size}</span>
            <span>contact{selected.size === 1 ? '' : 's'} selected</span>
          </div>
          <div className="rt-bulkbar-sep" />
          <button className="rt-bulk-btn"><Icons.Tag size={13} /> Add tag</button>
          <button className="rt-bulk-btn"><Icons.Close size={13} /> Remove tag</button>
          <button className="rt-bulk-btn"><Icons.Sliders size={13} /> Add to segment</button>
          <button className="rt-bulk-btn"><Icons.Mail size={13} /> Unsubscribe</button>
          <button className="rt-bulk-btn rt-bulk-soon" disabled><Icons.ArrowUp size={13} /> Export <SoonPill /></button>
          <button className="rt-bulk-btn rt-bulk-danger"><Icons.Trash size={13} /> Delete</button>
          <div className="rt-bulkbar-sep" />
          <button className="rt-bulk-close" onClick={() => setSelected(new Set())} aria-label="Clear selection"><Icons.Close size={14} /></button>
        </div>
      )}

      <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} />
    </div>
  );
}

Object.assign(window, { ContactsList, Avatar, StatusPill, LifecyclePill, TagChip, SoonPill });
