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

export function sanitizePopupHtml(input, scopeSelector) {
  if (input == null) return "";
  let out = String(input);
  out = out.replace(BLOCKED_TAG_RE, "");
  out = out.replace(EVENT_HANDLER_RE, "");
  out = out.replace(JS_URL_RE, "");
  out = out.replace(DATA_HREF_RE, "");
  if (scopeSelector) out = scopeStyleBlocks(out, scopeSelector);
  return out;
}

// Rewrite every <style>…</style> block so its selectors are prefixed with
// `scopeSelector`. Prevents merchant CSS (e.g. `body {}`, `:root {}`, `.close {}`)
// from leaking into the surrounding storefront or admin page.
export function scopeStyleBlocks(html, scopeSelector) {
  return String(html).replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, (_, attrs, css) => {
    return "<style" + attrs + ">" + scopeCss(css, scopeSelector) + "</style>";
  });
}

// Scope a CSS string by prefixing every selector in every rule with
// `scope`. Handles nested at-rules (@media, @supports), leaves at-rules
// with no selector body (@keyframes, @font-face, @import, @charset) alone.
export function scopeCss(css, scope) {
  const src = String(css || "");
  let i = 0;
  const n = src.length;
  let out = "";

  function skipComment() {
    if (src[i] === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) { out += src.slice(i); i = n; return true; }
      out += src.slice(i, end + 2);
      i = end + 2;
      return true;
    }
    return false;
  }

  // Walk to the matching close brace of a block that starts at position `i`
  // (i.e. src[i] === '{'). Returns the exclusive end position (index of '}').
  function matchBrace(start) {
    let depth = 0;
    for (let k = start; k < n; k++) {
      const c = src[k];
      if (c === "/" && src[k + 1] === "*") {
        const e = src.indexOf("*/", k + 2);
        k = e === -1 ? n : e + 1;
        continue;
      }
      if (c === '"' || c === "'") {
        // skip string
        const quote = c;
        k++;
        while (k < n && src[k] !== quote) {
          if (src[k] === "\\") k++;
          k++;
        }
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return k;
      }
    }
    return n;
  }

  // At-rules whose body is a raw block (do NOT recurse or prefix selectors).
  const RAW_AT_RULES = /^@(keyframes|-webkit-keyframes|-moz-keyframes|-o-keyframes|font-face|font-feature-values|counter-style|property|page|viewport)\b/i;
  // At-rules that wrap other rules (RECURSE into their body with the same scope).
  const NESTED_AT_RULES = /^@(media|supports|container|layer|scope|document)\b/i;

  while (i < n) {
    // Preserve whitespace/comments as-is.
    if (skipComment()) continue;
    const c = src[i];
    if (c === " " || c === "\n" || c === "\t" || c === "\r") { out += c; i++; continue; }

    // Find the next '{' or ';' — everything up to it is a "selector list" or an at-rule.
    let j = i;
    let inStr = null;
    while (j < n) {
      const ch = src[j];
      if (inStr) {
        if (ch === "\\") { j += 2; continue; }
        if (ch === inStr) inStr = null;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'") { inStr = ch; j++; continue; }
      if (ch === "/" && src[j + 1] === "*") {
        const e = src.indexOf("*/", j + 2);
        j = e === -1 ? n : e + 2;
        continue;
      }
      if (ch === "{" || ch === ";") break;
      j++;
    }

    const head = src.slice(i, j).trim();
    if (!head) { i = j; if (src[i] === ";" || src[i] === "{") { out += src[i]; i++; } continue; }

    if (src[j] === ";" || j >= n) {
      // Statement at-rule (e.g. @import, @charset) — pass through verbatim.
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    // src[j] === '{' — we have a rule with a body.
    const bodyEnd = matchBrace(j);
    const body = src.slice(j + 1, bodyEnd);

    if (head.startsWith("@")) {
      if (RAW_AT_RULES.test(head)) {
        // Leave keyframes / font-face / etc. bodies untouched.
        out += head + "{" + body + "}";
      } else if (NESTED_AT_RULES.test(head)) {
        // Recurse: scope the rules INSIDE the at-rule body.
        out += head + "{" + scopeCss(body, scope) + "}";
      } else {
        // Unknown at-rule — pass through.
        out += head + "{" + body + "}";
      }
    } else {
      // Regular selector list — prefix every comma-separated selector.
      out += prefixSelectorList(head, scope) + "{" + body + "}";
    }
    i = bodyEnd + 1;
  }
  return out;
}

function prefixSelectorList(selectorList, scope) {
  // Split on top-level commas (respect parens for :is()/:not()/:where()).
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k < selectorList.length; k++) {
    const c = selectorList[k];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(selectorList.slice(start, k));
      start = k + 1;
    }
  }
  parts.push(selectorList.slice(start));

  return parts.map((raw) => {
    const sel = raw.trim();
    if (!sel) return "";
    // :root refers to the document root — collapse it onto the popup wrapper
    // so merchant CSS variables land where descendants can consume them.
    if (sel === ":root") return scope;
    if (/^:root\b/.test(sel)) return scope + sel.slice(5);
    // If a merchant already scoped their selectors to the wrapper, don't double-prefix.
    if (sel === scope || sel.startsWith(scope + " ") || sel.startsWith(scope + ":") || sel.startsWith(scope + ".") || sel.startsWith(scope + "[")) {
      return sel;
    }
    // Pseudo-selectors on the wrapper itself: `&:hover` / `:hover` shouldn't be
    // prefixed with a space (which would demand a descendant).
    return scope + " " + sel;
  }).filter(Boolean).join(", ");
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
