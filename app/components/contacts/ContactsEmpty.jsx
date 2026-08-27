import Icons from "../ui/Icons.jsx";

/**
 * `onSync` is null for a workspace with no connected store — the sync button and
 * every "your storefront fills this in for you" promise come off with it, because
 * for a direct workspace an import is the only way contacts get here.
 */
export default function ContactsEmpty({ onSync, onAdd, onImport }) {
  const isShopify = !!onSync;

  return (
    <div className="rt-empty">
      <div className="rt-empty-art">
        <svg width="180" height="120" viewBox="0 0 180 120" fill="none">
          <rect x="20" y="40" width="48" height="60" rx="6" fill="#FDFBF5" stroke="#D2C9B0"/>
          <circle cx="44" cy="60" r="9" fill="#DCE7DF" stroke="#1F3D2F"/>
          <rect x="28" y="74" width="32" height="3" rx="1.5" fill="#D2C9B0"/>
          <rect x="28" y="82" width="20" height="3" rx="1.5" fill="#E4DDCB"/>
          <rect x="66" y="20" width="48" height="60" rx="6" fill="#FDFBF5" stroke="#D2C9B0"/>
          <circle cx="90" cy="40" r="9" fill="#F1E4C5" stroke="#6B5018"/>
          <rect x="74" y="54" width="32" height="3" rx="1.5" fill="#D2C9B0"/>
          <rect x="74" y="62" width="20" height="3" rx="1.5" fill="#E4DDCB"/>
          <rect x="112" y="40" width="48" height="60" rx="6" fill="#FDFBF5" stroke="#D2C9B0"/>
          <circle cx="136" cy="60" r="9" fill="#DCE4ED" stroke="#25406A"/>
          <rect x="120" y="74" width="32" height="3" rx="1.5" fill="#D2C9B0"/>
          <rect x="120" y="82" width="20" height="3" rx="1.5" fill="#E4DDCB"/>
        </svg>
      </div>
      <h2 className="t-display-2" style={{ margin: 0, color: "var(--ink-1)" }}>
        Everyone you've met,{" "}
        <em style={{ fontFamily: "var(--font-display)", color: "var(--brand-700)" }}>
          in one place
        </em>
        .
      </h2>
      <p className="rt-empty-lede">
        {isShopify
          ? "Contacts appear here when someone subscribes through your popup, abandons a cart, places an order, or opts in to push. Sync your Shopify customers to get started."
          : "Bring in the list you already have. Upload a CSV and map your own columns — names, tags and custom fields come across intact."}
      </p>
      <div className="rt-empty-actions">
        {isShopify ? (
          <button type="button" className="btn btn-primary btn-lg" onClick={onSync}>
            <Icons.Refresh size={14} /> Sync from Shopify
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-lg" onClick={onImport}>
            <Icons.Upload size={14} /> Import a CSV
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-lg" onClick={onAdd}>
          <Icons.Plus size={14} /> Add a contact
        </button>
      </div>
      <div className="rt-empty-tips">
        {(isShopify ? SHOPIFY_TIPS : DIRECT_TIPS).map((t) => {
          const Ic = Icons[t.icon];
          return (
            <div className="rt-empty-tip" key={t.title}>
              <Ic size={16} />
              <div>
                <strong>{t.title}</strong>
                <br />
                <span className="muted">{t.body}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SHOPIFY_TIPS = [
  { icon: "Mail", title: "Popups", body: "New subscribers land here automatically." },
  { icon: "Cart", title: "Carts", body: "Anyone who reaches checkout gets a record." },
  { icon: "Bell", title: "Push", body: "Anonymous push subscribers, too." },
  { icon: "Refresh", title: "Shopify sync", body: "Backfill all existing customers in one go." },
];

const DIRECT_TIPS = [
  { icon: "Upload", title: "CSV import", body: "Map your columns once; we remember the mapping." },
  { icon: "Sliders", title: "Custom fields", body: "Any column you import becomes filterable." },
  { icon: "Users", title: "Segments", body: "Rules over those fields, re-evaluated continuously." },
  { icon: "Mail", title: "Broadcasts", body: "Send to a segment and track every open and click." },
];
