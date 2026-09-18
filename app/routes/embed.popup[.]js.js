/**
 * The popup script for websites outside Shopify:
 *
 *   <script src="https://retainify.growzar.com/embed/popup.js" data-site="site_…" async></script>
 *
 * It is the same file the Shopify theme extension ships, so both render the
 * same templates, preceded by a few lines that read the site key from the tag
 * and point the script at the /embed endpoints instead of the app proxy.
 */
import storefrontScript from "../../extensions/cart-rescue-popup/assets/cart-rescue-popup.js?raw";

const PRELUDE = `(function () {
  if (window.__retainifyPopup) return;
  var s = document.currentScript;
  if (!s) return;
  var key = s.getAttribute("data-site") || "";
  var base;
  try { base = new URL(s.src).origin; } catch (e) { return; }
  if (!key) { console.warn("[Retainify] popup.js needs a data-site attribute — copy the tag from Retainify > Popup."); return; }
  var q = "?site=" + encodeURIComponent(key);
  window.__retainifyPopup = {
    site: key,
    endpoint: base + "/embed/popup-signup" + q,
    configEndpoint: base + "/embed/popup-config" + q
  };
})();
`;

const BODY = PRELUDE + storefrontScript;

export const loader = () =>
  new Response(BODY, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Short: a template fix should reach live sites within minutes.
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
