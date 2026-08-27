/**
 * Transactional mail for the account system itself — invitations, password
 * resets, welcome messages.
 *
 * Deliberately does NOT go through lib/email/index.server.js. That module
 * resolves the *merchant's* provider and sender identity, which is exactly
 * wrong here: a password reset is from us, to one person, and must arrive even
 * if the workspace has no sender configured (or is the reason they're locked
 * out). So this sends from our own address through the platform provider, with
 * no merchant settings involved.
 *
 * ── Deliverability notes ────────────────────────────────────────────────────
 * These messages are the ones that MUST reach the inbox — a password reset in
 * the junk folder is an account lockout. Everything below is shaped for that:
 *
 *  - Table-based layout with inline styles. Outlook's Word renderer ignores
 *    float, flex and most modern CSS; a div layout collapses there.
 *  - No images at all. An image-only email is a classic spam shape, images are
 *    blocked by default in most clients, and a logo that fails to load makes a
 *    security email look forged. The wordmark is drawn with a styled table
 *    cell, so it renders identically everywhere with nothing to block.
 *  - A real plain-text alternative that says the same thing as the HTML.
 *    Missing or stub text parts are a strong spam signal.
 *  - Preheader text, so the inbox preview line is a sentence rather than
 *    whatever markup happens to come first.
 *  - Enough real prose to give a sane text-to-link ratio. A near-empty message
 *    whose only content is one big link is the exact shape of a phishing mail,
 *    and filters score it that way.
 *  - Reply-To pointing at a monitored address: replies are a positive
 *    engagement signal, and a no-reply-only sender is treated worse.
 *  - No List-Unsubscribe. These are transactional, not marketing; offering to
 *    unsubscribe from a password reset is both wrong and a mixed signal.
 */
import { sendEmail as sendViaResend } from "../email/resend.server.js";
import { sendEmail as sendViaSes } from "../email/ses.server.js";

const FALLBACK_FROM = "Retainify <noreply@retainify.app>";

/** The app's public origin, with no trailing slash. */
export function appBaseUrl() {
  const raw = process.env.APP_PUBLIC_URL || process.env.SHOPIFY_APP_URL || "";
  const trimmed = String(raw).replace(/\/+$/, "");
  if (!trimmed) {
    console.warn("[auth-mail] APP_PUBLIC_URL/SHOPIFY_APP_URL unset — links will be relative");
  }
  return trimmed;
}

function systemFrom() {
  return (
    process.env.AUTH_FROM_EMAIL ||
    (process.env.RESEND_FROM_EMAIL ? `Retainify <${process.env.RESEND_FROM_EMAIL}>` : "") ||
    FALLBACK_FROM
  );
}

/**
 * Where replies go. A transactional sender that discards replies is penalised
 * by most filters, so this should be a mailbox someone actually reads.
 */
function systemReplyTo() {
  return process.env.AUTH_REPLY_TO || process.env.SUPPORT_EMAIL || "";
}

function systemSender() {
  // Same choice the rest of the app makes, but read from env rather than a
  // ShopSettings row, since these mails belong to no workspace.
  return process.env.AUTH_EMAIL_PROVIDER === "ses" ? sendViaSes : sendViaResend;
}

async function send({ to, subject, html, text }) {
  const from = systemFrom();
  const replyTo = systemReplyTo() || undefined;
  try {
    const result = await systemSender()({ to, from, replyTo, subject, html, text });
    if (!result.ok) console.error("[auth-mail] send failed:", result.error);
    return result;
  } catch (err) {
    console.error("[auth-mail] send threw:", err.message);
    return { ok: false, error: err.message };
  }
}

// ── Brand ───────────────────────────────────────────────────────────────────
// Mirrors app/styles/tokens.css. Hex literals rather than CSS variables: no
// email client supports custom properties.
const C = {
  paper: "#F4EFE4", // page background — warm, not the usual clinical white
  card: "#FDFBF5",
  ink: "#14201A",
  inkSoft: "#5C625A",
  inkFaint: "#8A8E84",
  hair: "#E4DDCB",
  brand: "#1F3D2F",
  onBrand: "#F4EFE4",
  accent: "#E8F25A",
};

// Georgia stands in for Instrument Serif, and the system stack for Geist.
// Webfonts are unreliable in email (Outlook and Gmail both drop them), so the
// fallbacks ARE the design rather than a degraded version of it.
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Hidden preheader — the grey text a client shows after the subject.
 *
 * The trailing entities pad it out so the client doesn't pull the first line of
 * body copy in after it, which is what produces those "…View this email in your
 * browser" previews.
 */
function preheader(text) {
  return `<div style="display:none;font-size:1px;color:${C.paper};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(
    text,
  )}${"&#8199;&#65279;&#847; ".repeat(30)}</div>`;
}

/**
 * A button that survives Outlook.
 *
 * The colour sits on the <td> rather than the <a>, because Outlook's Word
 * renderer drops background-color from inline anchors and would otherwise draw
 * dark text on a dark ground.
 */
function button(label, url) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0;">
    <tr>
      <td align="center" bgcolor="${C.brand}" style="border-radius:8px;">
        <a href="${url}" target="_blank" rel="noopener"
           style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:15px;font-weight:600;line-height:1;color:${C.onBrand};text-decoration:none;border-radius:8px;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

/**
 * Shared shell. Every account email is this frame with different contents, so
 * they read as one product rather than three unrelated notifications.
 */
function shell({ preview, eyebrow, heading, body, cta, ctaUrl, linkNote, footer }) {
  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
<!--[if mso]><style>body,table,td,a{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${C.paper};">
${preheader(preview)}
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:${C.paper};">
  <tr>
    <td align="center" style="padding:32px 12px 40px;">

      <!-- Wordmark. Text, not an image: nothing to block, nothing to fail. -->
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
        <tr>
          <td style="width:28px;height:28px;background-color:${C.brand};border-radius:7px;text-align:center;vertical-align:middle;font-family:${SANS};font-size:15px;font-weight:700;color:${C.onBrand};">R</td>
          <td style="padding-left:9px;font-family:${SANS};font-size:14px;font-weight:600;color:${C.ink};letter-spacing:0.01em;">Retainify</td>
        </tr>
      </table>

      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"
             style="max-width:520px;background-color:${C.card};border:1px solid ${C.hair};border-radius:14px;">
        <tr>
          <td style="padding:36px 36px 0;">
            ${
              eyebrow
                ? `<div style="font-family:${SANS};font-size:11px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:${C.inkFaint};padding-bottom:12px;">${escapeHtml(
                    eyebrow,
                  )}</div>`
                : ""
            }
            <h1 style="margin:0;font-family:${SERIF};font-size:29px;line-height:1.2;font-weight:400;color:${C.ink};">${escapeHtml(
              heading,
            )}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 36px 0;font-family:${SANS};font-size:15px;line-height:1.65;color:${C.inkSoft};">
            ${body}
          </td>
        </tr>
        ${
          cta && ctaUrl
            ? `<tr><td style="padding:28px 36px 0;">${button(cta, ctaUrl)}</td></tr>
               <tr><td style="padding:18px 36px 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.inkFaint};">
                 ${escapeHtml(linkNote || "If the button doesn't work, copy and paste this address into your browser:")}<br>
                 <a href="${ctaUrl}" target="_blank" rel="noopener" style="color:${C.brand};text-decoration:underline;word-break:break-all;">${ctaUrl}</a>
               </td></tr>`
            : ""
        }
        <tr>
          <td style="padding:28px 36px 32px;">
            <div style="height:1px;background-color:${C.hair};font-size:0;line-height:0;">&nbsp;</div>
            <div style="padding-top:18px;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.inkFaint};">
              ${footer}
            </div>
          </td>
        </tr>
      </table>

      <div style="max-width:520px;padding-top:18px;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.inkFaint};text-align:center;">
        Retainify — email marketing, automations and analytics.
      </div>

    </td>
  </tr>
</table>
</body>
</html>`;
}

export async function sendInviteEmail({ to, token, accountName, invitedByName }) {
  const url = `${appBaseUrl()}/invite/${token}`;
  const ws = escapeHtml(accountName);
  const who = invitedByName ? escapeHtml(invitedByName) : "";
  // Both names reach the Subject header, so they are header-sanitised there.
  const subjWs = headerSafe(accountName);
  const subjWho = headerSafe(invitedByName, 40);

  return send({
    to,
    subject: `${subjWho ? `${subjWho} invited you` : "You're invited"} to ${subjWs || "a workspace"} on Retainify`,
    html: shell({
      preview: `Accept your invitation to the ${accountName} workspace.`,
      eyebrow: "Workspace invitation",
      heading: `Join ${accountName}`,
      body: `<p style="margin:0 0 14px;">${
        who ? `<strong style="color:${C.ink};">${who}</strong> has invited you` : "You've been invited"
      } to join the <strong style="color:${C.ink};">${ws}</strong> workspace on Retainify.</p>
        <p style="margin:0 0 14px;">Retainify is where the team manages contacts, builds automated email flows, sends broadcasts, and tracks how each one performed. Accepting takes a moment — you'll pick a password and land straight in the workspace.</p>
        <p style="margin:0;">This invitation is good for 7 days.</p>`,
      cta: "Accept invitation",
      ctaUrl: url,
      footer: `You're receiving this because ${
        who ? `${who} entered` : "someone entered"
      } your address when inviting a teammate to ${ws}. If that wasn't expected, you can safely ignore this email — nothing happens until you accept.`,
    }),
    text: [
      `${who ? `${invitedByName} has invited you` : "You've been invited"} to join the "${accountName}" workspace on Retainify.`,
      ``,
      `Retainify is where the team manages contacts, builds automated email flows, sends broadcasts, and tracks how each one performed.`,
      ``,
      `Accept your invitation:`,
      url,
      ``,
      `This invitation is good for 7 days.`,
      ``,
      `If you weren't expecting this, you can ignore this email — nothing happens until you accept.`,
    ].join("\n"),
  });
}

export async function sendPasswordResetEmail({ to, token }) {
  const url = `${appBaseUrl()}/reset/${token}`;
  return send({
    to,
    subject: "Reset your Retainify password",
    html: shell({
      preview: "Choose a new password — this link works once and expires in an hour.",
      eyebrow: "Account security",
      heading: "Reset your password",
      body: `<p style="margin:0 0 14px;">We received a request to reset the password for the Retainify account registered to this address.</p>
        <p style="margin:0 0 14px;">Use the button below to choose a new one. For your security the link can only be used once, and it stops working an hour after this email was sent.</p>
        <p style="margin:0;">Setting a new password signs you out everywhere else, so anyone using your account on another device will need to sign in again.</p>`,
      cta: "Choose a new password",
      ctaUrl: url,
      footer: `If you didn't request a password reset, no action is needed and nothing has changed — your current password still works. Someone may have entered your address by mistake.`,
    }),
    text: [
      `Reset your Retainify password`,
      ``,
      `We received a request to reset the password for the account registered to this address.`,
      ``,
      `Choose a new password:`,
      url,
      ``,
      `The link works once and expires one hour after this email was sent.`,
      `Setting a new password signs you out on all other devices.`,
      ``,
      `If you didn't request this, nothing has changed and your current password still works.`,
    ].join("\n"),
  });
}

export async function sendWelcomeEmail({ to, name, workspaceName }) {
  const url = `${appBaseUrl()}/app`;
  const ws = escapeHtml(workspaceName);
  return send({
    to,
    subject: `Your Retainify workspace is ready`,
    html: shell({
      preview: `${workspaceName} is set up — here's how to get your first send out.`,
      eyebrow: "Welcome",
      heading: name ? `Welcome, ${name}` : "Welcome to Retainify",
      body: `<p style="margin:0 0 14px;">Your workspace <strong style="color:${C.ink};">${ws}</strong> is ready to use.</p>
        <p style="margin:0 0 8px;">Three things worth doing first:</p>
        <p style="margin:0 0 8px;"><strong style="color:${C.ink};">1. Bring in your contacts.</strong> Upload a CSV and map your own columns — names, tags and any custom fields come across intact.</p>
        <p style="margin:0 0 8px;"><strong style="color:${C.ink};">2. Set your sender details.</strong> The name recipients see, and the address their replies reach.</p>
        <p style="margin:0 0 14px;"><strong style="color:${C.ink};">3. Send something.</strong> A one-off broadcast to a segment, or an automated flow that runs on its own.</p>
        <p style="margin:0;">If you get stuck, reply to this email — it reaches a real person.</p>`,
      cta: "Open your workspace",
      ctaUrl: url,
      footer: `You're receiving this because a Retainify account was created with this address. If that wasn't you, please reply and let us know.`,
    }),
    text: [
      name ? `Welcome, ${name}` : `Welcome to Retainify`,
      ``,
      `Your workspace "${workspaceName}" is ready to use.`,
      ``,
      `Three things worth doing first:`,
      `1. Bring in your contacts — upload a CSV and map your own columns.`,
      `2. Set your sender details — the name recipients see and where replies go.`,
      `3. Send something — a broadcast to a segment, or an automated flow.`,
      ``,
      `Open your workspace:`,
      url,
      ``,
      `If you get stuck, reply to this email — it reaches a real person.`,
    ].join("\n"),
  });
}

/**
 * Make a user-supplied value safe to place in a header (Subject, mostly).
 *
 * Workspace and person names come from a signup form, so they can contain
 * anything — including CR/LF, which is the classic header-injection vector: a
 * name of "Eve\r\nBcc: attacker@example.com" would otherwise try to smuggle a
 * second header into the message. Our provider takes JSON and very likely
 * sanitises this itself, but "the API probably handles it" is not a security
 * control, and a subject containing a newline is broken output regardless.
 *
 * Also collapses runs of whitespace and clamps length, because a 400-character
 * workspace name makes for a useless subject line.
 */
function headerSafe(value, max = 80) {
  const cleaned = String(value || "")
    // Strip CR, LF, NUL and other C0 control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
