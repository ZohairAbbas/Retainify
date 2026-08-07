import { Link } from "react-router";

/**
 * Inline upgrade prompt shown at a gate.
 *
 * Deliberately not a modal — it sits in the flow of the page so a merchant can
 * still read and understand the feature they don't have yet, rather than being
 * blocked from looking at it.
 *
 * @param {string} title
 * @param {string} [body]
 * @param {string} [planName] plan that unlocks the feature, e.g. "Growth"
 * @param {boolean} [compact] tighter spacing for inline/banner use
 */
export default function UpgradeNotice({ title, body, planName, compact = false }) {
  return (
    <div
      className="rt-form-section"
      style={{
        borderLeft: "3px solid var(--brand-700)",
        padding: compact ? "12px 16px" : undefined,
        marginBottom: compact ? 16 : undefined,
      }}
    >
      <div className="t-body" style={{ fontWeight: 500 }}>{title}</div>
      {body && (
        <div className="t-small muted" style={{ marginTop: 4 }}>{body}</div>
      )}
      <div style={{ marginTop: compact ? 10 : 14 }}>
        <Link className="btn btn-primary" to="/app/plans">
          {planName ? `See the ${planName} plan` : "See plans"}
        </Link>
      </div>
    </div>
  );
}
