/**
 * Public unsubscribe endpoint.
 *
 * GET  → renders a confirmation page. Never mutates. This is load-bearing:
 *        corporate link scanners, spam filters and inbox prefetchers GET every
 *        URL in a message, so a mutating GET unsubscribes real people who never
 *        clicked anything.
 * POST → performs the unsubscribe, and only with a valid signature. Accepts
 *        either the durable `t` token from the email (RFC 8058 one-click, which
 *        mailbox providers POST directly) or the short-lived `ct` token minted
 *        by the confirmation page (which is how links sent before signing
 *        existed still work — a human has to load the page and click).
 *
 * See app/lib/tracking/links.server.js for the token contract.
 */
import prisma from "../db.server.js";
import { evaluateExitCriteria } from "../lib/journey/exit-criteria.server.js";
import {
  normalizeEmail,
  resubscribeContact,
  unsubscribeContact,
} from "../lib/contacts/contacts.server.js";
import {
  confirmFormToken,
  verifyConfirmFormToken,
  verifyUnsubscribeToken,
} from "../lib/tracking/links.server.js";

// ── Page shell ─────────────────────────────────────────────────────────────
function page(title, body, status = 200) {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:48px 20px; background:#f6f6f4; color:#1a1a1a;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    line-height:1.6; }
  .card { max-width:440px; margin:0 auto; background:#fff; border-radius:12px;
    padding:36px 32px; box-shadow:0 2px 14px rgba(0,0,0,.07); text-align:center; }
  h1 { margin:0 0 10px; font-size:21px; line-height:1.3; }
  p { margin:0 0 18px; font-size:15px; color:#555; }
  .addr { font-weight:600; color:#1a1a1a; word-break:break-all; }
  button { font:inherit; font-size:15px; font-weight:600; cursor:pointer;
    border-radius:8px; padding:12px 22px; border:1px solid transparent; }
  .primary { background:#1a1a1a; color:#fff; }
  .primary:hover { background:#333; }
  .ghost { background:transparent; color:#666; border-color:#d6d6d2; }
  .ghost:hover { color:#1a1a1a; border-color:#999; }
  button:focus-visible { outline:2px solid #2F5D4E; outline-offset:2px; }
  .muted { font-size:13px; color:#8a8a86; margin:0; }
  form { margin:0 0 12px; }
  @media (prefers-color-scheme: dark) {
    body { background:#111; color:#eee; }
    .card { background:#1b1b1b; box-shadow:none; }
    h1 { color:#f2f2f2; } p { color:#aaa; } .addr { color:#f2f2f2; }
    .primary { background:#f2f2f2; color:#111; } .primary:hover { background:#fff; }
    .ghost { color:#aaa; border-color:#3a3a3a; }
  }
</style></head>
<body><div class="card">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * What to call the sender on the unsubscribe page.
 *
 * The last resort used to be the tenant key with ".myshopify.com" stripped,
 * which reads fine for a store ("acme") and badly for a direct workspace, whose
 * key is a generated slug ("acme-1a2b3c4d"). The workspace name is the right
 * answer there, and a plain fallback beats showing anyone an internal id.
 */
async function storeNameFor(shop) {
  const [settings, account] = await Promise.all([
    prisma.shopSettings
      .findUnique({ where: { shop }, select: { senderName: true } })
      .catch(() => null),
    prisma.account.findUnique({ where: { key: shop }, select: { name: true, kind: true } }).catch(() => null),
  ]);

  const name = (settings?.senderName || "").trim();
  if (name && name !== "Your Store") return name;

  const accountName = (account?.name || "").trim();
  if (accountName) return accountName;

  if (/\.myshopify\.com$/i.test(String(shop || ""))) {
    return String(shop).replace(".myshopify.com", "");
  }
  return "this sender";
}

// ── GET: confirmation page, no mutation ────────────────────────────────────
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  const email = normalizeEmail(url.searchParams.get("email") || "");

  if (!shop || !email) {
    return page(
      "Invalid link",
      `<h1>This link isn't valid</h1><p>It's missing the information we need to identify your subscription. Please use the unsubscribe link at the bottom of one of our emails.</p>`,
      400,
    );
  }

  const storeName = await storeNameFor(shop);

  // Already suppressed — say so instead of asking them to confirm again.
  const existing = await prisma.emailSuppression.findUnique({
    where: { shop_email: { shop, email } },
  });
  if (existing) {
    return page(
      "Already unsubscribed",
      `<h1>You're already unsubscribed</h1>
       <p><span class="addr">${escapeHtml(email)}</span> won't receive marketing emails from ${escapeHtml(storeName)}.</p>`,
    );
  }

  // Mint a short-lived form token so the POST is verifiable even when the
  // original link predates signing.
  const issuedAt = Date.now();
  const ct = confirmFormToken(shop, email, issuedAt);

  return page(
    "Unsubscribe",
    `<h1>Unsubscribe from ${escapeHtml(storeName)}?</h1>
     <p><span class="addr">${escapeHtml(email)}</span> will stop receiving marketing emails. This takes effect immediately.</p>
     <form method="POST">
       <input type="hidden" name="shop" value="${escapeHtml(shop)}" />
       <input type="hidden" name="email" value="${escapeHtml(email)}" />
       <input type="hidden" name="ts" value="${issuedAt}" />
       <input type="hidden" name="ct" value="${ct}" />
       <button type="submit" class="primary">Unsubscribe</button>
     </form>
     <p class="muted">Didn't mean to click this? Just close this page — nothing changes until you confirm.</p>`,
  );
};

// ── POST: perform the change ───────────────────────────────────────────────
export const action = async ({ request }) => {
  const url = new URL(request.url);

  let form;
  try {
    form = await request.formData();
  } catch {
    form = new FormData();
  }

  // Query params win for one-click (the provider POSTs to the URL as-is and
  // puts only "List-Unsubscribe=One-Click" in the body); form fields cover the
  // confirmation page.
  const shop = url.searchParams.get("shop") || String(form.get("shop") || "");
  const email = normalizeEmail(
    url.searchParams.get("email") || String(form.get("email") || ""),
  );
  const intent = String(form.get("intent") || "unsubscribe");

  if (!shop || !email) {
    return page("Invalid link", `<h1>This link isn't valid</h1><p>We couldn't identify the subscription to update.</p>`, 400);
  }

  // Signature: either the durable email token or a fresh confirmation-page token.
  const durableToken = url.searchParams.get("t") || String(form.get("t") || "");
  const authorized =
    verifyUnsubscribeToken(shop, email, durableToken) ||
    verifyConfirmFormToken(shop, email, form.get("ts"), form.get("ct"));

  if (!authorized) {
    console.warn(`[unsubscribe] rejected unsigned POST shop=${shop}`);
    return page(
      "Link expired",
      `<h1>This link has expired</h1><p>Open the unsubscribe link from one of our emails again to continue.</p>`,
      403,
    );
  }

  const storeName = await storeNameFor(shop);

  // ── Undo, offered on the success page after an accidental unsubscribe ─────
  // Only reachable with a valid `ct`, i.e. from a page this person just loaded.
  if (intent === "resubscribe") {
    // resubscribeContact clears the suppression row and flips the Contact back
    // to "subscribed" — the exact inverse of unsubscribeContact below.
    await resubscribeContact(shop, email).catch((err) =>
      console.error("[unsubscribe] undo resubscribe failed:", err.message),
    );
    return page(
      "Resubscribed",
      `<h1>You're back on the list</h1>
       <p><span class="addr">${escapeHtml(email)}</span> will keep receiving emails from ${escapeHtml(storeName)}.</p>`,
    );
  }

  // Canonical path: writes the EmailSuppression row (the gate every worker
  // checks) and mirrors the status onto the Contact record.
  await unsubscribeContact(shop, email);

  await evaluateExitCriteria(shop, email, "unsubscribed").catch((err) =>
    console.error("[unsubscribe] exit-criteria failed:", err.message),
  );

  // RFC 8058 one-click: the mailbox provider isn't rendering anything, it just
  // wants a 2xx. Detect it by the body the spec requires and skip the HTML.
  if (String(form.get("List-Unsubscribe") || "") === "One-Click") {
    return new Response(null, { status: 200 });
  }

  const issuedAt = Date.now();
  const ct = confirmFormToken(shop, email, issuedAt);

  return page(
    "Unsubscribed",
    `<h1>You've been unsubscribed</h1>
     <p><span class="addr">${escapeHtml(email)}</span> will no longer receive marketing emails from ${escapeHtml(storeName)}.</p>
     <form method="POST">
       <input type="hidden" name="intent" value="resubscribe" />
       <input type="hidden" name="shop" value="${escapeHtml(shop)}" />
       <input type="hidden" name="email" value="${escapeHtml(email)}" />
       <input type="hidden" name="ts" value="${issuedAt}" />
       <input type="hidden" name="ct" value="${ct}" />
       <button type="submit" class="ghost">This was a mistake — resubscribe me</button>
     </form>`,
  );
};
