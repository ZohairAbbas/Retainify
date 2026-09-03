import Icons from "../ui/Icons.jsx";
import { EVENT_VISUALS, EVENT_LABEL, fmtMoney, relativeTime } from "./constants.js";

export default function TimelineEvent({ event, last }) {
  const vis = EVENT_VISUALS[event.kind] || { icon: "Bolt", tint: "delay" };
  const Icon = Icons[vis.icon] || Icons.Bolt;
  const p = event.payload || {};

  let context = null;
  switch (event.kind) {
    case "email_sent":
    case "email_opened":
    case "email_clicked":
      context = (
        <>
          Subject: <span className="rt-tl-quote">“{p.subject || "(no subject)"}”</span>
          {p.journey && (
            <>
              {" · "}
              <span className="muted">{p.journey}</span>
            </>
          )}
        </>
      );
      break;
    case "order_placed":
      context = (
        <>
          Order {p.order} · {p.items} · <strong>{fmtMoney(p.total)}</strong>
        </>
      );
      break;
    case "cart_abandoned":
    case "cart_recovered":
      context = (
        <>
          {p.items || ""}
          {p.value ? (
            <>
              {" · "}
              <strong>{fmtMoney(p.value)}</strong>
            </>
          ) : null}
        </>
      );
      break;
    case "push_sent":
    case "push_clicked":
      context = (
        <>
          Title: <span className="rt-tl-quote">“{p.title}”</span>
        </>
      );
      break;
    case "signed_up":
      context = p.source ? <>via {p.source}</> : null;
      break;
    case "tagged":
    case "untagged":
      context = p.tag ? (
        <>
          Tag: <strong>{p.tag}</strong>
          {/* Only when a flow applied it. A tag added by a person shows no
              source, which is the truth rather than a guess. */}
          {p.byFlow && (
            <>
              {" · "}
              <span className="muted">by {p.byFlow}</span>
            </>
          )}
        </>
      ) : null;
      break;
    case "split_taken":
      // Names the split and the side taken. This is the answer to "why did
      // this person get that email", which is otherwise only reachable by
      // reading the database.
      context = (
        <>
          <strong>{p.split}</strong>
          {" → "}
          <span className={p.branch === "yes" ? "rt-tl-branch-yes" : "rt-tl-branch-no"}>
            {p.branch === "yes" ? "Yes" : "No"}
          </span>
          {p.name && (
            <>
              {" · "}
              <span className="muted">{p.name}</span>
            </>
          )}
        </>
      );
      break;
    case "entered_journey":
    case "exited_journey":
      context = p.name ? (
        <>
          Journey: <strong>{p.name}</strong>
        </>
      ) : null;
      break;
    case "unsubscribed":
    case "bounced":
    case "complained":
      context = p.reason ? <>{p.reason}</> : null;
      break;
    default:
      context = null;
  }

  return (
    <div className="rt-tl-event">
      <div className="rt-tl-rail">
        <div className={`rt-tl-dot rt-tint-${vis.tint}`}>
          <Icon size={12} />
        </div>
        {!last && <div className="rt-tl-line" />}
      </div>
      <div className="rt-tl-body">
        <div className="rt-tl-head">
          <span className="rt-tl-title">{EVENT_LABEL[event.kind] || event.kind}</span>
          <span className="rt-tl-time">{relativeTime(event.at)}</span>
        </div>
        {context && <div className="rt-tl-context">{context}</div>}
      </div>
    </div>
  );
}
