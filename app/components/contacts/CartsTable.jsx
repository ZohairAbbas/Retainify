import { fmtMoney, relativeTime } from "./constants.js";
import EmptyTab from "./EmptyTab.jsx";

export default function CartsTable({ rows }) {
  if (!rows.length) {
    return (
      <EmptyTab
        icon="Cart"
        title="No carts yet"
        body="Abandoned and recovered carts will show up here."
      />
    );
  }
  return (
    <div className="rt-subtable rt-sub4">
      <div className="rt-subhead">
        <div>Date</div>
        <div>Items</div>
        <div className="rt-tnum">Value</div>
        <div>Status</div>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="rt-subrow">
          <div className="rt-tdate">{relativeTime(r.date)}</div>
          <div>{r.items || <span className="muted">—</span>}</div>
          <div className="rt-tnum">
            <strong>{fmtMoney(r.value)}</strong>
          </div>
          <div>
            <span
              className={`rt-pill ${
                r.status === "Recovered" ? "rt-pill-success" : "rt-pill-warn"
              }`}
            >
              <span className="rt-pill-dot" />
              {r.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
