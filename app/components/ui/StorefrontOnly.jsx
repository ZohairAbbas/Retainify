/**
 * Shown instead of a feature that needs a storefront when the workspace hasn't
 * got one.
 *
 * These pages are hidden from the nav for a direct workspace, but a bookmark,
 * a deep link, or a shared URL still lands here — and a settings screen that
 * saves happily while nothing on the other end can ever read it is worse than
 * a closed door.
 */
import { Link } from "react-router";
import Icons from "./Icons.jsx";

export default function StorefrontOnly({ feature, what }) {
  return (
    <div className="rt-page">
      <header className="rt-page-head">
        <h1 className="t-display-2" style={{ margin: 0 }}>{feature}</h1>
      </header>

      <div className="card card-pad" style={{ maxWidth: 560 }}>
        <div className="t-h3" style={{ marginBottom: 8 }}>Needs a connected store</div>
        <p className="t-small muted" style={{ marginTop: 0 }}>
          {what} That only works on a workspace connected to a Shopify store, and
          this one isn&apos;t.
        </p>
        <p className="t-small muted">
          Email, flows, broadcasts, segments and contacts all work here as normal.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <Link className="btn btn-primary" to="/app/campaigns">
            Go to Campaigns <Icons.Arrow size={13} />
          </Link>
          <Link className="btn btn-secondary" to="/app">Dashboard</Link>
        </div>
      </div>
    </div>
  );
}
