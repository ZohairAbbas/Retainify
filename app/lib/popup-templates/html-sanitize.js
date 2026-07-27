// Sanitizer for merchant-authored popup HTML.
// Strategy: parse-free regex sweep over the raw string. We can't run DOMParser
// on the server (React Router loader/action), and we don't want to ship a
// full HTML parser to the storefront extension either. The rules below are
// intentionally conservative — allowlist of tag semantics enforced by
// blocking the dangerous ones outright.

const BLOCKED_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "frame",
  "frameset",
];

// Matches any of the blocked tags (opening or self-closing) along with their
// entire contents up to the matching close tag. Non-greedy so multiple
// occurrences are handled independently.
const BLOCKED_TAG_RE = new RegExp(
  `<(${BLOCKED_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>|<(${BLOCKED_TAGS.join("|")})\\b[^>]*\\/?>`,
  "gi",
);

// on* event-handler attributes: strip the whole `onclick="..."` chunk.
const EVENT_HANDLER_RE = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

// javascript: URLs in href/src/action
const JS_URL_RE = /\s(href|src|action|formaction|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi;

// data: URLs on href — mostly used for XSS via <a href="data:text/html,...">.
// Allow data: on src (used for images / fonts) but block on href.
const DATA_HREF_RE = /\s(href)\s*=\s*(?:"\s*data:[^"]*"|'\s*data:[^']*')/gi;

export function sanitizePopupHtml(input) {
  if (input == null) return "";
  let out = String(input);
  out = out.replace(BLOCKED_TAG_RE, "");
  out = out.replace(EVENT_HANDLER_RE, "");
  out = out.replace(JS_URL_RE, "");
  out = out.replace(DATA_HREF_RE, "");
  return out;
}

// Required hook checks. Both must be present for email capture to work.
export function findMissingHooks(html) {
  const s = String(html || "");
  const missing = [];
  if (!/data-rt-email\b/i.test(s)) missing.push("data-rt-email");
  if (!/data-rt-submit\b/i.test(s)) missing.push("data-rt-submit");
  return missing;
}

export const STARTER_HTML = `<style>
  .my-popup {
    position: relative;
    width: 420px;
    max-width: calc(100vw - 32px);
    padding: 36px 32px;
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.18);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #111;
    text-align: center;
  }
  .my-popup h2 { margin: 0 0 8px; font-size: 22px; font-weight: 700; }
  .my-popup p  { margin: 0 0 20px; font-size: 14px; color: #666; line-height: 1.5; }
  .my-popup input {
    width: 100%; box-sizing: border-box;
    padding: 12px 14px; margin-bottom: 10px;
    border: 1.5px solid #e0e0e0; border-radius: 8px; font-size: 14px;
  }
  .my-popup button.cta {
    width: 100%; padding: 12px;
    background: #111; color: #fff;
    border: 0; border-radius: 8px;
    font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .my-popup .close {
    position: absolute; top: 10px; right: 14px;
    background: none; border: 0; cursor: pointer;
    font-size: 22px; color: #aaa; line-height: 1;
  }
  .my-popup .fine { margin-top: 12px; font-size: 11px; color: #aaa; }
</style>

<div class="my-popup">
  <button class="close" data-rt-close aria-label="Close">×</button>
  <h2>Get 10% off your first order</h2>
  <p>Join our list — no spam, unsubscribe anytime.</p>
  <input type="email" placeholder="you@example.com" data-rt-email />
  <button type="button" class="cta" data-rt-submit>Get my discount</button>
  <div class="fine" data-rt-status style="display:none;"></div>
</div>
`;
