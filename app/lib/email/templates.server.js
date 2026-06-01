/**
 * Popup signup email templates.
 *
 * Cart-rescue / journey email rendering lives in visual-renderer.server.js.
 * The two renderers here power the double-opt-in popup flow:
 *   1. renderConfirmationEmail — sent immediately after popup signup
 *   2. renderDiscountRevealEmail — sent after the user clicks the confirm link
 */

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
        <tr>
          <td align="center" style="padding-bottom:24px;">
            ${
              logoUrl
                ? `<img src="${logoUrl}" height="48" alt="${storeName}" style="display:block;max-width:200px;" />`
                : `<p style="margin:0;font-size:22px;font-weight:700;color:#1a1a1a;">${storeName}</p>`
            }
          </td>
        </tr>
        <tr>
          <td style="background-color:${cardBg};border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            ${content}
          </td>
        </tr>
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
