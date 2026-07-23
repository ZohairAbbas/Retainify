/**
 * Visual email renderer — converts JourneyStep.emailBlocks + emailBrand JSON
 * into inline-CSS, table-based email HTML.
 *
 * Every email JourneyStep is guaranteed by saveDraft() to have a non-empty
 * emailBlocks array (defaultEmailBlocks() seeds one if the merchant never
 * opened the editor), so this is the sole render path for journey emails.
 *
 * Mirrors the block schema authored by app/components/EmailEditor.jsx.
 */

// Mirrors FONT_PAIRS in app/components/EmailEditor.jsx. The leading family is a
// Google webfont embedded via <link> in the email <head> (rendered by Apple /
// iOS / Samsung Mail); the rest are email-safe fallbacks for clients that drop
// webfonts (Gmail, Outlook).
const FONT_PAIRS = {
  editorial: { display: "'Instrument Serif', Cambria, Georgia, serif", body: "Geist, system-ui, sans-serif" },
  modern:    { display: "Geist, system-ui, sans-serif",                body: "Geist, system-ui, sans-serif" },
  classic:   { display: "Georgia, Cambria, 'Times New Roman', serif",  body: "Georgia, Cambria, serif" },
  display:   { display: "'DM Serif Display', Georgia, serif",          body: "Geist, system-ui, sans-serif" },
  mono:      { display: "'Geist Mono', 'Courier New', monospace",      body: "Geist, system-ui, sans-serif" },
  hand:      { display: "'Caveat', 'Brush Script MT', cursive",        body: "Geist, system-ui, sans-serif" },
  brutal:    { display: "'Archivo Black', Impact, Arial, sans-serif",  body: "Geist, system-ui, sans-serif" },
  moody:     { display: "'DM Serif Display', Georgia, serif",          body: "Geist, system-ui, sans-serif", displayItalic: true },
};

// Google Fonts stylesheet embedded in the email head so supporting clients
// render the real display faces. Mirrors the families used by FONT_PAIRS.
const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Archivo+Black&family=Caveat:wght@500;700&family=DM+Serif+Display:ital@0;1&display=swap";

const DEFAULT_BRAND = {
  logoText: "YOUR STORE", accent: "#1F3D2F", bg: "#FFFFFF",
  ink: "#14201A", subInk: "#2D362F", onAccent: "#FFFFFF", fontPair: "editorial",
};

function escapeAttr(s) {
  return String(s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function applyMergeTags(html, ctx) {
  if (!html) return { out: "", used: [] };
  const used = [];
  const out = String(html).replace(/\{(first_name|last_name|store_name|discount_code|cart_url|store_url)\}/g, (_, key) => {
    used.push(key);
    return ctx[key] != null ? String(ctx[key]) : "";
  });
  return { out, used };
}

// Plain-text merge-tag substitution for fields that aren't HTML (logo text,
// footer store name/address, etc). Returns just the substituted string.
function mergeText(text, ctx) {
  return applyMergeTags(text, ctx).out;
}

/**
 * Substitute merge tags in an arbitrary HTML string. Same tag set + semantics
 * as the block renderer, exported so the custom-HTML send path stays identical
 * to blocks. Returns just the substituted HTML.
 */
export function applyMergeTagsToHtml(html, ctx) {
  return applyMergeTags(html, ctx).out;
}

function renderLogo(b, brand, fonts, ctx) {
  const sizes = { small: 14, medium: 18, large: 24 };
  const fontSize = sizes[b.size] || 18;
  const align = b.align || "center";
  const brutal = brand.fontPair === "brutal";
  const mono = brand.fontPair === "mono";
  const text = mergeText(b.text || brand.logoText, ctx);
  const tracking = mono || brutal ? "0.16em" : "0.06em";
  return `<tr><td align="${align}" style="padding:0 0 16px;">
    <div style="font-family:${fonts.display};font-size:${fontSize}px;letter-spacing:${tracking};text-transform:uppercase;font-weight:${brutal ? 900 : 500};color:${b.color || brand.ink};">${escapeAttr(text)}</div>
  </td></tr>`;
}

function renderHeading(b, brand, fonts, ctx) {
  const sizes = { 1: 32, 2: 24, 3: 18 };
  const fontSize = sizes[b.level] || 24;
  const align = b.align || "left";
  const brutal = brand.fontPair === "brutal";
  const italic = fonts.displayItalic ? "font-style:italic;" : "";
  const { out } = applyMergeTags(b.html || "", ctx);
  return `<tr><td align="${align}" style="padding:8px 0;">
    <div style="font-family:${fonts.display};font-size:${fontSize}px;line-height:${brutal ? 1.04 : 1.18};font-weight:${brutal ? 900 : 400};letter-spacing:${brutal ? "-0.02em" : "-0.01em"};${brutal ? "text-transform:uppercase;" : ""}${italic}color:${b.color || brand.ink};text-align:${align};">${out}</div>
  </td></tr>`;
}

function renderParagraph(b, brand, fonts, ctx) {
  const align = b.align || "left";
  const { out } = applyMergeTags(b.html || "", ctx);
  return `<tr><td align="${align}" style="padding:8px 0;">
    <div style="font-family:${fonts.body};font-size:15px;line-height:1.6;color:${b.color || brand.subInk};text-align:${align};">${out}</div>
  </td></tr>`;
}

function renderButton(b, brand, fonts, ctx) {
  const filled = b.fill !== "outline";
  const align = b.align || "center";
  const brutal = brand.fontPair === "brutal";
  const { out: url } = applyMergeTags(b.url || "#", ctx);
  const text = mergeText(b.text || "Shop now", ctx);
  // If url resolved to empty (merge tag with no value, e.g. {cart_url} on a
  // non-cart trigger), fall back to the storefront URL or '#'.
  const safeUrl = url && url !== "{cart_url}" && url !== "{store_url}"
    ? url
    : (ctx.store_url || "#");
  const btnBg = b.bgColor || brand.accent;
  const bg = filled ? btnBg : "transparent";
  const color = filled ? (b.textColor || brand.onAccent) : (b.textColor || btnBg);
  return `<tr><td align="${align}" style="padding:16px 0;">
    <a href="${escapeAttr(safeUrl)}" style="display:inline-block;padding:14px 28px;background:${bg};color:${color};border:1px solid ${btnBg};border-radius:4px;font-family:${fonts.body};font-size:15px;font-weight:${brutal ? 700 : 600};${brutal ? "text-transform:uppercase;letter-spacing:0.04em;" : ""}text-decoration:none;">${escapeAttr(text)}</a>
  </td></tr>`;
}

function renderImage(b) {
  if (!b.src) return null; // skip — caller logs
  const align = b.align || "full";
  const width = align === "full" ? "100%" : align === "wide" ? "80%" : "50%";
  const heightCss = b.height ? `height:${Number(b.height)}px;object-fit:cover;` : "height:auto;";
  return `<tr><td align="center" style="padding:12px 0;">
    <img src="${escapeAttr(b.src)}" alt="${escapeAttr(b.alt || "")}" style="width:${width};max-width:100%;${heightCss}display:block;border:0;" />
  </td></tr>`;
}

function formatPriceServer(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount || "");
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `${currency || "$"} ${n.toFixed(2)}`;
  }
}

function renderProductGrid(b, brand, fonts, ctx, products) {
  if (!products || !products.length) return null;
  const cols = Math.max(1, Math.min(4, Number(b.count) || 3));
  const showPrice = b.showPrice !== false;
  // Email-safe grid: outer table, single row, one td per column. Stacks via
  // width:100% on narrow viewports because we set width="100%" on tds.
  const cellWidthPct = Math.floor(100 / cols);
  const visible = products.slice(0, cols);
  const cells = visible.map((p) => {
    const url = escapeAttr(p.url || "#");
    const img = p.image
      ? `<a href="${url}" style="text-decoration:none;display:block;">
           <img src="${escapeAttr(p.image)}" alt="${escapeAttr(p.imageAlt || p.title || "")}"
             style="width:100%;height:auto;display:block;border-radius:4px;border:0;" />
         </a>`
      : `<div style="aspect-ratio:1/1;background:#F4EFE4;border-radius:4px;"></div>`;
    const priceHtml = showPrice && p.price
      ? `<div style="font-family:${fonts.body};font-size:13px;color:${brand.subInk};">${formatPriceServer(p.price, p.currency)}</div>`
      : "";
    return `<td valign="top" width="${cellWidthPct}%" style="padding:6px;">
      ${img}
      <div style="margin-top:8px;font-family:${fonts.body};font-size:13px;color:${brand.ink};">
        <a href="${url}" style="color:${brand.ink};text-decoration:none;">${escapeAttr(p.title || "")}</a>
      </div>
      ${priceHtml}
    </td>`;
  }).join("");
  return `<tr><td style="padding:12px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>${cells}</tr>
    </table>
  </td></tr>`;
}

function renderSpacer(b) {
  return `<tr><td style="height:${Number(b.height) || 32}px;line-height:${Number(b.height) || 32}px;font-size:1px;">&nbsp;</td></tr>`;
}

function renderDivider(b) {
  const style = ["solid", "dashed", "dotted"].includes(b.style) ? b.style : "solid";
  return `<tr><td style="padding:12px 0;"><div style="border-top:1px ${style} #E5E0D5;"></div></td></tr>`;
}

function renderDiscount(b, brand, fonts, ctx) {
  // The displayed code is the Shopify-generated one from ctx; the worker is
  // responsible for calling createDiscountCode() and putting it on ctx before
  // calling the renderer. If empty, the block gets skipped at the caller.
  const code = ctx.discount_code || "";
  const label = mergeText(b.label || "A gift for you", ctx);
  return `<tr><td align="center" style="padding:16px 0;">
    <div style="border:1px dashed ${brand.accent};border-radius:6px;padding:20px;text-align:center;">
      <div style="font-family:${fonts.body};font-size:13px;color:${brand.accent};text-transform:uppercase;letter-spacing:0.08em;">${escapeAttr(label)}</div>
      <div style="font-family:'Courier New',monospace;font-size:24px;font-weight:700;color:${brand.ink};margin:8px 0;">${escapeAttr(code)}</div>
      <div style="font-family:${fonts.body};font-size:13px;color:${brand.subInk};">${Number(b.percent) || 0}% off your order</div>
    </div>
  </td></tr>`;
}

function renderFooter(b, brand, fonts, ctx) {
  const unsubHtml = b.unsubscribe && ctx.unsubscribeUrl
    ? `<div style="margin-top:8px;"><a href="${escapeAttr(ctx.unsubscribeUrl)}" style="color:${brand.subInk};text-decoration:underline;">Unsubscribe</a></div>`
    : "";
  const storeName = mergeText(b.storeName || ctx.store_name || "", ctx);
  const address = mergeText(b.address || "", ctx);
  return `<tr><td align="center" style="padding:24px 0 8px;">
    <div style="font-family:${fonts.body};font-size:12px;color:${brand.subInk};line-height:1.6;">
      <div style="font-weight:600;color:${brand.ink};">${escapeAttr(storeName)}</div>
      <div>${escapeAttr(address)}</div>
      ${unsubHtml}
      <div style="margin-top:6px;font-size:11px;opacity:0.6;">Powered by Retainify</div>
    </div>
  </td></tr>`;
}

const RENDERERS = {
  logo: renderLogo,
  heading: renderHeading,
  paragraph: renderParagraph,
  button: renderButton,
  image: renderImage,
  spacer: renderSpacer,
  divider: renderDivider,
  discount: renderDiscount,
  footer: renderFooter,
};

/**
 * Resolve any `product` blocks ahead of the render loop. For each block:
 *   - if `productIds` is non-empty → fetch those exact products
 *   - else → fall back to top-sellers (cached per-shop for 1h)
 *
 * @param {Array} blocks
 * @param {{ shop?: string }} resolveCtx
 * @returns {Promise<Map<string, Array>>} blockId -> products[]
 */
async function resolveProductBlocks(blocks, resolveCtx) {
  const out = new Map();
  const productBlocks = blocks.filter((b) => b?.type === "product");
  if (!productBlocks.length) return out;

  // Lazy import so renderer stays cheap when no product blocks are present.
  const { getProductsByIds, getTopSellers } = await import("../shopify/products.server.js");

  for (const b of productBlocks) {
    try {
      if (Array.isArray(b.productIds) && b.productIds.length) {
        if (!resolveCtx.shop) { out.set(b.id, []); continue; }
        const { unauthenticated } = await import("../../shopify.server.js");
        const { admin } = await unauthenticated.admin(resolveCtx.shop);
        const products = await getProductsByIds({ admin, shop: resolveCtx.shop }, b.productIds);
        out.set(b.id, products);
      } else if (resolveCtx.shop) {
        const products = await getTopSellers(resolveCtx.shop, b.count || 3);
        out.set(b.id, products);
      } else {
        out.set(b.id, []);
      }
    } catch (err) {
      console.error(`[email-render] product block ${b.id} resolve failed:`, err.message);
      out.set(b.id, []);
    }
  }
  return out;
}

export async function renderVisualEmail({ blocks, brand, ctx, stepId, shop }) {
  const safeBrand = { ...DEFAULT_BRAND, ...(brand || {}) };
  const fonts = FONT_PAIRS[safeBrand.fontPair] || FONT_PAIRS.editorial;

  let rendered = 0;
  let skipped = 0;
  const skippedDetail = [];
  const mergeTagsUsed = new Set();

  const productMap = await resolveProductBlocks(blocks, { shop });

  const rowsArr = [];
  for (const b of blocks) {
    if (!b || !b.type) {
      skipped++;
      skippedDetail.push("missing-type");
      continue;
    }
    if (b.type === "image" && !b.src) {
      skipped++;
      skippedDetail.push("image:no-src");
      continue;
    }
    if (b.type === "discount" && !ctx.discount_code) {
      skipped++;
      skippedDetail.push("discount:no-code");
      continue;
    }
    let html = null;
    try {
      if (b.type === "product") {
        const products = productMap.get(b.id) || [];
        if (!products.length) {
          skipped++;
          skippedDetail.push("product:no-products");
          continue;
        }
        html = renderProductGrid(b, safeBrand, fonts, ctx, products);
      } else {
        const fn = RENDERERS[b.type];
        if (!fn) {
          skipped++;
          skippedDetail.push(`unknown:${b.type}`);
          continue;
        }
        html = fn(b, safeBrand, fonts, ctx);
      }
    } catch (err) {
      skipped++;
      skippedDetail.push(`${b.type}:throw:${err.message}`);
      continue;
    }
    if (!html) {
      skipped++;
      skippedDetail.push(`${b.type}:null-html`);
      continue;
    }
    // Detect merge tag references in source block (for telemetry)
    const sourceText = JSON.stringify(b);
    const matches = sourceText.match(/\{(first_name|last_name|store_name|discount_code|cart_url)\}/g);
    if (matches) matches.forEach((m) => mergeTagsUsed.add(m.slice(1, -1)));
    rowsArr.push(html);
    rendered++;
  }

  const inner = rowsArr.join("\n");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${escapeAttr(ctx.store_name || "")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${GOOGLE_FONTS_HREF}" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background-color:${safeBrand.bg};font-family:${fonts.body};">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:${safeBrand.bg};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${safeBrand.bg};border-radius:8px;padding:32px;">
        ${inner}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  console.log(
    `[email-render] step=${stepId || "?"} blocks=${blocks.length} rendered=${rendered} skipped=${skipped}` +
    ` htmlBytes=${html.length} mergeTags=[${[...mergeTagsUsed].join(",")}]` +
    (skipped > 0 ? ` skippedDetail=[${skippedDetail.join("|")}]` : ""),
  );

  return html;
}

// Minimal unsubscribe footer appended to custom HTML that doesn't provide its
// own {unsubscribe_url}. Keeps custom-HTML sends CAN-SPAM / Shopify compliant.
function unsubscribeFooterHtml(unsubscribeUrl) {
  if (!unsubscribeUrl) return "";
  return `<div style="font-family:Geist,system-ui,sans-serif;font-size:12px;color:#999;text-align:center;line-height:1.6;padding:24px 16px 8px;">
    <a href="${escapeAttr(unsubscribeUrl)}" style="color:#999;text-decoration:underline;">Unsubscribe</a>
    <div style="margin-top:6px;font-size:11px;opacity:0.6;">Powered by Retainify</div>
  </div>`;
}

/**
 * Render a merchant's pasted HTML template for send. Applies the SAME pipeline
 * as blocks where it matters — merge tags + unsubscribe — and injects the head/
 * wrapper without double-wrapping a full document.
 *
 * @param {{ html: string, ctx: object, stepId?: string }} args
 *   ctx carries merge-tag values plus `unsubscribeUrl` (same object the worker
 *   builds for the block path). `discount_code` is typically "" here since
 *   custom-HTML steps don't generate a code.
 * @returns {string} final HTML ready to send
 */
export function renderCustomHtmlEmail({ html, ctx = {}, stepId }) {
  const raw = String(html || "");

  // 1) Merge tags (incl. an explicit {unsubscribe_url} tag if the author used one).
  let out = applyMergeTagsToHtml(raw, ctx);
  const hadUnsubTag = /\{unsubscribe_url\}/.test(raw);
  out = out.replace(/\{unsubscribe_url\}/g, ctx.unsubscribeUrl ? escapeAttr(ctx.unsubscribeUrl) : "");

  // 2) Unsubscribe guarantee — only append a footer if the author didn't wire
  //    their own {unsubscribe_url} and there's no existing unsubscribe link.
  const hasUnsubLink = hadUnsubTag || /unsubscribe/i.test(out);
  const footer = hasUnsubLink ? "" : unsubscribeFooterHtml(ctx.unsubscribeUrl);

  const isFullDoc = /<html[\s>]/i.test(out);
  const fontsLink = `<link rel="preconnect" href="https://fonts.googleapis.com" />\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n<link href="${GOOGLE_FONTS_HREF}" rel="stylesheet" />`;

  let finalHtml;
  if (isFullDoc) {
    // 3a) Full document: pass through. Inject fonts link into <head> if present
    //     and not already there; append footer before </body> (or at end).
    let doc = out;
    if (/<head[\s>]/i.test(doc) && !doc.includes("fonts.googleapis.com/css2")) {
      doc = doc.replace(/<head([^>]*)>/i, (m) => `${m}\n${fontsLink}`);
    }
    if (footer) {
      doc = /<\/body>/i.test(doc)
        ? doc.replace(/<\/body>/i, `${footer}\n</body>`)
        : doc + footer;
    }
    finalHtml = doc;
  } else {
    // 3b) Fragment: wrap in the same shell shape the block renderer uses.
    finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${escapeAttr(ctx.store_name || "")}</title>
${fontsLink}
</head>
<body style="margin:0;padding:0;font-family:Geist,system-ui,sans-serif;">
${out}
${footer}
</body>
</html>`;
  }

  console.log(
    `[email-render] step=${stepId || "?"} mode=html htmlBytes=${finalHtml.length}` +
    ` fullDoc=${isFullDoc} unsubAppended=${footer ? 1 : 0}`,
  );

  return finalHtml;
}
