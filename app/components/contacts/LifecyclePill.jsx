import { LIFECYCLE } from "./constants.js";

export default function LifecyclePill({ stage, tooltip = true }) {
  const l = LIFECYCLE[stage];
  if (!l) return null;
  return (
    <span
      className="rt-pill rt-pill-lifecycle"
      style={{ background: l.bg, color: l.ink }}
      title={tooltip ? l.rule : undefined}
    >
      {l.label}
    </span>
  );
}
