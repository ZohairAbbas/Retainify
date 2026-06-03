import Icons from "../ui/Icons.jsx";
import SoonPill from "./SoonPill.jsx";

// Placeholder until Segments lands in a follow-up release. The rail still shows
// the slot so the profile layout matches the prototype.
export default function SegmentsCard() {
  return (
    <div className="rt-rail-card rt-rail-locked">
      <div className="rt-rail-head">
        <span className="t-micro">Segments</span>
        <SoonPill />
      </div>
      <div className="rt-rail-lockedbody">
        <Icons.Sliders size={14} />
        <div className="t-small muted">
          Build dynamic groups of contacts based on behaviour, then use them to trigger flows.
        </div>
      </div>
    </div>
  );
}
