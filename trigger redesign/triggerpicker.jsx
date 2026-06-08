// Retainify — Trigger picker
// 2x2 tile grid of triggers. When "Entered a segment" is picked, a rich
// segment-pick card appears below; the card can flip into a gallery to
// browse/search all segments. Replaces the prior <select> in the trigger
// inspector and the cascading-selects pattern shown in the Klaviyo reference.

const { useState: useStateTP, useMemo: useMemoTP } = React;

function TriggerPicker({ value, segmentId, onChange }) {
  const { TRIGGERS } = window.RetainifyData;
  const [galleryOpen, setGalleryOpen] = useStateTP(false);
  const triggers = Object.values(TRIGGERS);

  return (
    <div>
      <div className="rt-trig-tiles">
        {triggers.map(t => {
          const Glyph = window.Icons[t.glyph] || window.Icons.Trigger;
          const isOn = value === t.id;
          return (
            <button
              key={t.id}
              className={`rt-trig-tile ${isOn ? 'rt-on' : ''} ${t.id === 'entered_segment' ? 'rt-trig-tile-segment' : ''}`}
              onClick={() => {
                // For segment trigger, preserve any existing segment selection
                onChange(t.id, t.requiresSegment ? (segmentId || null) : undefined);
              }}
              title={t.desc}
            >
              <span className="rt-trig-tile-icon"><Glyph size={14} /></span>
              <span style={{ minWidth: 0 }}>
                <span className="rt-trig-tile-name">{t.label}</span>
                <span className="rt-trig-tile-sub">
                  {t.id === 'customer_created' && 'Lifecycle'}
                  {t.id === 'cart_abandoned' && 'Cart'}
                  {t.id === 'order_placed' && 'Order'}
                  {t.id === 'win_back' && 'Lifecycle'}
                  {t.id === 'entered_segment' && 'Segment match'}
                </span>
              </span>
              <span className="rt-trig-tile-check" />
            </button>
          );
        })}
      </div>

      {/* Helper text for the picked trigger */}
      <div className="field-help" style={{ marginTop: 10 }}>
        {TRIGGERS[value]?.desc}
      </div>

      {/* Segment picker appears below when "entered_segment" is the trigger */}
      {value === 'entered_segment' && (
        <SegmentTriggerCard
          segmentId={segmentId}
          galleryOpen={galleryOpen}
          onOpenGallery={() => setGalleryOpen(true)}
          onCloseGallery={() => setGalleryOpen(false)}
          onPick={(id) => { onChange('entered_segment', id); setGalleryOpen(false); }}
        />
      )}
    </div>
  );
}

// ── Card that shows the selected segment OR an empty-state prompt ──────
function SegmentTriggerCard({ segmentId, galleryOpen, onOpenGallery, onCloseGallery, onPick }) {
  const USER_SEGMENTS = window.RetainifySegments?.USER_SEGMENTS || [];
  const seg = USER_SEGMENTS.find(s => s.id === segmentId);

  if (galleryOpen) {
    return (
      <div className="rt-seg-pick">
        <div className="rt-seg-pick-head">
          <span className="t-micro">Pick a segment</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onCloseGallery}
            style={{ padding: '4px 8px', height: 26 }}
          >
            <Icons.Close size={12} /> Cancel
          </button>
        </div>
        <SegmentGallery
          activeId={segmentId}
          onPick={onPick}
        />
      </div>
    );
  }

  return (
    <div className="rt-seg-pick">
      <div className="rt-seg-pick-head">
        <span className="t-micro">Segment</span>
        {seg && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={onOpenGallery}
            style={{ padding: '4px 8px', height: 26 }}
          >
            <Icons.Refresh size={11} /> Change
          </button>
        )}
      </div>

      {!seg ? (
        <div className="rt-seg-pick-empty">
          <div className="rt-seg-pick-empty-lede">
            Anyone newly matching this segment enters the flow.{' '}
            <strong>Pick which segment</strong> to begin.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={onOpenGallery}>
              <Icons.Sliders size={13} /> Pick a segment
            </button>
            <button className="btn btn-secondary" title="Create new segment">
              <Icons.Plus size={13} /> New
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="rt-seg-pick-card">
            <span className="rt-seg-pick-icon"><Icons.Venn size={16} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="rt-seg-pick-info-top">
                <span className="rt-seg-pick-name">{seg.name}</span>
                <span className="rt-seg-pick-count">{seg.contactCount.toLocaleString()}</span>
              </div>
              <div className="rt-seg-pick-rule">{seg.description}</div>
              <div className="rt-seg-pick-foot">
                <span>{seg.kind === 'dynamic' ? 'Dynamic' : 'Static'}</span>
                <span>·</span>
                <span>Updated {seg.updated}</span>
                <a href="#" onClick={(e) => e.preventDefault()}>
                  View <Icons.Arrow size={9} />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Searchable gallery of segments ─────────────────────────────────────
function SegmentGallery({ activeId, onPick }) {
  const USER_SEGMENTS = window.RetainifySegments?.USER_SEGMENTS || [];
  const [q, setQ] = useStateTP('');

  const items = useMemoTP(() => {
    if (!q) return USER_SEGMENTS;
    const lq = q.toLowerCase();
    return USER_SEGMENTS.filter(s => `${s.name} ${s.description}`.toLowerCase().includes(lq));
  }, [q]);

  return (
    <div className="rt-seg-gallery">
      <div className="rt-seg-gallery-search">
        <div className="rt-search" style={{ width: '100%' }}>
          <Icons.Search size={13} />
          <input
            autoFocus
            placeholder="Search your segments…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
      </div>
      <div className="rt-seg-gallery-list">
        <button className="rt-seg-gallery-create">
          <Icons.Plus size={13} /> Create new segment…
        </button>
        {items.map(s => (
          <button
            key={s.id}
            className={`rt-seg-gallery-item ${activeId === s.id ? 'rt-on' : ''}`}
            onClick={() => onPick(s.id)}
          >
            <span className="rt-seg-gallery-item-icon"><Icons.Venn size={13} /></span>
            <span className="rt-seg-gallery-item-body">
              <span className="rt-seg-gallery-item-name">{s.name}</span>
              <span className="rt-seg-gallery-item-sub">{s.description}</span>
            </span>
            <span className="rt-seg-gallery-item-meta">
              {s.contactCount.toLocaleString()}
              <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>contacts</span>
            </span>
          </button>
        ))}
        {items.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12.5, color: 'var(--ink-4)' }}>
            No segments match "{q}".
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { TriggerPicker, SegmentTriggerCard, SegmentGallery });
