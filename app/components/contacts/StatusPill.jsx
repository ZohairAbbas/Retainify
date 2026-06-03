import { STATUS } from "./constants.js";

export default function StatusPill({ status }) {
  const s = STATUS[status];
  if (!s) return null;
  return (
    <span className="rt-pill rt-pill-status" style={{ background: s.bg, color: s.ink }}>
      <span className="rt-pill-dot" style={{ background: s.ink }} />
      {s.label}
    </span>
  );
}
