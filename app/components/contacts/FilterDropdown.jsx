import { useState } from "react";
import Icons from "../ui/Icons.jsx";

export default function FilterDropdown({ label, options, value, onChange, icon }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);
  const active = value && value !== "all";
  const IconComp = icon ? Icons[icon] : null;
  return (
    <div className="rt-fdrop">
      <button
        type="button"
        className={`rt-chip ${active ? "rt-chip-on" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        {IconComp && <IconComp size={13} />}
        <span>{active ? selected?.label : label}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="rt-veil" onClick={() => setOpen(false)} />
          <div className="rt-fdrop-menu">
            {options.map((o) => (
              <button
                type="button"
                key={o.id}
                className={`rt-fdrop-item ${value === o.id ? "rt-on" : ""}`}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
              >
                {o.swatch && (
                  <span className="rt-fdrop-swatch" style={{ background: o.swatch }} />
                )}
                <span>{o.label}</span>
                {o.count != null && <span className="rt-fdrop-count">{o.count}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
