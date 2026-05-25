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
