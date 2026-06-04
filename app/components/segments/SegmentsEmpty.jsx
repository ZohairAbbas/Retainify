import { useNavigate } from "react-router";
import Icons from "../ui/Icons.jsx";

export default function SegmentsEmpty({ templates }) {
  const navigate = useNavigate();
  return (
    <div className="rt-sg-empty">
      <svg width="180" height="120" viewBox="0 0 180 120" className="rt-sg-empty-art">
        <circle cx="70" cy="60" r="42" fill="#DCE7DF" stroke="#1F3D2F" strokeWidth="1.5" />
        <circle cx="110" cy="60" r="42" fill="#F1E4C5" stroke="#6B5018" strokeWidth="1.5" opacity="0.85" />
        <text x="50" y="65" fill="#1F3D2F" fontFamily="Geist Mono" fontSize="10">VIP</text>
        <text x="115" y="65" fill="#6B5018" fontFamily="Geist Mono" fontSize="10">cart</text>
      </svg>
      <h1 className="t-display-1" style={{ margin: 0 }}>
        Smaller groups, <em style={{ color: "var(--brand-700)", fontStyle: "italic" }}>better messages.</em>
      </h1>
      <p className="t-body muted" style={{ maxWidth: 540, margin: "16px auto 24px" }}>
        Segments group contacts by what they've done — abandoned a cart, opened an email,
        joined this week — and let you use those groups to trigger flows or browse audiences.
      </p>
      <div style={{ display: "inline-flex", gap: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate("/app/segments/new")}
        >
          <Icons.Plus size={14} /> Create segment
        </button>
      </div>

      <div className="rt-sg-empty-cards">
        {templates.slice(0, 3).map((t) => (
          <button
            type="button"
            key={t.id}
            className="rt-tpl-card"
            onClick={() => navigate(`/app/segments/new?template=${t.id}`)}
          >
            <div className="rt-tpl-card-top">
              <span className="rt-tpl-icon" style={{ background: t.accent, color: t.accentInk }}>
                <Icons.Sparkles size={14} />
              </span>
              <span className="rt-tpl-card-name">{t.name}</span>
            </div>
            <div className="rt-tpl-card-desc">{t.description}</div>
            <div className="rt-tpl-card-foot">
              <strong>Use template</strong>
              <Icons.Arrow size={10} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
