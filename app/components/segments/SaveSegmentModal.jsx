import { useState } from "react";
import Icons from "../ui/Icons.jsx";
import ReadOnlyRules from "./ReadOnlyRules.jsx";

export default function SaveSegmentModal({
  open,
  onClose,
  onSubmit,
  filterTree,
  fields,
  tags,
  initialName = "",
  initialDescription = "",
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [kind, setKind] = useState("dynamic");

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: description.trim(), kind, filterTree });
  };

  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <form className="rt-save-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="rt-save-head">
          <div className="t-micro">Save segment</div>
          <h2 className="t-h1">Name your audience</h2>
        </div>
        <div className="rt-save-body">
          <label>
            <div className="field-label">Segment name</div>
            <input
              className="input"
              placeholder="e.g. Subscribed VIPs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            <div className="field-label">Description (optional)</div>
            <input
              className="input"
              placeholder="What's this group for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="rt-save-preview">
            <div className="rt-save-preview-head">
              <Icons.Sliders size={12} />
              <span>Preview of saved rules</span>
            </div>
            <ReadOnlyRules tree={filterTree} fields={fields} tags={tags} />
          </div>
        </div>
        <div className="rt-save-foot">
          <div className="rt-save-foot-left">
            Dynamic segments update automatically as contacts change.
          </div>
          <div className="rt-save-foot-right">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
              Save segment
            </button>
          </div>
        </div>
        {/* hidden — kept for future static-from-filter expansion */}
        <input type="hidden" name="kind" value={kind} onChange={() => setKind(kind)} />
      </form>
    </div>
  );
}
