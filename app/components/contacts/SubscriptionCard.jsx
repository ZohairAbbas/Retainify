import { useFetcher } from "react-router";
import Icons from "../ui/Icons.jsx";
import { STATUS, SOURCE, relativeTime } from "./constants.js";

/** WhatsApp consent states, in the merchant's language rather than the column's. */
const WA_STATUS = {
  subscribed: "Subscribed",
  unsubscribed: "Opted out",
  // The number was rejected by Meta as unreachable, which is not the same as
  // the customer having said no — worth distinguishing, because it is fixable.
  invalid: "Invalid number",
  never_opted_in: "Not subscribed",
};

export default function SubscriptionCard({ contact }) {
  const fetcher = useFetcher();
  const waFetcher = useFetcher();
  const isSubscribed = contact.subscriptionStatus === "subscribed";
  const isSuppressed = ["unsubscribed", "bounced", "complained"].includes(
    contact.subscriptionStatus,
  );

  const toggleEmail = () => {
    const fd = new FormData();
    fd.set("intent", isSubscribed ? "unsubscribe" : "resubscribe");
    fetcher.submit(fd, { method: "post" });
  };

  const optOutWhatsapp = () => {
    const fd = new FormData();
    fd.set("intent", "whatsapp-opt-out");
    waFetcher.submit(fd, { method: "post" });
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
      {/* WhatsApp is a separate consent axis from email — Meta requires its own
          opt-in — so it gets its own row rather than being folded into the
          email status. The toggle only ever removes consent: re-subscribing
          someone from here would be manufacturing an opt-in record, which is
          the one thing WhatsApp's policy does not allow us to do on their
          behalf. It comes back when THEY opt in again. */}
      <div className="rt-rail-row">
        <div className="rt-rail-row-left">
          <Icons.Whatsapp size={14} />
          <span>WhatsApp</span>
        </div>
        <div className="rt-rail-row-right">
          <span className="rt-rail-row-val">
            {WA_STATUS[contact.whatsappStatus] || "Not subscribed"}
            {contact.whatsappStatus === "subscribed" && contact.whatsappOptInAt
              ? ` · ${relativeTime(contact.whatsappOptInAt)}`
              : ""}
          </span>
          {contact.whatsappStatus === "subscribed" && (
            <button
              className="btn"
              style={{ marginLeft: 8, padding: "2px 10px" }}
              onClick={optOutWhatsapp}
              disabled={waFetcher.state !== "idle"}
            >
              {waFetcher.state !== "idle" ? "…" : "Opt out"}
            </button>
          )}
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
