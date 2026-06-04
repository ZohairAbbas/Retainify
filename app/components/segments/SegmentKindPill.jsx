export default function SegmentKindPill({ kind, system = false }) {
  if (system) {
    return (
      <span className="pill" style={{ background: "var(--paper-2)", color: "var(--ink-3)" }}>
        System
      </span>
    );
  }
  const cls = kind === "static" ? "rt-seg-kind-pill rt-seg-kind-static" : "rt-seg-kind-pill rt-seg-kind-dynamic";
  return <span className={cls}>{kind === "static" ? "Static" : "Dynamic"}</span>;
}
