import Icons from "../ui/Icons.jsx";
import { relativeTime } from "./constants.js";

export default function JourneysCard({ active = [], past = 0 }) {
  return (
    <div className="rt-rail-card">
      <div className="rt-rail-head">
        <span className="t-micro">Journeys</span>
        <span className="rt-rail-count">{active.length}</span>
      </div>
      {active.length === 0 && past === 0 && (
        <div className="muted t-small">Not in any journeys.</div>
      )}
      {active.map((j, i) => (
        <div key={i} className="rt-rail-journey">
          <div className="rt-rail-jhead">
            <Icons.Flow size={13} />
            <span className="rt-rail-jname">{j.name}</span>
          </div>
          <div className="rt-rail-jmeta">
            <span>{j.step}</span>
            <span className="muted"> · Started {relativeTime(j.startedAt)}</span>
          </div>
        </div>
      ))}
      {past > 0 && (
        <div className="rt-rail-pastlink muted t-small">
          {past} past journey{past === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}
