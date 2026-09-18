import { useNavigate } from "react-router";
import Icons from "../ui/Icons.jsx";

/**
 * One segment template. The count is how many contacts it would hold today;
 * null means it couldn't be counted and is simply left off.
 */
export default function SegmentTemplateCard({ template: t, iconSize = 12 }) {
  const navigate = useNavigate();
  const Icon = Icons[t.icon] || Icons.Sparkles;
  return (
    <button
      type="button"
      className={`rt-tpl-card${t.recommended ? " rt-tpl-card-rec" : ""}`}
      onClick={() => navigate(`/app/segments/new?template=${t.id}`)}
    >
      <div className="rt-tpl-card-top">
        <span className="rt-tpl-icon" style={{ background: t.accent, color: t.accentInk }}>
          <Icon size={iconSize} />
        </span>
        <span className="rt-tpl-card-name">{t.name}</span>
        {t.recommended && <span className="rt-tmpl-rec-badge">Recommended</span>}
      </div>
      <div className="rt-tpl-card-desc">{t.description}</div>
      <div className="rt-tpl-card-foot">
        {typeof t.count === "number" && (
          <span className="rt-tpl-card-count">
            {t.count === 0 ? "No one yet" : `${t.count.toLocaleString()} ${t.count === 1 ? "contact" : "contacts"}`}
          </span>
        )}
        {t.alreadySaved && <span className="rt-tpl-card-count">· already saved</span>}
        <strong style={{ marginLeft: "auto" }}>Use template</strong>
        <Icons.Arrow size={10} />
      </div>
    </button>
  );
}
