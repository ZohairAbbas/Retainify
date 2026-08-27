/**
 * HTML → plain text, for the text/plain alternative part of every send.
 *
 * A multipart message with both parts is a meaningful deliverability signal;
 * HTML-only has been a spam heuristic for two decades. It also covers text-only
 * clients, watch previews and accessibility tooling.
 *
 * This is deliberately a small regex pass rather than a parser dependency: the
 * input is our own renderer's table-based output (or the merchant's pasted
 * HTML), and the cost of a wrong newline in the text part is nil compared with
 * pulling a DOM implementation into the send path.
 */

const BLOCK_CLOSE = /<\/(p|div|tr|table|h1|h2|h3|h4|h5|h6|li|ul|ol|section|header|footer)\s*>/gi;

/**
 * @param {string} html
 * @returns {string} plain-text rendering, or "" for empty input
 */
export function htmlToText(html) {
  if (!html) return "";

  let out = String(html);

  // Drop anything that is markup machinery rather than content. <style> in
  // particular would otherwise dump the entire inline stylesheet into the body.
  out = out.replace(/<!DOCTYPE[^>]*>/gi, "");
  out = out.replace(/<head\b[\s\S]*?<\/head>/gi, "");
  out = out.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // Links become "text (url)" so the text part stays actionable — a bare label
  // with no destination is useless to someone reading the fallback.
  out = out.replace(
    /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, label) => {
      const text = stripTags(label).trim();
      const url = String(href).trim();
      if (!url || url === "#") return text;
      if (!text) return url;
      // Avoid the redundant "https://x (https://x)" when the label is the URL.
      if (text === url) return url;
      return `${text} (${url})`;
    },
  );

  // Structural newlines before tags are stripped wholesale.
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(BLOCK_CLOSE, "\n");
  out = out.replace(/<\/td\s*>/gi, " ");
  out = out.replace(/<hr\s*\/?>/gi, "\n----------\n");

  out = stripTags(out);
  out = decodeEntities(out);

  // Tidy: trim each line, collapse runs of blank lines to one, drop leading and
  // trailing whitespace overall.
  out = out
    .split("\n")
    // \u00A0 is a literal non-breaking space; email HTML is full of them and
    // they must collapse like any other run of whitespace.
    .map((line) => line.replace(/[ \t\u00A0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return out;
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, "");
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&rsquo;/gi, "’")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    });
}

/**
 * Build the text part for a marketing send, guaranteeing the unsubscribe URL is
 * present even when the HTML expressed it only as a styled link.
 *
 * @param {{ html: string, unsubscribeUrl?: string }} args
 */
export function buildTextPart({ html, unsubscribeUrl }) {
  const body = htmlToText(html);
  if (!unsubscribeUrl) return body;
  if (body.includes(unsubscribeUrl)) return body;
  return `${body}\n\n----------\nUnsubscribe: ${unsubscribeUrl}`;
}
