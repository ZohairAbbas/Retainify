// Retainify — Segment builder
// Two-column layout: rule editor (left) + live preview (right).
// Supports nested AND/OR groups, dynamic + static segments, save flow.

const { useState: useStateB, useMemo: useMemoB, useEffect: useEffectB, useRef: useRefB } = React;

// ── Stable IDs for new rules/groups ──────────────────────────────────────
let __rid = 100;
const nextId = () => `r${++__rid}`;

// ── Walk helpers ─────────────────────────────────────────────────────────
function countRules(node) {
  if (!node) return 0;
  if (node.type === 'rule') return 1;
  return (node.children || []).reduce((s, c) => s + countRules(c), 0);
}
function depth(node, d = 0) {
  if (!node || node.type === 'rule') return d;
  return Math.max(d, ...(node.children || []).map(c => depth(c, d + 1)));
}
function updateAt(node, path, mutator) {
  if (path.length === 0) return mutator(node);
  const [head, ...rest] = path;
  const children = node.children.map((c, i) => i === head ? updateAt(c, rest, mutator) : c);
  return { ...node, children };
}
function removeAt(node, path) {
  if (path.length === 1) {
    return { ...node, children: node.children.filter((_, i) => i !== path[0]) };
  }
  const [head, ...rest] = path;
  return { ...node, children: node.children.map((c, i) => i === head ? removeAt(c, rest) : c) };
}

// ── Field-picker dropdown ────────────────────────────────────────────────
function FieldPicker({ value, onChange, placeholder = 'Pick attribute…' }) {
  const { FIELDS, FIELD_BY_ID } = window.RetainifySegments;
  const [open, setOpen] = useStateB(false);
  const [q, setQ] = useStateB('');
  const ref = useRefB(null);
  useEffectB(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = FIELDS.filter(f => !q || f.label.toLowerCase().includes(q.toLowerCase()) || f.group.toLowerCase().includes(q.toLowerCase()));
  // Group by group
  const groups = {};
  for (const f of filtered) {
    if (!groups[f.group]) groups[f.group] = [];
    groups[f.group].push(f);
  }

  const current = value ? FIELD_BY_ID[value] : null;
  return (
    <div className="rt-sel" ref={ref}>
      <button className={`rt-sel-btn ${!value ? 'rt-empty' : ''}`} onClick={() => setOpen(o => !o)}>
        {current ? current.label : placeholder}
      </button>
      {open && (
        <div className="rt-sel-menu" style={{ minWidth: 260 }}>
          <div style={{ padding: 6 }}>
            <div className="rt-search" style={{ width: '100%' }}>
              <Icons.Search size={12} />
              <input autoFocus placeholder="Search attributes…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
          </div>
          {Object.entries(groups).map(([g, items]) => (
            <div key={g}>
              <div className="rt-sel-group-label">{g}</div>
              {items.map(f => (
                <button key={f.id} className={`rt-sel-item ${value === f.id ? 'rt-on' : ''}`} onClick={() => { onChange(f.id); setOpen(false); setQ(''); }}>
                  {f.label}
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--ink-4)' }}>No attributes match.</div>}
        </div>
      )}
    </div>
  );
}

// ── Operator picker ──────────────────────────────────────────────────────
function OpPicker({ field, value, onChange }) {
  const { OPERATORS, FIELD_BY_ID } = window.RetainifySegments;
  const [open, setOpen] = useStateB(false);
  const ref = useRefB(null);
  useEffectB(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const f = FIELD_BY_ID[field];
  if (!f) return <div className="rt-sel"><button className="rt-sel-btn rt-empty">—</button></div>;
  const opts = OPERATORS[f.type] || [];
  const current = opts.find(o => o.id === value) || opts[0];
  return (
    <div className="rt-sel" ref={ref}>
      <button className="rt-sel-btn" onClick={() => setOpen(o => !o)}>{current?.label || '—'}</button>
      {open && (
        <div className="rt-sel-menu">
          {opts.map(o => (
            <button key={o.id} className={`rt-sel-item ${value === o.id ? 'rt-on' : ''}`} onClick={() => { onChange(o.id); setOpen(false); }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tag/enum picker ──────────────────────────────────────────────────────
function ValueEnumPicker({ options, value, onChange, renderOption }) {
  const [open, setOpen] = useStateB(false);
  const ref = useRefB(null);
  useEffectB(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const current = options.find(o => o.id === value);
  return (
    <div className="rt-sel" ref={ref}>
      <button className={`rt-sel-btn ${!current ? 'rt-empty' : ''}`} onClick={() => setOpen(o => !o)}>
        {current ? (renderOption ? renderOption(current) : current.label) : 'Pick…'}
      </button>
      {open && (
        <div className="rt-sel-menu">
          {options.map(o => (
            <button key={o.id} className={`rt-sel-item ${value === o.id ? 'rt-on' : ''}`} onClick={() => { onChange(o.id); setOpen(false); }}>
              {renderOption ? renderOption(o) : o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Value control (varies by field type + operator) ──────────────────────
function ValueControl({ rule, onChange }) {
  const { FIELD_BY_ID } = window.RetainifySegments;
  const { TAGS, TAG_PALETTE } = window.RetainifyContacts;
  const f = FIELD_BY_ID[rule.field];
  if (!f) return <div />;

  // Date with `in_last` / `more_than` → number + unit
  if (f.type === 'date' && (rule.op === 'in_last' || rule.op === 'more_than')) {
    return (
      <div className="rt-val">
        <input className="input" type="number" min="1" value={rule.value || ''} onChange={e => onChange({ ...rule, value: Number(e.target.value) })} style={{ width: 70 }} />
        <ValueEnumPicker
          value={rule.unit || 'days'}
          onChange={v => onChange({ ...rule, unit: v })}
          options={[{ id: 'days', label: 'days' }, { id: 'weeks', label: 'weeks' }, { id: 'months', label: 'months' }]}
        />
      </div>
    );
  }
  if (f.type === 'date' && (rule.op === 'before' || rule.op === 'after')) {
    return <div className="rt-val"><input className="input" type="date" value={rule.value || '2025-06-01'} onChange={e => onChange({ ...rule, value: e.target.value })} /></div>;
  }
  if (f.type === 'date' && rule.op === 'empty') {
    return <div className="rt-val" style={{ color: 'var(--ink-4)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>no value needed</div>;
  }

  if (f.type === 'money') {
    if (rule.op === 'between') {
      return (
        <div className="rt-val rt-val-between">
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>$</span>
            <input className="input" type="number" value={rule.value || 0} onChange={e => onChange({ ...rule, value: Number(e.target.value) })} style={{ paddingLeft: 22 }} />
          </div>
          <span className="rt-val-suffix">and</span>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>$</span>
            <input className="input" type="number" value={rule.value2 || 0} onChange={e => onChange({ ...rule, value2: Number(e.target.value) })} style={{ paddingLeft: 22 }} />
          </div>
        </div>
      );
    }
    return (
      <div className="rt-val">
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>$</span>
          <input className="input" type="number" value={rule.value || 0} onChange={e => onChange({ ...rule, value: Number(e.target.value) })} style={{ paddingLeft: 22, width: '100%' }} />
        </div>
      </div>
    );
  }

  if (f.type === 'number') {
    if (rule.op === 'between') {
      return (
        <div className="rt-val rt-val-between">
          <input className="input" type="number" value={rule.value || 0} onChange={e => onChange({ ...rule, value: Number(e.target.value) })} />
          <span className="rt-val-suffix">and</span>
          <input className="input" type="number" value={rule.value2 || 0} onChange={e => onChange({ ...rule, value2: Number(e.target.value) })} />
        </div>
      );
    }
    return <div className="rt-val"><input className="input" type="number" value={rule.value || 0} onChange={e => onChange({ ...rule, value: Number(e.target.value) })} /></div>;
  }

  if (f.type === 'percent') {
    return (
      <div className="rt-val">
        <input className="input" type="number" min="0" max="100" value={rule.value || 0} onChange={e => onChange({ ...rule, value: Number(e.target.value) })} style={{ flex: 1 }} />
        <span className="rt-val-suffix">%</span>
      </div>
    );
  }

  if (f.type === 'enum') {
    return (
      <div className="rt-val" style={{ width: '100%' }}>
        <ValueEnumPicker options={f.options} value={rule.value} onChange={v => onChange({ ...rule, value: v })} />
      </div>
    );
  }

  if (f.type === 'boolean') {
    return <div className="rt-val" style={{ color: 'var(--ink-4)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>—</div>;
  }

  if (f.type === 'tag') {
    return (
      <div className="rt-val" style={{ width: '100%' }}>
        <ValueEnumPicker
          options={TAGS.map(t => ({ id: t.id, label: t.name, color: t.color }))}
          value={rule.value}
          onChange={v => onChange({ ...rule, value: v })}
          renderOption={(o) => (
            <>
              <span className="rt-sel-tag-swatch" style={{ background: TAG_PALETTE[o.color]?.ink }} />
              <span>{o.label}</span>
            </>
          )}
        />
      </div>
    );
  }

  return <div className="rt-val"><input className="input" value={rule.value || ''} onChange={e => onChange({ ...rule, value: e.target.value })} /></div>;
}

// ── Single rule row ──────────────────────────────────────────────────────
function RuleRow({ rule, num, onChange, onRemove }) {
  const { defaultOpFor, defaultValueFor } = window.RetainifySegments;
  return (
    <div className="rt-rule">
      <div className="rt-rule-num">{String(num).padStart(2, '0')}</div>
      <FieldPicker value={rule.field} onChange={(field) => onChange({ ...rule, field, op: defaultOpFor(field), value: defaultValueFor(field) })} />
      <OpPicker field={rule.field} value={rule.op} onChange={(op) => onChange({ ...rule, op })} />
      <ValueControl rule={rule} onChange={onChange} />
      <button className="rt-rule-x" onClick={onRemove} aria-label="Remove rule"><Icons.Close size={14} /></button>
    </div>
  );
}

// ── Group (recursive) ────────────────────────────────────────────────────
function RuleGroup({ group, path, onChange, onRemove, isRoot, isAny: parentIsAny }) {
  const isAny = group.match === 'any';
  const items = group.children || [];
  return (
    <div className={`rt-grp ${isRoot ? 'rt-grp-root' : ''}`}>
      <div className={`rt-grp-head ${isAny ? 'rt-any' : ''}`}>
        <span className="rt-grp-label">{isRoot ? 'Match' : 'Sub-group'}</span>
        <div className="rt-grp-toggle">
          <button className={!isAny ? 'rt-on' : ''} onClick={() => onChange({ ...group, match: 'all' })}>All</button>
          <button className={isAny ? 'rt-on' : ''} onClick={() => onChange({ ...group, match: 'any' })}>Any</button>
        </div>
        <span className="rt-grp-of">of the following {isAny ? '(at least one must match)' : '(all must match)'}</span>
        <span className="rt-grp-spacer" />
        {!isRoot && (
          <button className="rt-grp-remove" onClick={onRemove} aria-label="Remove group"><Icons.Trash size={13} /></button>
        )}
      </div>
      <div className="rt-grp-body">
        {items.length === 0 && (
          <div style={{ color: 'var(--ink-4)', fontSize: 12.5, fontStyle: 'italic', padding: '6px 0' }}>
            No rules in this group yet. Add one below.
          </div>
        )}
        {items.map((child, i) => (
          <React.Fragment key={child.id || i}>
            {i > 0 && (
              <div className="rt-grp-conn">
                <span className="rt-grp-conn-word">{isAny ? 'or' : 'and'}</span>
                <span className="rt-grp-conn-line" />
              </div>
            )}
            {child.type === 'rule' ? (
              <RuleRow
                rule={child}
                num={i + 1}
                onChange={(next) => onChange({ ...group, children: items.map((c, ci) => ci === i ? next : c) })}
                onRemove={() => onChange({ ...group, children: items.filter((_, ci) => ci !== i) })}
              />
            ) : (
              <div className={`rt-grp-sub ${child.match === 'any' ? 'rt-any-rail' : ''}`}>
                <RuleGroup
                  group={child}
                  path={[...path, i]}
                  isRoot={false}
                  isAny={isAny}
                  onChange={(next) => onChange({ ...group, children: items.map((c, ci) => ci === i ? next : c) })}
                  onRemove={() => onChange({ ...group, children: items.filter((_, ci) => ci !== i) })}
                />
              </div>
            )}
          </React.Fragment>
        ))}
        <div className="rt-grp-add-row">
          <button
            className="rt-add-btn"
            onClick={() => onChange({ ...group, children: [...items, { id: nextId(), type: 'rule', field: 'totalSpent', op: 'gt', value: 100 }] })}
          >
            <Icons.Plus size={12} /> Add rule
          </button>
          {isRoot && (
            <button
              className="rt-add-btn rt-add-btn-sub"
              onClick={() => onChange({ ...group, children: [...items, { id: nextId(), type: 'group', match: isAny ? 'all' : 'any', children: [{ id: nextId(), type: 'rule', field: 'lastEmailOpenedAt', op: 'in_last', value: 7, unit: 'days' }] }] })}
            >
              <Icons.Split size={12} /> Add sub-group ({isAny ? 'AND' : 'OR'})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Live preview pane ────────────────────────────────────────────────────
function LivePreview({ rules, kind, name, isComputing }) {
  const { PREVIEW_CONTACTS } = window.RetainifySegments;
  // Simulated count: deterministic from rule fingerprint
  const ruleCount = countRules(rules);

  const matchCount = useMemoB(() => {
    if (!rules || ruleCount === 0) return 4230; // everyone
    // Hash for stability
    const str = JSON.stringify(rules);
    let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    // Map h into a sensible range based on depth/count
    const base = 4230;
    const slice = (h % 1500) + 40 + ruleCount * 30;
    return Math.max(8, Math.min(base, base - (h % 3800) + ruleCount * 12));
  }, [rules]);

  // Lifecycle breakdown — synthetic shares of matchCount
  const breakdown = useMemoB(() => {
    const seed = JSON.stringify(rules || {});
    let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const r = (s) => (((h * (s + 7)) >>> 0) % 100);
    const stages = [
      { id: 'active',  label: 'Active',  color: '#1F3D2F', bg: 'var(--brand-100)' },
      { id: 'new',     label: 'New',     color: '#25406A', bg: 'var(--info-bg)' },
      { id: 'at_risk', label: 'At-risk', color: '#6B5018', bg: 'var(--warn-bg)' },
      { id: 'churned', label: 'Churned', color: '#5A3F38', bg: 'var(--status-draft-bg)' },
    ];
    let weights = stages.map((_, i) => 10 + r(i));
    const sum = weights.reduce((a, b) => a + b, 0);
    return stages.map((s, i) => ({ ...s, pct: weights[i] / sum, count: Math.round(matchCount * weights[i] / sum) }));
  }, [rules, matchCount]);

  // Trend sparkline
  const spark = useMemoB(() => {
    const seed = JSON.stringify(rules || {});
    let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const arr = [];
    let v = matchCount * 0.84;
    for (let i = 0; i < 12; i++) {
      const noise = (((h * (i + 1)) >>> 0) % 200) / 1000;
      v *= 1 + 0.012 + noise - 0.08;
      arr.push(Math.max(1, Math.round(v)));
    }
    arr[arr.length - 1] = matchCount;
    return arr;
  }, [matchCount]);

  const tooBroad = ruleCount > 0 && matchCount > 3500;
  const tooNarrow = ruleCount > 0 && matchCount < 20;
  const empty = ruleCount === 0;

  return (
    <>
      {/* Count card */}
      <div className="rt-prev-card">
        <div className="rt-prev-head">
          {isComputing ? <div className="rt-prev-spinner" /> : <Icons.Sparkle size={12} />}
          <span className="t-micro">Live preview</span>
        </div>
        <div className="rt-prev-count">
          <em>{matchCount.toLocaleString()}</em>
          <span className="rt-prev-count-unit">contacts match</span>
        </div>
        {!empty && (
          <div className="rt-prev-trend">
            <Icons.ArrowUp size={11} /> <strong>+{Math.round(matchCount * 0.04).toLocaleString()}</strong> in the last 7 days
          </div>
        )}
        <div className="rt-prev-spark"><Sparkline points={spark} w={320} h={42} color="var(--brand-700)" /></div>

        {/* Warnings */}
        {empty && (
          <div className="rt-prev-warn info" style={{ marginTop: 16 }}>
            <Icons.Help size={14} />
            <div>
              <strong>Add a rule to get started</strong>
              Without rules, this segment will match <strong>everyone</strong> in your contacts.
            </div>
          </div>
        )}
        {tooBroad && !empty && (
          <div className="rt-prev-warn warn" style={{ marginTop: 16 }}>
            <Icons.Help size={14} />
            <div>
              <strong>This segment is very broad</strong>
              Matching <strong>{Math.round((matchCount / 4230) * 100)}%</strong> of contacts may not give you much targeting power. Consider adding more rules.
            </div>
          </div>
        )}
        {tooNarrow && (
          <div className="rt-prev-warn warn" style={{ marginTop: 16 }}>
            <Icons.Help size={14} />
            <div>
              <strong>This segment is very small</strong>
              Only {matchCount} contacts — not enough for meaningful broadcasts. That's fine for a personal note.
            </div>
          </div>
        )}
      </div>

      {/* Lifecycle breakdown */}
      {!empty && (
        <div className="rt-prev-card">
          <div className="rt-prev-section-head" style={{ margin: 0, marginBottom: 12 }}>Lifecycle mix</div>
          <div className="rt-prev-stack">
            {breakdown.map(s => (
              <div key={s.id} className="rt-prev-stack-seg" style={{ width: `${s.pct * 100}%`, background: s.color }} title={`${s.label}: ${s.count}`} />
            ))}
          </div>
          <div className="rt-prev-stack-legend">
            {breakdown.map(s => (
              <div key={s.id} className="rt-prev-stack-leg">
                <span className="rt-prev-stack-leg-dot" style={{ background: s.color }} />
                <span>{s.label}</span>
                <span className="rt-prev-stack-leg-num">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sample contacts */}
      {!empty && matchCount > 0 && (
        <div className="rt-prev-card">
          <div className="rt-prev-section-head" style={{ margin: 0, marginBottom: 12 }}>Sample contacts</div>
          <div className="rt-prev-samples">
            {PREVIEW_CONTACTS.slice(0, 5).map(c => (
              <div key={c.id} className="rt-prev-sample">
                <Avatar name={c.name} email={c.email} size={24} />
                <span className="rt-prev-sample-email">{c.email}</span>
                <span className="rt-prev-sample-meta">${c.spent.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <button className="rt-prev-viewall">See all matching contacts <Icons.Arrow size={11} /></button>
        </div>
      )}
    </>
  );
}

// ── Builder shell ────────────────────────────────────────────────────────
function SegmentBuilder({ initial, onBack, onSave, onSaveAndUseInFlow }) {
  const { TEMPLATES } = window.RetainifySegments;
  const [name, setName] = useStateB(initial?.name || '');
  const [description, setDescription] = useStateB(initial?.description || '');
  const [kind, setKind] = useStateB(initial?.kind || 'dynamic');
  const [rules, setRules] = useStateB(() => initial?.rules || {
    type: 'group', match: 'all',
    children: [{ id: nextId(), type: 'rule', field: 'totalSpent', op: 'gt', value: 100 }],
  });
  const [showSaveModal, setShowSaveModal] = useStateB(false);
  const [isComputing, setIsComputing] = useStateB(false);

  // Simulate compute spinner when rules change
  useEffectB(() => {
    setIsComputing(true);
    const t = setTimeout(() => setIsComputing(false), 320);
    return () => clearTimeout(t);
  }, [JSON.stringify(rules)]);

  const ruleCount = countRules(rules);
  const isEditing = !!initial && initial.id;

  const handleSave = () => {
    if (!name.trim()) {
      // Open modal so the user names it
      setShowSaveModal(true);
      return;
    }
    onSave({ ...(initial || {}), name: name.trim(), description: description.trim(), kind, rules });
  };

  const handleSaveAndFlow = () => {
    if (!name.trim()) { setShowSaveModal(true); return; }
    onSaveAndUseInFlow({ name: name.trim(), description: description.trim(), kind, rules });
  };

  return (
    <>
      <div className="rt-bld">
            <div className="rt-bld-main">
              {/* Top bar */}
              <div className="rt-bld-top">
                <div className="rt-bld-top-left">
                  <button className="rt-bld-back" onClick={onBack} aria-label="Back to segments"><Icons.ArrowBack size={16} /></button>
                  <div>
                    <div className="rt-bld-crumb">
                      <span onClick={onBack} style={{ cursor: 'pointer' }}>Segments</span>
                      <span style={{ margin: '0 8px', color: 'var(--ink-4)' }}>/</span>
                      <span className="rt-bld-crumb-active">{isEditing ? `Edit · ${initial.name}` : 'New segment'}</span>
                    </div>
                  </div>
                </div>
                <div className="rt-bld-top-actions">
                  <button className="btn btn-ghost" onClick={onBack}>Cancel</button>
                  <button className="btn btn-secondary" onClick={handleSaveAndFlow} disabled={ruleCount === 0 && kind !== 'static'}>
                    <Icons.Send size={14} /> Save & use in flow
                  </button>
                  <button className="btn btn-primary" onClick={handleSave} disabled={ruleCount === 0 && kind !== 'static'}>
                    <Icons.Check size={14} /> {isEditing ? 'Save changes' : 'Save segment'}
                  </button>
                </div>
              </div>

              {/* Basics */}
              <div className="rt-bld-card">
                <div className="rt-bld-card-head">
                  <span className="rt-bld-card-num">1</span>
                  <span className="t-micro">The basics</span>
                  <span className="rt-bld-card-rule" />
                </div>
                <div className="rt-bld-basics">
                  <div>
                    <div className="field-label">Segment name</div>
                    <input className="input" placeholder="e.g. VIP buyers in California" value={name} onChange={e => setName(e.target.value)} />
                  </div>
                  <div>
                    <div className="field-label">Short description (optional)</div>
                    <input className="input" placeholder="What's the purpose of this group?" value={description} onChange={e => setDescription(e.target.value)} />
                  </div>
                </div>

                {/* Type */}
                <div style={{ marginTop: 18 }}>
                  <div className="field-label">Segment type</div>
                  <div className="rt-typ-toggle">
                    <button className={`rt-typ-opt ${kind === 'dynamic' ? 'rt-on' : ''}`} onClick={() => setKind('dynamic')}>
                      <span className="rt-typ-radio" />
                      <div>
                        <div className="rt-typ-name">Dynamic <span style={{ fontWeight: 400, color: 'var(--ink-3)', fontSize: 12 }}>· Updates itself</span></div>
                        <div className="rt-typ-desc">Contacts move in and out as their data changes. Use for flows and ongoing campaigns.</div>
                      </div>
                    </button>
                    <button className={`rt-typ-opt ${kind === 'static' ? 'rt-on' : ''}`} onClick={() => setKind('static')}>
                      <span className="rt-typ-radio" />
                      <div>
                        <div className="rt-typ-name">Static <span style={{ fontWeight: 400, color: 'var(--ink-3)', fontSize: 12 }}>· Frozen list</span></div>
                        <div className="rt-typ-desc">A snapshot you build manually or from a one-time match. Useful for one-off lists (e.g. event RSVPs).</div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              {/* Rules (dynamic) or Members (static) */}
              <div className="rt-bld-card">
                <div className="rt-bld-card-head">
                  <span className="rt-bld-card-num">2</span>
                  <span className="t-micro">{kind === 'dynamic' ? 'Rules' : 'Members'}</span>
                  <span className="rt-bld-card-rule" />
                  {kind === 'dynamic' && ruleCount > 0 && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                      {ruleCount} rule{ruleCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                {kind === 'dynamic' ? (
                  <RuleGroup
                    group={rules}
                    path={[]}
                    isRoot
                    onChange={setRules}
                  />
                ) : (
                  <StaticMembers />
                )}
              </div>

              {/* Footer */}
              <div className="rt-bld-foot">
                <div className="rt-bld-foot-meta">
                  {isEditing ? `Editing · last updated ${initial.updated}` : 'Draft — nothing saved yet'}
                </div>
                <div className="rt-bld-foot-actions">
                  <button className="btn btn-ghost" onClick={onBack}>Discard</button>
                  <button className="btn btn-primary" onClick={handleSave} disabled={ruleCount === 0 && kind !== 'static'}>
                    <Icons.Check size={14} /> {isEditing ? 'Save changes' : 'Save segment'}
                  </button>
                </div>
              </div>
            </div>

        {/* Right rail — live preview */}
        <aside className="rt-bld-side">
          <LivePreview rules={kind === 'dynamic' ? rules : null} kind={kind} name={name} isComputing={isComputing} />
        </aside>
      </div>

      {showSaveModal && (
        <SaveSegmentModal
          initialName={name}
          rules={rules}
          ruleCount={ruleCount}
          onClose={() => setShowSaveModal(false)}
          onSave={(payload) => {
            setShowSaveModal(false);
            onSave({ ...(initial || {}), ...payload, kind, rules });
          }}
        />
      )}
    </>
  );
}

// ── Static members manual builder ────────────────────────────────────────
function StaticMembers() {
  const { CONTACTS } = window.RetainifyContacts;
  const [members, setMembers] = useStateB([CONTACTS[0]?.id, CONTACTS[1]?.id, CONTACTS[2]?.id].filter(Boolean));
  const [adding, setAdding] = useStateB('');
  const candidates = CONTACTS.filter(c => !members.includes(c.id) && (!adding || `${c.email} ${c.name || ''}`.toLowerCase().includes(adding.toLowerCase()))).slice(0, 5);

  return (
    <>
      <div className="rt-stm-add">
        <div className="rt-search" style={{ flex: 1, width: 'auto' }}>
          <Icons.Search size={14} />
          <input placeholder="Search to add contacts by email or name…" value={adding} onChange={e => setAdding(e.target.value)} />
        </div>
        <button className="btn btn-secondary"><Icons.ArrowDown size={14} /> Import CSV</button>
      </div>
      {adding && candidates.length > 0 && (
        <div className="rt-sel-menu" style={{ position: 'relative', boxShadow: 'none', borderColor: 'var(--hair-1)', marginTop: 0, marginBottom: 12 }}>
          {candidates.map(c => (
            <button key={c.id} className="rt-sel-item" onClick={() => { setMembers([c.id, ...members]); setAdding(''); }}>
              <Avatar name={c.name} email={c.email} size={20} />
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13 }}>{c.email}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{c.name}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="rt-stm-bulk">
        <Icons.Sparkle size={14} />
        <span><strong>{members.length}</strong> contact{members.length === 1 ? '' : 's'} in this segment. Add more above, or bulk-import from a CSV.</span>
      </div>
      <div className="rt-stm-list">
        {members.map(id => {
          const c = window.RetainifyContacts.CONTACTS.find(x => x.id === id);
          if (!c) return null;
          return (
            <div key={id} className="rt-stm-row">
              <Avatar name={c.name} email={c.email} size={28} />
              <div className="rt-cname-email" style={{ minWidth: 0 }}>
                <div>{c.email}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{c.name}</div>
              </div>
              <button className="rt-rule-x" onClick={() => setMembers(members.filter(m => m !== id))} aria-label="Remove"><Icons.Close size={14} /></button>
            </div>
          );
        })}
        {members.length === 0 && <div className="rt-stm-empty">No members yet. Search above to add contacts.</div>}
      </div>
    </>
  );
}

// ── Save modal (for save-with-name + entered via filter bar) ─────────────
function SaveSegmentModal({ initialName, rules, ruleCount, onClose, onSave }) {
  const [name, setName] = useStateB(initialName || '');
  const [description, setDescription] = useStateB('');
  const [kind, setKind] = useStateB('dynamic');
  const { FIELD_BY_ID, formatRuleValue, opLabel } = window.RetainifySegments;

  // Quick render of rules as a sentence
  const renderRule = (r) => {
    const f = FIELD_BY_ID[r.field]; if (!f) return null;
    return (
      <span key={r.id}>
        <strong>{f.label}</strong> <span style={{ color: 'var(--ink-3)' }}>{opLabel(r)}</span>{' '}
        <span style={{ background: 'var(--brand-50)', color: 'var(--brand-700)', padding: '1px 6px', borderRadius: 'var(--r-pill)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{formatRuleValue(r)}</span>
      </span>
    );
  };

  const sentencePieces = [];
  if (rules && rules.children) {
    rules.children.forEach((c, i) => {
      if (i > 0) sentencePieces.push(<span key={`s${i}`} style={{ color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 11, margin: '0 4px' }}>{rules.match === 'any' ? 'OR' : 'AND'}</span>);
      if (c.type === 'rule') sentencePieces.push(renderRule(c));
      else sentencePieces.push(<span key={c.id}>(nested group · {countRules(c)} rule{countRules(c) === 1 ? '' : 's'})</span>);
    });
  }

  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div className="rt-save-modal" onClick={e => e.stopPropagation()}>
        <div className="rt-save-head">
          <span className="t-micro">Save as segment</span>
          <h2 className="t-h1">Give this segment a name</h2>
        </div>
        <div className="rt-save-body">
          <div>
            <div className="field-label">Name</div>
            <input autoFocus className="input" placeholder="e.g. Engaged subscribers" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <div className="field-label">Description (optional)</div>
            <input className="input" placeholder="So you remember what it's for" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="rt-save-preview">
            <div className="rt-save-preview-head">
              <Icons.Sliders size={11} />
              <span>Rules · <strong>{ruleCount}</strong></span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink-1)' }}>
              {sentencePieces.length > 0 ? sentencePieces : <span style={{ color: 'var(--ink-4)' }}>No rules yet.</span>}
            </div>
          </div>
          <label className="rt-toggle">
            <input type="checkbox" checked={kind === 'dynamic'} onChange={e => setKind(e.target.checked ? 'dynamic' : 'static')} />
            <span className="rt-toggle-switch" />
            <span>Keep this segment up to date automatically <span style={{ color: 'var(--ink-3)' }}>(recommended)</span></span>
          </label>
        </div>
        <div className="rt-save-foot">
          <div className="rt-save-foot-left">You can edit rules anytime from the segment detail.</div>
          <div className="rt-save-foot-right">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), description: description.trim() })}>
              <Icons.Check size={14} /> Save segment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SegmentBuilder, SaveSegmentModal });
