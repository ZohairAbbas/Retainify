import { Link } from "react-router";
import Icons from "../ui/Icons.jsx";

// Live segments card. The loader passes in the segments this contact belongs
// to — static segments via SegmentMembership, dynamic via filter evaluation.
export default function SegmentsCard({ segments = [] }) {
  return (
    <div className="rt-rail-card">
      <div className="rt-rail-head">
        <span className="t-micro">Segments</span>
      </div>
      {segments.length === 0 ? (
        <div className="rt-rail-lockedbody">
          <Icons.Sliders size={14} />
          <div className="t-small muted">
            Not in any segments yet. Create one from Segments to start grouping contacts.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 4px 4px" }}>
          {segments.map((s) => (
            <Link
              key={s.id}
              to={`/app/segments/${s.id}`}
              className="rt-prev-used-flow"
              style={{ textDecoration: "none" }}
            >
              {s.kind === "static" ? (
                <Icons.Lock size={12} />
              ) : (
                <Icons.Sliders size={12} />
              )}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.name}
              </span>
              <span className="rt-prev-used-flow-status">{s.kind}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
