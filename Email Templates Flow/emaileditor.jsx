// Retainify — Email Visual Editor
// Block-based editor that opens as a full-page takeover from the flow builder.
// Edits the email node's `blocks` array; on save the flow builder's inline preview updates.

const { useState: useStateE, useRef: useRefE, useEffect: useEffectE, useMemo: useMemoE } = React;

// ── Block factory ──────────────────────────────────────────────────────────
const bid = () => 'b_' + Math.random().toString(36).slice(2, 7);

const BLOCK_LIBRARY = [
  { group: 'Basic', items: [
    { type: 'eyebrow',   icon: 'Type',         label: 'Eyebrow'   },
    { type: 'heading',   icon: 'Heading1',     label: 'Heading'   },
    { type: 'paragraph', icon: 'Type',         label: 'Paragraph' },
    { type: 'button',    icon: 'Button',       label: 'Button'    },
    { type: 'image',     icon: 'Image',        label: 'Image'     },
    { type: 'logo',      icon: 'Logo',         label: 'Logo'      },
    { type: 'signature', icon: 'Italic',       label: 'Signature' },
  ]},
  { group: 'Layout', items: [
    { type: 'spacer',  icon: 'Spacer',  label: 'Spacer'  },
    { type: 'divider', icon: 'Divider', label: 'Divider' },
  ]},
  { group: 'Commerce', items: [
    { type: 'product',  icon: 'ProductGrid', label: 'Product grid' },
    { type: 'discount', icon: 'Discount',    label: 'Discount code' },
    { type: 'bignumber', icon: 'Discount',   label: 'Big number'    },
  ]},
  { group: 'Structure', items: [
    { type: 'footer', icon: 'Footer', label: 'Footer' },
  ]},
];

function makeBlock(type, node) {
  switch (type) {
    case 'logo':      return { id: bid(), type, text: 'NORTHHILL', align: 'center', size: 'medium' };
    case 'eyebrow':   return { id: bid(), type, text: 'A NEW LETTER · NO. 14', align: 'center' };
    case 'heading':   return { id: bid(), type, html: 'A new heading', level: 2, align: 'left' };
    case 'paragraph': return { id: bid(), type, html: 'Write something compelling. <strong>Bold</strong> and <em>italic</em> work too.', align: 'left' };
    case 'signature': return { id: bid(), type, text: 'with love,\nAnna', align: 'left' };
    case 'button':    return { id: bid(), type, text: 'Shop now', url: '#', align: 'center', fill: 'filled' };
    case 'image':     return { id: bid(), type, placeholder: true, label: 'Drop an image', align: 'full', height: 220 };
    case 'spacer':    return { id: bid(), type, height: 32 };
    case 'divider':   return { id: bid(), type, style: 'solid' };
    case 'product':   return { id: bid(), type, count: 3, showPrice: true };
    case 'discount':  return { id: bid(), type, code: `SAVE${node?.discount || 10}`, percent: node?.discount || 10, label: 'A little gift for you' };
    case 'bignumber': return { id: bid(), type, value: '15', unit: '% OFF', caption: 'On your next order', align: 'center' };
    case 'footer':    return { id: bid(), type, storeName: 'Northhill & Co.', address: '142 Mercer St, New York, NY 10012', unsubscribe: true };
    default: return null;
  }
}

function defaultBlocks(node) {
  const blocks = [
    { id: bid(), type: 'logo', text: 'NORTHHILL', align: 'center', size: 'medium' },
    { id: bid(), type: 'image', placeholder: true, label: 'Hero image', align: 'full', height: 240 },
    { id: bid(), type: 'heading', html: node.subject || 'Welcome to the family', level: 1, align: 'center' },
    { id: bid(), type: 'paragraph', html: "Hi <strong>{first_name}</strong>, thanks for joining us. We hand-pick a few favourites each week — here's something we think you'll love.", align: 'center' },
  ];
  if (node.discount > 0) {
    blocks.push({ id: bid(), type: 'discount', code: `WELCOME${node.discount}`, percent: node.discount, label: 'A welcome gift, on us' });
  }
  blocks.push({ id: bid(), type: 'button', text: 'Shop the collection', url: '#', align: 'center', fill: 'filled' });
  blocks.push({ id: bid(), type: 'footer', storeName: 'Northhill & Co.', address: '142 Mercer St, New York, NY 10012', unsubscribe: true });
  return blocks;
}

const DEFAULT_BRAND = {
  logoText: 'NORTHHILL',
  accent: '#1F3D2F',     // forest
  bg: '#FFFFFF',
  ink: '#14201A',
  subInk: '#2D362F',
  fontPair: 'editorial', // editorial | modern | classic | display | mono | hand | brutal | moody
};

const FONT_PAIRS = {
  editorial: { display: '"Instrument Serif", Cambria, Georgia, serif', body: '"Geist", system-ui, sans-serif', label: 'Editorial' },
  modern:    { display: '"Geist", system-ui, sans-serif',              body: '"Geist", system-ui, sans-serif', label: 'Modern' },
  classic:   { display: 'Georgia, Cambria, serif',                     body: 'Georgia, Cambria, serif',        label: 'Classic' },
  display:   { display: '"DM Serif Display", Georgia, serif',          body: '"Geist", system-ui, sans-serif', label: 'Display Serif' },
  mono:      { display: '"Geist Mono", ui-monospace, monospace',       body: '"Geist", system-ui, sans-serif', label: 'Mono' },
  hand:      { display: '"Caveat", "Instrument Serif", cursive',        body: '"Geist", system-ui, sans-serif', label: 'Handwritten' },
  brutal:    { display: '"Archivo Black", "Geist", sans-serif',         body: '"Geist", system-ui, sans-serif', label: 'Bold Display' },
  moody:     { display: '"DM Serif Display", Georgia, serif',          body: '"Geist", system-ui, sans-serif', label: 'Moody Serif', displayItalic: true },
};

const ACCENT_SWATCHES = [
  { name: 'Forest',     value: '#1F3D2F' },
  { name: 'Ink',        value: '#14201A' },
  { name: 'Navy',       value: '#25406A' },
  { name: 'Plum',       value: '#5A2E5A' },
  { name: 'Terracotta', value: '#9A4A2E' },
  { name: 'Lime',       value: '#C5CC3E' },
];

const MERGE_TAGS = ['{first_name}', '{last_name}', '{store_name}', '{discount_code}', '{cart_url}'];

// ── Block view (renders inside canvas) ─────────────────────────────────────
function BlockView({ block, brand, isPreview, onInlineEdit }) {
  const align = block.align || 'left';
  const alignStyle = { textAlign: align === 'full' ? 'left' : align };
  const fonts = FONT_PAIRS[brand.fontPair] || FONT_PAIRS.editorial;
  const ink = brand.ink || '#14201A';
  const subInk = brand.subInk || '#2D362F';
  const accent = brand.accent || '#1F3D2F';
  const displayItalicStyle = fonts.displayItalic ? { fontStyle: 'italic' } : null;

  if (block.type === 'logo') {
    const sizes = { small: 13, medium: 16, large: 22 };
    const isMono = brand.fontPair === 'mono' || brand.fontPair === 'brutal';
    return (
      <div className="rt-emb-logo" style={{
        textAlign: block.align,
        fontFamily: fonts.display,
        fontSize: sizes[block.size] || 16,
        color: ink,
        letterSpacing: isMono ? '0.18em' : '0.06em',
        textTransform: isMono ? 'uppercase' : 'none',
        fontWeight: brand.fontPair === 'brutal' ? 900 : 500,
      }}>
        {block.text}
      </div>
    );
  }
  if (block.type === 'eyebrow') {
    return (
      <div
        className={`rt-emb-eyebrow ${!isPreview ? 'rt-emb-editable' : ''}`}
        contentEditable={!isPreview}
        suppressContentEditableWarning
        onBlur={e => onInlineEdit && onInlineEdit({ text: e.currentTarget.innerText })}
        style={{
          textAlign: block.align,
          fontFamily: fonts.body,
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: subInk,
          opacity: 0.85,
        }}
      >{block.text}</div>
    );
  }
  if (block.type === 'heading') {
    const sizes = { 1: 34, 2: 26, 3: 19 };
    const isBrutal = brand.fontPair === 'brutal';
    return (
      <div
        className={`rt-emb-text rt-emb-heading ${!isPreview ? 'rt-emb-editable' : ''}`}
        contentEditable={!isPreview}
        suppressContentEditableWarning
        onBlur={e => onInlineEdit && onInlineEdit({ html: e.currentTarget.innerHTML })}
        style={{
          ...alignStyle,
          fontFamily: fonts.display,
          fontSize: sizes[block.level] || 26,
          lineHeight: isBrutal ? 1.02 : 1.15,
          fontWeight: isBrutal ? 900 : 400,
          letterSpacing: isBrutal ? '-0.02em' : '-0.012em',
          color: ink,
          textTransform: isBrutal ? 'uppercase' : 'none',
          ...displayItalicStyle,
        }}
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    );
  }
  if (block.type === 'paragraph') {
    return (
      <div
        className={`rt-emb-text rt-emb-paragraph ${!isPreview ? 'rt-emb-editable' : ''}`}
        contentEditable={!isPreview}
        suppressContentEditableWarning
        onBlur={e => onInlineEdit && onInlineEdit({ html: e.currentTarget.innerHTML })}
        style={{ ...alignStyle, fontFamily: fonts.body, fontSize: 15, lineHeight: 1.65, color: subInk }}
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    );
  }
  if (block.type === 'signature') {
    const isHand = brand.fontPair === 'hand';
    return (
      <div
        className={`rt-emb-signature ${!isPreview ? 'rt-emb-editable' : ''}`}
        contentEditable={!isPreview}
        suppressContentEditableWarning
        onBlur={e => onInlineEdit && onInlineEdit({ text: e.currentTarget.innerText })}
        style={{
          textAlign: block.align,
          fontFamily: isHand ? '"Caveat", cursive' : fonts.display,
          fontStyle: isHand ? 'normal' : 'italic',
          fontSize: isHand ? 30 : 22,
          lineHeight: 1.25,
          color: ink,
          whiteSpace: 'pre-line',
        }}
      >{block.text}</div>
    );
  }
  if (block.type === 'bignumber') {
    const isBrutal = brand.fontPair === 'brutal';
    return (
      <div style={{ textAlign: block.align, fontFamily: fonts.display, color: ink }}>
        <div style={{
          fontSize: 96,
          lineHeight: 0.9,
          fontWeight: isBrutal ? 900 : 500,
          letterSpacing: '-0.04em',
          color: accent,
        }}>
          {block.value}<span style={{ fontSize: 40, marginLeft: 4 }}>{block.unit}</span>
        </div>
        {block.caption && <div style={{ marginTop: 10, fontFamily: fonts.body, fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: subInk, fontWeight: 600 }}>{block.caption}</div>}
      </div>
    );
  }
  if (block.type === 'button') {
    const filled = block.fill === 'filled';
    const isBrutal = brand.fontPair === 'brutal';
    const onAccent = brand.onAccent || '#FFFFFF';
    return (
      <div style={{ textAlign: block.align }}>
        <a className="rt-emb-button"
           href={isPreview ? block.url : undefined}
           style={{
             background: filled ? accent : 'transparent',
             color: filled ? onAccent : accent,
             borderColor: accent,
             fontFamily: fonts.body,
             borderRadius: brand.btnRadius != null ? brand.btnRadius : 999,
             letterSpacing: isBrutal ? '0.06em' : '0.04em',
             textTransform: isBrutal ? 'uppercase' : 'none',
             fontWeight: isBrutal ? 700 : 500,
           }}>
          {block.text}
        </a>
      </div>
    );
  }
  if (block.type === 'image') {
    if (block.placeholder) {
      return (
        <div className="rt-emb-image-placeholder" style={(() => {
          const tones = {
            amber:  { from: '#8B7355', to: '#5A4632', ink: '#F4EFE4' },
            rose:   { from: '#C09080', to: '#7A4F45', ink: '#FFF' },
            forest: { from: '#3F5246', to: '#1F3D2F', ink: '#F4EFE4' },
            ink:    { from: '#4A4632', to: '#1F1A12', ink: '#F4EFE4' },
            cream:  { from: '#F0E8D6', to: '#D6C8A2', ink: '#5C625A' },
            peach:  { from: '#F2C49A', to: '#D89766', ink: '#4A2E1F' },
            plum:   { from: '#3A1F4A', to: '#1A0E26', ink: '#D9C8E0' },
            slate:  { from: '#5A6168', to: '#2A2F35', ink: '#E8EAED' },
            bright: { from: '#E5FF36', to: '#B5D018', ink: '#0E0E0E' },
          };
          const t = tones[block.tone] || tones.cream;
          return { height: block.height, background: `linear-gradient(135deg, ${t.from} 0%, ${t.to} 100%)`, color: t.ink, borderColor: 'rgba(0,0,0,0.06)' };
        })()}>
          <Icons.Image size={20} />
          <span className="t-mono" style={{ fontSize: 11, marginTop: 6, opacity: 0.85 }}>{block.label || 'Image'}</span>
          <span className="t-mono" style={{ fontSize: 10, marginTop: 2, opacity: 0.55 }}>{block.align === 'full' ? '600 × ' + block.height : ''}</span>
        </div>
      );
    }
    return <img src={block.src} alt={block.alt || ''} style={{ width: '100%', display: 'block' }} />;
  }
  if (block.type === 'spacer') {
    return <div className="rt-emb-spacer" style={{ height: block.height }} />;
  }
  if (block.type === 'divider') {
    return <div className="rt-emb-divider" style={{ borderTopStyle: block.style, borderTopColor: brand.rule || 'rgba(20,32,26,0.14)' }} />;
  }
  if (block.type === 'product') {
    const cols = block.count || 3;
    return (
      <div className="rt-emb-products" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="rt-emb-product">
            <div className="rt-emb-product-img"><span className="t-mono faint" style={{ fontSize: 10 }}>product {i + 1}</span></div>
            <div className="rt-emb-product-name" style={{ fontFamily: fonts.body }}>Product name</div>
            {block.showPrice && <div className="rt-emb-product-price" style={{ fontFamily: fonts.body }}>$48</div>}
          </div>
        ))}
      </div>
    );
  }
  if (block.type === 'discount') {
    return (
      <div className="rt-emb-discount" style={{ borderColor: accent, background: 'transparent' }}>
        <div className="rt-emb-discount-label" style={{ fontFamily: fonts.body, color: accent }}>{block.label}</div>
        <div className="rt-emb-discount-code" style={{ fontFamily: '"Geist Mono", ui-monospace, monospace', color: ink }}>{block.code}</div>
        <div className="rt-emb-discount-percent" style={{ fontFamily: fonts.body, color: subInk }}>{block.percent}% off {block.note || 'your first order'}</div>
      </div>
    );
  }
  if (block.type === 'footer') {
    return (
      <div className="rt-emb-footer" style={{ fontFamily: fonts.body, color: subInk, borderTopColor: brand.rule || 'rgba(20,32,26,0.14)' }}>
        <div className="rt-emb-footer-store" style={{ color: ink }}>{block.storeName}</div>
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
    <div className={`rt-emb-wrap ${selected ? 'rt-emb-selected' : ''}`}
         onClick={(e) => { e.stopPropagation(); onSelect(block.id); }}
         data-comment-anchor={`block:${block.id}`}>
      <BlockView block={block} brand={brand} isPreview={false} onInlineEdit={onInlineEdit} />
      {selected && (
        <div className="rt-emb-tools" onClick={e => e.stopPropagation()}>
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
            {BLOCK_LIBRARY.map(grp => (
              <div key={grp.group} className="rt-emb-add-grp">
                <div className="t-micro muted rt-emb-add-grp-h">{grp.group}</div>
                <div className="rt-emb-add-list">
                  {grp.items.map(it => {
                    const Icon = Icons[it.icon];
                    return (
                      <button key={it.type} className="rt-emb-add-item"
                              onClick={() => { onAdd(it.type, idx); setOpenId(null); }}>
                        <Icon size={14} />
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

// ── Rich text toolbar (for selected text/paragraph block) ──────────────────
function RichTextToolbar({ block, onUpdate }) {
  if (!block || (block.type !== 'paragraph' && block.type !== 'heading')) return null;
  const exec = (cmd, value = null) => {
    document.execCommand(cmd, false, value);
  };
  const link = () => {
    const url = prompt('Link URL', 'https://');
    if (url) exec('createLink', url);
  };
  return (
    <div className="rt-emb-rtbar">
      {block.type === 'heading' && (
        <>
          <button className={block.level === 1 ? 'on' : ''} onClick={() => onUpdate({ level: 1 })} title="Heading 1"><Icons.Heading1 size={14} /></button>
          <button className={block.level === 2 ? 'on' : ''} onClick={() => onUpdate({ level: 2 })} title="Heading 2"><Icons.Heading2 size={14} /></button>
          <span className="rt-emb-rtbar-sep" />
        </>
      )}
      <button onClick={() => exec('bold')} title="Bold"><Icons.Bold size={14} /></button>
      <button onClick={() => exec('italic')} title="Italic"><Icons.Italic size={14} /></button>
      <button onClick={() => exec('underline')} title="Underline"><Icons.Underline size={14} /></button>
      <button onClick={link} title="Link"><Icons.LinkIcon size={14} /></button>
      <span className="rt-emb-rtbar-sep" />
      <button onClick={() => onUpdate({ align: 'left' })} className={block.align === 'left' ? 'on' : ''} title="Align left"><Icons.AlignLeft size={14} /></button>
      <button onClick={() => onUpdate({ align: 'center' })} className={block.align === 'center' ? 'on' : ''} title="Align center"><Icons.AlignCenter size={14} /></button>
      <button onClick={() => onUpdate({ align: 'right' })} className={block.align === 'right' ? 'on' : ''} title="Align right"><Icons.AlignRight size={14} /></button>
    </div>
  );
}

// ── Block inspector (right rail when block selected) ───────────────────────
function BlockInspector({ block, onUpdate, onDelete, onInsertMergeTag }) {
  if (!block) return null;
  const label = {
    logo: 'Logo', heading: 'Heading', paragraph: 'Paragraph', button: 'Button',
    image: 'Image', spacer: 'Spacer', divider: 'Divider', product: 'Product grid',
    discount: 'Discount code', footer: 'Footer',
    eyebrow: 'Eyebrow', signature: 'Signature', bignumber: 'Big number',
  }[block.type];

  return (
    <div className="rt-ins">
      <div className="rt-ins-head">
        <div className="rt-node-glyph rt-tint-email"><Icons.Mail size={14} /></div>
        <div>
          <div className="t-micro muted">Block</div>
          <div className="t-h2" style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>{label}</div>
        </div>
      </div>

      {block.type === 'logo' && (
        <div className="rt-ins-section">
          <label className="field-label">Wordmark text</label>
          <input className="input" value={block.text} onChange={e => onUpdate({ text: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Size</label>
          <div className="rt-segmented">
            {['small', 'medium', 'large'].map(s => (
              <button key={s} className={block.size === s ? 'rt-seg-on' : ''} onClick={() => onUpdate({ size: s })} style={{ textTransform: 'capitalize' }}>{s}</button>
            ))}
          </div>
          <label className="field-label" style={{ marginTop: 14 }}>Alignment</label>
          <AlignToggle value={block.align} onChange={v => onUpdate({ align: v })} />
        </div>
      )}

      {block.type === 'heading' && (
        <>
          <div className="rt-ins-section">
            <label className="field-label">Level</label>
            <div className="rt-segmented">
              {[1, 2, 3].map(l => (
                <button key={l} className={block.level === l ? 'rt-seg-on' : ''} onClick={() => onUpdate({ level: l })}>H{l}</button>
              ))}
            </div>
            <label className="field-label" style={{ marginTop: 14 }}>Alignment</label>
            <AlignToggle value={block.align} onChange={v => onUpdate({ align: v })} />
            <div className="field-help" style={{ marginTop: 10 }}>Click the heading on the canvas to edit text. Use the floating toolbar for <strong>B</strong> / <em>I</em> / link.</div>
          </div>
          <MergeTagsSection onInsert={onInsertMergeTag} />
        </>
      )}

      {block.type === 'paragraph' && (
        <>
          <div className="rt-ins-section">
            <label className="field-label">Alignment</label>
            <AlignToggle value={block.align} onChange={v => onUpdate({ align: v })} />
            <div className="field-help" style={{ marginTop: 10 }}>Click the paragraph on the canvas to edit. Bold / italic / link via the floating toolbar.</div>
          </div>
          <MergeTagsSection onInsert={onInsertMergeTag} />
        </>
      )}

      {block.type === 'button' && (
        <div className="rt-ins-section">
          <label className="field-label">Button text</label>
          <input className="input" value={block.text} onChange={e => onUpdate({ text: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Link URL</label>
          <input className="input" value={block.url} onChange={e => onUpdate({ url: e.target.value })} placeholder="https://" />
          <label className="field-label" style={{ marginTop: 14 }}>Style</label>
          <div className="rt-segmented">
            {[['filled', 'Filled'], ['outline', 'Outline']].map(([k, l]) => (
              <button key={k} className={block.fill === k ? 'rt-seg-on' : ''} onClick={() => onUpdate({ fill: k })}>{l}</button>
            ))}
          </div>
          <label className="field-label" style={{ marginTop: 14 }}>Alignment</label>
          <AlignToggle value={block.align} onChange={v => onUpdate({ align: v })} />
        </div>
      )}

      {block.type === 'image' && (
        <div className="rt-ins-section">
          <div className="rt-emb-uploader">
            <Icons.Image size={20} />
            <div className="t-small" style={{ marginTop: 8 }}>Drop an image or</div>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }}>Browse media</button>
            <div className="field-help" style={{ marginTop: 8 }}>JPG, PNG or GIF · up to 4MB</div>
          </div>
          <label className="field-label" style={{ marginTop: 16 }}>Placeholder label</label>
          <input className="input" value={block.label} onChange={e => onUpdate({ label: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Width</label>
          <div className="rt-segmented">
            {[['full', 'Full bleed'], ['wide', 'Wide'], ['small', 'Inset']].map(([k, l]) => (
              <button key={k} className={block.align === k ? 'rt-seg-on' : ''} onClick={() => onUpdate({ align: k })}>{l}</button>
            ))}
          </div>
          <label className="field-label" style={{ marginTop: 14 }}>Height</label>
          <input className="input" type="number" value={block.height} onChange={e => onUpdate({ height: +e.target.value })} />
        </div>
      )}

      {block.type === 'spacer' && (
        <div className="rt-ins-section">
          <label className="field-label">Height ({block.height}px)</label>
          <input type="range" min="8" max="120" step="4" value={block.height} onChange={e => onUpdate({ height: +e.target.value })} className="rt-emb-range" />
          <div className="rt-emb-range-marks t-mono"><span>8</span><span>64</span><span>120</span></div>
        </div>
      )}

      {block.type === 'divider' && (
        <div className="rt-ins-section">
          <label className="field-label">Line style</label>
          <div className="rt-segmented">
            {['solid', 'dashed', 'dotted'].map(s => (
              <button key={s} className={block.style === s ? 'rt-seg-on' : ''} onClick={() => onUpdate({ style: s })} style={{ textTransform: 'capitalize' }}>{s}</button>
            ))}
          </div>
        </div>
      )}

      {block.type === 'product' && (
        <div className="rt-ins-section">
          <label className="field-label">Columns</label>
          <div className="rt-segmented">
            {[2, 3, 4].map(n => (
              <button key={n} className={block.count === n ? 'rt-seg-on' : ''} onClick={() => onUpdate({ count: n })}>{n}</button>
            ))}
          </div>
          <label className="rt-toggle" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={block.showPrice} onChange={e => onUpdate({ showPrice: e.target.checked })} />
            <span className="rt-toggle-switch" />
            <span>Show price</span>
          </label>
          <div className="field-help" style={{ marginTop: 10 }}>Products are pulled from your top sellers at send time.</div>
        </div>
      )}

      {block.type === 'discount' && (
        <div className="rt-ins-section">
          <label className="field-label">Caption</label>
          <input className="input" value={block.label} onChange={e => onUpdate({ label: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Discount code</label>
          <input className="input t-mono" value={block.code} onChange={e => onUpdate({ code: e.target.value.toUpperCase() })} />
          <label className="field-label" style={{ marginTop: 14 }}>Percentage</label>
          <input className="input" type="number" min="0" max="90" value={block.percent} onChange={e => onUpdate({ percent: +e.target.value })} />
          <div className="rt-emb-linked-note">
            <Icons.Bolt size={12} />
            <span>Synced from the flow step's discount field.</span>
          </div>
        </div>
      )}

      {block.type === 'eyebrow' && (
        <div className="rt-ins-section">
          <label className="field-label">Eyebrow text</label>
          <input className="input" value={block.text} onChange={e => onUpdate({ text: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Alignment</label>
          <AlignToggle value={block.align} onChange={v => onUpdate({ align: v })} />
          <div className="field-help" style={{ marginTop: 10 }}>Renders small caps with wide tracking. Best for issue labels and section markers.</div>
        </div>
      )}

      {block.type === 'signature' && (
        <div className="rt-ins-section">
          <label className="field-label">Signature text</label>
          <textarea className="textarea" value={block.text} onChange={e => onUpdate({ text: e.target.value })} rows={3} />
          <label className="field-label" style={{ marginTop: 14 }}>Alignment</label>
          <AlignToggle value={block.align} onChange={v => onUpdate({ align: v })} />
          <div className="field-help" style={{ marginTop: 10 }}>Italic display or handwritten depending on your brand font pair.</div>
        </div>
      )}

      {block.type === 'bignumber' && (
        <div className="rt-ins-section">
          <label className="field-label">Big number</label>
          <input className="input" value={block.value} onChange={e => onUpdate({ value: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Unit</label>
          <input className="input" value={block.unit} onChange={e => onUpdate({ unit: e.target.value })} placeholder="% OFF" />
          <label className="field-label" style={{ marginTop: 14 }}>Caption</label>
          <input className="input" value={block.caption} onChange={e => onUpdate({ caption: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Alignment</label>
          <AlignToggle value={block.align} onChange={v => onUpdate({ align: v })} />
        </div>
      )}

      {block.type === 'footer' && (
        <div className="rt-ins-section">
          <label className="field-label">Store name</label>
          <input className="input" value={block.storeName} onChange={e => onUpdate({ storeName: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Postal address</label>
          <textarea className="textarea" value={block.address} onChange={e => onUpdate({ address: e.target.value })} />
          <label className="rt-toggle" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={block.unsubscribe} onChange={e => onUpdate({ unsubscribe: e.target.checked })} />
            <span className="rt-toggle-switch" />
            <span>Show unsubscribe links</span>
          </label>
          <div className="field-help" style={{ marginTop: 10 }}>Legally required in most regions.</div>
        </div>
      )}

      <div className="rt-ins-section">
        <button className="btn btn-danger" style={{ width: '100%' }} onClick={() => onDelete(block.id)}>
          <Icons.Trash size={13} /> Delete block
        </button>
      </div>
    </div>
  );
}

function AlignToggle({ value, onChange }) {
  return (
    <div className="rt-segmented">
      <button className={value === 'left' ? 'rt-seg-on' : ''} onClick={() => onChange('left')}><Icons.AlignLeft size={13} /></button>
      <button className={value === 'center' ? 'rt-seg-on' : ''} onClick={() => onChange('center')}><Icons.AlignCenter size={13} /></button>
      <button className={value === 'right' ? 'rt-seg-on' : ''} onClick={() => onChange('right')}><Icons.AlignRight size={13} /></button>
    </div>
  );
}

function MergeTagsSection({ onInsert }) {
  return (
    <div className="rt-ins-section">
      <div className="t-micro muted" style={{ marginBottom: 10 }}>Merge tags</div>
      <div className="t-small muted" style={{ marginBottom: 12 }}>Personalize with contact + store data. Click to insert at the cursor.</div>
      <div className="rt-emb-tag-grid">
        {MERGE_TAGS.map(t => (
          <button key={t} className="rt-emb-tag-chip t-mono" onClick={() => onInsert && onInsert(t)}>{t}</button>
        ))}
      </div>
    </div>
  );
}

// ── Color picker (native color wheel + hex input) ─────────────────────────
function ColorPicker({ value, onChange, light }) {
  const norm = (value || '#000000').toUpperCase();
  const [hex, setHex] = useStateE(norm);
  useEffectE(() => { setHex(norm); }, [norm]);
  const onHexChange = (v) => {
    setHex(v);
    if (/^#[0-9A-F]{6}$/i.test(v)) onChange(v.toUpperCase());
  };
  return (
    <div className={`rt-emb-cp ${light ? 'rt-emb-cp-light' : ''}`}>
      <label className="rt-emb-cp-swatch" style={{ background: norm }}>
        <input
          type="color"
          value={norm}
          onChange={e => onChange(e.target.value.toUpperCase())}
        />
      </label>
      <div className="rt-emb-cp-hex">
        <span className="rt-emb-cp-hash">#</span>
        <input
          type="text"
          value={hex.replace(/^#/, '')}
          maxLength={6}
          onChange={e => onHexChange('#' + e.target.value.replace(/[^0-9a-fA-F]/g, ''))}
          onBlur={() => setHex(norm)}
          spellCheck={false}
        />
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
          <div className="t-h2" style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>{node.name}</div>
        </div>
      </div>

      <div className="rt-ins-section">
        <div className="t-micro muted" style={{ marginBottom: 12 }}>Inbox</div>
        <label className="field-label">From name</label>
        <input className="input" defaultValue="Northhill & Co." />
        <label className="field-label" style={{ marginTop: 12 }}>Subject</label>
        <input className="input" value={node.subject} onChange={e => onNode({ subject: e.target.value })} />
        <div className="field-help">{50 - (node.subject || '').length} characters remaining</div>
        <label className="field-label" style={{ marginTop: 12 }}>Preview text</label>
        <input className="input" value={node.preview || ''} placeholder="A short preview shown in the inbox" onChange={e => onNode({ preview: e.target.value })} />
      </div>

      <div className="rt-ins-section">
        <div className="t-micro muted" style={{ marginBottom: 12 }}>Brand kit</div>
        <label className="field-label">Wordmark / Logo</label>
        <input className="input" value={brand.logoText} onChange={e => onBrand({ logoText: e.target.value })} />
        <div className="rt-emb-upload-sm">
          <button className="btn btn-secondary btn-sm" style={{ width: '100%' }}>
            <Icons.Image size={13} /> Upload logo (svg, png)
          </button>
        </div>

        <label className="field-label" style={{ marginTop: 16 }}>Accent color</label>
        <ColorPicker value={brand.accent} onChange={v => onBrand({ accent: v })} />

        <label className="field-label" style={{ marginTop: 16 }}>Background</label>
        <ColorPicker value={brand.bg} onChange={v => onBrand({ bg: v })} light />

        <label className="field-label" style={{ marginTop: 16 }}>Font pairing</label>
        <div className="rt-emb-fonts">
          {Object.entries(FONT_PAIRS).map(([k, v]) => (
            <button key={k} className={`rt-emb-font ${brand.fontPair === k ? 'rt-on' : ''}`}
                    onClick={() => onBrand({ fontPair: k })}>
              <div style={{ fontFamily: v.display, fontSize: 17, lineHeight: 1, marginBottom: 4 }}>Aa</div>
              <div style={{ fontFamily: v.body, fontSize: 11, color: 'var(--ink-3)' }}>{v.label}</div>
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
  const width = viewport === 'mobile' ? 375 : 600;
  return (
    <div className="rt-emb-stage" onClick={() => onSelect(null)}>
      <div className="rt-emb-inbox-hint">
        <div className="rt-emb-inbox-from">Northhill &amp; Co. <span className="muted">· northhill.co</span></div>
        <div className="rt-emb-inbox-time t-mono">11:42 AM</div>
      </div>
      <div className="rt-emb-frame" style={{ width, background: brand.bg }} onClick={e => e.stopPropagation()}>
        <InsertGap idx={0} onAdd={onInsert} openId={openGapId} setOpenId={setOpenGapId} />
        {blocks.map((b, i) => (
          <React.Fragment key={b.id}>
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
          </React.Fragment>
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

// ── Left block library rail ────────────────────────────────────────────────
function BlockLibraryRail({ onAdd }) {
  return (
    <div className="rt-emb-library">
      <div className="rt-emb-library-head">
        <div className="t-micro muted">Blocks</div>
      </div>
      {BLOCK_LIBRARY.map(grp => (
        <div key={grp.group} className="rt-emb-lib-grp">
          <div className="t-mono rt-emb-lib-grp-h">{grp.group}</div>
          <div className="rt-emb-lib-grid">
            {grp.items.map(it => {
              const Icon = Icons[it.icon];
              return (
                <button key={it.type} className="rt-emb-lib-item" onClick={() => onAdd(it.type)}>
                  <Icon size={16} />
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

// ── Main editor ────────────────────────────────────────────────────────────
function EmailEditor({ flow, node, onBack, onSave }) {
  const [blocks, setBlocks] = useStateE(() => node.blocks && node.blocks.length ? node.blocks : defaultBlocks(node));
  const [brand, setBrand] = useStateE(() => node.brand || DEFAULT_BRAND);
  const [nodeMeta, setNodeMeta] = useStateE({ subject: node.subject, preview: node.preview || '', name: node.name });
  const [selectedId, setSelectedId] = useStateE(null);
  const [viewport, setViewport] = useStateE('desktop');
  const [openGapId, setOpenGapId] = useStateE(null);
  const [saved, setSaved] = useStateE(true);
  const [templatesOpen, setTemplatesOpen] = useStateE(false);

  const selected = useMemoE(() => blocks.find(b => b.id === selectedId), [selectedId, blocks]);

  // Mark dirty on any change after mount
  const firstRun = useRefE(true);
  useEffectE(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setSaved(false);
  }, [blocks, brand, nodeMeta]);

  const updateBlock = (id, patch) => {
    setBlocks(bs => bs.map(b => b.id === id ? { ...b, ...patch } : b));
  };
  const insertBlock = (type, idx) => {
    const nb = makeBlock(type, node);
    if (!nb) return;
    setBlocks(bs => {
      const next = [...bs];
      next.splice(idx, 0, nb);
      return next;
    });
    setSelectedId(nb.id);
  };
  const addToEnd = (type) => insertBlock(type, blocks.length);
  const moveBlock = (id, dir) => {
    setBlocks(bs => {
      const i = bs.findIndex(b => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const duplicateBlock = (id) => {
    setBlocks(bs => {
      const i = bs.findIndex(b => b.id === id);
      if (i < 0) return bs;
      const copy = { ...bs[i], id: bid() };
      const next = [...bs];
      next.splice(i + 1, 0, copy);
      return next;
    });
  };
  const deleteBlock = (id) => {
    setBlocks(bs => bs.filter(b => b.id !== id));
    setSelectedId(null);
  };

  const insertMergeTag = (tag) => {
    // Insert at the current selection inside the currently focused contenteditable.
    const el = document.activeElement;
    if (el && el.isContentEditable) {
      document.execCommand('insertText', false, tag);
    }
  };

  const save = () => {
    onSave({
      ...node,
      subject: nodeMeta.subject,
      preview: nodeMeta.preview,
      blocks,
      brand,
    });
    setSaved(true);
  };

  const closeAndSave = () => { save(); onBack(); };

  // Apply a template from the gallery (after confirmation in the gallery itself).
  const applyTemplate = (templateId) => {
    const tmpl = window.EmailTemplates.TEMPLATES[templateId];
    if (!tmpl) return;
    setBlocks(window.EmailTemplates.cloneBlocks(tmpl));
    setBrand({ ...tmpl.brand });
    setNodeMeta({
      subject: tmpl.subject,
      preview: tmpl.preview,
      name: tmpl.name,
    });
    setSelectedId(null);
    setTemplatesOpen(false);
  };

  // Top bar
  const topBar = (
    <>
      <div className="rt-bt-left">
        <button className="btn btn-ghost btn-icon" onClick={closeAndSave} aria-label="Back to flow"><Icons.ArrowBack size={16} /></button>
        <div className="rt-bt-flowmeta">
          <div className="rt-emb-crumbs">
            <span className="muted">{flow.name}</span>
            <Icons.Chevron size={12} />
            <span>Email</span>
          </div>
          <input className="rt-bt-name rt-emb-subject" value={nodeMeta.subject}
                 onChange={e => setNodeMeta(m => ({ ...m, subject: e.target.value }))}
                 placeholder="Email subject" />
        </div>
      </div>
      <div className="rt-bt-center" style={{ gap: 18, alignItems: 'center' }}>
        <button
          className="rt-emb-browse-btn"
          onClick={() => setTemplatesOpen(true)}
          title="Browse all email designs"
        >
          <span className="rt-emb-browse-btn-swatches">
            <span style={{ background: brand.accent || '#1F3D2F' }} />
            <span style={{ background: brand.bg || '#FFFFFF' }} />
            <span style={{ background: brand.ink || '#14201A' }} />
          </span>
          <span>Browse templates</span>
          <span className="rt-emb-browse-btn-pill">10</span>
        </button>
        <div className="rt-view-toggle">
          <button className={viewport === 'desktop' ? 'rt-vt-on' : ''} onClick={() => setViewport('desktop')}><Icons.Desktop size={13} /> Desktop</button>
          <button className={viewport === 'mobile' ? 'rt-vt-on' : ''} onClick={() => setViewport('mobile')}><Icons.Phone size={13} /> Mobile</button>
        </div>
      </div>
      <div className="rt-bt-right">
        <span className="rt-emb-saved t-mono">{saved ? 'Saved' : 'Unsaved changes'}</span>
        <button className="btn btn-ghost"><Icons.Send size={13} /> Send test</button>
        <span className="rt-bt-divider" />
        <button className="btn btn-secondary" onClick={save}>Save draft</button>
        <button className="btn btn-primary" onClick={closeAndSave}>Done</button>
      </div>
    </>
  );

  return (
    <>
      <div className="rt-builder rt-emb-builder">
        <div className="rt-builder-topbar">{topBar}</div>
        <div className="rt-builder-body">
          <aside className="rt-emb-left">
            <BlockLibraryRail onAdd={addToEnd} />
          </aside>
          <div className="rt-builder-canvas">
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
                node={{ ...node, subject: nodeMeta.subject, preview: nodeMeta.preview }}
                brand={brand}
                onNode={(patch) => setNodeMeta(m => ({ ...m, ...patch }))}
                onBrand={(patch) => setBrand(b => ({ ...b, ...patch }))}
              />
            )}
          </div>
        </div>
      </div>
      {templatesOpen && window.EmailTemplateComponents && (
        <window.EmailTemplateComponents.EmailTemplateGallery
          onClose={() => setTemplatesOpen(false)}
          onUseTemplate={applyTemplate}
        />
      )}
    </>
  );
}

Object.assign(window, { EmailEditor, BlockView, defaultBlocks: defaultBlocks, makeBlock, FONT_PAIRS, DEFAULT_BRAND });
