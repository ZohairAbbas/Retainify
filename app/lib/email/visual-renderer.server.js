/**
 * Visual email renderer — converts JourneyStep.emailBlocks + emailBrand JSON
 * into inline-CSS, table-based email HTML.
 *
 * Activates when step.emailBlocks is a non-empty JSON array. Falls back to
 * legacy renderCartRescueEmail when blocks are empty.
 *
 * Mirrors the block schema authored by app/components/EmailEditor.jsx.
 */

const FONT_PAIRS = {
  editorial: { display: "Instrument Serif, Cambria, serif", body: "Geist, system-ui, sans-serif" },
  modern:    { display: "Geist, system-ui, sans-serif",     body: "Geist, system-ui, sans-serif" },
  classic:   { display: "Georgia, Cambria, serif",          body: "Georgia, Cambria, serif" },
};

const DEFAULT_BRAND = { logoText: "YOUR STORE", accent: "#1F3D2F", bg: "#FFFFFF", fontPair: "editorial" };

function escapeAttr(s) {
  return String(s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function applyMergeTags(html, ctx) {
  if (!html) return "";
  const used = [];
  const out = String(html).replace(/\{(first_name|last_name|store_name|discount_code|cart_url)\}/g, (_, key) => {
    used.push(key);
    return ctx[key] != null ? String(ctx[key]) : "";
  });
  return { out, used };
}

function renderLogo(b, brand, fonts) {
  const sizes = { small: 14, medium: 18, large: 24 };
  const fontSize = sizes[b.size] || 18;
  const align = b.align || "center";
  return `<tr><td align="${align}" style="padding:0 0 16px;">
    <div style="font-family:${fonts.display};font-size:${fontSize}px;letter-spacing:0.08em;text-transform:uppercase;color:#14201A;">${escapeAttr(b.text || brand.logoText)}</div>
  </td></tr>`;
}

function renderHeading(b, brand, fonts, ctx) {
  const sizes = { 1: 32, 2: 24, 3: 18 };
  const fontSize = sizes[b.level] || 24;
  const align = b.align || "left";
  const { out } = applyMergeTags(b.html || "", ctx);
  return `<tr><td align="${align}" style="padding:8px 0;">
    <div style="font-family:${fonts.display};font-size:${fontSize}px;line-height:1.18;font-weight:400;letter-spacing:-0.01em;color:#14201A;text-align:${align};">${out}</div>
  </td></tr>`;
}

function renderParagraph(b, brand, fonts, ctx) {
  const align = b.align || "left";
  const { out } = applyMergeTags(b.html || "", ctx);
  return `<tr><td align="${align}" style="padding:8px 0;">
    <div style="font-family:${fonts.body};font-size:15px;line-height:1.6;color:#2D362F;text-align:${align};">${out}</div>
  </td></tr>`;
}

function renderButton(b, brand, fonts, ctx) {
  const filled = b.fill !== "outline";
  const align = b.align || "center";
  const { out: url } = applyMergeTags(b.url || "#", ctx);
  const bg = filled ? brand.accent : "transparent";
  const color = filled ? "#FFFFFF" : brand.accent;
  return `<tr><td align="${align}" style="padding:16px 0;">
    <a href="${escapeAttr(url)}" style="display:inline-block;padding:14px 28px;background:${bg};color:${color};border:1px solid ${brand.accent};border-radius:4px;font-family:${fonts.body};font-size:15px;font-weight:600;text-decoration:none;">${escapeAttr(b.text || "Shop now")}</a>
  </td></tr>`;
}

function renderImage(b) {
  if (!b.src || b.placeholder) return null; // skip — caller logs
  const align = b.align || "full";
  const width = align === "full" ? "100%" : align === "wide" ? "80%" : "50%";
  return `<tr><td align="center" style="padding:12px 0;">
    <img src="${escapeAttr(b.src)}" alt="${escapeAttr(b.alt || "")}" style="width:${width};max-width:100%;height:auto;display:block;border:0;" />
  </td></tr>`;
}

function renderSpacer(b) {
  return `<tr><td style="height:${Number(b.height) || 32}px;line-height:${Number(b.height) || 32}px;font-size:1px;">&nbsp;</td></tr>`;
}

function renderDivider(b) {
  const style = ["solid", "dashed", "dotted"].includes(b.style) ? b.style : "solid";
  return `<tr><td style="padding:12px 0;"><div style="border-top:1px ${style} #E5E0D5;"></div></td></tr>`;
}

function renderDiscount(b, brand, fonts) {
  return `<tr><td align="center" style="padding:16px 0;">
    <div style="border:1px dashed ${brand.accent};border-radius:6px;padding:20px;text-align:center;">
      <div style="font-family:${fonts.body};font-size:13px;color:${brand.accent};text-transform:uppercase;letter-spacing:0.08em;">${escapeAttr(b.label || "A gift for you")}</div>
      <div style="font-family:'Courier New',monospace;font-size:24px;font-weight:700;color:#14201A;margin:8px 0;">${escapeAttr(b.code || "")}</div>
      <div style="font-family:${fonts.body};font-size:13px;color:#666;">${Number(b.percent) || 0}% off your order</div>
    </div>
  </td></tr>`;
}

function renderFooter(b, brand, fonts, ctx) {
  const unsubHtml = b.unsubscribe && ctx.unsubscribeUrl
    ? `<div style="margin-top:8px;"><a href="${escapeAttr(ctx.unsubscribeUrl)}" style="color:#999;text-decoration:underline;">Unsubscribe</a></div>`
    : "";
  return `<tr><td align="center" style="padding:24px 0 8px;">
    <div style="font-family:${fonts.body};font-size:12px;color:#999;line-height:1.6;">
      <div style="font-weight:600;color:#666;">${escapeAttr(b.storeName || ctx.store_name || "")}</div>
      <div>${escapeAttr(b.address || "")}</div>
      ${unsubHtml}
      <div style="margin-top:6px;font-size:11px;color:#CCC;">Powered by Retainify</div>
    </div>
  </td></tr>`;
}

const RENDERERS = {
  logo: renderLogo,
  heading: renderHeading,
  paragraph: renderParagraph,
  button: renderButton,
  image: (b) => renderImage(b),
  spacer: (b) => renderSpacer(b),
  divider: (b) => renderDivider(b),
  discount: renderDiscount,
  footer: renderFooter,
};

const UNSUPPORTED_REASONS = {
  product: "product-grid-not-supported-server-side",
};

export function renderVisualEmail({ blocks, brand, ctx, stepId }) {
  const safeBrand = { ...DEFAULT_BRAND, ...(brand || {}) };
  const fonts = FONT_PAIRS[safeBrand.fontPair] || FONT_PAIRS.editorial;

  let rendered = 0;
  let skipped = 0;
  const skippedDetail = [];
  const mergeTagsUsed = new Set();

  // Track merge tag usage by wrapping applyMergeTags
  const ctxProxy = ctx; // ctx fields used directly; merge tags counted inline

  const rowsArr = [];
  for (const b of blocks) {
    if (!b || !b.type) {
      skipped++;
      skippedDetail.push("missing-type");
      continue;
    }
    if (b.type === "image" && (!b.src || b.placeholder)) {
      skipped++;
      skippedDetail.push("image:no-src");
      continue;
    }
    if (UNSUPPORTED_REASONS[b.type]) {
      skipped++;
      skippedDetail.push(`${b.type}:${UNSUPPORTED_REASONS[b.type]}`);
      continue;
    }
    const fn = RENDERERS[b.type];
    if (!fn) {
      skipped++;
      skippedDetail.push(`unknown:${b.type}`);
      continue;
    }
    let html = null;
    try {
      html = fn(b, safeBrand, fonts, ctxProxy);
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
</head>
<body style="margin:0;padding:0;background-color:${safeBrand.bg};font-family:${fonts.body};">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:${safeBrand.bg};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:8px;padding:32px;">
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
