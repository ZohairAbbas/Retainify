import Icons from "../ui/Icons.jsx";

export default function BulkBar({ selectedCount, onAddTag, onSaveAsSegment, onUnsubscribe, onDelete, onClear, onExport }) {
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
      {/* A real link: the response is a streamed file download the browser
          must handle itself, so this cannot go through a fetcher. */}
      {onExport && (
        <a className="rt-bulk-btn" href={onExport} download>
          <Icons.ArrowUp size={13} /> Export
        </a>
      )}
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
