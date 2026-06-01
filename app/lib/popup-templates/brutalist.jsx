import { TextField, PaletteRowWithCustom, CommonTimingFields } from "./shared.jsx";

export const BRUTAL_PALETTES = {
  acid:     { id: "acid",     label: "Acid",     bg: "#0E0E0E", ink: "#E5FF36", shadow: "#E5FF36", colors: ["#0E0E0E", "#E5FF36"] },
  inferno:  { id: "inferno",  label: "Inferno",  bg: "#FF3D2E", ink: "#FFF1E0", shadow: "#0E0E0E", colors: ["#FF3D2E", "#FFF1E0", "#0E0E0E"] },
  electric: { id: "electric", label: "Electric", bg: "#1B2BFF", ink: "#FFF",    shadow: "#FFEE00", colors: ["#1B2BFF", "#FFEE00", "#FFF"] },
  mint:     { id: "mint",     label: "Mint",     bg: "#F0F0E8", ink: "#0E0E0E", shadow: "#3DBF7C", colors: ["#F0F0E8", "#0E0E0E", "#3DBF7C"] },
};

function resolveBrutalPalette(data) {
  if (data.palette === "custom" && data.paletteCustom) {
    return {
      bg: data.paletteCustom.bg || "#0E0E0E",
      ink: data.paletteCustom.ink || "#E5FF36",
      shadow: data.paletteCustom.shadow || data.paletteCustom.ink || "#E5FF36",
    };
  }
  return BRUTAL_PALETTES[data.palette] || BRUTAL_PALETTES.acid;
}

export function RenderBrutal({ data, scale }) {
  const p = resolveBrutalPalette(data);
  const marqueeText = data.marqueeText || "FREE SHIPPING · NEW DROPS WEEKLY · MEMBERS ONLY · ";
  return (
    <div
      className="tpl-brutal"
      style={{
        "--br-bg": p.bg,
        "--br-ink": p.ink,
        "--br-shadow": p.shadow,
        transform: scale ? `scale(${scale})` : undefined,
      }}
    >
      <button type="button" className="tpl-brutal-close" aria-label="Close">×</button>
      <div className="tpl-brutal-marquee">
        <div className="tpl-brutal-marquee-inner">
          <span>{marqueeText.repeat(4)}</span>
          <span>{marqueeText.repeat(4)}</span>
        </div>
      </div>
      <div className="tpl-brutal-body">
        <span className="tpl-brutal-eyebrow">{data.eyebrow || "STOP RIGHT THERE"}</span>
        <h2 className="tpl-brutal-h">
          {data.headline}
          <span className="pct">{data.discount}</span>
        </h2>
        <div className="tpl-brutal-sub">{data.sub}</div>
        <div className="tpl-brutal-form">
          <input className="tpl-brutal-input" placeholder="EMAIL@HERE.COM" readOnly />
          <button type="button" className="tpl-brutal-btn">{data.cta}</button>
        </div>
        <div className="tpl-brutal-fine">{data.fine}</div>
      </div>
      {data.cornerTag && <div className="corner-tag">{data.cornerTag}</div>}
    </div>
  );
}

export function EditorBrutal({ data, onUpdate }) {
  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Content</div>
        <TextField label="Marquee text" value={data.marqueeText} onChange={(v) => onUpdate({ marqueeText: v })} help="Repeats forever. Keep short." />
        <TextField label="Eyebrow" value={data.eyebrow} onChange={(v) => onUpdate({ eyebrow: v })} />
        <TextField label="Headline" value={data.headline} onChange={(v) => onUpdate({ headline: v })} help="The big number renders after. E.g. 'TAKE' + 15" />
        <div className="rt-pop-field">
          <label className="field-label">Subtitle</label>
          <textarea className="textarea" rows={2} value={data.sub || ""} onChange={(e) => onUpdate({ sub: e.target.value })} />
        </div>
        <TextField label="Button label" value={data.cta} onChange={(v) => onUpdate({ cta: v })} />
        <TextField label="Corner tag (optional)" value={data.cornerTag} onChange={(v) => onUpdate({ cornerTag: v })} />
        <TextField label="Fine print" value={data.fine} onChange={(v) => onUpdate({ fine: v })} />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Palette</div>
        <PaletteRowWithCustom
          label="Color combo"
          value={data.palette}
          onChange={(v) => onUpdate({ palette: v })}
          options={Object.values(BRUTAL_PALETTES)}
          slots={[
            { key: "bg", label: "Background", placeholder: "#0E0E0E" },
            { key: "ink", label: "Ink / accent", placeholder: "#E5FF36" },
            { key: "shadow", label: "Shadow", placeholder: "#E5FF36" },
          ]}
          customValue={data.paletteCustom}
          onCustomChange={(v) => onUpdate({ paletteCustom: v })}
        />
      </div>
      <CommonTimingFields data={data} onUpdate={onUpdate} />
    </>
  );
}

export const brutalistTemplate = {
  id: "brutalist",
  name: "MEGA15",
  vibe: "Bold · Brutalist",
  oneliner: "High-contrast, hits like a poster. For streetwear, design tools, anything loud.",
  tags: ["Email capture", "Display type", "High contrast"],
  goal: "email_discount",
  Render: RenderBrutal,
  Editor: EditorBrutal,
  defaults: {
    template: "brutalist",
    marqueeText: "FREE SHIPPING · NEW DROPS WEEKLY · MEMBERS ONLY · ",
    eyebrow: "STOP RIGHT THERE.",
    headline: "TAKE ",
    sub: "Off your first order. No spam. Cancel whenever. Members get first dibs on every drop.",
    cta: "GET IT",
    cornerTag: "TODAY ONLY",
    fine: "BY SUBSCRIBING YOU AGREE TO RECEIVE MARKETING EMAILS.",
    palette: "acid",
    discount: 15,
    trigger: "delay",
    delay: "3",
    frequency: "session",
  },
};
