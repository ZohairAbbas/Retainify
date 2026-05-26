// Retainify — Email Visual Editor
// Block-based editor that opens as a full-page takeover from the flow builder.
// Edits the email node's blocks/brand; on save the flow builder's inline preview updates.

import { useState, useRef, useEffect, useMemo } from "react";
import Icons from "./ui/Icons.jsx";

// ── Block factory ──────────────────────────────────────────────────────────
const bid = () => "b_" + Math.random().toString(36).slice(2, 7);

const BLOCK_LIBRARY = [
  { group: "Basic", items: [
    { type: "heading",   icon: "Heading1",     label: "Heading"   },
    { type: "paragraph", icon: "Type",         label: "Paragraph" },
    { type: "button",    icon: "Button",       label: "Button"    },
    { type: "image",     icon: "Image",        label: "Image"     },
    { type: "logo",      icon: "Logo",         label: "Logo"      },
  ]},
  { group: "Layout", items: [
    { type: "spacer",  icon: "Spacer",  label: "Spacer"  },
    { type: "divider", icon: "Divider", label: "Divider" },
  ]},
  { group: "Commerce", items: [
    { type: "product",  icon: "ProductGrid", label: "Product grid"   },
    { type: "discount", icon: "Discount",    label: "Discount code"  },
  ]},
  { group: "Structure", items: [
    { type: "footer", icon: "Footer", label: "Footer" },
  ]},
];

function makeBlock(type, node) {
  switch (type) {
    case "logo":      return { id: bid(), type, text: "YOUR STORE", align: "center", size: "medium" };
    case "heading":   return { id: bid(), type, html: "A new heading", level: 2, align: "left" };
    case "paragraph": return { id: bid(), type, html: "Write something compelling. <strong>Bold</strong> and <em>italic</em> work too.", align: "left" };
    case "button":    return { id: bid(), type, text: "Shop now", url: "#", align: "center", fill: "filled" };
    case "image":     return { id: bid(), type, src: "", alt: "", align: "full", height: 220 };
    case "spacer":    return { id: bid(), type, height: 32 };
    case "divider":   return { id: bid(), type, style: "solid" };
    case "product":   return { id: bid(), type, count: 3, showPrice: true };
    case "discount":  return { id: bid(), type, code: `SAVE${node?.discountPct || 10}`, percent: node?.discountPct || 10, label: "A little gift for you" };
    case "footer":    return { id: bid(), type, storeName: "Your Store", address: "123 Main St", unsubscribe: true };
    default: return null;
  }
}

function defaultBlocks(node) {
  const blocks = [
    { id: bid(), type: "logo", text: "YOUR STORE", align: "center", size: "medium" },
    { id: bid(), type: "image", src: "", alt: "", align: "full", height: 240 },
    { id: bid(), type: "heading", html: node.subject || "Welcome to the family", level: 1, align: "center" },
    { id: bid(), type: "paragraph", html: "Hi <strong>{first_name}</strong>, thanks for joining us. We hand-pick a few favourites each week — here's something we think you'll love.", align: "center" },
  ];
  if (node.discountPct > 0) {
    blocks.push({ id: bid(), type: "discount", code: `WELCOME${node.discountPct}`, percent: node.discountPct, label: "A welcome gift, on us" });
  }
  blocks.push({ id: bid(), type: "button", text: "Shop the collection", url: "#", align: "center", fill: "filled" });
  blocks.push({ id: bid(), type: "footer", storeName: "Your Store", address: "123 Main St", unsubscribe: true });
  return blocks;
}

export const DEFAULT_BRAND = {
  logoText: "YOUR STORE",
  accent: "#1F3D2F",
  bg: "#FFFFFF",
  fontPair: "editorial",
};

const FONT_PAIRS = {
  editorial: { display: "Instrument Serif, Cambria, serif", body: "Geist, system-ui, sans-serif", label: "Editorial" },
  modern:    { display: "Geist, system-ui, sans-serif",     body: "Geist, system-ui, sans-serif", label: "Modern" },
  classic:   { display: "Georgia, Cambria, serif",          body: "Georgia, Cambria, serif",      label: "Classic" },
};

const ACCENT_SWATCHES = [
  { name: "Forest",     value: "#1F3D2F" },
  { name: "Ink",        value: "#14201A" },
  { name: "Navy",       value: "#25406A" },
  { name: "Plum",       value: "#5A2E5A" },
  { name: "Terracotta", value: "#9A4A2E" },
  { name: "Lime",       value: "#C5CC3E" },
];

const BG_SWATCHES = [
  { name: "White",  value: "#FFFFFF" },
  { name: "Paper",  value: "#FAF6EC" },
  { name: "Cream",  value: "#F4EFE4" },
  { name: "Sand",   value: "#EFE8D7" },
];

const MERGE_TAGS = ["{first_name}", "{last_name}", "{store_name}", "{discount_code}", "{cart_url}"];

function formatPrice(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount || "");
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `${currency || "$"} ${n.toFixed(2)}`;
  }
}

// ── Block view (renders inside canvas) ─────────────────────────────────────
function BlockView({ block, brand, isPreview, onInlineEdit }) {
  const align = block.align || "left";
  const alignStyle = { textAlign: align === "full" ? "left" : align };
  const fonts = FONT_PAIRS[brand.fontPair] || FONT_PAIRS.editorial;

  if (block.type === "logo") {
    const sizes = { small: 14, medium: 18, large: 24 };
    return (
      <div className="rt-emb-logo" style={{ textAlign: block.align, fontFamily: fonts.display, fontSize: sizes[block.size] || 18 }}>
        {block.text}
      </div>
    );
  }
  if (block.type === "heading") {
    const sizes = { 1: 32, 2: 24, 3: 18 };
    return (
      <div
        className={`rt-emb-text rt-emb-heading${!isPreview ? " rt-emb-editable" : ""}`}
        contentEditable={!isPreview}
        suppressContentEditableWarning
        onBlur={(e) => onInlineEdit && onInlineEdit({ html: e.currentTarget.innerHTML })}
        style={{ ...alignStyle, fontFamily: fonts.display, fontSize: sizes[block.level] || 24, lineHeight: 1.18, fontWeight: 400, letterSpacing: "-0.01em", color: "#14201A" }}
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    );
  }
  if (block.type === "paragraph") {
    return (
      <div
        className={`rt-emb-text rt-emb-paragraph${!isPreview ? " rt-emb-editable" : ""}`}
        contentEditable={!isPreview}
        suppressContentEditableWarning
        onBlur={(e) => onInlineEdit && onInlineEdit({ html: e.currentTarget.innerHTML })}
        style={{ ...alignStyle, fontFamily: fonts.body, fontSize: 15, lineHeight: 1.6, color: "#2D362F" }}
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    );
  }
  if (block.type === "button") {
    const filled = block.fill === "filled";
    return (
      <div style={{ textAlign: block.align }}>
        <a className="rt-emb-button"
           href={isPreview ? block.url : undefined}
           style={{
             background: filled ? brand.accent : "transparent",
             color: filled ? "#fff" : brand.accent,
             borderColor: brand.accent,
             fontFamily: fonts.body,
           }}>
          {block.text}
        </a>
      </div>
    );
  }
  if (block.type === "image") {
    if (block.src) {
      return <img src={block.src} alt={block.alt || ""} style={{ width: "100%", display: "block" }} />;
    }
    return (
      <div className="rt-emb-image-placeholder" style={{ height: block.height }}>
        <Icons.Image size={20} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, marginTop: 6 }}>{block.label || "Image"}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, marginTop: 2, color: "var(--ink-4)" }}>
          Upload from the inspector →
        </span>
      </div>
    );
  }
  if (block.type === "spacer") {
    return <div className="rt-emb-spacer" style={{ height: block.height }} />;
  }
  if (block.type === "divider") {
    return <div className="rt-emb-divider" style={{ borderTopStyle: block.style }} />;
  }
  if (block.type === "product") {
    const cols = block.count || 3;
    const pinned = block.products || [];
    const slots = pinned.length > 0 ? pinned.slice(0, cols) : Array.from({ length: cols }).map(() => null);
    return (
      <div className="rt-emb-products" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {slots.map((p, i) => (
          <div key={p?.id || i} className="rt-emb-product">
            <div className="rt-emb-product-img" style={p?.image ? { background: `url(${p.image}) center/cover` } : undefined}>
              {!p?.image && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-4)" }}>
                  {p ? "no image" : "top seller " + (i + 1)}
                </span>
              )}
            </div>
            <div className="rt-emb-product-name" style={{ fontFamily: fonts.body }}>
              {p?.title || "Product name"}
            </div>
            {block.showPrice && (
              <div className="rt-emb-product-price" style={{ fontFamily: fonts.body }}>
                {p?.price ? formatPrice(p.price, p.currency) : "$48"}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "discount") {
    return (
      <div className="rt-emb-discount" style={{ borderColor: brand.accent }}>
        <div className="rt-emb-discount-label" style={{ fontFamily: fonts.body, color: brand.accent }}>{block.label}</div>
        <div className="rt-emb-discount-code" style={{ fontFamily: "var(--font-mono)", color: "#14201A" }}>{block.code}</div>
        <div className="rt-emb-discount-percent" style={{ fontFamily: fonts.body }}>{block.percent}% off your first order</div>
      </div>
    );
  }
  if (block.type === "footer") {
    return (
      <div className="rt-emb-footer" style={{ fontFamily: fonts.body }}>
        <div className="rt-emb-footer-store">{block.storeName}</div>
        <div className="rt-emb-footer-addr">{block.address}</div>
        {block.unsubscribe && (
          <div className="rt-emb-footer-links">
            <a>Unsubscribe</a><span>·</span><a>View in browser</a><span>·</span><a>Update preferences</a>
          </div>
        )}
      </div>
    );
  }
  return null;
}

// ── Block wrapper (selection + handles) ────────────────────────────────────
function BlockWrapper({ block, brand, selected, onSelect, onMove, onDuplicate, onDelete, onInlineEdit, canMoveUp, canMoveDown }) {
  return (
    <div
      className={`rt-emb-wrap${selected ? " rt-emb-selected" : ""}`}
      onClick={(e) => { e.stopPropagation(); onSelect(block.id); }}
    >
      <BlockView block={block} brand={brand} isPreview={false} onInlineEdit={onInlineEdit} />
      {selected && (
        <div className="rt-emb-tools" onClick={(e) => e.stopPropagation()}>
          <button title="Move up" disabled={!canMoveUp} onClick={() => onMove(block.id, -1)}><Icons.ArrowUp size={12} /></button>
          <button title="Move down" disabled={!canMoveDown} onClick={() => onMove(block.id, 1)}><Icons.ArrowDown size={12} /></button>
          <button title="Duplicate" onClick={() => onDuplicate(block.id)}><Icons.Copy size={12} /></button>
          <button title="Delete" onClick={() => onDelete(block.id)}><Icons.Trash size={12} /></button>
        </div>
      )}
    </div>
  );
}

// ── Insert + button between blocks ─────────────────────────────────────────
function InsertGap({ onAdd, idx, openId, setOpenId }) {
  const id = `gap-${idx}`;
  const open = openId === id;
  return (
    <div className="rt-emb-gap">
      <button className="rt-emb-gap-btn" onClick={(e) => { e.stopPropagation(); setOpenId(open ? null : id); }}>
        <Icons.Plus size={12} />
      </button>
      {open && (
        <>
          <div className="rt-emb-veil" onClick={() => setOpenId(null)} />
          <div className="rt-emb-add-pop">
            {BLOCK_LIBRARY.map((grp) => (
              <div key={grp.group} className="rt-emb-add-grp">
                <div className="rt-emb-add-grp-h t-micro muted">{grp.group}</div>
                <div className="rt-emb-add-list">
                  {grp.items.map((it) => {
                    const Icon = Icons[it.icon];
                    return (
                      <button key={it.type} className="rt-emb-add-item"
                              onClick={() => { onAdd(it.type, idx); setOpenId(null); }}>
                        {Icon && <Icon size={14} />}
                        <span>{it.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Rich text floating toolbar ─────────────────────────────────────────────
function RichTextToolbar({ block, onUpdate }) {
  if (!block || (block.type !== "paragraph" && block.type !== "heading")) return null;
  const exec = (cmd, value = null) => document.execCommand(cmd, false, value);
  const link = () => {
    const url = prompt("Link URL", "https://");
    if (url) exec("createLink", url);
  };
  return (
    <div className="rt-emb-rtbar">
      {block.type === "heading" && (
        <>
          <button className={block.level === 1 ? "on" : ""} onClick={() => onUpdate({ level: 1 })} title="Heading 1"><Icons.Heading1 size={14} /></button>
          <button className={block.level === 2 ? "on" : ""} onClick={() => onUpdate({ level: 2 })} title="Heading 2"><Icons.Heading2 size={14} /></button>
          <span className="rt-emb-rtbar-sep" />
        </>
      )}
      <button onClick={() => exec("bold")} title="Bold"><Icons.Bold size={14} /></button>
      <button onClick={() => exec("italic")} title="Italic"><Icons.Italic size={14} /></button>
      <button onClick={() => exec("underline")} title="Underline"><Icons.Underline size={14} /></button>
      <button onClick={link} title="Link"><Icons.LinkIcon size={14} /></button>
      <span className="rt-emb-rtbar-sep" />
      <button onClick={() => onUpdate({ align: "left" })} className={block.align === "left" ? "on" : ""} title="Align left"><Icons.AlignLeft size={14} /></button>
      <button onClick={() => onUpdate({ align: "center" })} className={block.align === "center" ? "on" : ""} title="Align center"><Icons.AlignCenter size={14} /></button>
      <button onClick={() => onUpdate({ align: "right" })} className={block.align === "right" ? "on" : ""} title="Align right"><Icons.AlignRight size={14} /></button>
    </div>
  );
}

// ── Align toggle helper ────────────────────────────────────────────────────
function AlignToggle({ value, onChange }) {
  return (
    <div className="rt-segmented">
      <button className={value === "left" ? "rt-seg-on" : ""} onClick={() => onChange("left")}><Icons.AlignLeft size={13} /></button>
      <button className={value === "center" ? "rt-seg-on" : ""} onClick={() => onChange("center")}><Icons.AlignCenter size={13} /></button>
      <button className={value === "right" ? "rt-seg-on" : ""} onClick={() => onChange("right")}><Icons.AlignRight size={13} /></button>
    </div>
  );
}

// ── Merge tags section ─────────────────────────────────────────────────────
function MergeTagsSection({ onInsert }) {
  return (
    <div className="rt-ins-section">
      <div className="t-micro muted" style={{ marginBottom: 10 }}>Merge tags</div>
      <div className="t-small muted" style={{ marginBottom: 12 }}>Personalize with contact + store data. Click to insert at the cursor.</div>
      <div className="rt-emb-tag-grid">
        {MERGE_TAGS.map((t) => (
          <button key={t} className="rt-emb-tag-chip" onClick={() => onInsert && onInsert(t)}>{t}</button>
        ))}
      </div>
    </div>
  );
}

// ── Image uploader (inside the image block inspector) ─────────────────────
function ImageUploader({ block, onUpdate }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  async function uploadFile(file) {
    if (!file) return;
    setError("");
    if (file.size > 4 * 1024 * 1024) { setError("File is larger than 4MB."); return; }
    if (!/^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(file.type)) {
      setError("Use JPG, PNG, GIF, WebP or SVG.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("alt", block.alt || "");
      const resp = await fetch("/app/api/upload", { method: "POST", body: fd });
      const json = await resp.json();
      if (!resp.ok || !json.ok) throw new Error(json.message || json.error || "Upload failed");
      onUpdate({ src: json.url, width: json.width, height: json.height, alt: block.alt || "" });
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  }

  return (
    <div>
      {block.src ? (
        <div className="rt-emb-image-preview">
          <img src={block.src} alt={block.alt || ""} />
          <div className="rt-emb-image-preview-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Icons.Image size={13} /> Replace
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onUpdate({ src: "", width: 0, height: 0 })}>
              <Icons.Trash size={13} /> Remove
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`rt-emb-uploader${dragOver ? " rt-emb-uploader-drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          style={{ cursor: uploading ? "wait" : "pointer" }}
        >
          <Icons.Image size={20} />
          <div className="t-small" style={{ marginTop: 8 }}>
            {uploading ? "Uploading…" : "Drop an image or"}
          </div>
          {!uploading && (
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
              Browse files
            </button>
          )}
          <div className="field-help" style={{ marginTop: 8 }}>JPG, PNG, GIF, WebP or SVG · up to 4MB</div>
        </div>
      )}
      {error && <div className="rt-emb-uploader-error">{error}</div>}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ── Product picker modal ──────────────────────────────────────────────────
function ProductPickerModal({ initialIds = [], onClose, onConfirm }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(initialIds);
  const [selectedMap, setSelectedMap] = useState({});

  // Hydrate any pre-selected products so we can show them with image + title.
  useEffect(() => {
    if (!initialIds.length) return;
    const params = new URLSearchParams();
    initialIds.forEach((id) => params.append("id", id));
    fetch(`/app/api/products?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return;
        const map = {};
        json.products.forEach((p) => { map[p.id] = p; });
        setSelectedMap(map);
      })
      .catch(() => {});
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      const url = `/app/api/products?q=${encodeURIComponent(query)}`;
      fetch(url)
        .then((r) => r.json())
        .then((json) => {
          if (!json.ok) { setResults([]); return; }
          setResults(json.products || []);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function toggle(p) {
    setSelectedMap((m) => ({ ...m, [p.id]: p }));
    setSelectedIds((ids) => (ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id]));
  }

  function confirm() {
    const products = selectedIds.map((id) => selectedMap[id]).filter(Boolean);
    onConfirm({ ids: selectedIds, products });
  }

  return (
    <div className="rt-emb-pp-backdrop" onClick={onClose}>
      <div className="rt-emb-pp" onClick={(e) => e.stopPropagation()}>
        <div className="rt-emb-pp-head">
          <div>
            <div className="t-micro muted">Pick products</div>
            <div className="t-h2" style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>Your catalog</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><Icons.Close size={14} /></button>
        </div>
        <div className="rt-emb-pp-search">
          <Icons.Search size={14} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products by title…"
          />
        </div>
        <div className="rt-emb-pp-results">
          {loading && <div className="rt-emb-pp-state">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="rt-emb-pp-state">No products found.</div>
          )}
          {!loading && results.map((p) => {
            const checked = selectedIds.includes(p.id);
            return (
              <button key={p.id} className={`rt-emb-pp-row${checked ? " rt-on" : ""}`} onClick={() => toggle(p)}>
                <div className="rt-emb-pp-thumb" style={p.image ? { background: `url(${p.image}) center/cover` } : undefined}>
                  {!p.image && <Icons.Image size={14} />}
                </div>
                <div className="rt-emb-pp-meta">
                  <div className="rt-emb-pp-title">{p.title}</div>
                  <div className="rt-emb-pp-price">{p.price ? formatPrice(p.price, p.currency) : ""}</div>
                </div>
                <span className={`rt-emb-pp-check${checked ? " rt-on" : ""}`}>
                  {checked && <Icons.Check size={12} />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="rt-emb-pp-foot">
          <div className="t-small muted">{selectedIds.length} selected</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={confirm}>Use selected</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Product block inspector (right rail) ──────────────────────────────────
function ProductBlockInspector({ block, onUpdate }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pinned = block.products || [];
  const mode = pinned.length > 0 ? "manual" : "auto";

  function setMode(next) {
    if (next === "auto") onUpdate({ products: [], productIds: [] });
    else setPickerOpen(true);
  }

  function onPickerConfirm({ ids, products }) {
    onUpdate({ productIds: ids, products });
    setPickerOpen(false);
  }

  return (
    <div className="rt-ins-section">
      <label className="field-label">Columns</label>
      <div className="rt-segmented">
        {[2, 3, 4].map((n) => (
          <button key={n} className={block.count === n ? "rt-seg-on" : ""} onClick={() => onUpdate({ count: n })}>{n}</button>
        ))}
      </div>

      <label className="field-label" style={{ marginTop: 14 }}>Source</label>
      <div className="rt-segmented">
        <button className={mode === "auto" ? "rt-seg-on" : ""} onClick={() => setMode("auto")}>Top sellers</button>
        <button className={mode === "manual" ? "rt-seg-on" : ""} onClick={() => setMode("manual")}>Pick products</button>
      </div>

      {mode === "auto" ? (
        <div className="field-help" style={{ marginTop: 10 }}>
          Filled from your last-30-day top sellers at send time.
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="rt-emb-pp-pinned-list">
            {pinned.map((p) => (
              <div key={p.id} className="rt-emb-pp-pinned">
                <div className="rt-emb-pp-thumb sm" style={p.image ? { background: `url(${p.image}) center/cover` } : undefined}>
                  {!p.image && <Icons.Image size={11} />}
                </div>
                <div className="rt-emb-pp-title">{p.title}</div>
                <button
                  className="rt-emb-pp-remove"
                  onClick={() => {
                    const next = pinned.filter((x) => x.id !== p.id);
                    onUpdate({ products: next, productIds: next.map((x) => x.id) });
                  }}
                  aria-label="Remove"
                >
                  <Icons.Close size={11} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 10, width: "100%" }} onClick={() => setPickerOpen(true)}>
            <Icons.Plus size={13} /> {pinned.length ? "Edit selection" : "Pick products"}
          </button>
        </div>
      )}

      <label className="rt-toggle" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={block.showPrice} onChange={(e) => onUpdate({ showPrice: e.target.checked })} />
        <span className="rt-toggle-switch" />
        <span>Show price</span>
      </label>

      {pickerOpen && (
        <ProductPickerModal
          initialIds={pinned.map((p) => p.id)}
          onClose={() => setPickerOpen(false)}
          onConfirm={onPickerConfirm}
        />
      )}
    </div>
  );
}

// ── Block inspector (right rail when block selected) ───────────────────────
function BlockInspector({ block, onUpdate, onDelete, onInsertMergeTag }) {
  if (!block) return null;
  const label = {
    logo: "Logo", heading: "Heading", paragraph: "Paragraph", button: "Button",
    image: "Image", spacer: "Spacer", divider: "Divider", product: "Product grid",
    discount: "Discount code", footer: "Footer",
  }[block.type];

  return (
    <div className="rt-ins">
      <div className="rt-ins-head">
        <div className="rt-node-glyph rt-tint-email"><Icons.Mail size={14} /></div>
        <div>
          <div className="t-micro muted">Block</div>
          <div className="t-h2" style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>{label}</div>
        </div>
      </div>

      {block.type === "logo" && (
        <div className="rt-ins-section">
          <label className="field-label">Wordmark text</label>
          <input className="input" value={block.text} onChange={(e) => onUpdate({ text: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Size</label>
          <div className="rt-segmented">
            {["small", "medium", "large"].map((s) => (
              <button key={s} className={block.size === s ? "rt-seg-on" : ""} onClick={() => onUpdate({ size: s })} style={{ textTransform: "capitalize" }}>{s}</button>
            ))}
          </div>
          <label className="field-label" style={{ marginTop: 14 }}>Alignment</label>
          <AlignToggle value={block.align} onChange={(v) => onUpdate({ align: v })} />
        </div>
      )}

      {block.type === "heading" && (
        <>
          <div className="rt-ins-section">
            <label className="field-label">Level</label>
            <div className="rt-segmented">
              {[1, 2, 3].map((l) => (
                <button key={l} className={block.level === l ? "rt-seg-on" : ""} onClick={() => onUpdate({ level: l })}>H{l}</button>
              ))}
            </div>
            <label className="field-label" style={{ marginTop: 14 }}>Alignment</label>
            <AlignToggle value={block.align} onChange={(v) => onUpdate({ align: v })} />
            <div className="field-help" style={{ marginTop: 10 }}>Click the heading on the canvas to edit text.</div>
          </div>
          <MergeTagsSection onInsert={onInsertMergeTag} />
        </>
      )}

      {block.type === "paragraph" && (
        <>
          <div className="rt-ins-section">
            <label className="field-label">Alignment</label>
            <AlignToggle value={block.align} onChange={(v) => onUpdate({ align: v })} />
            <div className="field-help" style={{ marginTop: 10 }}>Click the paragraph on the canvas to edit.</div>
          </div>
          <MergeTagsSection onInsert={onInsertMergeTag} />
        </>
      )}

      {block.type === "button" && (
        <div className="rt-ins-section">
          <label className="field-label">Button text</label>
          <input className="input" value={block.text} onChange={(e) => onUpdate({ text: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Link URL</label>
          <input className="input" value={block.url} onChange={(e) => onUpdate({ url: e.target.value })} placeholder="https://" />
          <label className="field-label" style={{ marginTop: 14 }}>Style</label>
          <div className="rt-segmented">
            {[["filled", "Filled"], ["outline", "Outline"]].map(([k, l]) => (
              <button key={k} className={block.fill === k ? "rt-seg-on" : ""} onClick={() => onUpdate({ fill: k })}>{l}</button>
            ))}
          </div>
          <label className="field-label" style={{ marginTop: 14 }}>Alignment</label>
          <AlignToggle value={block.align} onChange={(v) => onUpdate({ align: v })} />
        </div>
      )}

      {block.type === "image" && (
        <div className="rt-ins-section">
          <ImageUploader block={block} onUpdate={onUpdate} />
          <label className="field-label" style={{ marginTop: 14 }}>Alt text</label>
          <input className="input" value={block.alt || ""} placeholder="Describe the image (for accessibility)" onChange={(e) => onUpdate({ alt: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Width</label>
          <div className="rt-segmented">
            {[["full", "Full bleed"], ["wide", "Wide"], ["small", "Inset"]].map(([k, l]) => (
              <button key={k} className={block.align === k ? "rt-seg-on" : ""} onClick={() => onUpdate({ align: k })}>{l}</button>
            ))}
          </div>
          <label className="field-label" style={{ marginTop: 14 }}>Height (px)</label>
          <input className="input" type="number" value={block.height} onChange={(e) => onUpdate({ height: +e.target.value })} />
        </div>
      )}

      {block.type === "spacer" && (
        <div className="rt-ins-section">
          <label className="field-label">Height ({block.height}px)</label>
          <input type="range" min="8" max="120" step="4" value={block.height} onChange={(e) => onUpdate({ height: +e.target.value })} className="rt-emb-range" />
          <div className="rt-emb-range-marks"><span>8</span><span>64</span><span>120</span></div>
        </div>
      )}

      {block.type === "divider" && (
        <div className="rt-ins-section">
          <label className="field-label">Line style</label>
          <div className="rt-segmented">
            {["solid", "dashed", "dotted"].map((s) => (
              <button key={s} className={block.style === s ? "rt-seg-on" : ""} onClick={() => onUpdate({ style: s })} style={{ textTransform: "capitalize" }}>{s}</button>
            ))}
          </div>
        </div>
      )}

      {block.type === "product" && (
        <ProductBlockInspector block={block} onUpdate={onUpdate} />
      )}

      {block.type === "discount" && (
        <div className="rt-ins-section">
          <label className="field-label">Caption</label>
          <input className="input" value={block.label} onChange={(e) => onUpdate({ label: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Discount code</label>
          <input className="input" style={{ fontFamily: "var(--font-mono)" }} value={block.code} onChange={(e) => onUpdate({ code: e.target.value.toUpperCase() })} />
          <label className="field-label" style={{ marginTop: 14 }}>Percentage</label>
          <input className="input" type="number" min="0" max="90" value={block.percent} onChange={(e) => onUpdate({ percent: +e.target.value })} />
          <div className="rt-emb-linked-note">
            <Icons.Bolt size={12} />
            <span>Synced from the flow step's discount field.</span>
          </div>
        </div>
      )}

      {block.type === "footer" && (
        <div className="rt-ins-section">
          <label className="field-label">Store name</label>
          <input className="input" value={block.storeName} onChange={(e) => onUpdate({ storeName: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Postal address</label>
          <textarea className="textarea" value={block.address} onChange={(e) => onUpdate({ address: e.target.value })} />
          <label className="rt-toggle" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={block.unsubscribe} onChange={(e) => onUpdate({ unsubscribe: e.target.checked })} />
            <span className="rt-toggle-switch" />
            <span>Show unsubscribe links</span>
          </label>
          <div className="field-help" style={{ marginTop: 10 }}>Legally required in most regions.</div>
        </div>
      )}

      <div className="rt-ins-section">
        <button className="btn btn-danger" style={{ width: "100%" }} onClick={() => onDelete(block.id)}>
          <Icons.Trash size={13} /> Delete block
        </button>
      </div>
    </div>
  );
}

// ── Email settings + brand kit (right rail when nothing selected) ──────────
function EmailSettings({ node, brand, onNode, onBrand }) {
  return (
    <div className="rt-ins">
      <div className="rt-ins-head">
        <div className="rt-node-glyph rt-tint-email"><Icons.Mail size={14} /></div>
        <div>
          <div className="t-micro muted">Editing</div>
          <div className="t-h2" style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>{node.emailName || "Email"}</div>
        </div>
      </div>

      <div className="rt-ins-section">
        <div className="t-micro muted" style={{ marginBottom: 12 }}>Inbox</div>
        <label className="field-label">Subject</label>
        <input className="input" value={node.subject || ""} onChange={(e) => onNode({ subject: e.target.value })} />
        <div className="field-help">{50 - (node.subject || "").length} characters remaining</div>
        <label className="field-label" style={{ marginTop: 12 }}>Preview text</label>
        <input className="input" value={node.previewText || ""} placeholder="A short preview shown in the inbox" onChange={(e) => onNode({ previewText: e.target.value })} />
      </div>

      <div className="rt-ins-section">
        <div className="t-micro muted" style={{ marginBottom: 12 }}>Brand kit</div>
        <label className="field-label">Wordmark / Logo</label>
        <input className="input" value={brand.logoText} onChange={(e) => onBrand({ logoText: e.target.value })} />
        <div className="rt-emb-upload-sm">
          <button className="btn btn-secondary btn-sm" style={{ width: "100%" }}>
            <Icons.Image size={13} /> Upload logo (svg, png)
          </button>
        </div>

        <label className="field-label" style={{ marginTop: 16 }}>Accent color</label>
        <div className="rt-emb-swatches">
          {ACCENT_SWATCHES.map((s) => (
            <button key={s.value} className={`rt-emb-swatch${brand.accent === s.value ? " rt-on" : ""}`}
                    style={{ background: s.value }} title={s.name}
                    onClick={() => onBrand({ accent: s.value })}>
              {brand.accent === s.value && <Icons.Check size={14} />}
            </button>
          ))}
        </div>

        <label className="field-label" style={{ marginTop: 16 }}>Background</label>
        <div className="rt-emb-swatches">
          {BG_SWATCHES.map((s) => (
            <button key={s.value} className={`rt-emb-swatch rt-emb-swatch-light${brand.bg === s.value ? " rt-on" : ""}`}
                    style={{ background: s.value }} title={s.name}
                    onClick={() => onBrand({ bg: s.value })}>
              {brand.bg === s.value && <Icons.Check size={14} />}
            </button>
          ))}
        </div>

        <label className="field-label" style={{ marginTop: 16 }}>Font pairing</label>
        <div className="rt-emb-fonts">
          {Object.entries(FONT_PAIRS).map(([k, v]) => (
            <button key={k} className={`rt-emb-font${brand.fontPair === k ? " rt-on" : ""}`}
                    onClick={() => onBrand({ fontPair: k })}>
              <div style={{ fontFamily: v.display, fontSize: 17, lineHeight: 1, marginBottom: 4 }}>Aa</div>
              <div style={{ fontFamily: v.body, fontSize: 11, color: "var(--ink-3)" }}>{v.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rt-ins-section">
        <div className="rt-emb-soon-card">
          <Icons.Sparkles size={14} />
          <div>
            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4 }}>AI subject line suggestions</div>
            <div className="t-small muted">Coming soon — Retainify will draft subject variants from your email content.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Email canvas ───────────────────────────────────────────────────────────
function EmailCanvas({ blocks, brand, selectedId, viewport, onSelect, onInsert, onUpdateBlock, onMove, onDuplicate, onDelete, openGapId, setOpenGapId }) {
  const width = viewport === "mobile" ? 375 : 600;
  return (
    <div className="rt-emb-stage" onClick={() => onSelect(null)}>
      <div className="rt-emb-inbox-hint" style={{ width }}>
        <div className="rt-emb-inbox-from">Your Store <span className="muted">· yourstore.com</span></div>
        <div className="rt-emb-inbox-time">11:42 AM</div>
      </div>
      <div className="rt-emb-frame" style={{ width, background: brand.bg }} onClick={(e) => e.stopPropagation()}>
        <InsertGap idx={0} onAdd={onInsert} openId={openGapId} setOpenId={setOpenGapId} />
        {blocks.map((b, i) => (
          <div key={b.id}>
            <BlockWrapper
              block={b}
              brand={brand}
              selected={selectedId === b.id}
              onSelect={onSelect}
              onMove={onMove}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              onInlineEdit={(patch) => onUpdateBlock(b.id, patch)}
              canMoveUp={i > 0}
              canMoveDown={i < blocks.length - 1}
            />
            <InsertGap idx={i + 1} onAdd={onInsert} openId={openGapId} setOpenId={setOpenGapId} />
          </div>
        ))}
        {blocks.length === 0 && (
          <div className="rt-emb-empty">
            <div className="t-h3" style={{ marginBottom: 6 }}>Start with a block</div>
            <div className="t-small muted">Click the + above, or pick from the library on the left.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Block library left rail ────────────────────────────────────────────────
function BlockLibraryRail({ onAdd }) {
  return (
    <div className="rt-emb-left">
      <div className="rt-emb-library-head">
        <div className="t-micro muted">Blocks</div>
      </div>
      {BLOCK_LIBRARY.map((grp) => (
        <div key={grp.group} className="rt-emb-lib-grp">
          <div className="rt-emb-lib-grp-h">{grp.group}</div>
          <div className="rt-emb-lib-grid">
            {grp.items.map((it) => {
              const Icon = Icons[it.icon];
              return (
                <button key={it.type} className="rt-emb-lib-item" onClick={() => onAdd(it.type)}>
                  {Icon && <Icon size={16} />}
                  <span>{it.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Mini block preview rendered inside the flow canvas card ───────────────
export function RenderedBlockPreview({ node }) {
  const brand = node.emailBrand || DEFAULT_BRAND;
  const blocks = node.emailBlocks || [];
  const stripTags = (html) => (html || "").replace(/<[^>]+>/g, "");
  return (
    <div className="rt-email-preview-rendered">
      {blocks.slice(0, 6).map((b) => {
        if (b.type === "logo") return <div key={b.id} className="rt-emp-block rt-emp-logo" style={{ textAlign: b.align }}>{b.text}</div>;
        if (b.type === "heading") return <div key={b.id} className="rt-emp-block rt-emp-heading" style={{ textAlign: b.align }}>{stripTags(b.html)}</div>;
        if (b.type === "paragraph") return <div key={b.id} className="rt-emp-block rt-emp-paragraph" style={{ textAlign: b.align }}>{stripTags(b.html).slice(0, 120)}{stripTags(b.html).length > 120 ? "…" : ""}</div>;
        if (b.type === "button") return <div key={b.id} className="rt-emp-block" style={{ textAlign: b.align }}><span className="rt-emp-button" style={{ background: b.fill === "filled" ? brand.accent : "transparent", color: b.fill === "filled" ? "#fff" : brand.accent, border: "1px solid " + brand.accent }}>{b.text}</span></div>;
        if (b.type === "image") return <div key={b.id} className="rt-emp-block rt-emp-image" />;
        if (b.type === "discount") return <div key={b.id} className="rt-emp-block rt-emp-discount" style={{ borderColor: brand.accent, color: brand.accent }}>{b.label} · <span className="rt-emp-discount-code">{b.code}</span></div>;
        if (b.type === "divider") return <div key={b.id} className="rt-emp-block rt-emp-divider" />;
        if (b.type === "spacer") return <div key={b.id} style={{ height: Math.min(b.height / 3, 16) }} />;
        if (b.type === "footer") return <div key={b.id} className="rt-emp-block rt-emp-footer">{b.storeName}</div>;
        if (b.type === "product") return <div key={b.id} className="rt-emp-block rt-emp-image" style={{ height: 24 }} />;
        return null;
      })}
    </div>
  );
}

// ── Main editor ────────────────────────────────────────────────────────────
export default function EmailEditor({ flow, node, onBack, onSave }) {
  const [blocks, setBlocks] = useState(() => node.emailBlocks?.length ? node.emailBlocks : defaultBlocks(node));
  const [brand, setBrand] = useState(() => node.emailBrand || DEFAULT_BRAND);
  const [nodeMeta, setNodeMeta] = useState({ subject: node.subject || "", previewText: node.previewText || "", emailName: node.emailName || "" });
  const [selectedId, setSelectedId] = useState(null);
  const [viewport, setViewport] = useState("desktop");
  const [openGapId, setOpenGapId] = useState(null);
  const [saved, setSaved] = useState(true);

  const selected = useMemo(() => blocks.find((b) => b.id === selectedId), [selectedId, blocks]);

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setSaved(false);
  }, [blocks, brand, nodeMeta]);

  function updateBlock(id, patch) {
    setBlocks((bs) => bs.map((b) => b.id === id ? { ...b, ...patch } : b));
  }
  function insertBlock(type, idx) {
    const nb = makeBlock(type, node);
    if (!nb) return;
    setBlocks((bs) => {
      const next = [...bs];
      next.splice(idx, 0, nb);
      return next;
    });
    setSelectedId(nb.id);
  }
  function addToEnd(type) { insertBlock(type, blocks.length); }
  function moveBlock(id, dir) {
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function duplicateBlock(id) {
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      if (i < 0) return bs;
      const copy = { ...bs[i], id: bid() };
      const next = [...bs];
      next.splice(i + 1, 0, copy);
      return next;
    });
  }
  function deleteBlock(id) {
    setBlocks((bs) => bs.filter((b) => b.id !== id));
    setSelectedId(null);
  }
  function insertMergeTag(tag) {
    const el = document.activeElement;
    if (el && el.isContentEditable) document.execCommand("insertText", false, tag);
  }

  function save() {
    onSave({
      ...node,
      subject: nodeMeta.subject,
      previewText: nodeMeta.previewText,
      emailBlocks: blocks,
      emailBrand: brand,
    });
    setSaved(true);
  }
  function closeAndSave() { save(); onBack(); }

  return (
    <div className="rt-builder-shell rt-emb-builder">
      {/* Top bar */}
      <div className="rt-builder-topbar">
        <div className="rt-bt-left">
          <button className="btn btn-ghost btn-icon" onClick={closeAndSave} aria-label="Back to flow">
            <Icons.ArrowBack size={16} />
          </button>
          <div className="rt-bt-flowmeta">
            <div className="rt-emb-crumbs">
              <span className="muted">{flow.name}</span>
              <Icons.Chevron size={12} />
              <span>Email</span>
            </div>
            <input
              className="rt-bt-name rt-emb-subject"
              value={nodeMeta.subject}
              onChange={(e) => setNodeMeta((m) => ({ ...m, subject: e.target.value }))}
              placeholder="Email subject"
            />
          </div>
        </div>

        <div className="rt-bt-center">
          <div className="rt-view-toggle">
            <button className={viewport === "desktop" ? "rt-vt-on" : ""} onClick={() => setViewport("desktop")}>
              <Icons.Desktop size={13} /> Desktop
            </button>
            <button className={viewport === "mobile" ? "rt-vt-on" : ""} onClick={() => setViewport("mobile")}>
              <Icons.Phone size={13} /> Mobile
            </button>
          </div>
        </div>

        <div className="rt-bt-right">
          <span className="rt-emb-saved">{saved ? "Saved" : "Unsaved changes"}</span>
          <button className="btn btn-ghost"><Icons.Send size={13} /> Send test</button>
          <span className="rt-bt-divider" />
          <button className="btn btn-secondary" onClick={save}>Save draft</button>
          <button className="btn btn-primary" onClick={closeAndSave}>Done</button>
        </div>
      </div>

      {/* Body */}
      <div className="rt-builder-body rt-emb-builder">
        <BlockLibraryRail onAdd={addToEnd} />

        <div className="rt-builder-canvas rt-emb-builder">
          {selected && (
            <RichTextToolbar block={selected} onUpdate={(patch) => updateBlock(selected.id, patch)} />
          )}
          <EmailCanvas
            blocks={blocks}
            brand={brand}
            selectedId={selectedId}
            viewport={viewport}
            onSelect={setSelectedId}
            onInsert={insertBlock}
            onUpdateBlock={updateBlock}
            onMove={moveBlock}
            onDuplicate={duplicateBlock}
            onDelete={deleteBlock}
            openGapId={openGapId}
            setOpenGapId={setOpenGapId}
          />
        </div>

        <div className="rt-builder-inspector">
          {selected ? (
            <BlockInspector
              block={selected}
              onUpdate={(patch) => updateBlock(selected.id, patch)}
              onDelete={deleteBlock}
              onInsertMergeTag={insertMergeTag}
            />
          ) : (
            <EmailSettings
              node={{ ...node, subject: nodeMeta.subject, previewText: nodeMeta.previewText }}
              brand={brand}
              onNode={(patch) => setNodeMeta((m) => ({ ...m, ...patch }))}
              onBrand={(patch) => setBrand((b) => ({ ...b, ...patch }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}
