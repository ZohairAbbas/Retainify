import { TextField, SwatchRowWithCustom, GradientRowWithCustom, CommonTimingFields } from "./shared.jsx";

export const EDITORIAL_IMAGES = {
  amber: "linear-gradient(135deg, #8B7355 0%, #5A4632 100%)",
  rose: "linear-gradient(135deg, #C09080 0%, #7A4F45 100%)",
  forest: "linear-gradient(135deg, #6B7A6F 0%, #3A4A40 100%)",
  ink: "linear-gradient(135deg, #4A4632 0%, #1F1A12 100%)",
};

export const EDITORIAL_ACCENTS = {
  burgundy: "#8C3A2A",
  forest: "#2E5240",
  cobalt: "#2A4A8C",
  rust: "#A85A2E",
};

export function RenderEditorial({ data, scale }) {
  const img = data.image === "custom" && data.imageCustom?.from && data.imageCustom?.to
    ? `linear-gradient(135deg, ${data.imageCustom.from} 0%, ${data.imageCustom.to} 100%)`
    : (EDITORIAL_IMAGES[data.image] || EDITORIAL_IMAGES.amber);
  const accent = data.accent === "custom" && data.accentCustom
    ? data.accentCustom
    : (EDITORIAL_ACCENTS[data.accent] || EDITORIAL_ACCENTS.burgundy);
  return (
    <div
      className="tpl-editorial"
      style={{
        "--ed-img": img,
        "--ed-accent": accent,
        transform: scale ? `scale(${scale})` : undefined,
      }}
    >
      <div className="tpl-editorial-img">
        <div className="tpl-editorial-mast">{data.masthead || "NORTHHILL & CO."}</div>
      </div>
      <div className="tpl-editorial-body">
        <button type="button" className="tpl-editorial-close" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        </button>
        <div className="tpl-editorial-rule">An invitation · {data.discount}% off</div>
        <h2 className="tpl-editorial-h" dangerouslySetInnerHTML={{ __html: data.headline || "" }} />
        <p className="tpl-editorial-p">{data.body}</p>
        <input className="tpl-editorial-input" placeholder={data.placeholder || "your address"} readOnly />
        <button type="button" className="tpl-editorial-btn">
          {data.cta} <span aria-hidden>→</span>
        </button>
        <div className="tpl-editorial-fine">{data.fine}</div>
      </div>
    </div>
  );
}

export function EditorEditorial({ data, onUpdate }) {
  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Content</div>
        <TextField label="Masthead (top of image)" value={data.masthead} onChange={(v) => onUpdate({ masthead: v })} />
        <TextField
          label="Headline"
          value={data.headline}
          onChange={(v) => onUpdate({ headline: v })}
          help="Use <em>…</em> for italic accent words."
        />
        <div className="rt-pop-field">
          <label className="field-label">Body</label>
          <textarea
            className="textarea"
            rows={3}
            value={data.body || ""}
            onChange={(e) => onUpdate({ body: e.target.value })}
          />
        </div>
        <TextField label="Email placeholder" value={data.placeholder} onChange={(v) => onUpdate({ placeholder: v })} />
        <TextField label="Button label" value={data.cta} onChange={(v) => onUpdate({ cta: v })} />
        <TextField label="Fine print" value={data.fine} onChange={(v) => onUpdate({ fine: v })} />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Style</div>
        <GradientRowWithCustom
          label="Hero image"
          value={data.image}
          onChange={(v) => onUpdate({ image: v })}
          options={Object.entries(EDITORIAL_IMAGES).map(([k, v]) => ({ value: k, color: v, label: k }))}
          customValue={data.imageCustom}
          onCustomChange={(v) => onUpdate({ imageCustom: v })}
          help="Pick a preset, or choose Custom for your own gradient."
        />
        <SwatchRowWithCustom
          label="Accent color"
          value={data.accent}
          onChange={(v) => onUpdate({ accent: v })}
          options={Object.entries(EDITORIAL_ACCENTS).map(([k, c]) => ({ value: k, color: c, label: k }))}
          customValue={data.accentCustom}
          onCustomChange={(v) => onUpdate({ accentCustom: v })}
        />
      </div>
      <CommonTimingFields data={data} onUpdate={onUpdate} />
    </>
  );
}

export const editorialTemplate = {
  id: "editorial",
  name: "Le Salon",
  vibe: "Editorial · Quiet",
  oneliner: "A magazine-shop invitation, set in serif. For fashion, beauty & curated lifestyle brands.",
  tags: ["Email capture", "Serif", "Refined"],
  goal: "email_discount",
  Render: RenderEditorial,
  Editor: EditorEditorial,
  defaults: {
    template: "editorial",
    masthead: "NORTHHILL & CO.",
    headline: "An <em>invitation,</em><br/>from us to you.",
    body: "Take 15% off your first order. Plus dispatches twice a month — beautiful things, no noise.",
    placeholder: "your address",
    cta: "Send my code",
    fine: "By subscribing you agree to receive marketing emails. Unsubscribe anytime.",
    image: "amber",
    accent: "burgundy",
    discount: 15,
    trigger: "delay",
    delay: "7",
    frequency: "session",
  },
};
