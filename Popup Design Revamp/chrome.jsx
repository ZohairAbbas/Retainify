// Retainify — Shopify-style page chrome
// Top bar + left sidebar. Mimics Shopify density without copying Polaris exactly.

const { useState } = React;

function ShopifyTopBar() {
  return (
    <div className="rt-shopify-top">
      <div className="rt-shopify-left">
        <div className="rt-shopify-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M19 6.5a3.5 3.5 0 0 0-3-3.5l-2-2c-.4-.5-1.4-.4-1.8-.3-.1 0-.3 0-.5.1L4 6l1 14 12 3 3-13c-.1-.1-.2-.2-1-3.5z" fill="#95BF47"/>
            <path d="M16 3a3.5 3.5 0 0 0-3-3l-2 23 4-3z" fill="#5E8E3E"/>
            <path d="M13 8c-.1 0-1.5-.5-1.7-.5-.4-.1-.7 0-.7.5l-.1 1.5c-.3-.1-.6-.2-1-.2-1.5 0-2.3 1-2.5 1.7-.1.3 0 .8.4 1l1 .4c.4.2.5.3.5.5 0 .3-.3.5-.7.5-.6 0-1.2-.3-1.4-.5l-.5 1.5c.4.2 1.2.5 2 .5 1.6 0 2.6-.8 2.6-2.3 0-.8-.4-1.2-1-1.5l-.5-.3c-.3-.2-.6-.3-.6-.6 0-.3.3-.4.6-.4.5 0 1.2.2 1.4.4z" fill="#fff"/>
          </svg>
          <span>shopify</span>
        </div>
        <span className="rt-shopify-divider" />
        <div className="rt-shopify-search">
          <Icons.Search size={14} />
          <input placeholder="Search" />
          <span className="rt-shopify-kbd">⌘ K</span>
        </div>
      </div>
      <div className="rt-shopify-right">
        <button className="rt-shopify-icon"><Icons.Bell size={16} /></button>
        <div className="rt-shopify-store">
          <span>Northhill &amp; Co.</span>
          <Icons.ChevronDown size={14} />
        </div>
      </div>
    </div>
  );
}

const SHOP_NAV = [
  { label: 'Home', icon: 'Home' },
  { label: 'Orders', icon: 'Cart', count: 12 },
  { label: 'Products', icon: 'Tab' },
  { label: 'Customers', icon: 'Users' },
  { label: 'Analytics', icon: 'Chart' },
  { label: 'Marketing', icon: 'Heart' },
];

function ShopifyAppShell({ active, onNav, children }) {
  const NAV = [
    { id: 'home',      label: 'Home',       icon: 'Home' },
    { id: 'flows',     label: 'Flows',      icon: 'Flow' },
    { id: 'popups',    label: 'Popups',     icon: 'Megaphone' },
    { id: 'contacts',  label: 'Contacts',   icon: 'Users' },
    { id: 'segments',  label: 'Segments',   icon: 'Tag' },
    { id: 'coupons',   label: 'Coupons',    icon: 'Ticket' },
    { id: 'analytics', label: 'Analytics',  icon: 'Chart' },
    { id: 'settings',  label: 'Settings',   icon: 'Settings' },
  ];

  return (
    <div className="rt-shell">
      <ShopifyTopBar />
      <div className="rt-shopify-body">
        <aside className="rt-shopify-nav">
          <div className="rt-shopify-nav-section">
            {SHOP_NAV.map(n => {
              const Icon = Icons[n.icon];
              return (
                <a key={n.label} className="rt-shopify-nav-item">
                  <Icon size={16} />
                  <span>{n.label}</span>
                  {n.count != null && <span className="rt-shopify-nav-count">{n.count}</span>}
                </a>
              );
            })}
          </div>
          <div className="rt-shopify-nav-section">
            <div className="rt-shopify-nav-heading">Apps</div>
            <a className="rt-shopify-nav-item rt-shopify-nav-app rt-active">
              <span className="rt-app-mark">R</span>
              <span>Retainify</span>
              <Icons.ChevronDown size={14} className="rt-rotate" />
            </a>
            {/* Retainify sub-nav */}
            <div className="rt-retainify-subnav">
              {NAV.map(n => {
                const Icon = Icons[n.icon];
                return (
                  <a key={n.id} onClick={() => onNav && onNav(n.id)}
                     className={`rt-subnav-item ${active === n.id ? 'rt-on' : ''}`}>
                    <Icon size={15} />
                    <span>{n.label}</span>
                  </a>
                );
              })}
            </div>
          </div>
        </aside>
        <main className="rt-shopify-main">{children}</main>
      </div>
    </div>
  );
}

// Builder takeover — full-page, no Shopify chrome
function BuilderShell({ topBar, leftRail, children, rightPanel }) {
  return (
    <div className="rt-builder">
      <div className="rt-builder-topbar">{topBar}</div>
      <div className="rt-builder-body">
        {leftRail && <div className="rt-builder-rail">{leftRail}</div>}
        <div className="rt-builder-canvas">{children}</div>
        {rightPanel && <div className="rt-builder-inspector">{rightPanel}</div>}
      </div>
    </div>
  );
}

Object.assign(window, { ShopifyAppShell, BuilderShell });
