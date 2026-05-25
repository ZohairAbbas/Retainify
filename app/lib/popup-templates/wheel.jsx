import { TextField, CommonTimingFields } from "./shared.jsx";

export const WHEEL_DEFAULT_SLICES = [
  { color: "#FF7A6B", label: "5% OFF" },
  { color: "#FFD58A", label: "10% OFF" },
  { color: "#9B7BC8", label: "25% OFF" },
  { color: "#FFB347", label: "TRY AGAIN" },
  { color: "#7CC8B6", label: "15% OFF" },
  { color: "#E8568D", label: "FREE GIFT" },
];

function WheelDisc({ slices }) {
  const r = 100;
  const cx = 100;
  const cy = 100;
  const total = slices.length;
  const angle = 360 / total;
  const wedges = slices.map((s, i) => {
    const a0 = ((i * angle - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * angle - 90) * Math.PI) / 180;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const large = angle > 180 ? 1 : 0;
    const d = `M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
    const ma = ((i * angle + angle / 2 - 90) * Math.PI) / 180;
    const mx = cx + r * 0.62 * Math.cos(ma);
    const my = cy + r * 0.62 * Math.sin(ma);
    const rot = i * angle + angle / 2;
    return (
      <g key={i}>
        <path d={d} fill={s.color} stroke="#3A1A4B" strokeWidth="1.5" />
        <text
          x={mx}
          y={my}
          fill="#2A1B4E"
          fontFamily="Geist, sans-serif"
          fontWeight="700"
          fontSize="9"
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(${rot} ${mx} ${my})`}
        >
          {s.label}
        </text>
      </g>
    );
  });
  return (
    <svg className="tpl-wheel-svg" viewBox="0 0 200 200">
      {wedges}
      <circle cx={cx} cy={cy} r={r - 1} fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
    </svg>
  );
}

export function RenderWheel({ data, scale }) {
  const slices = data.slices && data.slices.length ? data.slices : WHEEL_DEFAULT_SLICES;
  return (
    <div className="tpl-wheel" style={{ transform: scale ? `scale(${scale})` : undefined }}>
      <div className="tpl-wheel-stars" />
      <button type="button" className="tpl-wheel-close" aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" fill="none" />
        </svg>
      </button>
      <div className="tpl-wheel-left">
        <div className="tpl-wheel-disc">
          <WheelDisc slices={slices} />
          <div className="tpl-wheel-hub" />
        </div>
        <div className="tpl-wheel-pointer" />
      </div>
      <div className="tpl-wheel-right">
        <div className="tpl-wheel-eyebrow">— {data.eyebrow || "one spin only"} —</div>
        <h2 className="tpl-wheel-h">{data.headline}</h2>
        <p className="tpl-wheel-p">{data.body}</p>
        <input className="tpl-wheel-input" placeholder={data.placeholder || "Your email address"} readOnly />
        <button type="button" className="tpl-wheel-btn">{data.cta}</button>
        <div className="tpl-wheel-fine">{data.fine}</div>
      </div>
    </div>
  );
}

export function EditorWheel({ data, onUpdate }) {
  const slices = data.slices && data.slices.length ? data.slices : WHEEL_DEFAULT_SLICES;
  const setSlice = (i, patch) => {
    const next = slices.map((s, j) => (j === i ? { ...s, ...patch } : s));
    onUpdate({ slices: next });
  };
  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Content</div>
        <TextField label="Eyebrow" value={data.eyebrow} onChange={(v) => onUpdate({ eyebrow: v })} />
        <TextField label="Headline" value={data.headline} onChange={(v) => onUpdate({ headline: v })} />
        <div className="rt-pop-field">
          <label className="field-label">Body</label>
          <textarea className="textarea" rows={3} value={data.body || ""} onChange={(e) => onUpdate({ body: e.target.value })} />
        </div>
        <TextField label="Email placeholder" value={data.placeholder} onChange={(v) => onUpdate({ placeholder: v })} />
        <TextField label="Spin button" value={data.cta} onChange={(v) => onUpdate({ cta: v })} />
        <TextField label="Fine print" value={data.fine} onChange={(v) => onUpdate({ fine: v })} />
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
              onChange={(e) => setSlice(i, { color: e.target.value })}
              style={{ border: "none", padding: 0, background: "transparent", cursor: "pointer" }}
            />
            <input className="input" value={s.label} onChange={(e) => setSlice(i, { label: e.target.value })} />
            <span className="t-small muted" style={{ textAlign: "right" }}>#{i + 1}</span>
          </div>
        ))}
      </div>
      <CommonTimingFields data={data} onUpdate={onUpdate} />
    </>
  );
}

export const wheelTemplate = {
  id: "wheel",
  name: "Lucky Day",
  vibe: "Gamified · Playful",
  oneliner: "Spin-to-win wheel with custom prize slices. Conversion machine — but use sparingly.",
  tags: ["Email capture", "Gamified", "High intent"],
  goal: "email_discount",
  Render: RenderWheel,
  Editor: EditorWheel,
  defaults: {
    template: "wheel",
    eyebrow: "one spin only",
    headline: "Take a chance.",
    body: "Drop your email, give the wheel a spin, and we'll send your prize within seconds.",
    placeholder: "Your email address",
    cta: "Spin the wheel",
    fine: "One spin per visitor. Prize codes valid for 7 days.",
    slices: WHEEL_DEFAULT_SLICES,
    discount: 15,
    trigger: "delay",
    delay: "7",
    frequency: "forever",
  },
};
