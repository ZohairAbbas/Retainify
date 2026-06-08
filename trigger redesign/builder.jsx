// Retainify — Visual Builder
// Top bar + canvas (with branching) + right inspector. Single editor; view toggle for canvas/form.

const { useState: useStateB, useMemo } = React;

// ── Node card ─────────────────────────────────────────────────────────────
function NodeCard({ node, selected, showPreview, showAnalytics, onSelect, onDelete, onDuplicate }) {
  const { TRIGGERS } = window.RetainifyData;
  if (node.type === 'trigger') {
    const trig = TRIGGERS[node.trigger];
    const Glyph = Icons[trig.glyph];
    return (
      <div className={`rt-node rt-node-trigger ${selected ? 'rt-selected' : ''}`} onClick={() => onSelect(node.id)}>
        <div className="rt-node-head">
          <div className="rt-node-glyph rt-tint-trigger"><Glyph size={14} /></div>
          <div className="rt-node-title">Trigger</div>
          <span className="rt-node-tag">Entry</span>
        </div>
        <div className="rt-node-body">
          <div className="rt-node-line"><span className="muted">When:</span> {trig.label}</div>
        </div>
      </div>
    );
  }
  if (node.type === 'email') {
    return (
      <div className={`rt-node rt-node-email ${selected ? 'rt-selected' : ''}`} onClick={() => onSelect(node.id)}>
        <div className="rt-node-head">
          <div className="rt-node-glyph rt-tint-email"><Icons.Mail size={14} /></div>
          <div className="rt-node-title">{node.name}</div>
          <div className="rt-node-actions">
            <button onClick={(e) => { e.stopPropagation(); onDuplicate(node.id); }}><Icons.Copy size={13} /></button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}><Icons.Trash size={13} /></button>
          </div>
        </div>
        <div className="rt-node-body">
          <div className="rt-node-line"><span className="muted">Subject:</span> {node.subject || <em className="faint">No subject</em>}</div>
          {node.discount > 0 && <span className="rt-discount">{node.discount}% discount</span>}
          {showPreview && (
            <div className="rt-node-preview">
              <EmailPreview node={node} />
            </div>
          )}
          {showAnalytics && (
            <div className="rt-node-stats">
              <div><div className="t-micro muted">Delivered</div><div className="t-mono rt-stat-num">428</div></div>
              <div><div className="t-micro muted">Opens</div><div className="t-mono rt-stat-num">39.4%</div></div>
              <div><div className="t-micro muted">Clicks</div><div className="t-mono rt-stat-num">7.8%</div></div>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (node.type === 'delay') {
    return (
      <div className={`rt-node rt-node-delay ${selected ? 'rt-selected' : ''}`} onClick={() => onSelect(node.id)}>
        <div className="rt-node-head">
          <div className="rt-node-glyph rt-tint-delay"><Icons.Clock size={14} /></div>
          <div className="rt-node-title">Wait {node.hours} {node.unit}</div>
          <div className="rt-node-actions">
            <button onClick={(e) => { e.stopPropagation(); onDuplicate(node.id); }}><Icons.Copy size={13} /></button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}><Icons.Trash size={13} /></button>
          </div>
        </div>
      </div>
    );
  }
  if (node.type === 'split') {
    return (
      <div className={`rt-node rt-node-split ${selected ? 'rt-selected' : ''}`} onClick={() => onSelect(node.id)}>
        <div className="rt-node-head">
          <div className="rt-node-glyph rt-tint-split"><Icons.Split size={14} /></div>
          <div className="rt-node-title">Split — {node.label || 'Branch'}</div>
          <span className="pill soon" style={{ height: 18, fontSize: 9, padding: '0 6px' }}>Soon</span>
        </div>
        <div className="rt-node-body">
          <div className="rt-node-line muted"><span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{node.condition || 'opened previous email'}</span></div>
        </div>
      </div>
    );
  }
  if (node.type === 'sms') {
    return (
      <div className={`rt-node rt-node-sms ${selected ? 'rt-selected' : ''}`} onClick={() => onSelect(node.id)}>
        <div className="rt-node-head">
          <div className="rt-node-glyph rt-tint-sms"><Icons.Sms size={14} /></div>
          <div className="rt-node-title">{node.name}</div>
          <span className="pill soon" style={{ height: 18, fontSize: 9, padding: '0 6px' }}>Soon</span>
        </div>
        <div className="rt-node-body">
          <div className="rt-node-line muted">{node.body}</div>
        </div>
      </div>
    );
  }
  if (node.type === 'exit') {
    return (
      <div className={`rt-node rt-node-exit ${selected ? 'rt-selected' : ''}`} onClick={() => onSelect(node.id)}>
        <div className="rt-node-head">
          <div className="rt-node-glyph rt-tint-exit"><Icons.Exit size={14} /></div>
          <div className="rt-node-title">Exit flow</div>
        </div>
        <div className="rt-node-body">
          <div className="rt-node-line muted">The contact exits the flow here.</div>
        </div>
      </div>
    );
  }
  return null;
}

// ── Email preview (placeholder iframe content) ────────────────────────────
// If the email node has been edited in the visual editor, render its blocks;
// otherwise fall back to a static placeholder.
function EmailPreview({ node }) {
  if (node.blocks && node.blocks.length) {
    return <RenderedBlockPreview node={node} />;
  }
  return (
    <div className="rt-email-preview">
      <div className="rt-email-logo">NORTHHILL</div>
      <div className="rt-email-hero" />
      <div className="rt-email-h">{node.subject || 'Hello there'}</div>
      <div className="rt-email-body">Hi Alex, thanks for joining us. We hand-pick a few favourites each week — here's something we think you'll love.</div>
      {node.discount > 0 && <div className="rt-email-cta">Use code <strong>WELCOME{node.discount}</strong> for {node.discount}% off</div>}
      <div className="rt-email-btn">Shop now</div>
    </div>
  );
}

// Renders the email node's blocks as a tiny preview inside the flow canvas card.
function RenderedBlockPreview({ node }) {
  const brand = node.brand || window.DEFAULT_BRAND;
  const stripTags = (html) => (html || '').replace(/<[^>]+>/g, '');
  return (
    <div className="rt-email-preview-rendered">
      {node.blocks.slice(0, 6).map(b => {
        if (b.type === 'logo') return <div key={b.id} className="rt-emp-block rt-emp-logo" style={{ textAlign: b.align }}>{b.text}</div>;
        if (b.type === 'heading') return <div key={b.id} className="rt-emp-block rt-emp-heading" style={{ textAlign: b.align }}>{stripTags(b.html)}</div>;
        if (b.type === 'paragraph') return <div key={b.id} className="rt-emp-block rt-emp-paragraph" style={{ textAlign: b.align }}>{stripTags(b.html).slice(0, 120)}{stripTags(b.html).length > 120 ? '…' : ''}</div>;
        if (b.type === 'button') return <div key={b.id} className="rt-emp-block" style={{ textAlign: b.align }}><span className="rt-emp-button" style={{ background: b.fill === 'filled' ? brand.accent : 'transparent', color: b.fill === 'filled' ? '#fff' : brand.accent, border: '1px solid ' + brand.accent }}>{b.text}</span></div>;
        if (b.type === 'image') return <div key={b.id} className="rt-emp-block rt-emp-image" />;
        if (b.type === 'discount') return <div key={b.id} className="rt-emp-block rt-emp-discount" style={{ borderColor: brand.accent, color: brand.accent }}>{b.label} · <span className="rt-emp-discount-code">{b.code}</span></div>;
        if (b.type === 'divider') return <div key={b.id} className="rt-emp-block rt-emp-divider" />;
        if (b.type === 'spacer') return <div key={b.id} style={{ height: Math.min(b.height / 3, 16) }} />;
        if (b.type === 'footer') return <div key={b.id} className="rt-emp-block rt-emp-footer">{b.storeName} · {b.address}</div>;
        if (b.type === 'product') return <div key={b.id} className="rt-emp-block rt-emp-image" style={{ height: 24 }} />;
        return null;
      })}
    </div>
  );
}

// ── Insert button menu ────────────────────────────────────────────────────
function InsertMenu({ open, onClose, onAdd }) {
  if (!open) return null;
  const item = (icon, label, type, soon = false) => {
    const Icon = Icons[icon];
    return (
      <button className={`rt-insert-item ${soon ? 'rt-insert-locked' : ''}`}
              onClick={() => { if (!soon) { onAdd(type); onClose(); } }}>
        <Icon size={14} />
        <span>{label}</span>
        {soon && <span className="pill soon" style={{ marginLeft: 'auto', height: 16, fontSize: 9, padding: '0 5px' }}>Soon</span>}
      </button>
    );
  };
  return (
    <>
      <div className="rt-insert-veil" onClick={onClose} />
      <div className="rt-insert-menu">
        <div className="t-micro muted rt-insert-heading">Send</div>
        {item('Mail', 'Email', 'email')}
        {item('Sms', 'SMS message', 'sms', true)}
        <div className="t-micro muted rt-insert-heading">Timing</div>
        {item('Clock', 'Wait (delay)', 'delay')}
        <div className="t-micro muted rt-insert-heading">Logic</div>
        {item('Split', 'Split branch', 'split', true)}
        {item('Tag', 'Tag contact', 'tag', true)}
      </div>
    </>
  );
}

// ── Connector + Insert button ─────────────────────────────────────────────
function Connector({ onInsert, openMenuId, setOpenMenuId, id }) {
  const open = openMenuId === id;
  return (
    <div className="rt-connector">
      <div className="rt-connector-line" />
      <button className="rt-insert-btn" onClick={() => setOpenMenuId(open ? null : id)}>
        <Icons.Plus size={14} />
      </button>
      <InsertMenu open={open} onClose={() => setOpenMenuId(null)} onAdd={(t) => onInsert(t)} />
    </div>
  );
}

// ── Canvas column (recursive for branches) ────────────────────────────────
function NodeColumn({ nodes, selectedId, onSelect, onInsert, onDelete, onDuplicate, showPreview, showAnalytics, openMenuId, setOpenMenuId, pathPrefix = '' }) {
  return (
    <div className="rt-canvas-col">
      {nodes.map((n, i) => (
        <React.Fragment key={n.id}>
          <NodeCard
            node={n}
            selected={selectedId === n.id}
            showPreview={showPreview}
            showAnalytics={showAnalytics}
            onSelect={onSelect}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
          />
          {n.type === 'split' && n.branches && (
            <div className="rt-branches">
              {n.branches.map((branch, bi) => (
                <div key={bi} className="rt-branch">
                  <div className="rt-branch-label">
                    <span className="t-micro" style={{ color: 'var(--node-split-ink)' }}>
                      {bi === 0 ? 'IF YES' : 'IF NO'}
                    </span>
                  </div>
                  <NodeColumn
                    nodes={branch}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onInsert={(t) => onInsert(t, `${pathPrefix}${n.id}/${bi}`)}
                    onDelete={onDelete}
                    onDuplicate={onDuplicate}
                    showPreview={showPreview}
                    showAnalytics={showAnalytics}
                    openMenuId={openMenuId}
                    setOpenMenuId={setOpenMenuId}
                    pathPrefix={`${pathPrefix}${n.id}/${bi}/`}
                  />
                </div>
              ))}
            </div>
          )}
          {i < nodes.length - 1 && (
            <Connector
              id={`${pathPrefix}${n.id}`}
              openMenuId={openMenuId}
              setOpenMenuId={setOpenMenuId}
              onInsert={(t) => onInsert(t, `${pathPrefix}${n.id}`)}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Inspector ─────────────────────────────────────────────────────────────
function Inspector({ flow, node, onChange }) {
  const { TRIGGERS } = window.RetainifyData;

  if (!node) {
    return (
      <div className="rt-ins">
        <div className="rt-ins-empty">
          <Icons.Sliders size={20} />
          <div className="t-h3" style={{ margin: '12px 0 6px' }}>Click a step to edit it</div>
          <div className="t-small muted">Or use the <strong>+</strong> on any connector to add one.</div>
        </div>
        <div className="rt-ins-section">
          <div className="t-micro muted">Flow details</div>
          <div style={{ marginTop: 12 }}>
            <label className="field-label">Internal name</label>
            <input className="input" value={flow.name} onChange={e => onChange({ flowName: e.target.value })} />
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="field-label">Description</label>
            <textarea className="textarea" placeholder="What does this flow do?" defaultValue="Welcomes new subscribers with three emails over five days." />
          </div>
        </div>
      </div>
    );
  }

  if (node.type === 'trigger') {
    const trig = TRIGGERS[node.trigger];
    const Glyph = Icons[trig.glyph];
    return (
      <div className="rt-ins">
        <div className="rt-ins-head">
          <div className={`rt-node-glyph rt-tint-trigger`}><Glyph size={14} /></div>
          <div>
            <div className="t-micro muted">Trigger</div>
            <div className="t-h2" style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>
              {trig.label}{trig.requiresSegment && node.segmentId ? ` · ${(window.RetainifySegments?.USER_SEGMENTS || []).find(s => s.id === node.segmentId)?.name || ''}` : ''}
            </div>
          </div>
        </div>
        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 4 }}>When this happens</div>
          <div className="t-small muted" style={{ margin: '0 0 4px' }}>Pick what kicks off the flow.</div>
          <TriggerPicker
            value={node.trigger}
            segmentId={node.segmentId}
            onChange={(triggerId, segmentId) => onChange({ nodePatch: { trigger: triggerId, segmentId } })}
          />
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted">Flow filters</div>
          <div className="t-small muted" style={{ margin: '6px 0 12px' }}>Only enter when these conditions are met.</div>
          <button className="rt-add-filter">
            <Icons.Plus size={13} /> Add filter
          </button>
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted">Entry frequency</div>
          <div className="t-small muted" style={{ margin: '6px 0 14px' }}>Control when contacts can re-enter this flow.</div>
          <div className="rt-radios">
            <RadioOption checked={node.frequency !== 'immediate' && node.frequency !== 'delayed'} onClick={() => onChange({ nodePatch: { frequency: 'none' }})}
              label="No re-entry" sub="Once enrolled, never again." />
            <RadioOption checked={node.frequency === 'delayed'} onClick={() => onChange({ nodePatch: { frequency: 'delayed' }})}
              label="Delayed re-entry" sub="Re-enter only after a waiting period." />
            <RadioOption checked={node.frequency === 'immediate'} onClick={() => onChange({ nodePatch: { frequency: 'immediate' }})}
              label="Immediate re-entry" sub="Re-enter at any time." />
          </div>
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted">Exit criteria</div>
          <div className="t-small muted" style={{ margin: '6px 0 12px' }}>Remove a contact from the flow if any happens.</div>
          <div className="rt-checks">
            <CheckOption label="Places an order" defaultChecked />
            <CheckOption label="Recovers cart" defaultChecked />
            <CheckOption label="Unsubscribes" defaultChecked />
            <CheckOption label="Custom segment leaves" soon />
          </div>
        </div>
      </div>
    );
  }

  if (node.type === 'email') {
    return (
      <div className="rt-ins">
        <div className="rt-ins-head">
          <div className="rt-node-glyph rt-tint-email"><Icons.Mail size={14} /></div>
          <div>
            <div className="t-micro muted">Email step</div>
            <div className="t-h2" style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>{node.name}</div>
          </div>
        </div>
        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Content</div>
          <label className="field-label">Internal name</label>
          <input className="input" value={node.name} onChange={e => onChange({ nodePatch: { name: e.target.value }})} />
          <div className="field-help">Not shown to contacts.</div>

          <label className="field-label" style={{ marginTop: 16 }}>Subject</label>
          <input className="input" value={node.subject} onChange={e => onChange({ nodePatch: { subject: e.target.value }})} />
          <div className="field-help">{50 - (node.subject || '').length} characters remaining</div>

          <label className="field-label" style={{ marginTop: 16 }}>Preview text</label>
          <input className="input" value={node.preview || ''} placeholder="A short preview shown in the inbox" onChange={e => onChange({ nodePatch: { preview: e.target.value }})} />
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Design</div>
          <label className="field-label">Template style</label>
          <div className="rt-segmented">
            {['Classic', 'Bold', 'Minimal'].map(s => (
              <button key={s} className={node.style === s ? 'rt-seg-on' : ''}
                      onClick={() => onChange({ nodePatch: { style: s }})}>
                {s}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 12, width: '100%' }}
                  onClick={() => onChange({ openEditor: true })}>
            <Icons.Tab size={14} /> Open visual editor
          </button>
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Offer</div>
          <label className="field-label">Discount %</label>
          <div className="rt-discount-input">
            <input className="input" type="number" min="0" max="50" value={node.discount}
                   onChange={e => onChange({ nodePatch: { discount: +e.target.value }})} />
            <span className="t-small muted">0 = no discount code attached</span>
          </div>
        </div>

        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Send</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="field-label">Send after</label>
              <input className="input" type="number" value={node.after}
                     onChange={e => onChange({ nodePatch: { after: +e.target.value }})} />
            </div>
            <div style={{ width: 110 }}>
              <label className="field-label">Unit</label>
              <select className="select" value={node.afterUnit}
                      onChange={e => onChange({ nodePatch: { afterUnit: e.target.value }})}>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
            </div>
          </div>
          <label className="rt-toggle" style={{ marginTop: 16 }}>
            <input type="checkbox" defaultChecked={node.enabled !== false} />
            <span className="rt-toggle-switch" />
            <span>Step enabled</span>
          </label>
        </div>
      </div>
    );
  }

  if (node.type === 'delay') {
    return (
      <div className="rt-ins">
        <div className="rt-ins-head">
          <div className="rt-node-glyph rt-tint-delay"><Icons.Clock size={14} /></div>
          <div>
            <div className="t-micro muted">Delay step</div>
            <div className="t-h2" style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>Wait</div>
          </div>
        </div>
        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 12 }}>Duration</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <input className="input" type="number" value={node.hours} onChange={e => onChange({ nodePatch: { hours: +e.target.value }})} style={{ flex: 1 }} />
            <select className="select" value={node.unit} onChange={e => onChange({ nodePatch: { unit: e.target.value }})} style={{ width: 110 }}>
              <option>hours</option>
              <option>days</option>
            </select>
          </div>
        </div>
        <div className="rt-ins-section">
          <div className="t-micro muted" style={{ marginBottom: 8 }}>Smart send window</div>
          <div className="t-small muted" style={{ marginBottom: 10 }}>Hold the send until the contact's best engagement window.</div>
          <label className="rt-toggle">
            <input type="checkbox" defaultChecked />
            <span className="rt-toggle-switch" />
            <span>Respect quiet hours (9pm–8am, contact tz)</span>
          </label>
        </div>
      </div>
    );
  }

  if (node.type === 'split' || node.type === 'sms' || node.type === 'tag') {
    const label = node.type === 'split' ? 'Split branch' : node.type === 'sms' ? 'SMS message' : 'Tag contact';
    return (
      <div className="rt-ins">
        <div className="rt-ins-head">
          <div className={`rt-node-glyph rt-tint-${node.type}`}>
            {node.type === 'split' ? <Icons.Split size={14} /> : node.type === 'sms' ? <Icons.Sms size={14} /> : <Icons.Tag size={14} />}
          </div>
          <div>
            <div className="t-micro muted">{label}</div>
            <div className="t-h2" style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>Coming soon</div>
          </div>
        </div>
        <div className="rt-ins-section">
          <div className="rt-soon-card">
            <Icons.Lock size={16} />
            <div>
              <div className="t-h3">In the lab</div>
              <p className="t-small muted" style={{ margin: '6px 0 0' }}>
                {label} is in private beta. You can design it into your flow now — it will activate when we roll it out.
              </p>
              <button className="btn btn-accent btn-sm" style={{ marginTop: 12 }}>Join the waitlist</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (node.type === 'exit') {
    return (
      <div className="rt-ins">
        <div className="rt-ins-head">
          <div className="rt-node-glyph rt-tint-exit"><Icons.Exit size={14} /></div>
          <div>
            <div className="t-micro muted">Exit</div>
            <div className="t-h2" style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>End of flow</div>
          </div>
        </div>
        <div className="rt-ins-section">
          <p className="t-small muted">The contact leaves the flow here. This step is automatic and cannot be removed.</p>
        </div>
      </div>
    );
  }

  return null;
}

function RadioOption({ checked, onClick, label, sub }) {
  return (
    <button className={`rt-radio ${checked ? 'rt-on' : ''}`} onClick={onClick}>
      <span className="rt-radio-dot"><span /></span>
      <span>
        <span className="rt-radio-label">{label}</span>
        <span className="rt-radio-sub">{sub}</span>
      </span>
    </button>
  );
}

function CheckOption({ label, defaultChecked, soon }) {
  return (
    <label className={`rt-check ${soon ? 'rt-locked' : ''}`}>
      <input type="checkbox" defaultChecked={defaultChecked} disabled={soon} />
      <span className="rt-check-box"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5 11-11"/></svg></span>
      <span>{label}</span>
      {soon && <span className="pill soon" style={{ marginLeft: 'auto', height: 18, fontSize: 9, padding: '0 6px' }}>Soon</span>}
    </label>
  );
}

// ── Form view (alternative to canvas) ─────────────────────────────────────
function FormView({ flow, onChange, onSelect, selectedId }) {
  const { TRIGGERS } = window.RetainifyData;
  const trig = TRIGGERS[flow.nodes[0].trigger];
  const Glyph = Icons[trig.glyph];
  return (
    <div className="rt-form-view">
      <section className="rt-form-section">
        <div className="rt-form-section-head">
          <div className={`rt-node-glyph rt-tint-trigger`}><Glyph size={14} /></div>
          <div>
            <div className="t-micro muted">Step 0 · Trigger</div>
            <div className="t-h2">{trig.label}</div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => onSelect(flow.nodes[0].id)}>Edit →</button>
        </div>
        <p className="t-small muted" style={{ margin: '12px 0 0' }}>{trig.desc}</p>
      </section>

      {flow.nodes.filter(n => n.type !== 'trigger' && n.type !== 'exit').map((n, i) => (
        <section key={n.id} className={`rt-form-section ${selectedId === n.id ? 'rt-form-selected' : ''}`}>
          <div className="rt-form-section-head">
            <div className={`rt-node-glyph rt-tint-${n.type}`}>
              {n.type === 'email' && <Icons.Mail size={14} />}
              {n.type === 'delay' && <Icons.Clock size={14} />}
              {n.type === 'split' && <Icons.Split size={14} />}
              {n.type === 'sms' && <Icons.Sms size={14} />}
            </div>
            <div>
              <div className="t-micro muted">Step {i + 1} · {n.type === 'email' ? 'Email' : n.type === 'delay' ? 'Delay' : n.type === 'split' ? 'Split' : 'SMS'}</div>
              <div className="t-h2">{n.type === 'email' ? n.name : n.type === 'delay' ? `Wait ${n.hours} ${n.unit}` : 'Coming soon'}</div>
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => onSelect(n.id)}>Edit →</button>
          </div>
          {n.type === 'email' && (
            <div className="rt-form-grid">
              <div>
                <label className="field-label">Subject</label>
                <input className="input" value={n.subject} onChange={e => onChange({ nodeId: n.id, patch: { subject: e.target.value }})} />
              </div>
              <div>
                <label className="field-label">Send after ({n.afterUnit})</label>
                <input className="input" type="number" value={n.after} onChange={e => onChange({ nodeId: n.id, patch: { after: +e.target.value }})} />
              </div>
              <div>
                <label className="field-label">Discount %</label>
                <input className="input" type="number" value={n.discount} onChange={e => onChange({ nodeId: n.id, patch: { discount: +e.target.value }})} />
              </div>
              <div>
                <label className="field-label">Template</label>
                <select className="select" value={n.style} onChange={e => onChange({ nodeId: n.id, patch: { style: e.target.value }})}>
                  <option>Classic</option><option>Bold</option><option>Minimal</option>
                </select>
              </div>
            </div>
          )}
          {n.type === 'delay' && (
            <div className="rt-form-grid">
              <div>
                <label className="field-label">Duration</label>
                <input className="input" type="number" value={n.hours} onChange={e => onChange({ nodeId: n.id, patch: { hours: +e.target.value }})} />
              </div>
              <div>
                <label className="field-label">Unit</label>
                <select className="select" value={n.unit} onChange={e => onChange({ nodeId: n.id, patch: { unit: e.target.value }})}>
                  <option>hours</option><option>days</option>
                </select>
              </div>
            </div>
          )}
        </section>
      ))}

      <section className="rt-form-section rt-form-exit">
        <div className="rt-form-section-head">
          <div className="rt-node-glyph rt-tint-exit"><Icons.Exit size={14} /></div>
          <div>
            <div className="t-micro muted">End · Exit</div>
            <div className="t-h2">Contacts leave the flow</div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Builder main ──────────────────────────────────────────────────────────
function Builder({ flow, onBack, onUpdate, onOpenEmailEditor }) {
  const [selectedId, setSelectedId] = useStateB(flow.nodes[0].id);
  const [viewMode, setViewMode] = useStateB('canvas'); // 'canvas' | 'form'
  const [showPreview, setShowPreview] = useStateB(true);
  const [showAnalytics, setShowAnalytics] = useStateB(flow.status === 'active');
  const [openMenuId, setOpenMenuId] = useStateB(null);

  const node = useMemo(() => {
    function find(arr) {
      for (const n of arr) {
        if (n.id === selectedId) return n;
        if (n.branches) for (const b of n.branches) { const r = find(b); if (r) return r; }
      }
    }
    return find(flow.nodes);
  }, [selectedId, flow]);

  const handleInspectorChange = ({ flowName, nodePatch, openEditor }) => {
    if (openEditor && node && node.type === 'email') {
      onOpenEmailEditor && onOpenEmailEditor(node.id);
      return;
    }
    if (flowName) onUpdate({ ...flow, name: flowName });
    if (nodePatch && node) {
      const updateNodes = (arr) => arr.map(n => {
        if (n.id === node.id) return { ...n, ...nodePatch };
        if (n.branches) return { ...n, branches: n.branches.map(b => updateNodes(b)) };
        return n;
      });
      onUpdate({ ...flow, nodes: updateNodes(flow.nodes) });
    }
  };

  const handleFormChange = ({ nodeId, patch }) => {
    const updateNodes = (arr) => arr.map(n => {
      if (n.id === nodeId) return { ...n, ...patch };
      if (n.branches) return { ...n, branches: n.branches.map(b => updateNodes(b)) };
      return n;
    });
    onUpdate({ ...flow, nodes: updateNodes(flow.nodes) });
  };

  const handleDelete = (id) => {
    const filterNodes = (arr) => arr.filter(n => n.id !== id).map(n => n.branches ? { ...n, branches: n.branches.map(b => filterNodes(b)) } : n);
    onUpdate({ ...flow, nodes: filterNodes(flow.nodes) });
    setSelectedId(flow.nodes[0].id);
  };
  const handleDuplicate = (id) => {
    const newId = `n_${Math.random().toString(36).slice(2, 7)}`;
    const dupe = (arr) => {
      const out = [];
      for (const n of arr) {
        out.push(n.branches ? { ...n, branches: n.branches.map(b => dupe(b)) } : n);
        if (n.id === id) out.push({ ...n, id: newId });
      }
      return out;
    };
    onUpdate({ ...flow, nodes: dupe(flow.nodes) });
  };
  const handleInsert = (type, afterId) => {
    const newId = `n_${Math.random().toString(36).slice(2, 7)}`;
    let newNode;
    if (type === 'email') newNode = { id: newId, type: 'email', name: 'New email', subject: '', after: 24, afterUnit: 'hours', discount: 0, style: 'Classic', enabled: true };
    else if (type === 'delay') newNode = { id: newId, type: 'delay', hours: 24, unit: 'hours' };
    else if (type === 'sms') newNode = { id: newId, type: 'sms', name: 'New SMS', body: 'Hey {first_name}, ...' };
    else if (type === 'split') newNode = { id: newId, type: 'split', condition: 'opened previous email', branches: [[{ id: 'b1_'+newId, type: 'email', name: 'Yes path', subject: 'Great to see you!', after: 24, afterUnit: 'hours', discount: 0, style: 'Classic', enabled: true }], [{ id: 'b2_'+newId, type: 'delay', hours: 48, unit: 'hours' }]] };

    const insert = (arr) => {
      const out = [];
      for (const n of arr) {
        out.push(n.branches ? { ...n, branches: n.branches.map(b => insert(b)) } : n);
        if (n.id === afterId) out.push(newNode);
      }
      return out;
    };
    onUpdate({ ...flow, nodes: insert(flow.nodes) });
    setSelectedId(newId);
  };

  // ── Top bar ──
  const topBar = (
    <>
      <div className="rt-bt-left">
        <button className="btn btn-ghost btn-icon" onClick={onBack} aria-label="Back">
          <Icons.ArrowBack size={16} />
        </button>
        <div className="rt-bt-flowmeta">
          <input className="rt-bt-name" value={flow.name} onChange={e => onUpdate({ ...flow, name: e.target.value })} />
          <span className={`pill ${flow.status}`}>{flow.status}</span>
        </div>
      </div>
      <div className="rt-bt-center">
        <div className="rt-view-toggle">
          <button className={viewMode === 'canvas' ? 'rt-vt-on' : ''} onClick={() => setViewMode('canvas')}>
            <Icons.Flow size={13} /> Canvas
          </button>
          <button className={viewMode === 'form' ? 'rt-vt-on' : ''} onClick={() => setViewMode('form')}>
            <Icons.List size={13} /> Form
          </button>
        </div>
      </div>
      <div className="rt-bt-right">
        {viewMode === 'canvas' && (
          <>
            <button className={`btn btn-ghost ${showPreview ? 'rt-toggle-on' : ''}`} onClick={() => setShowPreview(!showPreview)}>
              {showPreview ? <Icons.Eye size={14} /> : <Icons.EyeOff size={14} />} Preview
            </button>
            <button className={`btn btn-ghost ${showAnalytics ? 'rt-toggle-on' : ''}`} onClick={() => setShowAnalytics(!showAnalytics)}>
              <Icons.Chart size={14} /> Analytics
            </button>
            <span className="rt-bt-divider" />
          </>
        )}
        <button className="btn btn-secondary">Save draft</button>
        {flow.status === 'active' ? (
          <button className="btn btn-secondary" onClick={() => onUpdate({ ...flow, status: 'paused' })}>
            <Icons.Pause size={13} /> Pause
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => onUpdate({ ...flow, status: 'active' })}>
            <Icons.Play size={13} /> Publish
          </button>
        )}
      </div>
    </>
  );

  return (
    <BuilderShell topBar={topBar} rightPanel={<Inspector flow={flow} node={node} onChange={handleInspectorChange} />}>
      {viewMode === 'canvas' ? (
        <div className="rt-canvas-pad">
          <NodeColumn
            nodes={flow.nodes}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onInsert={handleInsert}
            onDelete={handleDelete}
            onDuplicate={handleDuplicate}
            showPreview={showPreview}
            showAnalytics={showAnalytics}
            openMenuId={openMenuId}
            setOpenMenuId={setOpenMenuId}
          />
        </div>
      ) : (
        <FormView flow={flow} onChange={handleFormChange} onSelect={setSelectedId} selectedId={selectedId} />
      )}
    </BuilderShell>
  );
}

Object.assign(window, { Builder });
