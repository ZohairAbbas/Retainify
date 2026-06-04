import Icons from "../ui/Icons.jsx";
import SoonPill from "./SoonPill.jsx";

export default function BulkBar({ selectedCount, onAddTag, onSaveAsSegment, onUnsubscribe, onDelete, onClear }) {
  if (!selectedCount) return null;
  return (
    <div className="rt-bulkbar">
      <div className="rt-bulkbar-count">
        <span className="rt-bulkbar-num">{selectedCount}</span>
        <span>contact{selectedCount === 1 ? "" : "s"} selected</span>
      </div>
      <div className="rt-bulkbar-sep" />
      <button type="button" className="rt-bulk-btn" onClick={onAddTag}>
        <Icons.Tag size={13} /> Add tag
      </button>
      {onSaveAsSegment && (
        <button type="button" className="rt-bulk-btn" onClick={onSaveAsSegment}>
          <Icons.Sliders size={13} /> Save as segment
        </button>
      )}
      <button type="button" className="rt-bulk-btn" onClick={onUnsubscribe}>
        <Icons.Mail size={13} /> Unsubscribe
      </button>
      <button type="button" className="rt-bulk-btn rt-bulk-soon" disabled>
        <Icons.ArrowUp size={13} /> Export <SoonPill />
      </button>
      <button type="button" className="rt-bulk-btn rt-bulk-danger" onClick={onDelete}>
        <Icons.Trash size={13} /> Delete
      </button>
      <div className="rt-bulkbar-sep" />
      <button
        type="button"
        className="rt-bulk-close"
        onClick={onClear}
        aria-label="Clear selection"
      >
        <Icons.Close size={14} />
      </button>
    </div>
  );
}
