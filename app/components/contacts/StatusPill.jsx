import { STATUS } from "./constants.js";

export default function StatusPill({ status }) {
  // An unknown status still shows as itself rather than as a blank cell,
  // which read as "no status" and hid data problems.
  const s = STATUS[status] || (status
    ? { label: String(status).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), bg: "var(--paper-2)", ink: "var(--ink-3)" }
    : null);
  if (!s) return null;
  return (
    <span className="rt-pill rt-pill-status" style={{ background: s.bg, color: s.ink }}>
      <span className="rt-pill-dot" style={{ background: s.ink }} />
      {s.label}
    </span>
  );
}
