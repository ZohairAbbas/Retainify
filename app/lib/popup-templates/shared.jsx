export function TextField({ label, value, onChange, help, type = "text" }) {
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <input className="input" type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} />
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}

export function SwatchRow({ label, value, onChange, options, help }) {
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <div className="rt-pop-swatch-row">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`rt-pop-swatch ${value === opt.value ? "is-on" : ""}`}
            style={{ background: opt.color || opt.value }}
            onClick={() => onChange(opt.value)}
            title={opt.label || ""}
          />
        ))}
      </div>
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}

export function PaletteRow({ label, value, onChange, options }) {
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`rt-pop-swatch-pal ${value === opt.id ? "is-on" : ""}`}
            onClick={() => onChange(opt.id)}
            title={opt.label}
          >
            {opt.colors.map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SegField({ label, value, onChange, options }) {
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <div className="rt-pop-seg">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={value === o.value ? "rt-on" : ""}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SelectField({ label, value, onChange, options, help }) {
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}

// Single-color swatch row with an extra "Custom" tile that, when active,
// reveals an inline color picker. `customField` is the key on `data` that
// stores the merchant's custom hex when `value === "custom"`.
export function SwatchRowWithCustom({ label, value, onChange, options, help, customValue, onCustomChange }) {
  const isCustom = value === "custom";
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <div className="rt-pop-swatch-row">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`rt-pop-swatch ${value === opt.value ? "is-on" : ""}`}
            style={{ background: opt.color || opt.value }}
            onClick={() => onChange(opt.value)}
            title={opt.label || ""}
          />
        ))}
        <button
          type="button"
          className={`rt-pop-swatch rt-pop-swatch-custom ${isCustom ? "is-on" : ""}`}
          style={{ background: isCustom && customValue ? customValue : "conic-gradient(from 180deg, #ff5757, #ffd93d, #4ecdc4, #845ec2, #ff5757)" }}
          onClick={() => onChange("custom")}
          title="Custom color"
        />
      </div>
      {isCustom && (
        <div className="rt-pop-custom-row" style={{ marginTop: 8 }}>
          <input
            type="color"
            value={customValue || "#000000"}
            onChange={(e) => onCustomChange(e.target.value)}
          />
          <input
            className="input"
            value={customValue || ""}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder="#000000"
          />
        </div>
      )}
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}

// Multi-color palette row with a "+" Custom tile that expands inline pickers
// for each named slot (e.g. ["bg","ink","shadow"] for brutalist).
// `customValue` is an object `{ [slot]: hexString }`.
export function PaletteRowWithCustom({ label, value, onChange, options, slots, customValue, onCustomChange }) {
  const isCustom = value === "custom";
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`rt-pop-swatch-pal ${value === opt.id ? "is-on" : ""}`}
            onClick={() => onChange(opt.id)}
            title={opt.label}
          >
            {opt.colors.map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </button>
        ))}
        <button
          type="button"
          className={`rt-pop-swatch-pal rt-pop-swatch-pal-custom ${isCustom ? "is-on" : ""}`}
          onClick={() => onChange("custom")}
          title="Custom palette"
        >
          <span style={{ background: "conic-gradient(from 180deg, #ff5757, #ffd93d, #4ecdc4, #845ec2, #ff5757)" }} />
        </button>
      </div>
      {isCustom && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {slots.map((slot) => (
            <div key={slot.key} className="rt-pop-custom-row">
              <input
                type="color"
                value={customValue?.[slot.key] || "#000000"}
                onChange={(e) => onCustomChange({ ...customValue, [slot.key]: e.target.value })}
              />
              <input
                className="input"
                value={customValue?.[slot.key] || ""}
                onChange={(e) => onCustomChange({ ...customValue, [slot.key]: e.target.value })}
                placeholder={slot.placeholder || "#000000"}
              />
              <span className="t-small muted">{slot.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Two-color gradient picker — start + end. `customValue` = { from, to }.
export function GradientRowWithCustom({ label, value, onChange, options, customValue, onCustomChange, help }) {
  const isCustom = value === "custom";
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <div className="rt-pop-swatch-row">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`rt-pop-swatch ${value === opt.value ? "is-on" : ""}`}
            style={{ background: opt.color || opt.value }}
            onClick={() => onChange(opt.value)}
            title={opt.label || ""}
          />
        ))}
        <button
          type="button"
          className={`rt-pop-swatch rt-pop-swatch-custom ${isCustom ? "is-on" : ""}`}
          style={{
            background: isCustom && customValue?.from && customValue?.to
              ? `linear-gradient(135deg, ${customValue.from} 0%, ${customValue.to} 100%)`
              : "conic-gradient(from 180deg, #ff5757, #ffd93d, #4ecdc4, #845ec2, #ff5757)",
          }}
          onClick={() => onChange("custom")}
          title="Custom gradient"
        />
      </div>
      {isCustom && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          <div className="rt-pop-custom-row">
            <input
              type="color"
              value={customValue?.from || "#8B7355"}
              onChange={(e) => onCustomChange({ ...customValue, from: e.target.value })}
            />
            <input
              className="input"
              value={customValue?.from || ""}
              onChange={(e) => onCustomChange({ ...customValue, from: e.target.value })}
              placeholder="#8B7355"
            />
            <span className="t-small muted">Start</span>
          </div>
          <div className="rt-pop-custom-row">
            <input
              type="color"
              value={customValue?.to || "#5A4632"}
              onChange={(e) => onCustomChange({ ...customValue, to: e.target.value })}
            />
            <input
              className="input"
              value={customValue?.to || ""}
              onChange={(e) => onCustomChange({ ...customValue, to: e.target.value })}
              placeholder="#5A4632"
            />
            <span className="t-small muted">End</span>
          </div>
        </div>
      )}
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}

export function CommonTimingFields({ data, onUpdate }) {
  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Trigger</div>
        <SelectField
          label="Show popup when…"
          value={data.trigger || "delay"}
          onChange={(v) => onUpdate({ trigger: v })}
          options={[
            { value: "delay", label: "After a time delay" },
            { value: "scroll", label: "After scrolling 50%" },
            { value: "exit", label: "On exit intent (desktop)" },
          ]}
        />
        {data.trigger !== "exit" && (
          <SelectField
            label="Delay"
            value={String(data.delay ?? "3")}
            onChange={(v) => onUpdate({ delay: v })}
            options={[
              { value: "0", label: "Immediately" },
              { value: "3", label: "3 seconds" },
              { value: "7", label: "7 seconds" },
              { value: "15", label: "15 seconds" },
              { value: "30", label: "30 seconds" },
            ]}
          />
        )}
        <SelectField
          label="Frequency"
          value={data.frequency || "session"}
          onChange={(v) => onUpdate({ frequency: v })}
          options={[
            { value: "session", label: "Once per session" },
            { value: "day", label: "Once per day" },
            { value: "week", label: "Once per week" },
            { value: "forever", label: "Once per visitor (ever)" },
          ]}
        />
      </div>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">Discount</div>
        <SelectField
          label="Discount percentage"
          value={String(data.discount ?? 10)}
          onChange={(v) => onUpdate({ discount: +v })}
          options={[5, 10, 15, 20, 25].map((n) => ({ value: String(n), label: `${n}%` }))}
          help="Auto-generated single-use code is sent after email confirmation."
        />
      </div>
    </>
  );
}
