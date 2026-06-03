import Icons from "../ui/Icons.jsx";
import { relativeTime } from "./constants.js";
import EmptyTab from "./EmptyTab.jsx";

export default function PushesTable({ rows }) {
  if (!rows.length) {
    return (
      <EmptyTab
        icon="Bell"
        title="No push notifications yet"
        body="Push notifications sent to this contact will appear here."
      />
    );
  }
  return (
    <div className="rt-subtable rt-sub5">
      <div className="rt-subhead">
        <div>Date</div>
        <div>Title</div>
        <div>Body</div>
        <div>Delivered</div>
        <div>Clicked</div>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="rt-subrow">
          <div className="rt-tdate">{relativeTime(r.date)}</div>
          <div>
            <span className="rt-tl-quote">“{r.title || "(no title)"}”</span>
          </div>
          <div className="muted">{r.body || "—"}</div>
          <div>
            {r.delivered ? (
              <span className="rt-yes">
                <Icons.Check size={12} />
              </span>
            ) : (
              <span className="muted">—</span>
            )}
          </div>
          <div>
            {r.clicked ? (
              <span className="rt-yes">
                <Icons.Check size={12} />
              </span>
            ) : (
              <span className="muted">—</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
