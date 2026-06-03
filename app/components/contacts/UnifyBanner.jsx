import Icons from "../ui/Icons.jsx";

export default function UnifyBanner({ count, onDismiss, onSync }) {
  return (
    <div className="rt-unify">
      <div className="rt-unify-icon">
        <Icons.Sparkles size={18} />
      </div>
      <div className="rt-unify-body">
        <div className="rt-unify-head">
          We found <strong>{(count ?? 0).toLocaleString()} {count === 1 ? "person" : "people"}</strong>{" "}
          across your popup, carts, push subscribers, and Shopify customers.
        </div>
        <div className="rt-unify-sub muted">
          We unified them into a single Contacts list. No emails were sent — this is just data clean-up.
        </div>
      </div>
      <div className="rt-unify-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>
          Got it
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onSync}>
          <Icons.Refresh size={14} /> Pull from Shopify too
        </button>
      </div>
    </div>
  );
}
