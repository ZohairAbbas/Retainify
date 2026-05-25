// Retainify — Popup template renderers + editor schemas
// Each template defines its own visual system (fonts, colors, layout).
// Exported as window.PopupTemplates so popups.jsx can consume.

const { useState: useStatePT, useEffect: useEffectPT } = React;

// ── Shared util: editor field rows ─────────────────────────────────────
function TextField({ label, value, onChange, help, type = "text" }) {
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <input className="input" type={type} value={value || ''} onChange={e => onChange(e.target.value)} />
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}
function SwatchRow({ label, value, onChange, options, help }) {
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <div className="rt-pop-swatch-row">
        {options.map(opt => (
          <button
            key={opt.value}
            className={`rt-pop-swatch ${value === opt.value ? 'is-on' : ''}`}
            style={{ background: opt.color || opt.value }}
            onClick={() => onChange(opt.value)}
            title={opt.label || ''}
          />
        ))}
      </div>
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}
function PaletteRow({ label, value, onChange, options }) {
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {options.map(opt => (
          <button
            key={opt.id}
            className={`rt-pop-swatch-pal ${value === opt.id ? 'is-on' : ''}`}
            onClick={() => onChange(opt.id)}
            title={opt.label}
          >
            {opt.colors.map((c, i) => <span key={i} style={{ background: c }} />)}
          </button>
        ))}
      </div>
    </div>
  );
}
function SegField({ label, value, onChange, options }) {
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <div className="rt-pop-seg">
        {options.map(o => (
          <button key={o.value} className={value === o.value ? 'rt-on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}
function SelectField({ label, value, onChange, options, help }) {
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <select className="select" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}

// Common control sections — discount/timing/trigger — same shape across templates
function CommonTimingFields({ data, onUpdate }) {
  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Trigger</div>
        <SelectField
          label="Show popup when…"
          value={data.trigger || 'delay'}
          onChange={v => onUpdate({ trigger: v })}
          options={[
            { value: 'delay', label: 'After a time delay' },
            { value: 'scroll', label: 'After scrolling 50%' },
            { value: 'exit', label: 'On exit intent (desktop)' },
          ]}
        />
        {data.trigger !== 'exit' && (
          <SelectField
            label="Delay"
            value={data.delay || '3'}
            onChange={v => onUpdate({ delay: v })}
            options={[
              { value: '0', label: 'Immediately' },
              { value: '3', label: '3 seconds' },
              { value: '7', label: '7 seconds' },
              { value: '15', label: '15 seconds' },
              { value: '30', label: '30 seconds' },
            ]}
          />
        )}
        <SelectField
          label="Frequency"
          value={data.frequency || 'session'}
          onChange={v => onUpdate({ frequency: v })}
          options={[
            { value: 'session', label: 'Once per session' },
            { value: 'day', label: 'Once per day' },
            { value: 'week', label: 'Once per week' },
            { value: 'forever', label: 'Once per visitor (ever)' },
          ]}
        />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Discount</div>
        <SelectField
          label="Discount percentage"
          value={String(data.discount || 10)}
          onChange={v => onUpdate({ discount: +v })}
          options={[5, 10, 15, 20, 25].map(n => ({ value: String(n), label: `${n}%` }))}
          help="Auto-generated single-use code is sent after email confirmation."
        />
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TEMPLATE 1 — EDITORIAL ("Le Salon")
// ═══════════════════════════════════════════════════════════════════════
const EDITORIAL_IMAGES = {
  amber:  'linear-gradient(135deg, #8B7355 0%, #5A4632 100%)',
  rose:   'linear-gradient(135deg, #C09080 0%, #7A4F45 100%)',
  forest: 'linear-gradient(135deg, #6B7A6F 0%, #3A4A40 100%)',
  ink:    'linear-gradient(135deg, #4A4632 0%, #1F1A12 100%)',
};
const EDITORIAL_ACCENTS = {
  burgundy: '#8C3A2A',
  forest:   '#2E5240',
  cobalt:   '#2A4A8C',
  rust:     '#A85A2E',
};

function RenderEditorial({ data, scale }) {
  const img = EDITORIAL_IMAGES[data.image] || EDITORIAL_IMAGES.amber;
  const accent = EDITORIAL_ACCENTS[data.accent] || EDITORIAL_ACCENTS.burgundy;
  return (
    <div className="tpl-editorial" style={{ '--ed-img': img, '--ed-accent': accent, transform: scale ? `scale(${scale})` : undefined }}>
      <div className="tpl-editorial-img">
        <div className="tpl-editorial-mast">{data.masthead || 'NORTHHILL & CO.'}</div>
      </div>
      <div className="tpl-editorial-body">
        <button className="tpl-editorial-close" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
        </button>
        <div className="tpl-editorial-rule">An invitation · {data.discount}% off</div>
        <h2 className="tpl-editorial-h" dangerouslySetInnerHTML={{ __html: data.headline }} />
        <p className="tpl-editorial-p">{data.body}</p>
        <input className="tpl-editorial-input" placeholder={data.placeholder || 'your address'} readOnly />
        <button className="tpl-editorial-btn">{data.cta} <span aria-hidden>→</span></button>
        <div className="tpl-editorial-fine">{data.fine}</div>
      </div>
    </div>
  );
}

function EditorEditorial({ data, onUpdate }) {
  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Content</div>
        <TextField label="Masthead (top of image)" value={data.masthead} onChange={v => onUpdate({ masthead: v })} />
        <TextField label="Headline" value={data.headline} onChange={v => onUpdate({ headline: v })} help="Use <em>…</em> for italic accent words." />
        <div className="rt-pop-field">
          <label className="field-label">Body</label>
          <textarea className="textarea" rows={3} value={data.body || ''} onChange={e => onUpdate({ body: e.target.value })} />
        </div>
        <TextField label="Email placeholder" value={data.placeholder} onChange={v => onUpdate({ placeholder: v })} />
        <TextField label="Button label" value={data.cta} onChange={v => onUpdate({ cta: v })} />
        <TextField label="Fine print" value={data.fine} onChange={v => onUpdate({ fine: v })} />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Style</div>
        <SwatchRow
          label="Hero image"
          value={data.image}
          onChange={v => onUpdate({ image: v })}
          options={Object.entries(EDITORIAL_IMAGES).map(([k, v]) => ({ value: k, color: v, label: k }))}
          help="Placeholder palettes. Upload your own image (coming soon)."
        />
        <SwatchRow
          label="Accent color"
          value={data.accent}
          onChange={v => onUpdate({ accent: v })}
          options={Object.entries(EDITORIAL_ACCENTS).map(([k, c]) => ({ value: k, color: c, label: k }))}
        />
      </div>
      <CommonTimingFields data={data} onUpdate={onUpdate} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TEMPLATE 2 — BRUTALIST ("MEGA15")
// ═══════════════════════════════════════════════════════════════════════
const BRUTAL_PALETTES = {
  acid:     { id: 'acid',     label: 'Acid',     bg: '#0E0E0E', ink: '#E5FF36', shadow: '#E5FF36', colors: ['#0E0E0E', '#E5FF36'] },
  inferno:  { id: 'inferno',  label: 'Inferno',  bg: '#FF3D2E', ink: '#FFF1E0', shadow: '#0E0E0E', colors: ['#FF3D2E', '#FFF1E0', '#0E0E0E'] },
  electric: { id: 'electric', label: 'Electric', bg: '#1B2BFF', ink: '#FFF', shadow: '#FFEE00', colors: ['#1B2BFF', '#FFEE00', '#FFF'] },
  mint:     { id: 'mint',     label: 'Mint',     bg: '#F0F0E8', ink: '#0E0E0E', shadow: '#3DBF7C', colors: ['#F0F0E8', '#0E0E0E', '#3DBF7C'] },
};

function RenderBrutal({ data, scale }) {
  const p = BRUTAL_PALETTES[data.palette] || BRUTAL_PALETTES.acid;
  const marqueeText = (data.marqueeText || 'FREE SHIPPING · NEW DROPS WEEKLY · MEMBERS ONLY · ').repeat(1);
  return (
    <div className="tpl-brutal" style={{ '--br-bg': p.bg, '--br-ink': p.ink, '--br-shadow': p.shadow, transform: scale ? `scale(${scale})` : undefined }}>
      <button className="tpl-brutal-close" aria-label="Close">×</button>
      <div className="tpl-brutal-marquee">
        <div className="tpl-brutal-marquee-inner">
          <span>{marqueeText}{marqueeText}{marqueeText}{marqueeText}</span>
          <span>{marqueeText}{marqueeText}{marqueeText}{marqueeText}</span>
        </div>
      </div>
      <div className="tpl-brutal-body">
        <span className="tpl-brutal-eyebrow">{data.eyebrow || 'STOP RIGHT THERE'}</span>
        <h2 className="tpl-brutal-h">
          {data.headline}<span className="pct">{data.discount}</span>
        </h2>
        <div className="tpl-brutal-sub">{data.sub}</div>
        <div className="tpl-brutal-form">
          <input className="tpl-brutal-input" placeholder="EMAIL@HERE.COM" readOnly />
          <button className="tpl-brutal-btn">{data.cta}</button>
        </div>
        <div className="tpl-brutal-fine">{data.fine}</div>
      </div>
      {data.cornerTag && <div className="corner-tag">{data.cornerTag}</div>}
    </div>
  );
}

function EditorBrutal({ data, onUpdate }) {
  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Content</div>
        <TextField label="Marquee text" value={data.marqueeText} onChange={v => onUpdate({ marqueeText: v })} help="Repeats forever. Keep short." />
        <TextField label="Eyebrow" value={data.eyebrow} onChange={v => onUpdate({ eyebrow: v })} />
        <TextField label="Headline" value={data.headline} onChange={v => onUpdate({ headline: v })} help="The big number renders after. E.g. 'TAKE' + 15" />
        <div className="rt-pop-field">
          <label className="field-label">Subtitle</label>
          <textarea className="textarea" rows={2} value={data.sub || ''} onChange={e => onUpdate({ sub: e.target.value })} />
        </div>
        <TextField label="Button label" value={data.cta} onChange={v => onUpdate({ cta: v })} />
        <TextField label="Corner tag (optional)" value={data.cornerTag} onChange={v => onUpdate({ cornerTag: v })} />
        <TextField label="Fine print" value={data.fine} onChange={v => onUpdate({ fine: v })} />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Palette</div>
        <PaletteRow
          label="Color combo"
          value={data.palette}
          onChange={v => onUpdate({ palette: v })}
          options={Object.values(BRUTAL_PALETTES)}
        />
      </div>
      <CommonTimingFields data={data} onUpdate={onUpdate} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TEMPLATE 3 — WHEEL ("Lucky Day")
// ═══════════════════════════════════════════════════════════════════════
const WHEEL_DEFAULT_SLICES = [
  { color: '#FF7A6B', label: '5% OFF' },
  { color: '#FFD58A', label: '10% OFF' },
  { color: '#9B7BC8', label: '25% OFF' },
  { color: '#FFB347', label: 'TRY AGAIN' },
  { color: '#7CC8B6', label: '15% OFF' },
  { color: '#E8568D', label: 'FREE GIFT' },
];

function WheelDisc({ slices }) {
  const r = 100;
  const cx = 100, cy = 100;
  const total = slices.length;
  const angle = 360 / total;
  // Build pie wedges via SVG paths
  const wedges = slices.map((s, i) => {
    const a0 = (i * angle - 90) * Math.PI / 180;
    const a1 = ((i + 1) * angle - 90) * Math.PI / 180;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = angle > 180 ? 1 : 0;
    const d = `M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
    const ma = (i * angle + angle / 2 - 90) * Math.PI / 180;
    const mx = cx + (r * 0.62) * Math.cos(ma);
    const my = cy + (r * 0.62) * Math.sin(ma);
    const rot = i * angle + angle / 2;
    return (
      <g key={i}>
        <path d={d} fill={s.color} stroke="#3A1A4B" strokeWidth="1.5"/>
        <text
          x={mx} y={my}
          fill="#2A1B4E" fontFamily="Geist, sans-serif" fontWeight="700"
          fontSize="9" textAnchor="middle" dominantBaseline="middle"
          transform={`rotate(${rot} ${mx} ${my})`}
        >{s.label}</text>
      </g>
    );
  });
  return (
    <svg className="tpl-wheel-svg" viewBox="0 0 200 200">
      {wedges}
      <circle cx={cx} cy={cy} r={r - 1} fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1"/>
    </svg>
  );
}

function RenderWheel({ data, scale }) {
  const slices = data.slices && data.slices.length ? data.slices : WHEEL_DEFAULT_SLICES;
  return (
    <div className="tpl-wheel" style={{ transform: scale ? `scale(${scale})` : undefined }}>
      <div className="tpl-wheel-stars" />
      <button className="tpl-wheel-close" aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" fill="none"/></svg>
      </button>
      <div className="tpl-wheel-left">
        <div className="tpl-wheel-disc">
          <WheelDisc slices={slices} />
          <div className="tpl-wheel-hub" />
        </div>
        <div className="tpl-wheel-pointer" />
      </div>
      <div className="tpl-wheel-right">
        <div className="tpl-wheel-eyebrow">— {data.eyebrow || 'one spin only'} —</div>
        <h2 className="tpl-wheel-h">{data.headline}</h2>
        <p className="tpl-wheel-p">{data.body}</p>
        <input className="tpl-wheel-input" placeholder={data.placeholder || 'Your email address'} readOnly />
        <button className="tpl-wheel-btn">{data.cta}</button>
        <div className="tpl-wheel-fine">{data.fine}</div>
      </div>
    </div>
  );
}

function EditorWheel({ data, onUpdate }) {
  const slices = data.slices && data.slices.length ? data.slices : WHEEL_DEFAULT_SLICES;
  const setSlice = (i, patch) => {
    const next = slices.map((s, j) => j === i ? { ...s, ...patch } : s);
    onUpdate({ slices: next });
  };
  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Content</div>
        <TextField label="Eyebrow" value={data.eyebrow} onChange={v => onUpdate({ eyebrow: v })} />
        <TextField label="Headline" value={data.headline} onChange={v => onUpdate({ headline: v })} />
        <div className="rt-pop-field">
          <label className="field-label">Body</label>
          <textarea className="textarea" rows={3} value={data.body || ''} onChange={e => onUpdate({ body: e.target.value })} />
        </div>
        <TextField label="Email placeholder" value={data.placeholder} onChange={v => onUpdate({ placeholder: v })} />
        <TextField label="Spin button" value={data.cta} onChange={v => onUpdate({ cta: v })} />
        <TextField label="Fine print" value={data.fine} onChange={v => onUpdate({ fine: v })} />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Wheel slices</div>
        <div className="field-help" style={{ marginBottom: 10 }}>
          Six prizes; first one is awarded on landing. Use “TRY AGAIN” to add risk.
        </div>
        {slices.map((s, i) => (
          <div key={i} className="rt-wheel-slice-row">
            <input
              type="color"
              className="rt-wheel-slice-color"
              value={s.color}
              onChange={e => setSlice(i, { color: e.target.value })}
              style={{ border: 'none', padding: 0, background: 'transparent', cursor: 'pointer' }}
            />
            <input className="input" value={s.label} onChange={e => setSlice(i, { label: e.target.value })} />
            <span className="t-small muted" style={{ textAlign: 'right' }}>#{i + 1}</span>
          </div>
        ))}
      </div>
      <CommonTimingFields data={data} onUpdate={onUpdate} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TEMPLATE 4 — PLAYFUL ("Sticker Drop")
// ═══════════════════════════════════════════════════════════════════════
const STICKER_S1_OPTIONS = ['10%', 'NEW!', 'HEY', '✿'];
const STICKER_S2_OPTIONS = ['❤', '!!', '★', '+'];
const STICKER_S3_OPTIONS = ['YES', 'GO!', '✓', '✿'];

function RenderSticker({ data, scale }) {
  // Confetti dots
  const confetti = [
    { c: '#FF6B6B', x: 12, y: 10, r: 8 },
    { c: '#4ECDC4', x: 88, y: 18, r: -14 },
    { c: '#FFD93D', x: 22, y: 80, r: -8 },
    { c: '#95D8B0', x: 80, y: 88, r: 14 },
    { c: '#FF6B6B', x: 6, y: 50, r: 4 },
    { c: '#4ECDC4', x: 92, y: 60, r: -4 },
  ];
  return (
    <div className="tpl-sticker" style={{ transform: scale ? `scale(${scale})` : undefined }}>
      <div className="tpl-sticker-confetti">
        {confetti.map((c, i) => (
          <span key={i} style={{
            left: `${c.x}%`, top: `${c.y}%`,
            width: 8, height: 8, background: c.c, borderRadius: 2,
            transform: `rotate(${c.r}deg)`,
          }} />
        ))}
      </div>
      <div className="tpl-sticker-tape" />
      <button className="tpl-sticker-close" aria-label="Close">
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
      </button>
      <div className="tpl-sticker-sticker tpl-sticker-s1">{data.sticker1 || '10%'}</div>
      <div className="tpl-sticker-sticker tpl-sticker-s2">{data.sticker2 || '❤'}</div>
      <div className="tpl-sticker-sticker tpl-sticker-s3">{data.sticker3 || 'YES'}</div>
      <div className="tpl-sticker-eyebrow">{data.eyebrow}</div>
      <h2 className="tpl-sticker-h" dangerouslySetInnerHTML={{ __html: data.headline }} />
      <p className="tpl-sticker-p">{data.body}</p>
      <input className="tpl-sticker-input" placeholder={data.placeholder || 'Drop your email here'} readOnly />
      <button className="tpl-sticker-btn">{data.cta}</button>
      <div className="tpl-sticker-fine">{data.fine}</div>
    </div>
  );
}

function EditorSticker({ data, onUpdate }) {
  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Content</div>
        <TextField label="Eyebrow" value={data.eyebrow} onChange={v => onUpdate({ eyebrow: v })} />
        <TextField label="Headline" value={data.headline} onChange={v => onUpdate({ headline: v })} help="Use <span class='accent'>…</span> for colored words." />
        <div className="rt-pop-field">
          <label className="field-label">Body</label>
          <textarea className="textarea" rows={2} value={data.body || ''} onChange={e => onUpdate({ body: e.target.value })} />
        </div>
        <TextField label="Email placeholder" value={data.placeholder} onChange={v => onUpdate({ placeholder: v })} />
        <TextField label="Button label" value={data.cta} onChange={v => onUpdate({ cta: v })} />
        <TextField label="Fine print" value={data.fine} onChange={v => onUpdate({ fine: v })} />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Stickers</div>
        <SegField
          label="Top-right sticker"
          value={data.sticker1}
          onChange={v => onUpdate({ sticker1: v })}
          options={STICKER_S1_OPTIONS.map(o => ({ value: o, label: o }))}
        />
        <SegField
          label="Bottom-left sticker"
          value={data.sticker2}
          onChange={v => onUpdate({ sticker2: v })}
          options={STICKER_S2_OPTIONS.map(o => ({ value: o, label: o }))}
        />
        <SegField
          label="Right-edge sticker"
          value={data.sticker3}
          onChange={v => onUpdate({ sticker3: v })}
          options={STICKER_S3_OPTIONS.map(o => ({ value: o, label: o }))}
        />
      </div>
      <CommonTimingFields data={data} onUpdate={onUpdate} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TEMPLATE 5 — HOLIDAY / EXIT ("Last Call")
// ═══════════════════════════════════════════════════════════════════════
const HOLIDAY_PALETTES = {
  pine:    { id: 'pine',    label: 'Pine',    bg: 'linear-gradient(180deg, #1A2E1F 0%, #0F1F15 100%)', bgSolid: '#1A2E1F', ink: '#F1E8C7', accent: '#D4A35A', line: 'rgba(241,232,199,0.18)', colors: ['#1A2E1F', '#D4A35A', '#F1E8C7'] },
  blush:   { id: 'blush',   label: 'Blush',   bg: 'linear-gradient(180deg, #4A1A2E 0%, #2E0F1F 100%)', bgSolid: '#4A1A2E', ink: '#FCE6D6', accent: '#E89B7A', line: 'rgba(252,230,214,0.18)', colors: ['#4A1A2E', '#E89B7A', '#FCE6D6'] },
  midnight:{ id: 'midnight', label: 'Midnight', bg: 'linear-gradient(180deg, #1A1F3A 0%, #0F1226 100%)', bgSolid: '#1A1F3A', ink: '#D8E1F5', accent: '#C5A86A', line: 'rgba(216,225,245,0.18)', colors: ['#1A1F3A', '#C5A86A', '#D8E1F5'] },
  ember:   { id: 'ember',   label: 'Ember',   bg: 'linear-gradient(180deg, #3A1810 0%, #1F0A06 100%)', bgSolid: '#3A1810', ink: '#FBD9A5', accent: '#E07A2C', line: 'rgba(251,217,165,0.18)', colors: ['#3A1810', '#E07A2C', '#FBD9A5'] },
};

function useCountdown(targetHours = 24) {
  const [now, setNow] = useStatePT(() => Date.now());
  useEffectPT(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const target = useStatePT(() => Date.now() + targetHours * 3600 * 1000)[0];
  const diff = Math.max(0, target - now);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return { h: pad(h), m: pad(m), s: pad(s) };
}

function RenderHoliday({ data, scale }) {
  const p = HOLIDAY_PALETTES[data.palette] || HOLIDAY_PALETTES.pine;
  const c = useCountdown(parseInt(data.countdownHours || 24, 10));
  return (
    <div className="tpl-holiday" style={{
      '--hd-bg': p.bg, '--hd-bg-solid': p.bgSolid, '--hd-ink': p.ink, '--hd-accent': p.accent, '--hd-line': p.line,
      transform: scale ? `scale(${scale})` : undefined,
    }}>
      <button className="tpl-holiday-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
      </button>
      <div className="tpl-holiday-wreath" />
      <div className="tpl-holiday-body">
        <div className="tpl-holiday-eyebrow">{data.eyebrow}</div>
        <h2 className="tpl-holiday-h" dangerouslySetInnerHTML={{ __html: data.headline }} />
        <p className="tpl-holiday-p">{data.body}</p>
        <div className="tpl-holiday-countdown">
          <div className="tpl-holiday-countdown-cell">
            <div className="tpl-holiday-countdown-num">{c.h}</div>
            <div className="tpl-holiday-countdown-label">Hours</div>
          </div>
          <div className="tpl-holiday-countdown-cell">
            <div className="tpl-holiday-countdown-num">{c.m}</div>
            <div className="tpl-holiday-countdown-label">Minutes</div>
          </div>
          <div className="tpl-holiday-countdown-cell">
            <div className="tpl-holiday-countdown-num">{c.s}</div>
            <div className="tpl-holiday-countdown-label">Seconds</div>
          </div>
        </div>
        <div className="tpl-holiday-form">
          <input className="tpl-holiday-input" placeholder={data.placeholder || 'your@email.com'} readOnly />
          <button className="tpl-holiday-btn">{data.cta}</button>
        </div>
        <div className="tpl-holiday-fine">{data.fine}</div>
      </div>
    </div>
  );
}

function EditorHoliday({ data, onUpdate }) {
  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Content</div>
        <TextField label="Eyebrow" value={data.eyebrow} onChange={v => onUpdate({ eyebrow: v })} />
        <TextField label="Headline" value={data.headline} onChange={v => onUpdate({ headline: v })} help="Use <em>…</em> for italic accent words." />
        <div className="rt-pop-field">
          <label className="field-label">Body</label>
          <textarea className="textarea" rows={2} value={data.body || ''} onChange={e => onUpdate({ body: e.target.value })} />
        </div>
        <TextField label="Email placeholder" value={data.placeholder} onChange={v => onUpdate({ placeholder: v })} />
        <TextField label="Button label" value={data.cta} onChange={v => onUpdate({ cta: v })} />
        <TextField label="Fine print" value={data.fine} onChange={v => onUpdate({ fine: v })} />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Countdown</div>
        <SelectField
          label="Countdown duration"
          value={String(data.countdownHours || 24)}
          onChange={v => onUpdate({ countdownHours: +v })}
          options={[
            { value: '1', label: '1 hour (flash sale)' },
            { value: '6', label: '6 hours' },
            { value: '12', label: '12 hours' },
            { value: '24', label: '24 hours' },
            { value: '48', label: '48 hours' },
            { value: '72', label: '72 hours' },
          ]}
          help="Counts down live for each visitor — resets if they return after expiry."
        />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Palette</div>
        <PaletteRow
          label="Color palette"
          value={data.palette}
          onChange={v => onUpdate({ palette: v })}
          options={Object.values(HOLIDAY_PALETTES)}
        />
      </div>
      <CommonTimingFields data={data} onUpdate={onUpdate} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TEMPLATE REGISTRY
// ═══════════════════════════════════════════════════════════════════════
const TEMPLATES = {
  editorial: {
    id: 'editorial',
    name: 'Le Salon',
    vibe: 'Editorial · Quiet',
    oneliner: 'A magazine-shop invitation, set in serif. For fashion, beauty & curated lifestyle brands.',
    tags: ['Email capture', 'Serif', 'Refined'],
    goal: 'email_discount',
    Render: RenderEditorial,
    Editor: EditorEditorial,
    defaults: {
      template: 'editorial',
      masthead: 'NORTHHILL & CO.',
      headline: 'An <em>invitation,</em><br/>from us to you.',
      body: 'Take 15% off your first order. Plus dispatches twice a month — beautiful things, no noise.',
      placeholder: 'your address',
      cta: 'Send my code',
      fine: 'By subscribing you agree to receive marketing emails. Unsubscribe anytime.',
      image: 'amber',
      accent: 'burgundy',
      discount: 15,
      trigger: 'delay',
      delay: '7',
      frequency: 'session',
    },
  },
  brutalist: {
    id: 'brutalist',
    name: 'MEGA15',
    vibe: 'Bold · Brutalist',
    oneliner: 'High-contrast, hits like a poster. For streetwear, design tools, anything loud.',
    tags: ['Email capture', 'Display type', 'High contrast'],
    goal: 'email_discount',
    Render: RenderBrutal,
    Editor: EditorBrutal,
    defaults: {
      template: 'brutalist',
      marqueeText: 'FREE SHIPPING · NEW DROPS WEEKLY · MEMBERS ONLY · ',
      eyebrow: 'STOP RIGHT THERE.',
      headline: 'TAKE ',
      sub: 'Off your first order. No spam. Cancel whenever. Members get first dibs on every drop.',
      cta: 'GET IT',
      cornerTag: 'TODAY ONLY',
      fine: 'BY SUBSCRIBING YOU AGREE TO RECEIVE MARKETING EMAILS.',
      palette: 'acid',
      discount: 15,
      trigger: 'delay',
      delay: '3',
      frequency: 'session',
    },
  },
  wheel: {
    id: 'wheel',
    name: 'Lucky Day',
    vibe: 'Gamified · Playful',
    oneliner: 'Spin-to-win wheel with custom prize slices. Conversion machine — but use sparingly.',
    tags: ['Email capture', 'Gamified', 'High intent'],
    goal: 'email_discount',
    Render: RenderWheel,
    Editor: EditorWheel,
    defaults: {
      template: 'wheel',
      eyebrow: 'one spin only',
      headline: 'Take a chance.',
      body: 'Drop your email, give the wheel a spin, and we\'ll send your prize within seconds.',
      placeholder: 'Your email address',
      cta: 'Spin the wheel',
      fine: 'One spin per visitor. Prize codes valid for 7 days.',
      slices: WHEEL_DEFAULT_SLICES,
      discount: 15,
      trigger: 'delay',
      delay: '7',
      frequency: 'forever',
    },
  },
  sticker: {
    id: 'sticker',
    name: 'Sticker Drop',
    vibe: 'Playful · Hand-drawn',
    oneliner: 'Confetti and tape and handwriting. For food, kids, indie makers — anyone with personality.',
    tags: ['Email capture', 'Illustrated', 'Friendly'],
    goal: 'email_discount',
    Render: RenderSticker,
    Editor: EditorSticker,
    defaults: {
      template: 'sticker',
      eyebrow: 'PSST — HEY YOU',
      headline: 'Hiya, <span class="accent">friend!</span>',
      body: '10% off your first order because we like your taste. Hit us up below.',
      placeholder: 'Drop your email here',
      cta: 'Yes please!',
      fine: 'No spam. Unsubscribe anytime. Promise.',
      sticker1: '10%',
      sticker2: '❤',
      sticker3: 'YES',
      discount: 10,
      trigger: 'delay',
      delay: '3',
      frequency: 'session',
    },
  },
  holiday: {
    id: 'holiday',
    name: 'Last Call',
    vibe: 'Seasonal · Urgent',
    oneliner: 'Countdown timer, exit-intent ready. Perfect for holiday campaigns and winbacks.',
    tags: ['Exit intent', 'Countdown', 'Seasonal'],
    goal: 'exit_winback',
    Render: RenderHoliday,
    Editor: EditorHoliday,
    defaults: {
      template: 'holiday',
      eyebrow: 'Before you go',
      headline: 'Don\'t leave <em>empty-handed.</em>',
      body: 'A parting gift: 20% off your first order. The code expires when the clock does.',
      placeholder: 'your@email.com',
      cta: 'Claim 20% off',
      fine: 'One-time use. Cannot be combined with other offers.',
      palette: 'pine',
      countdownHours: 24,
      discount: 20,
      trigger: 'exit',
      delay: '0',
      frequency: 'week',
    },
  },
};

window.PopupTemplates = {
  TEMPLATES,
  TEMPLATE_ORDER: ['editorial', 'brutalist', 'wheel', 'sticker', 'holiday'],
};
