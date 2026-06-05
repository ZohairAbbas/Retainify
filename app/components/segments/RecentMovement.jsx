import { Link } from "react-router";
import Avatar from "../contacts/Avatar.jsx";
import { relativeTime } from "../contacts/constants.js";

// Renders the "Recently entered" / "Recently left" cards on the segment
// detail Activity tab. Backed by SegmentEntryLog rows from the loader.
export default function RecentMovement({ title, rows, kind }) {
  return (
    <div className="rt-sd-act-card">
      <div className="rt-sd-act-title">{title}</div>
      {rows.length === 0 ? (
        <div className="t-small muted">No activity in the last 7 days.</div>
      ) : (
        <div className="rt-prev-samples">
          {rows.map((r) => (
            <Link
              key={r.id}
              to={`/app/contacts/${r.contactId}`}
              className="rt-prev-sample"
              style={{ textDecoration: "none" }}
            >
              <Avatar name={r.name} email={r.email} size={20} />
              <span className="rt-prev-sample-email">{r.email}</span>
              <span className="rt-prev-sample-meta">
                {relativeTime(kind === "entered" ? r.enteredAt : r.leftAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
