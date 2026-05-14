// Retainify — Create Flow Modal
// 3-column overlay: filters / template gallery / detail.

const { useState: useStateCM } = React;

function CreateFlowModal({ open, onClose, onPick }) {
  const [typeFilter, setTypeFilter] = useStateCM('all');
  const [channelFilter, setChannelFilter] = useStateCM('email');
  const [selectedId, setSelectedId] = useStateCM('welcome');

  if (!open) return null;

  const { TEMPLATES, TRIGGERS } = window.RetainifyData;
  const types = ['all', 'Welcome Series', 'Abandoned Cart', 'Post Purchase', 'Win-back'];
  const selected = TEMPLATES.find(t => t.id === selectedId) || TEMPLATES[0];

  const filteredTemplates = TEMPLATES.filter(t => typeFilter === 'all' || t.type === typeFilter);

  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div className="rt-modal rt-create-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <header className="rt-modal-head">
          <div>
            <div className="t-micro muted" style={{ marginBottom: 6 }}>New flow</div>
            <h2 className="t-display-2" style={{ margin: 0 }}>Start with a <em style={{ fontFamily: 'var(--font-display)' }}>tested</em> sequence</h2>
            <p className="muted t-small" style={{ margin: '8px 0 0', maxWidth: 480 }}>
              Templates are fully editable. Pick the closest match and shape it from there.
            </p>
          </div>
          <div className="rt-modal-head-right">
            <button className="btn btn-secondary" onClick={() => onPick(null)}><Icons.Plus size={14} /> Start blank</button>
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <Icons.Close size={16} />
            </button>
          </div>
        </header>

        {/* Body: 3 columns */}
        <div className="rt-modal-body">
          {/* Filters */}
          <aside className="rt-cm-filters">
            <div className="t-micro muted rt-cm-filter-heading">Type</div>
            <div className="rt-cm-radio-list">
              {types.map(t => (
                <button key={t} className={`rt-cm-radio ${typeFilter === t ? 'rt-on' : ''}`} onClick={() => setTypeFilter(t)}>
                  <span className="rt-cm-radio-dot" />
                  <span>{t === 'all' ? 'All templates' : t}</span>
                  <span className="rt-cm-radio-count">
                    {t === 'all' ? TEMPLATES.length : TEMPLATES.filter(x => x.type === t).length}
                  </span>
                </button>
              ))}
            </div>

            <div className="t-micro muted rt-cm-filter-heading" style={{ marginTop: 28 }}>Channel</div>
            <div className="rt-cm-radio-list">
              <button className={`rt-cm-radio ${channelFilter === 'email' ? 'rt-on' : ''}`} onClick={() => setChannelFilter('email')}>
                <span className="rt-cm-radio-dot" />
                <Icons.Mail size={14} />
                <span>Email</span>
                <span className="rt-cm-radio-count">{TEMPLATES.length}</span>
              </button>
              <button className="rt-cm-radio rt-locked">
                <span className="rt-cm-radio-dot" />
                <Icons.Sms size={14} />
                <span>SMS</span>
                <span className="pill soon" style={{ height: 18, fontSize: 9, padding: '0 6px' }}>Soon</span>
              </button>
              <button className="rt-cm-radio rt-locked">
                <span className="rt-cm-radio-dot" />
                <Icons.Bell size={14} />
                <span>Push</span>
                <span className="pill soon" style={{ height: 18, fontSize: 9, padding: '0 6px' }}>Soon</span>
              </button>
            </div>

            <div className="rt-cm-foot">
              <div className="t-micro muted">Need something custom?</div>
              <button className="btn btn-ghost btn-sm" onClick={() => onPick(null)} style={{ marginTop: 8 }}>
                Start from a blank canvas →
              </button>
            </div>
          </aside>

          {/* Gallery */}
          <div className="rt-cm-gallery">
            {filteredTemplates.map(t => {
              const trig = TRIGGERS[t.trigger];
              const TrigIcon = Icons[trig.glyph];
              const emails = t.nodes.filter(n => n.type === 'email').length;
              return (
                <button
                  key={t.id}
                  className={`rt-tmpl-card ${selectedId === t.id ? 'rt-on' : ''}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <div className="rt-tmpl-top">
                    <span className={`rt-tmpl-trig rt-tint-${trig.tint}`}>
                      <TrigIcon size={12} />
                      <span>{trig.label}</span>
                    </span>
                    <span className="rt-tmpl-emails t-mono">{emails} ✉</span>
                  </div>
                  <h3 className="rt-tmpl-name">{t.name}</h3>
                  <p className="rt-tmpl-desc">{t.description}</p>
                  <div className="rt-tmpl-seq">
                    {t.nodes.slice(0, 5).map((n, i) => (
                      <span key={n.id} className={`rt-seq-dot rt-seq-${n.type}`} title={n.type}>
                        {n.type === 'email' ? '✉' : n.type === 'delay' ? '·' : '○'}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail */}
          <aside className="rt-cm-detail">
            <div className="rt-cm-detail-illustration">
              <FlowMiniMap template={selected} />
            </div>
            <div className="rt-cm-detail-body">
              <div className="t-micro muted" style={{ marginBottom: 6 }}>{selected.type}</div>
              <h3 className="t-h1" style={{ margin: '0 0 8px' }}>{selected.name}</h3>
              <p className="t-small muted" style={{ margin: '0 0 20px', lineHeight: 1.6 }}>{selected.description}</p>

              <div className="t-micro muted rt-cm-detail-section">Best for</div>
              <ul className="rt-cm-best">
                {selected.bestFor.map(b => (
                  <li key={b}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5 11-11"/></svg>
                    {b}
                  </li>
                ))}
              </ul>

              <div className="t-micro muted rt-cm-detail-section">What's inside</div>
              <div className="rt-cm-inside">
                {selected.nodes.map(n => {
                  if (n.type === 'email') return (
                    <div key={n.id} className="rt-cm-inside-row">
                      <span className="rt-cm-inside-dot rt-tint-email"><Icons.Mail size={11} /></span>
                      <div>
                        <div className="rt-cm-inside-name">{n.name}</div>
                        <div className="t-mono rt-cm-inside-time">
                          {n.after === 0 ? 'immediately' : `+${n.after} ${n.afterUnit}`}
                        </div>
                      </div>
                      {n.discount > 0 && <span className="rt-discount">{n.discount}% off</span>}
                    </div>
                  );
                  if (n.type === 'delay') return (
                    <div key={n.id} className="rt-cm-inside-row rt-cm-inside-delay">
                      <span className="rt-cm-inside-dot rt-tint-delay"><Icons.Clock size={11} /></span>
                      <div className="t-mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>Wait {n.hours} hours</div>
                    </div>
                  );
                  return null;
                })}
              </div>

              <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 24 }} onClick={() => onPick(selected.id)}>
                Use this template <Icons.Arrow size={14} />
              </button>
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }}>
                Preview emails
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

// Tiny visual sketch of a template flow for the detail panel
function FlowMiniMap({ template }) {
  const nodes = template.nodes;
  return (
    <div className="rt-minimap">
      <div className="rt-minimap-node rt-mini-trigger">
        <Icons.Trigger size={10} />
        <span>Trigger</span>
      </div>
      <div className="rt-minimap-line" />
      {nodes.map((n, i) => (
        <React.Fragment key={n.id}>
          {n.type === 'email' && (
            <div className="rt-minimap-node rt-mini-email">
              <Icons.Mail size={10} />
              <span className="rt-minimap-label">Email {nodes.slice(0, i).filter(x => x.type === 'email').length + 1}</span>
            </div>
          )}
          {n.type === 'delay' && (
            <div className="rt-minimap-delay">
              <Icons.Clock size={9} />
              <span className="t-mono">{n.hours}h</span>
            </div>
          )}
          <div className="rt-minimap-line" />
        </React.Fragment>
      ))}
      <div className="rt-minimap-node rt-mini-exit">
        <Icons.Exit size={10} />
        <span>Exit</span>
      </div>
    </div>
  );
}

Object.assign(window, { CreateFlowModal });
