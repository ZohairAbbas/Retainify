import { useEffect, useRef, useState } from "react";
import Icons from "../ui/Icons.jsx";
import Sparkline from "./Sparkline.jsx";

const LIFECYCLE_COLORS = {
  new:             "#25406A",
  active:          "#1F3D2F",
  at_risk:         "#6B5018",
  churned:         "#5A3F38",
  never_purchased: "#5A2E5A",
};
const LIFECYCLE_LABELS = {
  new: "New",
  active: "Active",
  at_risk: "At-risk",
  churned: "Churned",
  never_purchased: "Never purchased",
};

export default function LivePreviewCard({ filterTree, kind, staticMembers, totalAudience }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (kind === "static") {
      setData({
        count: staticMembers?.length || 0,
        sample: (staticMembers || []).slice(0, 5).map((m) => ({
          id: m.id, email: m.email, name: m.name, lifecycle: "active",
        })),
        capped: false,
        lifecycleMix: null,
      });
      return;
    }
    const id = ++tokenRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const fd = new FormData();
        fd.set("filterTree", JSON.stringify(filterTree || null));
        const res = await fetch("/app/segments/preview", { method: "POST", body: fd });
        if (!res.ok) {
          if (tokenRef.current === id) setLoading(false);
          return;
        }
        const json = await res.json();
        if (tokenRef.current === id) {
          setData(json);
          setLoading(false);
        }
      } catch (_e) {
        if (tokenRef.current === id) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [filterTree, kind, staticMembers]);

  const count = data?.count ?? 0;
  const capped = data?.capped;
  const sample = data?.sample || [];
  const mix = data?.lifecycleMix;

  const isEmptyTree =
    kind === "dynamic" && (!filterTree || !(filterTree.children || []).length);
  const isBroad = totalAudience > 0 && count / totalAudience > 0.8;
  const isNarrow = count < 20 && !isEmptyTree && kind === "dynamic";

  return (
    <div className="rt-prev-card">
      <div className="rt-prev-head">
        {loading ? <span className="rt-prev-spinner" /> : <Icons.Sparkles size={12} />}
        <span className="t-micro">Live preview</span>
      </div>

      <div className="rt-prev-count">
        <em>{capped ? "5000+" : count.toLocaleString()}</em>
        <span className="rt-prev-count-unit">contacts match</span>
      </div>

      <div className="rt-prev-spark">
        <Sparkline
          values={[count * 0.92, count * 0.94, count * 0.95, count * 0.97, count * 0.98, count]}
          w={320}
          h={42}
        />
      </div>

      {isEmptyTree && (
        <div className="rt-prev-section">
          <div className="rt-prev-warn info">
            <Icons.Help size={14} />
            <div>
              <strong>Add a rule to get started.</strong>
              Without rules, this segment will match everyone in your contacts.
            </div>
          </div>
        </div>
      )}

      {isBroad && !isEmptyTree && (
        <div className="rt-prev-section">
          <div className="rt-prev-warn warn">
            <Icons.Help size={14} />
            <div>
              <strong>This segment is very broad.</strong>
              Matching most of your audience may not give you much targeting power.
            </div>
          </div>
        </div>
      )}

      {isNarrow && count > 0 && (
        <div className="rt-prev-section">
          <div className="rt-prev-warn warn">
            <Icons.Help size={14} />
            <div>
              <strong>This segment is very small.</strong>
              Only {count} contact{count === 1 ? "" : "s"} — fine for a personal note,
              not for broadcasts.
            </div>
          </div>
        </div>
      )}

      {mix && count > 0 && (
        <div className="rt-prev-section">
          <div className="rt-prev-section-head">Lifecycle mix</div>
          <LifecycleStack mix={mix} />
        </div>
      )}

      {sample.length > 0 && (
        <div className="rt-prev-section">
          <div className="rt-prev-section-head">Sample contacts</div>
          <div className="rt-prev-samples">
            {sample.map((s) => (
              <div className="rt-prev-sample" key={s.id}>
                <span
                  className="rt-sel-tag-swatch"
                  style={{
                    width: 20, height: 20, borderRadius: "50%",
                    background: "var(--brand-100)", color: "var(--brand-700)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 600,
                  }}
                >
                  {(s.email || "·")[0].toUpperCase()}
                </span>
                <span className="rt-prev-sample-email">{s.email}</span>
                <span className="rt-prev-sample-meta">{LIFECYCLE_LABELS[s.lifecycle] || ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LifecycleStack({ mix }) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  if (!total) return null;
  const entries = Object.entries(mix);
  return (
    <>
      <div className="rt-prev-stack">
        {entries.map(([k, v]) => {
          const pct = (v / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={k}
              className="rt-prev-stack-seg"
              style={{ width: `${pct}%`, background: LIFECYCLE_COLORS[k] }}
            />
          );
        })}
      </div>
      <div className="rt-prev-stack-legend">
        {entries.filter(([, v]) => v > 0).map(([k, v]) => (
          <div className="rt-prev-stack-leg" key={k}>
            <span
              className="rt-prev-stack-leg-dot"
              style={{ background: LIFECYCLE_COLORS[k] }}
            />
            {LIFECYCLE_LABELS[k]}
            <span className="rt-prev-stack-leg-num">{v}</span>
          </div>
        ))}
      </div>
    </>
  );
}
