import { TextField, SegField, CommonTimingFields } from "./shared.jsx";

export const STICKER_S1_OPTIONS = ["10%", "NEW!", "HEY", "✿"];
export const STICKER_S2_OPTIONS = ["❤", "!!", "★", "+"];
export const STICKER_S3_OPTIONS = ["YES", "GO!", "✓", "✿"];

export function RenderSticker({ data, scale }) {
  const confetti = [
    { c: "#FF6B6B", x: 12, y: 10, r: 8 },
    { c: "#4ECDC4", x: 88, y: 18, r: -14 },
    { c: "#FFD93D", x: 22, y: 80, r: -8 },
    { c: "#95D8B0", x: 80, y: 88, r: 14 },
    { c: "#FF6B6B", x: 6, y: 50, r: 4 },
    { c: "#4ECDC4", x: 92, y: 60, r: -4 },
  ];
  return (
    <div className="tpl-sticker" style={{ transform: scale ? `scale(${scale})` : undefined }}>
      <div className="tpl-sticker-confetti">
        {confetti.map((c, i) => (
          <span
            key={i}
            style={{
              left: `${c.x}%`,
              top: `${c.y}%`,
              width: 8,
              height: 8,
              background: c.c,
              borderRadius: 2,
              transform: `rotate(${c.r}deg)`,
            }}
          />
        ))}
      </div>
      <div className="tpl-sticker-tape" />
      <button type="button" className="tpl-sticker-close" aria-label="Close">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      <div className="tpl-sticker-sticker tpl-sticker-s1">{data.sticker1 || "10%"}</div>
      <div className="tpl-sticker-sticker tpl-sticker-s2">{data.sticker2 || "❤"}</div>
      <div className="tpl-sticker-sticker tpl-sticker-s3">{data.sticker3 || "YES"}</div>
      <div className="tpl-sticker-eyebrow">{data.eyebrow}</div>
      <h2 className="tpl-sticker-h" dangerouslySetInnerHTML={{ __html: data.headline || "" }} />
      <p className="tpl-sticker-p">{data.body}</p>
      <input className="tpl-sticker-input" placeholder={data.placeholder || "Drop your email here"} readOnly />
      <button type="button" className="tpl-sticker-btn">{data.cta}</button>
      <div className="tpl-sticker-fine">{data.fine}</div>
    </div>
  );
}

export function EditorSticker({ data, onUpdate }) {
  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Content</div>
        <TextField label="Eyebrow" value={data.eyebrow} onChange={(v) => onUpdate({ eyebrow: v })} />
        <TextField
          label="Headline"
          value={data.headline}
          onChange={(v) => onUpdate({ headline: v })}
          help="Use <span class='accent'>…</span> for colored words."
        />
        <div className="rt-pop-field">
          <label className="field-label">Body</label>
          <textarea className="textarea" rows={2} value={data.body || ""} onChange={(e) => onUpdate({ body: e.target.value })} />
        </div>
        <TextField label="Email placeholder" value={data.placeholder} onChange={(v) => onUpdate({ placeholder: v })} />
        <TextField label="Button label" value={data.cta} onChange={(v) => onUpdate({ cta: v })} />
        <TextField label="Fine print" value={data.fine} onChange={(v) => onUpdate({ fine: v })} />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Stickers</div>
        <SegField
          label="Top-right sticker"
          value={data.sticker1}
          onChange={(v) => onUpdate({ sticker1: v })}
          options={STICKER_S1_OPTIONS.map((o) => ({ value: o, label: o }))}
        />
        <SegField
          label="Bottom-left sticker"
          value={data.sticker2}
          onChange={(v) => onUpdate({ sticker2: v })}
          options={STICKER_S2_OPTIONS.map((o) => ({ value: o, label: o }))}
        />
        <SegField
          label="Right-edge sticker"
          value={data.sticker3}
          onChange={(v) => onUpdate({ sticker3: v })}
          options={STICKER_S3_OPTIONS.map((o) => ({ value: o, label: o }))}
        />
      </div>
      <CommonTimingFields data={data} onUpdate={onUpdate} />
    </>
  );
}

export const stickerTemplate = {
  id: "sticker",
  name: "Sticker Drop",
  vibe: "Playful · Hand-drawn",
  oneliner: "Confetti and tape and handwriting. For food, kids, indie makers — anyone with personality.",
  tags: ["Email capture", "Illustrated", "Friendly"],
  goal: "email_discount",
  Render: RenderSticker,
  Editor: EditorSticker,
  defaults: {
    template: "sticker",
    eyebrow: "PSST — HEY YOU",
    headline: "Hiya, <span class=\"accent\">friend!</span>",
    body: "10% off your first order because we like your taste. Hit us up below.",
    placeholder: "Drop your email here",
    cta: "Yes please!",
    fine: "No spam. Unsubscribe anytime. Promise.",
    sticker1: "10%",
    sticker2: "❤",
    sticker3: "YES",
    discount: 10,
    trigger: "delay",
    delay: "3",
    frequency: "session",
  },
};
