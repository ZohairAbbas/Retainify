export default function StatCard({ label, value, unit, sub, feature }) {
  return (
    <div className={`rt-stat ${feature ? "rt-stat-feature" : ""}`}>
      <div className="t-micro muted" style={feature ? { color: "var(--accent-ink)" } : null}>
        {label}
      </div>
      <div className="rt-stat-value" style={feature ? { color: "var(--brand-ink)" } : null}>
        {value}
        {unit && <span className="rt-stat-unit">{unit}</span>}
      </div>
      <div className="rt-stat-delta" style={feature ? { color: "var(--brand-600)" } : null}>
        {sub}
      </div>
    </div>
  );
}
