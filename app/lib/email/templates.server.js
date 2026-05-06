/**
 * Email template engine.
 * All templates are inline-CSS, mobile-responsive HTML strings.
 *
 * renderCartRescueEmail({ style, emailNumber, cart, settings, recoveryUrl, discountCode, trackingUrl })
 */

/**
 * @typedef {Object} LineItem
 * @property {string} title
 * @property {string} variantTitle
 * @property {number} quantity
 * @property {string} price
 * @property {string} imageUrl
 * @property {string} productUrl
 */

/**
 * @typedef {Object} RenderOptions
 * @property {'classic'|'bold'|'minimal'} style
 * @property {1|2|3} emailNumber
 * @property {string} customerName
 * @property {LineItem[]} lineItems
 * @property {string} totalPrice
 * @property {string} currency
 * @property {string} storeName
 * @property {string} senderEmail
 * @property {string} logoUrl
 * @property {string} brandColor
 * @property {string} recoveryUrl     - the tracked recovery CTA link
 * @property {string} unsubscribeUrl
 * @property {string} merchantAddress
 * @property {string} [discountCode]
 * @property {string} [customSubject]
 * @property {string} [customBody]
 */

function formatCurrency(amount, currency) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function lineItemsHtml(lineItems, brandColor) {
  if (!lineItems?.length) return "";
  return lineItems
    .map(
      (item) => `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
      <tr>
        ${
          item.imageUrl
            ? `<td width="70" style="padding-right:12px;vertical-align:top;">
                <img src="${item.imageUrl}" width="70" height="70"
                  style="border-radius:4px;object-fit:cover;display:block;" alt="${item.title}" />
              </td>`
            : ""
        }
        <td style="vertical-align:top;">
          <p style="margin:0;font-size:15px;font-weight:600;color:#1a1a1a;">${item.title}</p>
          ${item.variantTitle ? `<p style="margin:2px 0 0;font-size:13px;color:#666;">${item.variantTitle}</p>` : ""}
          <p style="margin:4px 0 0;font-size:13px;color:#666;">Qty: ${item.quantity}</p>
          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:${brandColor};">${item.price}</p>
        </td>
      </tr>
    </table>`,
    )
    .join("");
}

function baseLayout({ content, storeName, logoUrl, brandColor, unsubscribeUrl, merchantAddress, bgColor = "#f4f4f4", cardBg = "#ffffff" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${storeName}</title>
</head>
<body style="margin:0;padding:0;background-color:${bgColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:${bgColor};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
        <!-- Logo row -->
        <tr>
          <td align="center" style="padding-bottom:24px;">
            ${
              logoUrl
                ? `<img src="${logoUrl}" height="48" alt="${storeName}" style="display:block;max-width:200px;" />`
                : `<p style="margin:0;font-size:22px;font-weight:700;color:#1a1a1a;">${storeName}</p>`
            }
          </td>
        </tr>
        <!-- Card -->
        <tr>
          <td style="background-color:${cardBg};border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            ${content}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td align="center" style="padding-top:24px;">
            <p style="margin:0;font-size:12px;color:#999;line-height:1.6;">
              You received this email because you recently visited ${storeName}.<br />
              <a href="${unsubscribeUrl}" style="color:#999;text-decoration:underline;">Unsubscribe</a>
              &nbsp;·&nbsp;
              ${merchantAddress}
            </p>
            <p style="margin:8px 0 0;font-size:11px;color:#ccc;">Powered by Retainify</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ── Classic ────────────────────────────────────────────────────────────────
function renderClassic(opts, headline, body) {
  const { brandColor, lineItems, recoveryUrl, discountCode, totalPrice, currency } = opts;
  const content = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1a1a1a;">${headline}</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">${body}</p>
    ${lineItemsHtml(lineItems, brandColor)}
    <p style="margin:16px 0 0;font-size:14px;color:#555;">
      Cart total: <strong>${formatCurrency(totalPrice, currency)}</strong>
    </p>
    ${discountCode ? `<p style="margin:8px 0 0;font-size:14px;color:#555;">Use code <strong style="color:${brandColor};">${discountCode}</strong> at checkout for your discount.</p>` : ""}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
      <tr>
        <td>
          <a href="${recoveryUrl}"
            style="display:inline-block;background-color:${brandColor};color:#ffffff;font-size:15px;font-weight:600;padding:14px 28px;border-radius:6px;text-decoration:none;">
            Return to cart →
          </a>
        </td>
      </tr>
    </table>`;
  return baseLayout({ ...opts, content });
}

// ── Bold ───────────────────────────────────────────────────────────────────
function renderBold(opts, headline, body) {
  const { brandColor, lineItems, recoveryUrl, discountCode, totalPrice, currency } = opts;
  const content = `
    <div style="background-color:${brandColor};margin:-32px -32px 24px;padding:24px 32px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">${headline}</h1>
    </div>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.7;">${body}</p>
    ${lineItemsHtml(lineItems, brandColor)}
    <p style="margin:16px 0 0;font-size:14px;color:#555;">
      Cart total: <strong>${formatCurrency(totalPrice, currency)}</strong>
    </p>
    ${discountCode ? `<div style="margin:16px 0;padding:12px 16px;background:#f9f5ff;border-left:4px solid ${brandColor};border-radius:4px;"><p style="margin:0;font-size:14px;">Use code <strong style="color:${brandColor};font-size:16px;">${discountCode}</strong> at checkout.</p></div>` : ""}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
      <tr>
        <td>
          <a href="${recoveryUrl}"
            style="display:inline-block;background-color:${brandColor};color:#ffffff;font-size:16px;font-weight:700;padding:16px 32px;border-radius:6px;text-decoration:none;letter-spacing:0.3px;">
            Complete my purchase
          </a>
        </td>
      </tr>
    </table>`;
  return baseLayout({ ...opts, content, bgColor: "#ffffff", cardBg: "#ffffff" });
}

// ── Minimal ────────────────────────────────────────────────────────────────
function renderMinimal(opts, headline, body) {
  const { brandColor, lineItems, recoveryUrl, discountCode, totalPrice, currency } = opts;
  const content = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#1a1a1a;border-bottom:2px solid ${brandColor};padding-bottom:12px;">${headline}</h1>
    <p style="margin:16px 0 24px;font-size:15px;color:#555;line-height:1.7;">${body}</p>
    ${lineItemsHtml(lineItems, brandColor)}
    <p style="margin:16px 0 4px;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Total</p>
    <p style="margin:0 0 24px;font-size:20px;font-weight:700;color:#1a1a1a;">${formatCurrency(totalPrice, currency)}</p>
    ${discountCode ? `<p style="margin:0 0 20px;font-size:14px;color:#555;">Discount code: <code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:14px;">${discountCode}</code></p>` : ""}
    <a href="${recoveryUrl}"
      style="display:inline-block;border:2px solid ${brandColor};color:${brandColor};font-size:14px;font-weight:600;padding:12px 24px;border-radius:4px;text-decoration:none;">
      Return to cart
    </a>`;
  return baseLayout({ ...opts, content, bgColor: "#ffffff", cardBg: "#ffffff" });
}

const headlines = {
  1: "You left something behind",
  2: "Still thinking it over?",
  3: "Last chance — don't miss out",
};

const bodies = {
  1: (name) => `Hi ${name || "there"},<br /><br />You left items in your cart. They're still waiting for you — tap below to pick up where you left off.`,
  2: (name) => `Hi ${name || "there"},<br /><br />We noticed you haven't completed your purchase yet. Your cart is saved and ready whenever you are.`,
  3: (name, discount) => `Hi ${name || "there"},<br /><br />Your cart is about to expire. Use code <strong>${discount}</strong> for ${discount ? "your exclusive discount" : "a discount"} — valid for 48 hours only.`,
};

/**
 * Confirmation email sent when a user signs up via the popup.
 * User must click the CTA to confirm their email (double opt-in).
 */
export function renderConfirmationEmail({ storeName, logoUrl, brandColor, confirmUrl }) {
  const content = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#1a1a1a;">Confirm your email</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
      Thanks for signing up! Click the button below to confirm your email address
      and receive your exclusive discount.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td>
          <a href="${confirmUrl}"
            style="display:inline-block;background-color:${brandColor};color:#ffffff;font-size:15px;font-weight:600;padding:14px 28px;border-radius:6px;text-decoration:none;">
            Confirm my email →
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:12px;color:#aaa;">
      If you didn't sign up for this, you can safely ignore this email.
    </p>`;
  return baseLayout({
    content,
    storeName,
    logoUrl,
    brandColor,
    unsubscribeUrl: "#",
    merchantAddress: "",
  });
}

/**
 * Follow-up email sent after the user confirms, revealing their discount code.
 */
export function renderDiscountRevealEmail({ storeName, logoUrl, brandColor, discountCode, discountPct }) {
  const content = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#1a1a1a;">Here's your discount!</h1>
    <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;">
      Thanks for confirming. Use the code below for ${discountPct}% off your order.
    </p>
    <div style="text-align:center;padding:24px 20px;background:#f9f9f9;border-radius:8px;margin-bottom:24px;">
      <p style="margin:0;font-size:32px;font-weight:800;color:${brandColor};letter-spacing:3px;font-family:monospace;">
        ${discountCode}
      </p>
      <p style="margin:10px 0 0;font-size:12px;color:#999;">Valid for 48 hours &middot; Single use</p>
    </div>
    <p style="margin:0;font-size:14px;color:#555;">
      Apply this code at checkout to save ${discountPct}% on your entire order.
    </p>`;
  return baseLayout({
    content,
    storeName,
    logoUrl,
    brandColor,
    unsubscribeUrl: "#",
    merchantAddress: "",
  });
}

/**
 * @param {RenderOptions} opts
 * @returns {string} HTML string
 */
export function renderCartRescueEmail(opts) {
  const { style = "classic", emailNumber, customerName, discountCode } = opts;
  const headline = opts.customSubject || headlines[emailNumber] || headlines[1];
  const body = opts.customBody || bodies[emailNumber]?.(customerName, discountCode) || bodies[1](customerName);

  switch (style) {
    case "bold":
      return renderBold(opts, headline, body);
    case "minimal":
      return renderMinimal(opts, headline, body);
    default:
      return renderClassic(opts, headline, body);
  }
}
