import Icons from "../ui/Icons.jsx";
import { relativeTime } from "./constants.js";
import EmptyTab from "./EmptyTab.jsx";

export default function EmailsTable({ rows }) {
  if (!rows.length) {
    return (
      <EmptyTab
        icon="Mail"
        title="No emails sent yet"
        body="Sent emails will appear here as soon as a journey reaches this contact."
      />
    );
  }
  return (
    <div className="rt-subtable rt-sub5">
      <div className="rt-subhead">
        <div>Date</div>
        <div>Subject</div>
        <div>Journey</div>
        <div>Opened</div>
        <div>Clicked</div>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="rt-subrow">
          <div className="rt-tdate">{relativeTime(r.date)}</div>
          <div>
            <span className="rt-tl-quote">“{r.subject || "(no subject)"}”</span>
          </div>
          <div className="muted">{r.journey || "—"}</div>
          <div>
            {r.opened ? (
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
