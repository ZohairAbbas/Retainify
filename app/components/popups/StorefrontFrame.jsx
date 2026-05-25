export default function StorefrontFrame({ children, device = "desktop", dim = true }) {
  return (
    <div className={`rt-store-frame ${device}`}>
      <div className="rt-store-bar">
        <div className="rt-store-dots">
          <span /><span /><span />
        </div>
        <div className="rt-store-url">
          <span className="rt-store-url-lock" />
          northhill.shop
        </div>
        <div style={{ width: 36 }} />
      </div>
      <div className="rt-store-body">
        <div className="rt-store-page">
          <div className="rt-store-topnav">
            <div className="rt-store-brand">Northhill & Co.</div>
            <div className="rt-store-nav-links">
              <span>Shop</span><span>Journal</span><span>About</span>
            </div>
            <div className="rt-store-icons">
              <span /><span /><span />
            </div>
          </div>
          <div className="rt-store-hero">
            <div className="rt-store-hero-left" />
            <div className="rt-store-hero-right">
              <div className="rt-store-hero-h">
                Quiet objects, <em>well made.</em>
              </div>
              <div className="rt-store-hero-p">
                A small studio in upstate New York making linen, ceramics and small leather goods one batch at a time.
              </div>
              <div className="rt-store-hero-cta">Shop the studio</div>
            </div>
          </div>
        </div>
        <div className={`rt-store-dim ${dim ? "" : "no-dim"}`}>{children}</div>
      </div>
    </div>
  );
}
