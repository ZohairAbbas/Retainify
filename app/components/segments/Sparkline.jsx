// Tiny inline SVG sparkline. Defaults are sized for table rows; pass `w/h`
// for the larger preview-pane variant.
export default function Sparkline({ values, w = 60, h = 18, stroke = "var(--brand-700)" }) {
  if (!values || values.length < 2) {
    return (
      <svg width={w} height={h} className="rt-seg-spark">
        <line x1={0} y1={h - 1} x2={w} y2={h - 1} stroke="var(--hair-2)" strokeWidth={1} />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(h - ((v - min) / range) * (h - 2) - 1).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="rt-seg-spark">
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
