import { LIFECYCLE, LIFECYCLE_ORDER } from "./constants.js";

export default function LifecycleJourney({ stage }) {
  const idx = LIFECYCLE_ORDER.indexOf(stage);
  return (
    <div className="rt-journey">
      <div className="rt-journey-track">
        {LIFECYCLE_ORDER.map((s, i) => {
          const l = LIFECYCLE[s];
          const on = i === idx;
          const passed = i < idx;
          return (
            <div
              key={s}
              className={`rt-journey-stop ${on ? "rt-on" : ""} ${passed ? "rt-passed" : ""}`}
            >
              <div
                className="rt-journey-dot"
                style={on ? { background: l.ink, color: l.bg } : undefined}
              >
                {on && <span className="rt-journey-dot-inner" />}
              </div>
              <div className="rt-journey-label" title={l.rule}>
                {l.label}
              </div>
            </div>
          );
        })}
        <div className="rt-journey-line" />
        <div
          className="rt-journey-line-fill"
          style={{
            width: `${(Math.max(0, idx) / (LIFECYCLE_ORDER.length - 1)) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}
