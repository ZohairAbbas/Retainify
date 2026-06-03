import { useFetcher } from "react-router";
import Icons from "../ui/Icons.jsx";
import { STATUS, SOURCE, relativeTime } from "./constants.js";

export default function SubscriptionCard({ contact }) {
  const fetcher = useFetcher();
  const isSubscribed = contact.subscriptionStatus === "subscribed";
  const isSuppressed = ["unsubscribed", "bounced", "complained"].includes(
    contact.subscriptionStatus,
  );

  const toggleEmail = () => {
    const fd = new FormData();
    fd.set("intent", isSubscribed ? "unsubscribe" : "resubscribe");
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <div className="rt-rail-card">
      <div className="rt-rail-head">
        <span className="t-micro">Subscription</span>
      </div>
      <div className="rt-rail-row">
        <div className="rt-rail-row-left">
          <Icons.Mail size={14} />
          <span>Email</span>
        </div>
        <div className="rt-rail-row-right">
          <span className="rt-rail-row-val">
            {STATUS[contact.subscriptionStatus]?.label || contact.subscriptionStatus}
          </span>
          {!isSuppressed && (
            <label className="rt-toggle" style={{ marginLeft: 8 }}>
              <input
                type="checkbox"
                checked={isSubscribed}
                onChange={toggleEmail}
                disabled={fetcher.state !== "idle"}
              />
              <span className="rt-toggle-switch" />
            </label>
          )}
        </div>
      </div>
      <div className="rt-rail-row">
        <div className="rt-rail-row-left">
          <Icons.Bell size={14} />
          <span>Push</span>
        </div>
        <div className="rt-rail-row-right">
          <span className="rt-rail-row-val">
            {contact.pushEnabled
              ? `Subscribed · ${contact.pushDevices || 1} device${
                  (contact.pushDevices || 1) === 1 ? "" : "s"
                }`
              : "Not subscribed"}
          </span>
        </div>
      </div>
      {contact.marketingConsentAt && (
        <div className="rt-rail-row">
          <div className="rt-rail-row-left">
            <Icons.Check size={14} />
            <span>Consented</span>
          </div>
          <div className="rt-rail-row-right">
            <span className="rt-rail-row-val">
              {relativeTime(contact.marketingConsentAt)}
            </span>
          </div>
        </div>
      )}
      <div className="rt-rail-row">
        <div className="rt-rail-row-left">
          <Icons.Refresh size={14} />
          <span>Source</span>
        </div>
        <div className="rt-rail-row-right">
          <span className="rt-rail-row-val">{SOURCE[contact.source] || contact.source}</span>
        </div>
      </div>
    </div>
  );
}
