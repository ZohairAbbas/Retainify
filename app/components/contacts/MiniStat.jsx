export default function MiniStat({ label, value, sub }) {
  return (
    <div className="rt-mstat">
      <div className="t-micro muted">{label}</div>
      <div className="rt-mstat-value">{value}</div>
      {sub && <div className="rt-mstat-sub muted">{sub}</div>}
    </div>
  );
}
