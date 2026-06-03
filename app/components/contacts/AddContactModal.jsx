import { useState } from "react";
import { useFetcher } from "react-router";
import Icons from "../ui/Icons.jsx";

export default function AddContactModal({ open, onClose }) {
  const fetcher = useFetcher();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const submitting = fetcher.state !== "idle";

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("intent", "add_contact");
    fd.set("email", email);
    fd.set("name", name);
    fetcher.submit(fd, { method: "post" });
    onClose();
  };

  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div className="rt-sync-modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <div className="rt-sync-head">
            <div>
              <div className="t-micro muted">Contact</div>
              <h2 className="t-h1" style={{ margin: "4px 0 0" }}>
                Add a contact
              </h2>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={onClose}
              aria-label="Close"
            >
              <Icons.Close size={14} />
            </button>
          </div>
          <div className="rt-sync-body" style={{ display: "grid", gap: 14 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="t-micro muted">Email *</span>
              <input
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="t-micro muted">Name</span>
              <input
                className="input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <div className="t-small muted">
              Manual contacts are added as Subscribed. They can unsubscribe via any email
              or push you send them.
            </div>
          </div>
          <div className="rt-sync-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !email}>
              <Icons.Plus size={14} /> Add contact
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
