import Icons from "../ui/Icons.jsx";
import { TAG_PALETTE } from "./constants.js";

export default function TagChip({ tag, removable, onRemove }) {
  if (!tag) return null;
  const p = TAG_PALETTE[tag.color] || TAG_PALETTE.tan;
  return (
    <span className="rt-tag-chip" style={{ background: p.bg, color: p.ink }}>
      {tag.name}
      {removable && (
        <button
          type="button"
          className="rt-tag-x"
          onClick={onRemove}
          aria-label={`Remove ${tag.name}`}
        >
          <Icons.Close size={10} />
        </button>
      )}
    </span>
  );
}
