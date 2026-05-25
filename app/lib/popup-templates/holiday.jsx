import { useEffect, useRef, useState } from "react";
import { TextField, SelectField, PaletteRow, CommonTimingFields } from "./shared.jsx";

export const HOLIDAY_PALETTES = {
  pine:     { id: "pine",     label: "Pine",     bg: "linear-gradient(180deg, #1A2E1F 0%, #0F1F15 100%)", bgSolid: "#1A2E1F", ink: "#F1E8C7", accent: "#D4A35A", line: "rgba(241,232,199,0.18)", colors: ["#1A2E1F", "#D4A35A", "#F1E8C7"] },
  blush:    { id: "blush",    label: "Blush",    bg: "linear-gradient(180deg, #4A1A2E 0%, #2E0F1F 100%)", bgSolid: "#4A1A2E", ink: "#FCE6D6", accent: "#E89B7A", line: "rgba(252,230,214,0.18)", colors: ["#4A1A2E", "#E89B7A", "#FCE6D6"] },
  midnight: { id: "midnight", label: "Midnight", bg: "linear-gradient(180deg, #1A1F3A 0%, #0F1226 100%)", bgSolid: "#1A1F3A", ink: "#D8E1F5", accent: "#C5A86A", line: "rgba(216,225,245,0.18)", colors: ["#1A1F3A", "#C5A86A", "#D8E1F5"] },
  ember:    { id: "ember",    label: "Ember",    bg: "linear-gradient(180deg, #3A1810 0%, #1F0A06 100%)", bgSolid: "#3A1810", ink: "#FBD9A5", accent: "#E07A2C", line: "rgba(251,217,165,0.18)", colors: ["#3A1810", "#E07A2C", "#FBD9A5"] },
};

function useCountdown(targetHours) {
  const [now, setNow] = useState(() => Date.now());
  const targetRef = useRef(Date.now() + targetHours * 3600 * 1000);
  useEffect(() => {
    targetRef.current = Date.now() + targetHours * 3600 * 1000;
  }, [targetHours]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, targetRef.current - now);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return { h: pad(h), m: pad(m), s: pad(s) };
}

export function RenderHoliday({ data, scale }) {
  const p = HOLIDAY_PALETTES[data.palette] || HOLIDAY_PALETTES.pine;
  const c = useCountdown(parseInt(data.countdownHours || 24, 10));
  return (
    <div
      className="tpl-holiday"
      style={{
        "--hd-bg": p.bg,
        "--hd-bg-solid": p.bgSolid,
        "--hd-ink": p.ink,
        "--hd-accent": p.accent,
        "--hd-line": p.line,
        transform: scale ? `scale(${scale})` : undefined,
      }}
    >
      <button type="button" className="tpl-holiday-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14">
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </button>
      <div className="tpl-holiday-wreath" />
      <div className="tpl-holiday-body">
        <div className="tpl-holiday-eyebrow">{data.eyebrow}</div>
        <h2 className="tpl-holiday-h" dangerouslySetInnerHTML={{ __html: data.headline || "" }} />
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
          <input className="tpl-holiday-input" placeholder={data.placeholder || "your@email.com"} readOnly />
          <button type="button" className="tpl-holiday-btn">{data.cta}</button>
        </div>
        <div className="tpl-holiday-fine">{data.fine}</div>
      </div>
    </div>
  );
}

export function EditorHoliday({ data, onUpdate }) {
  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Content</div>
        <TextField label="Eyebrow" value={data.eyebrow} onChange={(v) => onUpdate({ eyebrow: v })} />
        <TextField label="Headline" value={data.headline} onChange={(v) => onUpdate({ headline: v })} help="Use <em>…</em> for italic accent words." />
        <div className="rt-pop-field">
          <label className="field-label">Body</label>
          <textarea className="textarea" rows={2} value={data.body || ""} onChange={(e) => onUpdate({ body: e.target.value })} />
        </div>
        <TextField label="Email placeholder" value={data.placeholder} onChange={(v) => onUpdate({ placeholder: v })} />
        <TextField label="Button label" value={data.cta} onChange={(v) => onUpdate({ cta: v })} />
        <TextField label="Fine print" value={data.fine} onChange={(v) => onUpdate({ fine: v })} />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Countdown</div>
        <SelectField
          label="Countdown duration"
          value={String(data.countdownHours || 24)}
          onChange={(v) => onUpdate({ countdownHours: +v })}
          options={[
            { value: "1", label: "1 hour (flash sale)" },
            { value: "6", label: "6 hours" },
            { value: "12", label: "12 hours" },
            { value: "24", label: "24 hours" },
            { value: "48", label: "48 hours" },
            { value: "72", label: "72 hours" },
          ]}
          help="Counts down live for each visitor — resets if they return after expiry."
        />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Palette</div>
        <PaletteRow
          label="Color palette"
          value={data.palette}
          onChange={(v) => onUpdate({ palette: v })}
          options={Object.values(HOLIDAY_PALETTES)}
        />
      </div>
      <CommonTimingFields data={data} onUpdate={onUpdate} />
    </>
  );
}

export const holidayTemplate = {
  id: "holiday",
  name: "Last Call",
  vibe: "Seasonal · Urgent",
  oneliner: "Countdown timer, exit-intent ready. Perfect for holiday campaigns and winbacks.",
  tags: ["Exit intent", "Countdown", "Seasonal"],
  goal: "exit_winback",
  Render: RenderHoliday,
  Editor: EditorHoliday,
  defaults: {
    template: "holiday",
    eyebrow: "Before you go",
    headline: "Don't leave <em>empty-handed.</em>",
    body: "A parting gift: 20% off your first order. The code expires when the clock does.",
    placeholder: "your@email.com",
    cta: "Claim 20% off",
    fine: "One-time use. Cannot be combined with other offers.",
    palette: "pine",
    countdownHours: 24,
    discount: 20,
    trigger: "exit",
    delay: "0",
    frequency: "week",
  },
};
