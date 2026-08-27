/**
 * The public front door.
 *
 * Two audiences arrive here and they want different things. A Shopify merchant
 * clicking through from the admin carries `?shop=` and should never see
 * marketing — they get bounced straight into the app. Everyone else is deciding
 * whether to sign up, and the page has to answer "what is this, and does it
 * apply to me?" without making them guess which half is for them.
 */
import { Link, redirect } from "react-router";
import { getSession } from "../../lib/auth/session.server.js";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Already signed in — a landing page is not what they came for.
  if (await getSession(request)) throw redirect("/app");

  return {};
};

const FEATURES = [
  {
    icon: "send",
    title: "Broadcasts",
    body: "Write once, send to a segment, and see opens and clicks per recipient — not just an average.",
  },
  {
    icon: "flow",
    title: "Automated flows",
    body: "Welcome series, win-backs, abandoned carts. Built visually, then left to run on their own.",
  },
  {
    icon: "filter",
    title: "Segments that update themselves",
    body: "Rules over any field you store, re-evaluated continuously. No static lists to maintain by hand.",
  },
  {
    icon: "users",
    title: "Contacts on your terms",
    body: "Import a CSV, map your own columns, add custom fields — then filter and send on any of them.",
  },
];

function FeatureIcon({ name }) {
  const common = {
    width: 16, height: 16, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round",
    strokeLinejoin: "round", "aria-hidden": true,
  };
  if (name === "send") return <svg {...common}><path d="M21 3 10.5 13.5M21 3l-6.5 18-4-8-8-4L21 3Z" /></svg>;
  if (name === "flow") return <svg {...common}><rect x="3" y="3" width="7" height="6" rx="1.5" /><rect x="14" y="15" width="7" height="6" rx="1.5" /><path d="M6.5 9v6a3 3 0 0 0 3 3H14" /></svg>;
  if (name === "filter") return <svg {...common}><path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" /></svg>;
  return <svg {...common}><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11.2a3 3 0 0 0 0-5.9M18.5 20a6 6 0 0 0-3-5.2" /></svg>;
}

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <Link to="/" className="lp-mark">
          <span className="rt-app-mark" aria-hidden="true">R</span>
          Retainify
        </Link>
        <nav className="lp-nav-links">
          <Link className="auth-link" to="/login">Sign in</Link>
          <Link className="btn btn-primary" to="/signup">Get started</Link>
        </nav>
      </header>

      <main className="lp-main">
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-eyebrow-dot" aria-hidden="true" />
              Email · Automation · Analytics
            </span>
            <h1 className="lp-h1">
              Own the list.<br />
              <em>Send like you mean it.</em>
            </h1>
            <p className="lp-lede">
              Retainify runs your email programme end to end — contacts, segments,
              automated flows, one-off broadcasts, and the analytics to prove which
              of them actually earned anything. Use it on your Shopify store, or on
              its own with any list you own.
            </p>
            <div className="lp-cta">
              <Link className="btn btn-primary" to="/signup">Create a free account</Link>
              <a className="btn btn-secondary" href="https://apps.shopify.com/retainify">
                Install on Shopify
              </a>
            </div>
            <div className="lp-cta-note">No card required · Import your contacts in minutes</div>
          </div>

          {/* A glimpse of the product itself rather than a stock illustration.
              Pure CSS, so there is no image to load or go stale. */}
          <div className="lp-vignette" aria-hidden="true">
            <div className="lp-vig-card">
              <div className="lp-vig-head">
                <div>
                  <div className="lp-vig-title">Winter restock</div>
                  <div className="lp-vig-sub">Broadcast · Engaged subscribers</div>
                </div>
                <span className="lp-vig-pill">Sent</span>
              </div>
              <div className="lp-vig-stats">
                <div>
                  <div className="lp-vig-label">Delivered</div>
                  <div className="lp-vig-value">8,412</div>
                </div>
                <div>
                  <div className="lp-vig-label">Opened</div>
                  <div className="lp-vig-value">41.6%</div>
                </div>
                <div>
                  <div className="lp-vig-label">Clicked</div>
                  <div className="lp-vig-value">9.2%</div>
                </div>
              </div>
              <div className="lp-vig-bar">
                <span style={{ width: "41.6%", background: "var(--brand-700)" }} />
                <span style={{ width: "9.2%", background: "var(--accent-deep)" }} />
              </div>
            </div>

            <div className="lp-vig-card">
              <div className="lp-vig-head">
                <div className="lp-vig-title">Welcome series</div>
                <span className="lp-vig-pill">Live</span>
              </div>
              <div className="lp-vig-step">
                <span className="lp-vig-dot">1</span> Contact subscribes
              </div>
              <div className="lp-vig-conn" />
              <div className="lp-vig-step">
                <span className="lp-vig-dot">2</span> Wait
                <span className="lp-vig-when">1 day</span>
              </div>
              <div className="lp-vig-conn" />
              <div className="lp-vig-step">
                <span className="lp-vig-dot">3</span> Send &ldquo;Start here&rdquo;
                <span className="lp-vig-when">62% open</span>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="lp-section-head">
            <h2 className="lp-h2">Everything a send needs, in one place</h2>
            <p className="lp-section-lede">
              No stitching together a list tool, a sender, and a spreadsheet to
              work out what happened afterwards.
            </p>
          </div>
          <div className="lp-grid">
            {FEATURES.map((f) => (
              <div className="lp-card" key={f.title}>
                <div className="lp-card-ic"><FeatureIcon name={f.icon} /></div>
                <h3 className="lp-card-title">{f.title}</h3>
                <p className="lp-card-body">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Two genuinely different setups, not a feature list — which one you
            are decides what you get, so it is worth saying outright. */}
        <section className="lp-paths">
          <div className="lp-path">
            <div className="lp-path-eyebrow">Shopify stores</div>
            <h3 className="lp-path-title">Install and it fills itself in</h3>
            <p className="lp-path-body">
              Customers, orders and abandoned carts sync automatically. You get
              cart recovery, an on-site signup popup, web push and WhatsApp on
              top of everything else — billed through Shopify.
            </p>
            <a className="btn btn-secondary" href="https://apps.shopify.com/retainify">
              View on the App Store
            </a>
          </div>

          <div className="lp-path lp-path-dark">
            <div className="lp-path-eyebrow">Everyone else</div>
            <h3 className="lp-path-title">Bring your own list</h3>
            <p className="lp-path-body">
              No storefront needed. Import a CSV, invite your team, and run
              contacts, segments, flows, broadcasts and analytics exactly as they
              are — the commerce-only pieces simply stay out of your way.
            </p>
            <Link className="btn btn-secondary" to="/signup">Create a free account</Link>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <span>© {new Date().getFullYear()} Retainify</span>
        <div className="lp-foot-links">
          <Link className="auth-link" to="/login">Sign in</Link>
          <Link className="auth-link" to="/signup">Get started</Link>
        </div>
      </footer>
    </div>
  );
}
