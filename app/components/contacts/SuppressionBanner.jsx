import Icons from "../ui/Icons.jsx";
import { relativeTime } from "./constants.js";

const CONFIG = {
  unsubscribed: {
    tone: "warn",
    title: (when) => `Unsubscribed ${when ? relativeTime(when) : ""}`.trim(),
    body: "This contact won't receive emails or push notifications until they re-subscribe.",
    action: "Re-subscribe",
  },
  bounced: {
    tone: "danger",
    title: (when) => `Email bounced ${when ? relativeTime(when) : ""}`.trim(),
    body: "Re-subscribing a bounced address may harm your sender reputation.",
    action: null,
  },
  complained: {
    tone: "danger",
    title: () => "Marked as spam",
    body: "A spam complaint was recorded against an email sent to this contact.",
    action: null,
  },
};

export default function SuppressionBanner({ contact, lastSuppressedAt, onResubscribe }) {
  const kind = contact.subscriptionStatus;
  const cfg = CONFIG[kind];
  if (!cfg) return null;
  return (
    <div className={`rt-suppress rt-suppress-${cfg.tone}`}>
      <Icons.Lock size={16} />
      <div className="rt-suppress-body">
        <div className="rt-suppress-title">{cfg.title(lastSuppressedAt)}</div>
        <div className="rt-suppress-sub">{cfg.body}</div>
      </div>
      {cfg.action && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onResubscribe}>
          {cfg.action}
        </button>
      )}
    </div>
  );
}
