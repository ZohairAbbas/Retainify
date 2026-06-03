import Icons from "../ui/Icons.jsx";
import SoonPill from "./SoonPill.jsx";

export default function CustomPropsCard() {
  return (
    <div className="rt-rail-card rt-rail-locked">
      <div className="rt-rail-head">
        <span className="t-micro">Custom properties</span>
        <SoonPill />
      </div>
      <div className="rt-rail-lockedbody">
        <Icons.Lock size={14} />
        <div className="t-small muted">
          Capture data like favorite category, VIP tier, or referral source on each contact.
        </div>
      </div>
    </div>
  );
}
