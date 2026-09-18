(function () {
  "use strict";

  var config = window.__retainifyPopup || {};
  var STORAGE_KEY_FOREVER = "retainify_popup_shown";        // localStorage flag
  var STORAGE_KEY_UNTIL   = "retainify_popup_shown_until";  // localStorage timestamp (day/week)
  var SESSION_KEY         = "retainify_popup_session";      // sessionStorage flag
  var ANON_KEY            = "__rt_anon";

  function getAnonId() {
    var id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  var _pendingPermission = null;
  function primePermissionRequest() {
    // Only where push can actually subscribe (a Shopify storefront, through the
    // app proxy). On any other website there is no service worker to register,
    // so asking for permission would be a prompt that leads nowhere.
    if (!config.vapidPublicKey || !config.pushSubscribeUrl) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "granted" || Notification.permission === "denied") return;
    _pendingPermission = Notification.requestPermission();
  }

  function requestPushPermission(capturedEmail) {
    var vapidKey = config.vapidPublicKey;
    var subscribeUrl = config.pushSubscribeUrl;
    if (!vapidKey || !subscribeUrl) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    var permPromise = _pendingPermission || Promise.resolve(Notification.permission);
    permPromise.then(function (permission) {
      if (permission !== "granted") return;
      navigator.serviceWorker.register("/apps/retainify/push-sw", { scope: "/apps/retainify/" })
        .then(function (reg) {
          if (reg.active) return reg;
          var worker = reg.installing || reg.waiting;
          if (!worker) return reg;
          return new Promise(function (resolve) {
            worker.addEventListener("statechange", function () {
              if (worker.state === "activated") resolve(reg);
            });
          });
        })
        .then(function (reg) {
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          });
        })
        .then(function (sub) {
          var raw = sub.toJSON();
          return fetch(subscribeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // No `shop`: the server takes it from the proxy signature and
            // ignores any body field of that name.
            body: JSON.stringify({
              endpoint: raw.endpoint,
              p256dh: raw.keys.p256dh,
              auth: raw.keys.auth,
              anonId: getAnonId(),
              contactEmail: capturedEmail || null,
            }),
          });
        })
        .catch(function (err) {
          try {
            var msg = (err && (err.name + ": " + err.message)) || "unknown";
            new Image().src = "/apps/retainify/push-sw?err=" + encodeURIComponent(msg);
          } catch (_) {}
        });
    });
  }

  // ── Frequency / suppression ─────────────────────────────────────────────
  function isSuppressed() {
    if (localStorage.getItem(STORAGE_KEY_FOREVER)) return true;
    var until = parseInt(localStorage.getItem(STORAGE_KEY_UNTIL) || "0", 10);
    if (until && until > Date.now()) return true;
    if (sessionStorage.getItem(SESSION_KEY)) return true;
    return false;
  }

  function markShown(frequency) {
    if (frequency === "forever") {
      localStorage.setItem(STORAGE_KEY_FOREVER, "1");
    } else if (frequency === "day") {
      localStorage.setItem(STORAGE_KEY_UNTIL, String(Date.now() + 24 * 3600 * 1000));
    } else if (frequency === "week") {
      localStorage.setItem(STORAGE_KEY_UNTIL, String(Date.now() + 7 * 24 * 3600 * 1000));
    }
    sessionStorage.setItem(SESSION_KEY, "1");
  }

  // ?rt_popup=preview on any page shows the popup straight away, ignoring the
  // "already shown" memory — for checking an install without a private window.
  var FORCE_PREVIEW = /[?&]rt_popup=preview\b/.test(location.search);

  if (!FORCE_PREVIEW && isSuppressed()) return;

  // ── Webfont loader ──────────────────────────────────────────────────────
  // Each template uses different families; load only what's needed so we don't
  // bloat every storefront pageview with fonts the active popup won't use.
  // Family list matches what the per-template CSS in renderXxx() references.
  var FONT_FAMILIES_BY_TEMPLATE = {
    editorial: ["Instrument Serif", "Geist:wght@400;500;700"],
    brutalist: ["Archivo Black", "Space Grotesk:wght@400;700"],
    wheel:     ["DM Serif Display:ital@0;1", "Geist:wght@400;500;700"],
    sticker:   ["Caveat:wght@400;700", "Geist:wght@400;500;700", "Geist Mono"],
    holiday:   ["DM Serif Display:ital@0;1", "Instrument Serif", "Geist:wght@400;500;700"],
    // custom: merchant supplies their own fonts inline; we don't preload anything.
  };

  var _fontsLoaded = false;
  function loadTemplateFonts(templateId) {
    if (_fontsLoaded) return;
    var families = FONT_FAMILIES_BY_TEMPLATE[templateId] ||
      (KIT.templates[templateId] && KIT.templates[templateId].fonts);
    if (!families) return; // e.g. custom template — nothing to load
    _fontsLoaded = true;
    var preconnect1 = document.createElement("link");
    preconnect1.rel = "preconnect";
    preconnect1.href = "https://fonts.googleapis.com";
    var preconnect2 = document.createElement("link");
    preconnect2.rel = "preconnect";
    preconnect2.href = "https://fonts.gstatic.com";
    preconnect2.crossOrigin = "";
    var fontLink = document.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?" +
      families.map(function (f) { return "family=" + f.replace(/ /g, "+"); }).join("&") +
      "&display=swap";
    document.head.appendChild(preconnect1);
    document.head.appendChild(preconnect2);
    document.head.appendChild(fontLink);
  }

  // ── Config fetch ────────────────────────────────────────────────────────
  var triggered = false;
  var _configReady = false;
  var _templateId = "editorial";
  var _tplData = {};
  var _frequency = "session";
  // Whether signing up earns a code. False for a newsletter popup, or a site
  // outside Shopify that hasn't set one — the success message must not
  // promise a discount that will never arrive.
  var _hasOffer = true;

  (function fetchRemoteConfig() {
    var endpoint = config.configEndpoint;
    // Without an endpoint there is no popup to show — never fall back to a
    // default one on a page that hasn't been set up.
    if (!endpoint) { triggered = true; _configReady = true; return; }
    // No ?shop= — the app proxy appends its own signed shop, signature and
    // timestamp, and the signature covers the whole query string. Adding a
    // parameter of our own would invalidate it and the server would 401.
    fetch(endpoint)
      .then(function (r) { return r.json(); })
      .then(function (remote) {
        if (remote.enabled === false) {
          triggered = true; // suppress entirely
        } else {
          _templateId = remote.template || "editorial";
          _tplData = remote.config || {};
          _frequency = _tplData.frequency || "session";
          _hasOffer = remote.hasOffer !== false;
          // Carry the WhatsApp opt-in decision onto `config`, which is where
          // whatsappFieldsHtml reads it. Without this line it stays undefined
          // forever — `config` is only ever the object the Liquid block injects
          // (shop, endpoints, VAPID key), and nothing else from the response was
          // merged back into it. That is why the phone and consent fields never
          // appeared on any storefront, on any template.
          //
          // Deliberately the TOP-LEVEL remote.whatsappOptIn, not
          // _tplData.whatsappOptIn. They are different values: the top-level one
          // is already ANDed with the shop's whatsappEnabled by /popup-config,
          // while the one inside `config` is the popup's own preference alone.
          // Reading the inner one would collect consent for a channel that is
          // switched off and cannot send.
          config.whatsappOptIn = remote.whatsappOptIn === true;
          loadTemplateFonts(_templateId);
        }
        _configReady = true;
      })
      .catch(function () { _configReady = true; });
  })();

  // ── Helpers ─────────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // Sanitize admin-controlled HTML: allow <em>, <br>, and <span class="accent"> only.
  function sanitizeRichHtml(s) {
    if (s == null) return "";
    var raw = String(s);
    var out = "";
    var i = 0;
    while (i < raw.length) {
      if (raw.charAt(i) === "<") {
        var end = raw.indexOf(">", i);
        if (end === -1) { out += escapeHtml(raw.slice(i)); break; }
        var tag = raw.slice(i, end + 1);
        if (/^<\/?em\s*>$/i.test(tag) || /^<br\s*\/?\s*>$/i.test(tag)
            || /^<\/?span(\s+class="accent")?\s*>$/i.test(tag)) {
          out += tag.toLowerCase().replace(/^<span\s+class="accent"\s*>$/, '<span class="accent">');
        } else {
          out += escapeHtml(tag);
        }
        i = end + 1;
      } else {
        var nextLt = raw.indexOf("<", i);
        var chunk = nextLt === -1 ? raw.slice(i) : raw.slice(i, nextLt);
        out += chunk.replace(/&/g, "&amp;");
        i = nextLt === -1 ? raw.length : nextLt;
      }
    }
    return out;
  }

  // Sanitize merchant-authored popup HTML. Kept in sync with the server-side
  // sanitizer at app/lib/popup-templates/html-sanitize.js. We can't reuse the
  // module because this file is a standalone IIFE served by the theme extension.
  var RT_BLOCKED_TAGS_RE = /<(script|iframe|object|embed|link|meta|base|frame|frameset)\b[^>]*>[\s\S]*?<\/\1\s*>|<(script|iframe|object|embed|link|meta|base|frame|frameset)\b[^>]*\/?>/gi;
  var RT_FORM_ATTR_STRIP_RE = /(<form\b[^>]*?)\s(action|method|enctype|target|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
  var RT_EVENT_HANDLER_RE = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
  var RT_JS_URL_RE = /\s(href|src|action|formaction|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi;
  var RT_DATA_HREF_RE = /\s(href)\s*=\s*(?:"\s*data:[^"]*"|'\s*data:[^']*')/gi;
  var RT_STYLE_BLOCK_RE = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi;

  var RT_RAW_AT_RULES = /^@(keyframes|-webkit-keyframes|-moz-keyframes|-o-keyframes|font-face|font-feature-values|counter-style|property|page|viewport)\b/i;
  var RT_NESTED_AT_RULES = /^@(media|supports|container|layer|scope|document)\b/i;

  function rtPrefixSelectorList(selectorList, scope) {
    var parts = [];
    var depth = 0, start = 0;
    for (var k = 0; k < selectorList.length; k++) {
      var c = selectorList.charAt(k);
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) { parts.push(selectorList.slice(start, k)); start = k + 1; }
    }
    parts.push(selectorList.slice(start));
    var mapped = [];
    for (var p = 0; p < parts.length; p++) {
      var sel = parts[p].trim();
      if (!sel) continue;
      if (sel === ":root") { mapped.push(scope); continue; }
      if (/^:root\b/.test(sel)) { mapped.push(scope + sel.slice(5)); continue; }
      if (sel === scope || sel.indexOf(scope + " ") === 0 || sel.indexOf(scope + ":") === 0 || sel.indexOf(scope + ".") === 0 || sel.indexOf(scope + "[") === 0) {
        mapped.push(sel); continue;
      }
      mapped.push(scope + " " + sel);
    }
    return mapped.join(", ");
  }

  function rtScopeCss(css, scope) {
    var src = String(css || "");
    var i = 0, n = src.length, out = "";
    function matchBrace(startPos) {
      var depth = 0;
      for (var k = startPos; k < n; k++) {
        var ch = src.charAt(k);
        if (ch === "/" && src.charAt(k + 1) === "*") {
          var e1 = src.indexOf("*/", k + 2);
          k = e1 === -1 ? n : e1 + 1;
          continue;
        }
        if (ch === '"' || ch === "'") {
          var q = ch; k++;
          while (k < n && src.charAt(k) !== q) { if (src.charAt(k) === "\\") k++; k++; }
          continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) return k; }
      }
      return n;
    }
    while (i < n) {
      if (src.charAt(i) === "/" && src.charAt(i + 1) === "*") {
        var e = src.indexOf("*/", i + 2);
        if (e === -1) { out += src.slice(i); i = n; continue; }
        out += src.slice(i, e + 2); i = e + 2; continue;
      }
      var c = src.charAt(i);
      if (c === " " || c === "\n" || c === "\t" || c === "\r") { out += c; i++; continue; }
      var j = i, inStr = null;
      while (j < n) {
        var ch = src.charAt(j);
        if (inStr) {
          if (ch === "\\") { j += 2; continue; }
          if (ch === inStr) inStr = null;
          j++; continue;
        }
        if (ch === '"' || ch === "'") { inStr = ch; j++; continue; }
        if (ch === "/" && src.charAt(j + 1) === "*") {
          var e2 = src.indexOf("*/", j + 2);
          j = e2 === -1 ? n : e2 + 2;
          continue;
        }
        if (ch === "{" || ch === ";") break;
        j++;
      }
      var head = src.slice(i, j).replace(/^\s+|\s+$/g, "");
      if (!head) {
        i = j;
        if (src.charAt(i) === ";" || src.charAt(i) === "{") { out += src.charAt(i); i++; }
        continue;
      }
      if (src.charAt(j) === ";" || j >= n) { out += src.slice(i, j + 1); i = j + 1; continue; }
      var bodyEnd = matchBrace(j);
      var body = src.slice(j + 1, bodyEnd);
      if (head.charAt(0) === "@") {
        if (RT_RAW_AT_RULES.test(head)) out += head + "{" + body + "}";
        else if (RT_NESTED_AT_RULES.test(head)) out += head + "{" + rtScopeCss(body, scope) + "}";
        else out += head + "{" + body + "}";
      } else {
        out += rtPrefixSelectorList(head, scope) + "{" + body + "}";
      }
      i = bodyEnd + 1;
    }
    return out;
  }

  function sanitizeMerchantHtml(s, scope) {
    if (s == null) return "";
    var out = String(s);
    out = out.replace(RT_BLOCKED_TAGS_RE, "");
    var prev;
    do { prev = out; out = out.replace(RT_FORM_ATTR_STRIP_RE, "$1"); } while (out !== prev);
    out = out.replace(RT_EVENT_HANDLER_RE, "");
    out = out.replace(RT_JS_URL_RE, "");
    out = out.replace(RT_DATA_HREF_RE, "");
    if (scope) {
      out = out.replace(RT_STYLE_BLOCK_RE, function (_m, attrs, css) {
        return "<style" + attrs + ">" + rtScopeCss(css, scope) + "</style>";
      });
    }
    return out;
  }

  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    var style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Bare mount for custom HTML — no overlay, no modal chrome. Merchant supplies
  // their own backdrop and positioning. We just inject the HTML into <body> and
  // wire dismissal. Returns the same shape as mountOverlay() so wireSubmit()
  // works unchanged.
  function mountBare(innerHTML) {
    var host = document.createElement("div");
    host.id = "rt-custom-host";
    host.innerHTML = innerHTML;
    document.body.appendChild(host);

    function close() {
      host.remove();
      markShown(_frequency);
    }

    host.querySelectorAll("[data-rt-close]").forEach(function (btn) {
      btn.addEventListener("click", close);
    });

    // Merchant's "modal" is the host itself — pass it as the second arg so
    // wireSubmit() can find [data-rt-email] / [data-rt-submit] / [data-rt-status].
    return { overlay: host, modal: host, close: close };
  }

  // Shared overlay + close handling
  function mountOverlay(innerHTML) {
    var overlay = document.createElement("div");
    overlay.id = "rt-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(20,32,26,0.42);z-index:999998;" +
      "display:flex;align-items:center;justify-content:center;padding:24px;" +
      "opacity:0;transition:opacity .25s;backdrop-filter:blur(2px);";

    var modal = document.createElement("div");
    modal.id = "rt-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.style.cssText = "position:relative;transform:scale(.94);transition:transform .25s;";
    modal.innerHTML = innerHTML;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    modal.querySelectorAll("[data-rt-close]").forEach(function (btn) {
      btn.addEventListener("click", close);
    });

    requestAnimationFrame(function () {
      overlay.style.opacity = "1";
      modal.style.transform = "scale(1)";
    });

    function close() {
      overlay.style.opacity = "0";
      modal.style.transform = "scale(.94)";
      setTimeout(function () { overlay.remove(); }, 300);
      markShown(_frequency);
    }

    return { overlay: overlay, modal: modal, close: close };
  }

  /**
   * Optional WhatsApp opt-in fields.
   *
   * Rendered only when the merchant has switched the channel on for their
   * popup (config.whatsappOptIn). The consent checkbox is the record Meta
   * requires before a business may message someone, so its wording states
   * plainly what the shopper is agreeing to — a pre-ticked box or vague copy
   * would not be consent at all.
   *
   * Returns "" when disabled, so every template can interpolate it
   * unconditionally.
   */
  function whatsappFieldsHtml(d) {
    if (!config.whatsappOptIn) return "";
    var label =
      (d && d.whatsappLabel) ||
      "Also send me WhatsApp updates about my order and offers";
    return (
      '<div class="rt-wa-optin">' +
        '<input class="rt-wa-phone" type="tel" data-rt-phone autocomplete="tel" ' +
          'placeholder="' + escapeHtml((d && d.phonePlaceholder) || "WhatsApp number (with country code)") + '">' +
        '<div class="rt-wa-error" data-rt-phone-error></div>' +
        '<label class="rt-wa-consent">' +
          '<input type="checkbox" data-rt-wa-consent>' +
          "<span>" + escapeHtml(label) + "</span>" +
        "</label>" +
      "</div>"
    );
  }

  /**
   * Why a typed number can't be messaged on WhatsApp, or "" if it can.
   *
   * Mirrors toE164 on the server. Meta treats a national-format number as a
   * permanent failure, which suppresses the subscriber for good — so the
   * shopper is told now, while they are still here to fix it, rather than
   * being signed up for messages that will never arrive.
   */
  function whatsappPhoneError(raw) {
    var digits = (raw || "").replace(/[^0-9]/g, "");
    if (!digits) return "Enter your WhatsApp number.";
    // "00" is the international dialling prefix — already correct, just
    // written the long way. Kept in step with toE164 on the server.
    if (digits.indexOf("00") === 0) digits = digits.slice(2);
    if (digits.charAt(0) === "0") {
      return "Start with your country code instead of 0 — e.g. 447700900123.";
    }
    if (digits.length < 8 || digits.length > 15) {
      return "Include your country code, with no leading 0.";
    }
    return "";
  }

  /** Styles for the opt-in block, neutral enough to sit in any template. */
  var WA_OPTIN_CSS =
    ".rt-wa-optin{margin:0 0 12px;display:flex;flex-direction:column;gap:8px}" +
    ".rt-wa-phone{width:100%;height:38px;padding:0 12px;border:1px solid rgba(0,0,0,.25);border-radius:4px;font-family:inherit;font-size:13px;color:inherit;background:transparent;outline:none}" +
    ".rt-wa-consent{display:flex;gap:8px;align-items:flex-start;font-size:11px;line-height:1.45;cursor:pointer;opacity:.85}" +
    ".rt-wa-consent input{margin-top:2px;flex-shrink:0}" +
    ".rt-wa-error{display:none;font-size:11px;line-height:1.4;color:#c0261a}";

  // Wire up the email-submit form inside any template. Each template's renderer
  // must expose an input with [data-rt-email], a submit button [data-rt-submit],
  // and a status node [data-rt-status].
  function wireSubmit(modal, close) {
    var input = modal.querySelector("[data-rt-email]");
    var btn = modal.querySelector("[data-rt-submit]");
    var status = modal.querySelector("[data-rt-status]");
    // Optional WhatsApp opt-in fields, rendered only when the merchant has
    // enabled the channel. Both are required together: a phone number is not
    // consent, and a ticked box with no number is nothing to send to.
    var phoneInput = modal.querySelector("[data-rt-phone]");
    var waConsentInput = modal.querySelector("[data-rt-wa-consent]");
    var phoneError = modal.querySelector("[data-rt-phone-error]");
    if (!input || !btn) return;

    function showPhoneError(message) {
      if (phoneError) {
        phoneError.textContent = message;
        phoneError.style.display = message ? "block" : "none";
      }
      if (phoneInput) phoneInput.style.outline = message ? "2px solid #e00" : "";
    }

    function submit() {
      var email = (input.value || "").trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        input.style.outline = "2px solid #e00";
        input.focus();
        return;
      }

      var phone = phoneInput ? (phoneInput.value || "").trim() : "";
      var waConsent = !!(waConsentInput && waConsentInput.checked);
      if (waConsent) {
        var waError = whatsappPhoneError(phone);
        if (waError) {
          showPhoneError(waError);
          phoneInput.focus();
          return;
        }
        showPhoneError("");
      }
      var originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Saving…";
      primePermissionRequest();

      var endpoint = config.endpoint || "/apps/retainify/popup-signup";
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No `shop`: supplied by the proxy signature, not by the page.
        body: JSON.stringify({
          email: email,
          anonId: getAnonId(),
          phone: phone,
          whatsappConsent: waConsent,
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          // The server holds a consented number to WhatsApp's own standard,
          // which is stricter than the client check. If it refused the opt-in,
          // say so instead of closing on "you're subscribed" — the email
          // signup itself still went through.
          if (res && res.whatsappError) {
            showPhoneError(res.whatsappError);
            btn.disabled = false;
            btn.textContent = originalLabel;
            if (phoneInput) phoneInput.focus();
            return;
          }
          localStorage.setItem(STORAGE_KEY_FOREVER, "1");
          requestPushPermission(email);
          var spinMs = (_templateId === "wheel") ? spinWheel(modal) : 0;
          setTimeout(function () {
            if (status) {
              status.innerHTML = _hasOffer
                ? "<strong>Almost there!</strong><br/>Check your inbox to confirm your email and get your discount."
                : "<strong>Almost there!</strong><br/>Check your inbox to confirm your subscription.";
              status.style.display = "block";
            }
            setTimeout(close, 3000);
          }, spinMs);
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = originalLabel;
        });
    }

    btn.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TEMPLATE RENDERERS
  // ═══════════════════════════════════════════════════════════════════════

  function renderEditorial(d) {
    var EDITORIAL_IMAGES = {
      amber:  "linear-gradient(135deg, #8B7355 0%, #5A4632 100%)",
      rose:   "linear-gradient(135deg, #C09080 0%, #7A4F45 100%)",
      forest: "linear-gradient(135deg, #6B7A6F 0%, #3A4A40 100%)",
      ink:    "linear-gradient(135deg, #4A4632 0%, #1F1A12 100%)",
    };
    var EDITORIAL_ACCENTS = { burgundy: "#8C3A2A", forest: "#2E5240", cobalt: "#2A4A8C", rust: "#A85A2E" };
    var img = (d.image === "custom" && d.imageCustom && d.imageCustom.from && d.imageCustom.to)
      ? "linear-gradient(135deg, " + d.imageCustom.from + " 0%, " + d.imageCustom.to + " 100%)"
      : (EDITORIAL_IMAGES[d.image] || EDITORIAL_IMAGES.amber);
    var accent = (d.accent === "custom" && d.accentCustom)
      ? d.accentCustom
      : (EDITORIAL_ACCENTS[d.accent] || EDITORIAL_ACCENTS.burgundy);

    injectCss("rt-tpl-editorial-css",
      ".rt-tpl-editorial{width:580px;max-width:calc(100vw - 32px);background:#F4EDDE;color:#1F2A1E;font-family:'Geist',sans-serif;display:grid;grid-template-columns:220px 1fr;border:1px solid rgba(31,42,30,.12);box-shadow:0 20px 60px rgba(20,32,26,.25);position:relative}" +
      ".rt-tpl-editorial-img{background-image:var(--ed-img);background-size:cover;background-position:center;position:relative}" +
      ".rt-tpl-editorial-img::after{content:'';position:absolute;inset:12px;border:1px solid rgba(244,237,222,.5)}" +
      ".rt-tpl-editorial-mast{position:absolute;top:18px;left:18px;color:#F4EDDE;font-family:'Instrument Serif',serif;font-size:14px;letter-spacing:.1em}" +
      ".rt-tpl-editorial-body{padding:38px 36px 32px;position:relative}" +
      ".rt-tpl-editorial-rule{font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:var(--ed-accent);margin-bottom:18px;font-weight:500}" +
      ".rt-tpl-editorial-h{font-family:'Instrument Serif','DM Serif Display',serif;font-size:44px;line-height:.98;margin:0 0 12px;letter-spacing:-.01em;color:#1F2A1E}" +
      ".rt-tpl-editorial-h em{font-style:italic;color:var(--ed-accent)}" +
      ".rt-tpl-editorial-p{font-size:13px;line-height:1.6;color:#4A4232;margin:0 0 22px;max-width:280px}" +
      ".rt-tpl-editorial-input{width:100%;height:40px;padding:0 14px;background:transparent;border:none;border-bottom:1px solid #1F2A1E;font-family:inherit;font-size:13px;color:#1F2A1E;outline:none;margin-bottom:14px}" +
      ".rt-tpl-editorial-input::placeholder{color:rgba(31,42,30,.4);font-style:italic}" +
      ".rt-tpl-editorial-btn{background:#1F2A1E;color:#F4EDDE;padding:11px 16px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;border:none;cursor:pointer;font-family:inherit;font-weight:500;display:inline-flex;align-items:center;gap:8px}" +
      ".rt-tpl-editorial-fine{font-size:9px;color:#6B5C42;letter-spacing:.06em;margin-top:14px;line-height:1.5}" +
      ".rt-tpl-editorial-close{position:absolute;top:14px;right:14px;background:none;border:none;color:#1F2A1E;cursor:pointer;padding:4px;opacity:.7}" +
      ".rt-tpl-editorial [data-rt-status]{display:none;background:#1F2A1E;color:#F4EDDE;padding:12px;font-size:12px;margin-top:12px;text-align:center}" + WA_OPTIN_CSS
    );

    return '<div class="rt-tpl-editorial" style="--ed-img:' + img + ';--ed-accent:' + accent + '">' +
      '<div class="rt-tpl-editorial-img"><div class="rt-tpl-editorial-mast">' + escapeHtml(d.masthead || "YOUR BRAND") + '</div></div>' +
      '<div class="rt-tpl-editorial-body">' +
        '<button class="rt-tpl-editorial-close" data-rt-close aria-label="Close">' +
          '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>' +
        '</button>' +
        '<div class="rt-tpl-editorial-rule">An invitation · ' + escapeHtml(d.discount || 10) + '% off</div>' +
        '<h2 class="rt-tpl-editorial-h">' + sanitizeRichHtml(d.headline) + '</h2>' +
        '<p class="rt-tpl-editorial-p">' + escapeHtml(d.body) + '</p>' +
        '<input class="rt-tpl-editorial-input" type="email" data-rt-email placeholder="' + escapeHtml(d.placeholder || "your address") + '" autocomplete="email">' +
        whatsappFieldsHtml(d) +
        '<button class="rt-tpl-editorial-btn" data-rt-submit type="button">' + escapeHtml(d.cta || "Send my code") + ' →</button>' +
        '<div class="rt-tpl-editorial-fine">' + escapeHtml(d.fine) + '</div>' +
        '<div data-rt-status></div>' +
      '</div></div>';
  }

  function renderBrutal(d) {
    var BRUTAL_PALETTES = {
      acid:     { bg: "#0E0E0E", ink: "#E5FF36", shadow: "#E5FF36" },
      inferno:  { bg: "#FF3D2E", ink: "#FFF1E0", shadow: "#0E0E0E" },
      electric: { bg: "#1B2BFF", ink: "#FFF",    shadow: "#FFEE00" },
      mint:     { bg: "#F0F0E8", ink: "#0E0E0E", shadow: "#3DBF7C" },
    };
    var p;
    if (d.palette === "custom" && d.paletteCustom) {
      p = {
        bg: d.paletteCustom.bg || "#0E0E0E",
        ink: d.paletteCustom.ink || "#E5FF36",
        shadow: d.paletteCustom.shadow || d.paletteCustom.ink || "#E5FF36",
      };
    } else {
      p = BRUTAL_PALETTES[d.palette] || BRUTAL_PALETTES.acid;
    }
    var marquee = escapeHtml(d.marqueeText || "FREE SHIPPING · NEW DROPS WEEKLY · MEMBERS ONLY · ");
    var marqueeRow = marquee + marquee + marquee + marquee;

    injectCss("rt-tpl-brutal-css",
      ".rt-tpl-brutal{width:520px;max-width:calc(100vw - 32px);background:var(--br-bg);color:var(--br-ink);font-family:'Space Grotesk','Geist',sans-serif;position:relative;border:4px solid var(--br-bg);box-shadow:12px 12px 0 var(--br-shadow),0 0 0 1px rgba(0,0,0,.4)}" +
      ".rt-tpl-brutal-marquee{background:var(--br-ink);color:var(--br-bg);padding:6px 0;overflow:hidden;white-space:nowrap;font-family:'Archivo Black',sans-serif;font-size:12px;letter-spacing:.16em}" +
      ".rt-tpl-brutal-marquee-inner{display:inline-flex;gap:24px;animation:rt-brutalmarquee 22s linear infinite}" +
      "@keyframes rt-brutalmarquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}" +
      ".rt-tpl-brutal-body{padding:28px 32px 30px}" +
      ".rt-tpl-brutal-eyebrow{display:inline-block;background:var(--br-ink);color:var(--br-bg);font-family:'Archivo Black',sans-serif;font-size:11px;letter-spacing:.18em;padding:4px 10px;margin-bottom:18px}" +
      ".rt-tpl-brutal-h{font-family:'Archivo Black',sans-serif;font-size:72px;line-height:.86;letter-spacing:-.04em;margin:0 0 4px;text-transform:uppercase;color:var(--br-ink)}" +
      ".rt-tpl-brutal-h .pct{display:inline-block;transform:translateY(6px) rotate(-4deg)}" +
      ".rt-tpl-brutal-sub{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px;line-height:1.3;margin:14px 0 22px;text-transform:uppercase;letter-spacing:.04em;max-width:380px}" +
      ".rt-tpl-brutal-form{display:flex;gap:0}" +
      ".rt-tpl-brutal-input{flex:1;padding:14px 16px;background:transparent;border:2px solid var(--br-ink);color:var(--br-ink);font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:700;outline:none;text-transform:uppercase;letter-spacing:.04em}" +
      ".rt-tpl-brutal-input::placeholder{color:color-mix(in srgb,var(--br-ink) 40%,transparent)}" +
      ".rt-tpl-brutal-btn{background:var(--br-ink);color:var(--br-bg);border:2px solid var(--br-ink);font-family:'Archivo Black',sans-serif;font-size:13px;letter-spacing:.1em;padding:0 22px;cursor:pointer;text-transform:uppercase}" +
      ".rt-tpl-brutal-fine{font-size:10px;margin-top:12px;letter-spacing:.06em;opacity:.6;font-weight:500}" +
      ".rt-tpl-brutal-close{position:absolute;top:14px;right:14px;background:var(--br-bg);border:2px solid var(--br-ink);color:var(--br-ink);width:30px;height:30px;cursor:pointer;font-family:'Archivo Black',sans-serif;font-size:14px;display:flex;align-items:center;justify-content:center}" +
      ".rt-tpl-brutal [data-rt-status]{display:none;color:var(--br-ink);font-size:13px;margin-top:12px;text-align:center;font-weight:700}" + WA_OPTIN_CSS
    );

    return '<div class="rt-tpl-brutal" style="--br-bg:' + p.bg + ';--br-ink:' + p.ink + ';--br-shadow:' + p.shadow + '">' +
      '<button class="rt-tpl-brutal-close" data-rt-close aria-label="Close">×</button>' +
      '<div class="rt-tpl-brutal-marquee"><div class="rt-tpl-brutal-marquee-inner"><span>' + marqueeRow + '</span><span>' + marqueeRow + '</span></div></div>' +
      '<div class="rt-tpl-brutal-body">' +
        '<span class="rt-tpl-brutal-eyebrow">' + escapeHtml(d.eyebrow || "STOP RIGHT THERE") + '</span>' +
        '<h2 class="rt-tpl-brutal-h">' + escapeHtml(d.headline || "TAKE ") + '<span class="pct">' + escapeHtml(d.discount || 15) + '</span></h2>' +
        '<div class="rt-tpl-brutal-sub">' + escapeHtml(d.sub) + '</div>' +
        '<div class="rt-tpl-brutal-form">' +
          '<input class="rt-tpl-brutal-input" type="email" data-rt-email placeholder="' + escapeHtml(d.placeholder || "EMAIL@HERE.COM") + '" autocomplete="email">' +
          whatsappFieldsHtml(d) +
          '<button class="rt-tpl-brutal-btn" data-rt-submit type="button">' + escapeHtml(d.cta || "GET IT") + '</button>' +
        '</div>' +
        '<div class="rt-tpl-brutal-fine">' + escapeHtml(d.fine) + '</div>' +
        '<div data-rt-status></div>' +
      '</div>' +
    '</div>';
  }

  function renderWheel(d) {
    var DEFAULT_SLICES = [
      { color: "#FF7A6B", label: "5% OFF" },
      { color: "#FFD58A", label: "10% OFF" },
      { color: "#9B7BC8", label: "25% OFF" },
      { color: "#FFB347", label: "TRY AGAIN" },
      { color: "#7CC8B6", label: "15% OFF" },
      { color: "#E8568D", label: "FREE GIFT" },
    ];
    var slices = (d.slices && d.slices.length) ? d.slices : DEFAULT_SLICES;
    var r = 100, cx = 100, cy = 100, total = slices.length, angle = 360 / total;
    var wedges = "";
    for (var i = 0; i < total; i++) {
      var s = slices[i];
      var a0 = (i * angle - 90) * Math.PI / 180;
      var a1 = ((i + 1) * angle - 90) * Math.PI / 180;
      var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      var large = angle > 180 ? 1 : 0;
      var pathD = "M" + cx + " " + cy + " L" + x0 + " " + y0 + " A" + r + " " + r + " 0 " + large + " 1 " + x1 + " " + y1 + " Z";
      var ma = (i * angle + angle / 2 - 90) * Math.PI / 180;
      var mx = cx + (r * 0.62) * Math.cos(ma);
      var my = cy + (r * 0.62) * Math.sin(ma);
      var rot = i * angle + angle / 2;
      wedges +=
        '<g>' +
          '<path d="' + pathD + '" fill="' + escapeHtml(s.color) + '" stroke="#3A1A4B" stroke-width="1.5"/>' +
          '<text x="' + mx + '" y="' + my + '" fill="#2A1B4E" font-family="Geist,sans-serif" font-weight="700" font-size="9" text-anchor="middle" dominant-baseline="middle" transform="rotate(' + rot + ' ' + mx + ' ' + my + ')">' + escapeHtml(s.label) + '</text>' +
        '</g>';
    }

    injectCss("rt-tpl-wheel-css",
      ".rt-tpl-wheel{width:640px;max-width:calc(100vw - 32px);background:radial-gradient(circle at 20% 0%,rgba(255,255,255,.18),transparent 50%),radial-gradient(circle at 80% 100%,rgba(255,210,80,.18),transparent 50%),linear-gradient(155deg,#2A1B4E 0%,#4E2570 50%,#6E2D7B 100%);color:#FFF1D2;font-family:'Geist',sans-serif;display:grid;grid-template-columns:280px 1fr;border-radius:18px;overflow:hidden;position:relative;box-shadow:0 30px 70px rgba(40,20,70,.4),inset 0 0 0 1px rgba(255,255,255,.06)}" +
      ".rt-tpl-wheel-left{padding:32px 0 32px 32px;position:relative;display:flex;align-items:center;justify-content:center}" +
      ".rt-tpl-wheel-disc{position:relative;width:240px;height:240px;border-radius:50%;box-shadow:0 0 0 8px rgba(255,255,255,.12),0 0 0 12px rgba(0,0,0,.2);overflow:hidden;transform:translateX(-30px);transition:transform 3.6s cubic-bezier(.17,.67,.21,1)}" +
      ".rt-tpl-wheel-svg{position:absolute;inset:0;width:100%;height:100%}" +
      ".rt-tpl-wheel-hub{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:34px;height:34px;border-radius:50%;background:radial-gradient(circle,#fff 0%,#FFD58A 100%);box-shadow:0 0 0 4px rgba(0,0,0,.4),0 2px 6px rgba(0,0,0,.3);z-index:2}" +
      ".rt-tpl-wheel-pointer{position:absolute;top:50%;right:-10px;transform:translateY(-50%);width:28px;height:28px;background:#FFD58A;clip-path:polygon(0 50%,100% 0,100% 100%);z-index:3}" +
      ".rt-tpl-wheel-right{padding:38px 36px 38px 20px}" +
      ".rt-tpl-wheel-eyebrow{font-family:'DM Serif Display',serif;font-style:italic;font-size:14px;letter-spacing:.06em;color:#FFD58A;margin-bottom:10px}" +
      ".rt-tpl-wheel-h{font-family:'DM Serif Display',serif;font-size:40px;line-height:1;margin:0 0 12px;color:#FFF1D2}" +
      ".rt-tpl-wheel-p{font-size:13px;line-height:1.5;opacity:.85;margin:0 0 18px;max-width:280px}" +
      ".rt-tpl-wheel-input{width:100%;height:42px;padding:0 14px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:8px;color:#FFF1D2;font-family:inherit;font-size:13px;outline:none;margin-bottom:12px;box-sizing:border-box}" +
      ".rt-tpl-wheel-btn{width:100%;background:linear-gradient(180deg,#FFE6A1 0%,#FFB347 100%);color:#3A1A4B;font-family:'DM Serif Display',serif;font-size:18px;border:none;height:46px;border-radius:999px;cursor:pointer;box-shadow:0 4px 0 #C58D2C,0 8px 24px rgba(0,0,0,.3);font-style:italic}" +
      ".rt-tpl-wheel-fine{font-size:10px;opacity:.5;margin-top:14px;letter-spacing:.04em}" +
      ".rt-tpl-wheel-close{position:absolute;top:12px;right:14px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);color:#FFF1D2;width:26px;height:26px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center}" +
      ".rt-tpl-wheel [data-rt-status]{display:none;color:#FFF1D2;font-size:13px;margin-top:12px;text-align:center}" + WA_OPTIN_CSS
    );

    var sliceLabels = slices.map(function (s) { return String(s.label || ""); });

    return '<div class="rt-tpl-wheel" data-rt-wheel data-rt-slice-count="' + total + '" data-rt-slice-labels="' + escapeHtml(JSON.stringify(sliceLabels)) + '" data-rt-discount="' + escapeHtml(d.discount || "") + '">' +
      '<button class="rt-tpl-wheel-close" data-rt-close aria-label="Close">' +
        '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>' +
      '</button>' +
      '<div class="rt-tpl-wheel-left">' +
        '<div class="rt-tpl-wheel-disc" data-rt-disc>' +
          '<svg class="rt-tpl-wheel-svg" viewBox="0 0 200 200">' + wedges + '<circle cx="100" cy="100" r="99" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="1"/></svg>' +
          '<div class="rt-tpl-wheel-hub"></div>' +
        '</div>' +
        '<div class="rt-tpl-wheel-pointer"></div>' +
      '</div>' +
      '<div class="rt-tpl-wheel-right">' +
        '<div class="rt-tpl-wheel-eyebrow">— ' + escapeHtml(d.eyebrow || "one spin only") + ' —</div>' +
        '<h2 class="rt-tpl-wheel-h">' + escapeHtml(d.headline || "Take a chance.") + '</h2>' +
        '<p class="rt-tpl-wheel-p">' + escapeHtml(d.body) + '</p>' +
        '<input class="rt-tpl-wheel-input" type="email" data-rt-email placeholder="' + escapeHtml(d.placeholder || "Your email address") + '" autocomplete="email">' +
        whatsappFieldsHtml(d) +
        '<button class="rt-tpl-wheel-btn" data-rt-submit type="button">' + escapeHtml(d.cta || "Spin the wheel") + '</button>' +
        '<div class="rt-tpl-wheel-fine">' + escapeHtml(d.fine) + '</div>' +
        '<div data-rt-status></div>' +
      '</div>' +
    '</div>';
  }

  function renderSticker(d) {
    injectCss("rt-tpl-sticker-css",
      ".rt-tpl-sticker{width:460px;max-width:calc(100vw - 32px);background:#FFF6E5;color:#2A1F12;font-family:'Geist',sans-serif;padding:36px 36px 32px;border-radius:28px;position:relative;box-shadow:0 20px 50px rgba(40,30,15,.2);border:2px solid #2A1F12}" +
      ".rt-tpl-sticker::before{content:'';position:absolute;inset:-2px;border:2px solid #2A1F12;border-radius:28px;transform:translate(8px,8px);z-index:-1;background:#FF6B6B}" +
      ".rt-tpl-sticker-tape{position:absolute;top:-14px;left:50%;transform:translateX(-50%) rotate(-3deg);width:90px;height:26px;background:repeating-linear-gradient(90deg,rgba(255,255,255,.6) 0 8px,transparent 8px 14px),#FFD93D;border:1.5px solid #2A1F12;box-shadow:0 2px 0 #2A1F12}" +
      ".rt-tpl-sticker-sticker{position:absolute;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Caveat','Geist',cursive;font-weight:700;border:1.5px solid #2A1F12;box-shadow:2px 2px 0 #2A1F12}" +
      ".rt-tpl-sticker-s1{top:-22px;right:30px;width:64px;height:64px;background:#4ECDC4;transform:rotate(8deg);color:#2A1F12;font-size:18px;line-height:1}" +
      ".rt-tpl-sticker-s2{bottom:-18px;left:20px;width:54px;height:54px;background:#FF6B6B;transform:rotate(-12deg);color:#FFF6E5;font-size:22px}" +
      ".rt-tpl-sticker-s3{top:45%;right:-20px;width:44px;height:44px;background:#95D8B0;transform:rotate(15deg);color:#2A1F12;font-size:16px}" +
      ".rt-tpl-sticker-eyebrow{display:inline-block;background:#2A1F12;color:#FFD93D;font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;padding:4px 10px;border-radius:999px;font-weight:500}" +
      ".rt-tpl-sticker-h{font-family:'Caveat','Instrument Serif',cursive;font-size:48px;line-height:.9;letter-spacing:-.02em;margin:16px 0 6px;color:#2A1F12;font-weight:700}" +
      ".rt-tpl-sticker-h .accent{color:#FF6B6B}" +
      ".rt-tpl-sticker-p{font-size:14px;line-height:1.5;color:#5A4632;margin:0 0 18px}" +
      ".rt-tpl-sticker-input{width:100%;height:44px;padding:0 14px;background:#FFF6E5;border:1.5px solid #2A1F12;border-radius:12px;color:#2A1F12;font-family:inherit;font-size:13px;outline:none;margin-bottom:10px;box-shadow:3px 3px 0 #2A1F12;box-sizing:border-box}" +
      ".rt-tpl-sticker-btn{width:100%;background:#FF6B6B;color:#FFF6E5;font-family:'Geist',sans-serif;font-weight:700;font-size:15px;border:1.5px solid #2A1F12;height:46px;border-radius:12px;cursor:pointer;box-shadow:3px 3px 0 #2A1F12;letter-spacing:.02em}" +
      ".rt-tpl-sticker-fine{font-size:10px;color:#8E7B5C;margin-top:10px;text-align:center;line-height:1.5}" +
      ".rt-tpl-sticker-close{position:absolute;top:12px;left:12px;background:#FFF6E5;border:1.5px solid #2A1F12;color:#2A1F12;width:28px;height:28px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:2px 2px 0 #2A1F12;z-index:4}" +
      ".rt-tpl-sticker [data-rt-status]{display:none;font-size:13px;margin-top:12px;text-align:center;font-weight:700;color:#2A1F12}" + WA_OPTIN_CSS
    );

    return '<div class="rt-tpl-sticker">' +
      '<div class="rt-tpl-sticker-tape"></div>' +
      '<button class="rt-tpl-sticker-close" data-rt-close aria-label="Close">' +
        '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>' +
      '</button>' +
      '<div class="rt-tpl-sticker-sticker rt-tpl-sticker-s1">' + escapeHtml(d.sticker1 || "10%") + '</div>' +
      '<div class="rt-tpl-sticker-sticker rt-tpl-sticker-s2">' + escapeHtml(d.sticker2 || "❤") + '</div>' +
      '<div class="rt-tpl-sticker-sticker rt-tpl-sticker-s3">' + escapeHtml(d.sticker3 || "YES") + '</div>' +
      '<div class="rt-tpl-sticker-eyebrow">' + escapeHtml(d.eyebrow) + '</div>' +
      '<h2 class="rt-tpl-sticker-h">' + sanitizeRichHtml(d.headline) + '</h2>' +
      '<p class="rt-tpl-sticker-p">' + escapeHtml(d.body) + '</p>' +
      '<input class="rt-tpl-sticker-input" type="email" data-rt-email placeholder="' + escapeHtml(d.placeholder || "Drop your email here") + '" autocomplete="email">' +
      whatsappFieldsHtml(d) +
      '<button class="rt-tpl-sticker-btn" data-rt-submit type="button">' + escapeHtml(d.cta || "Yes please!") + '</button>' +
      '<div class="rt-tpl-sticker-fine">' + escapeHtml(d.fine) + '</div>' +
      '<div data-rt-status></div>' +
    '</div>';
  }

  function renderHoliday(d) {
    var HOLIDAY_PALETTES = {
      pine:     { bg: "linear-gradient(180deg, #1A2E1F 0%, #0F1F15 100%)", bgSolid: "#1A2E1F", ink: "#F1E8C7", accent: "#D4A35A", line: "rgba(241,232,199,0.18)" },
      blush:    { bg: "linear-gradient(180deg, #4A1A2E 0%, #2E0F1F 100%)", bgSolid: "#4A1A2E", ink: "#FCE6D6", accent: "#E89B7A", line: "rgba(252,230,214,0.18)" },
      midnight: { bg: "linear-gradient(180deg, #1A1F3A 0%, #0F1226 100%)", bgSolid: "#1A1F3A", ink: "#D8E1F5", accent: "#C5A86A", line: "rgba(216,225,245,0.18)" },
      ember:    { bg: "linear-gradient(180deg, #3A1810 0%, #1F0A06 100%)", bgSolid: "#3A1810", ink: "#FBD9A5", accent: "#E07A2C", line: "rgba(251,217,165,0.18)" },
    };
    function rtHexToRgba(hex, alpha) {
      var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
      if (!m) return "rgba(241,232,199," + alpha + ")";
      var n = parseInt(m[1], 16);
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
    }
    var p;
    if (d.palette === "custom" && d.paletteCustom) {
      var bg = d.paletteCustom.bg || "#1A2E1F";
      var ink = d.paletteCustom.ink || "#F1E8C7";
      var accent = d.paletteCustom.accent || "#D4A35A";
      p = {
        bg: "linear-gradient(180deg, " + bg + " 0%, " + bg + " 100%)",
        bgSolid: bg,
        ink: ink,
        accent: accent,
        line: rtHexToRgba(ink, 0.18),
      };
    } else {
      p = HOLIDAY_PALETTES[d.palette] || HOLIDAY_PALETTES.pine;
    }
    var hours = parseInt(d.countdownHours || 24, 10);
    var target = Date.now() + hours * 3600 * 1000;

    injectCss("rt-tpl-holiday-css",
      ".rt-tpl-holiday{width:580px;max-width:calc(100vw - 32px);background:var(--hd-bg);color:var(--hd-ink);font-family:'Geist',sans-serif;position:relative;overflow:hidden;border:1px solid var(--hd-line);box-shadow:0 30px 80px rgba(0,0,0,.5);border-radius:4px}" +
      ".rt-tpl-holiday-body{padding:40px 44px 36px;position:relative}" +
      ".rt-tpl-holiday-eyebrow{display:flex;align-items:center;gap:10px;font-family:'DM Serif Display',serif;font-style:italic;font-size:14px;color:var(--hd-accent);margin-bottom:12px;letter-spacing:.02em}" +
      ".rt-tpl-holiday-eyebrow::before,.rt-tpl-holiday-eyebrow::after{content:'';flex:1;height:1px;background:var(--hd-accent);opacity:.6}" +
      ".rt-tpl-holiday-h{font-family:'DM Serif Display','Instrument Serif',serif;font-size:46px;line-height:1;text-align:center;margin:0 0 8px;letter-spacing:-.005em;color:var(--hd-ink)}" +
      ".rt-tpl-holiday-h em{font-style:italic;color:var(--hd-accent)}" +
      ".rt-tpl-holiday-p{text-align:center;font-size:13px;line-height:1.55;margin:0 auto 24px;max-width:360px;opacity:.78}" +
      ".rt-tpl-holiday-countdown{display:flex;justify-content:center;gap:8px;margin:0 0 24px}" +
      ".rt-tpl-holiday-countdown-cell{background:rgba(255,255,255,.06);border:1px solid var(--hd-line);padding:10px 14px;min-width:64px;text-align:center}" +
      ".rt-tpl-holiday-countdown-num{font-family:'DM Serif Display',serif;font-size:28px;line-height:1;color:var(--hd-ink)}" +
      ".rt-tpl-holiday-countdown-label{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--hd-accent);margin-top:6px}" +
      ".rt-tpl-holiday-form{display:grid;grid-template-columns:1fr;gap:10px;max-width:360px;margin:0 auto}" +
      ".rt-tpl-holiday-input{height:44px;padding:0 16px;background:rgba(255,255,255,.06);border:1px solid var(--hd-line);color:var(--hd-ink);font-family:inherit;font-size:13px;outline:none;border-radius:2px;box-sizing:border-box}" +
      ".rt-tpl-holiday-btn{height:44px;background:var(--hd-accent);color:var(--hd-bg-solid);border:none;font-family:'DM Serif Display',serif;font-size:15px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;border-radius:2px}" +
      ".rt-tpl-holiday-fine{font-size:10px;opacity:.5;text-align:center;margin-top:14px;letter-spacing:.04em}" +
      ".rt-tpl-holiday-close{position:absolute;top:16px;right:16px;background:transparent;border:none;color:var(--hd-ink);cursor:pointer;opacity:.6;padding:4px;z-index:2}" +
      ".rt-tpl-holiday [data-rt-status]{display:none;color:var(--hd-ink);font-size:13px;margin-top:12px;text-align:center}" + WA_OPTIN_CSS
    );

    var html = '<div class="rt-tpl-holiday" style="--hd-bg:' + p.bg + ';--hd-bg-solid:' + p.bgSolid + ';--hd-ink:' + p.ink + ';--hd-accent:' + p.accent + ';--hd-line:' + p.line + '">' +
      '<button class="rt-tpl-holiday-close" data-rt-close aria-label="Close">' +
        '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>' +
      '</button>' +
      '<div class="rt-tpl-holiday-body">' +
        '<div class="rt-tpl-holiday-eyebrow">' + escapeHtml(d.eyebrow) + '</div>' +
        '<h2 class="rt-tpl-holiday-h">' + sanitizeRichHtml(d.headline) + '</h2>' +
        '<p class="rt-tpl-holiday-p">' + escapeHtml(d.body) + '</p>' +
        '<div class="rt-tpl-holiday-countdown" data-rt-countdown="' + target + '">' +
          '<div class="rt-tpl-holiday-countdown-cell"><div class="rt-tpl-holiday-countdown-num" data-rt-h>00</div><div class="rt-tpl-holiday-countdown-label">Hours</div></div>' +
          '<div class="rt-tpl-holiday-countdown-cell"><div class="rt-tpl-holiday-countdown-num" data-rt-m>00</div><div class="rt-tpl-holiday-countdown-label">Minutes</div></div>' +
          '<div class="rt-tpl-holiday-countdown-cell"><div class="rt-tpl-holiday-countdown-num" data-rt-s>00</div><div class="rt-tpl-holiday-countdown-label">Seconds</div></div>' +
        '</div>' +
        '<div class="rt-tpl-holiday-form">' +
          '<input class="rt-tpl-holiday-input" type="email" data-rt-email placeholder="' + escapeHtml(d.placeholder || "your@email.com") + '" autocomplete="email">' +
          whatsappFieldsHtml(d) +
          '<button class="rt-tpl-holiday-btn" data-rt-submit type="button">' + escapeHtml(d.cta || "Claim discount") + '</button>' +
        '</div>' +
        '<div class="rt-tpl-holiday-fine">' + escapeHtml(d.fine) + '</div>' +
        '<div data-rt-status></div>' +
      '</div>' +
    '</div>';

    return html;
  }

  // Pick the slice whose label contains the merchant's discount %, fall back to 0.
  function pickWheelSlice(labels, discount) {
    if (!Array.isArray(labels) || !labels.length) return 0;
    var target = String(discount);
    for (var i = 0; i < labels.length; i++) {
      var m = labels[i].match(/(\d+)\s*%/);
      if (m && m[1] === target) return i;
    }
    return 0;
  }

  // Spin the wheel disc so the chosen slice lands at the pointer (3 o'clock).
  // Returns the duration in ms so callers can chain post-spin UI.
  function spinWheel(modal) {
    var wheel = modal.querySelector("[data-rt-wheel]");
    var disc = modal.querySelector("[data-rt-disc]");
    if (!wheel || !disc) return 0;
    var total = parseInt(wheel.getAttribute("data-rt-slice-count"), 10) || 6;
    var labels;
    try { labels = JSON.parse(wheel.getAttribute("data-rt-slice-labels") || "[]"); } catch (_) { labels = []; }
    var discount = wheel.getAttribute("data-rt-discount") || "";
    var winnerIdx = pickWheelSlice(labels, discount);

    var sliceAngle = 360 / total;
    // Slice center angle measured clockwise from 12 o'clock.
    var centerFromTop = (winnerIdx + 0.5) * sliceAngle;
    // Pointer sits at 3 o'clock = 90° clockwise from 12. Rotate the disc so the
    // slice center lands there: rotation = 90 - centerFromTop (mod 360),
    // plus 5 full spins for visual punch.
    var rest = ((90 - centerFromTop) % 360 + 360) % 360;
    var finalDeg = 360 * 5 + rest;
    var DURATION = 3600;
    // Keep the existing translateX(-30px) offset from CSS while we spin.
    disc.style.transform = "translateX(-30px) rotate(" + finalDeg + "deg)";
    return DURATION;
  }

  function wireCountdown(modal) {
    var cd = modal.querySelector("[data-rt-countdown]");
    if (!cd) return;
    var target = parseInt(cd.getAttribute("data-rt-countdown"), 10);
    var hEl = cd.querySelector("[data-rt-h]");
    var mEl = cd.querySelector("[data-rt-m]");
    var sEl = cd.querySelector("[data-rt-s]");
    function pad(n) { return String(n).padStart(2, "0"); }
    function tick() {
      var diff = Math.max(0, target - Date.now());
      var h = Math.floor(diff / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      hEl.textContent = pad(h);
      mEl.textContent = pad(m);
      sEl.textContent = pad(s);
    }
    tick();
    var id = setInterval(tick, 1000);
    // Best-effort cleanup when modal unmounts
    new MutationObserver(function () {
      if (!document.body.contains(cd)) clearInterval(id);
    }).observe(document.body, { childList: true, subtree: true });
  }

  function renderCustom(d) {
    // Minimal frame around merchant-owned HTML. No template CSS injected —
    // merchant supplies all styling via inline <style> in their HTML.
    injectCss("rt-tpl-custom-css",
      ".rt-tpl-custom{display:inline-block;max-width:calc(100vw - 32px)}"
    );
    return '<div class="rt-tpl-custom">' + sanitizeMerchantHtml(d.html || "", ".rt-tpl-custom") + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // KIT TEMPLATES — generated from app/lib/popup-templates/kit.js by
  // `npm run popup:kit`. Edit that file, not this block.
  // ═══════════════════════════════════════════════════════════════════════
  /* rt-kit:start */
  /**
   * Popup template kit — the newer templates, written once as plain functions
   * that return HTML and CSS strings.
   *
   * The same source runs in two places: the admin preview (kit-templates.jsx
   * renders the string) and the storefront script, which gets a verbatim copy of
   * everything between the rt-kit markers (npm run popup:kit). Writing a template
   * twice — once as JSX, once as string concatenation — is how the older
   * templates' preview and live popup drifted apart; these cannot.
   *
   * ES5 on purpose: it ships to every storefront browser.
   *
   * Contract for every render(): an input [data-rt-email], a button
   * [data-rt-submit] and a [data-rt-status] node (the storefront wires these),
   * and [data-rt-close] on anything that should dismiss.
   *
   * h = { esc, rich, wa, preview } — escape text, sanitise the small rich-text
   * subset, the optional WhatsApp opt-in fields, and whether this is the admin
   * preview (no timers, no listeners).
   */
  function rtPopupKit(h) {
    var PALETTES = {
      cream:    { bg: "#F6F1E7", ink: "#1F2A1E", accent: "#8C3A2A", soft: "#EAE1CF" },
      sage:     { bg: "#E9EEE7", ink: "#1D2B22", accent: "#2E5240", soft: "#D6E0D3" },
      midnight: { bg: "#141B2D", ink: "#F3EFE6", accent: "#E8B04B", soft: "#222B40" },
      blush:    { bg: "#F8E9E4", ink: "#3A1F1A", accent: "#B2473A", soft: "#EFD5CD" },
      ink:      { bg: "#111111", ink: "#F5F2EA", accent: "#F5F2EA", soft: "#242424" },
    };

    function pal(d, fallback) {
      if (d && d.palette === "custom" && d.paletteCustom) {
        var c = d.paletteCustom;
        var base = PALETTES[fallback];
        return { bg: c.bg || base.bg, ink: c.ink || base.ink, accent: c.accent || base.accent, soft: c.soft || c.bg || base.soft };
      }
      return PALETTES[(d && d.palette)] || PALETTES[fallback];
    }
    function vars(p) {
      return "--k-bg:" + p.bg + ";--k-ink:" + p.ink + ";--k-accent:" + p.accent + ";--k-soft:" + p.soft;
    }
    function closeX() {
      return '<button type="button" class="rt-k-x" data-rt-close aria-label="Close">' +
        '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.4" fill="none"/></svg></button>';
    }
    function num(v, dflt) { var n = parseInt(v, 10); return isNaN(n) ? dflt : n; }

    // Shared by every kit template: close button, input, status, fine print.
    var BASE_CSS =
      ".rt-k{box-sizing:border-box;position:relative;background:var(--k-bg);color:var(--k-ink);font-family:'Geist',-apple-system,sans-serif;-webkit-font-smoothing:antialiased;text-align:left}" +
      ".rt-k *{box-sizing:border-box}" +
      ".rt-k em{font-style:italic;color:var(--k-accent)}" +
      ".rt-k .accent{color:var(--k-accent)}" +
      ".rt-k-x{position:absolute;top:12px;right:12px;background:none;border:0;color:inherit;opacity:.6;cursor:pointer;padding:6px;line-height:0}" +
      ".rt-k-x:hover{opacity:1}" +
      ".rt-k-input{display:block;width:100%;height:46px;padding:0 14px;border:1px solid color-mix(in srgb,var(--k-ink) 28%,transparent);background:color-mix(in srgb,var(--k-bg) 70%,#fff);color:var(--k-ink);font:inherit;font-size:14px;border-radius:6px;outline:none}" +
      ".rt-k-input:focus{border-color:var(--k-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--k-accent) 20%,transparent)}" +
      ".rt-k-input::placeholder{color:color-mix(in srgb,var(--k-ink) 45%,transparent)}" +
      ".rt-k-btn{display:block;width:100%;height:48px;border:0;border-radius:6px;background:var(--k-accent);color:var(--k-bg);font:inherit;font-size:14px;font-weight:600;letter-spacing:.01em;cursor:pointer;transition:transform .12s,filter .12s}" +
      ".rt-k-btn:hover{filter:brightness(1.06)}.rt-k-btn:active{transform:translateY(1px)}" +
      ".rt-k-fine{font-size:10.5px;line-height:1.5;opacity:.6;margin-top:12px}" +
      ".rt-k-decline{display:block;margin:12px auto 0;background:none;border:0;color:inherit;opacity:.65;font:inherit;font-size:12.5px;text-decoration:underline;text-underline-offset:3px;cursor:pointer}" +
      ".rt-k-decline:hover{opacity:1}" +
      ".rt-k [data-rt-status]{display:none;margin-top:12px;padding:12px 14px;border-radius:6px;background:var(--k-soft);font-size:13px;line-height:1.45}" +
      ".rt-k .rt-wa-optin{margin:10px 0 0}" +
      ".rt-k-stack>*+*{margin-top:10px}";

    var T = {};

    // ── The Offer: one big number, one field, one button ────────────────────
    T.spotlight = {
      fonts: ["Instrument Serif:ital@0;1", "Geist:wght@400;500;600;700"],
      mount: "modal",
      css: BASE_CSS +
        ".rt-k-spot{width:440px;max-width:calc(100vw - 32px);padding:40px 40px 30px;border-radius:14px;box-shadow:0 24px 70px rgba(20,24,20,.28);text-align:center}" +
        ".rt-k-spot-eyebrow{font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:600;opacity:.7}" +
        ".rt-k-spot-big{font-family:'Instrument Serif',serif;font-size:124px;line-height:.9;color:var(--k-accent);margin:14px 0 2px;letter-spacing:-.03em}" +
        ".rt-k-spot-big sup{font-size:.42em;vertical-align:.95em;margin-left:2px}" +
        ".rt-k-spot-label{font-family:'Instrument Serif',serif;font-size:26px;line-height:1.1;margin-bottom:12px}" +
        ".rt-k-spot-body{font-size:14px;line-height:1.55;opacity:.8;margin:0 auto 22px;max-width:320px}" +
        ".rt-k-spot .rt-k-stack{text-align:left}" +
        "@media(max-width:480px){.rt-k-spot{padding:32px 22px 24px}.rt-k-spot-big{font-size:96px}}",
      render: function (d) {
        var p = pal(d, "cream");
        return '<div class="rt-k rt-k-spot" style="' + vars(p) + '">' + closeX() +
          '<div class="rt-k-spot-eyebrow">' + h.esc(d.eyebrow) + '</div>' +
          '<div class="rt-k-spot-big">' + h.esc(num(d.discount, 10)) + '<sup>%</sup></div>' +
          '<div class="rt-k-spot-label">' + h.rich(d.offerLabel) + '</div>' +
          '<p class="rt-k-spot-body">' + h.esc(d.body) + '</p>' +
          '<div class="rt-k-stack">' +
            '<input class="rt-k-input" type="email" data-rt-email autocomplete="email" placeholder="' + h.esc(d.placeholder || "Email address") + '">' +
            h.wa(d) +
            '<button type="button" class="rt-k-btn" data-rt-submit>' + h.esc(d.cta || "Unlock my discount") + '</button>' +
          '</div>' +
          '<div data-rt-status></div>' +
          (d.declineText ? '<button type="button" class="rt-k-decline" data-rt-close>' + h.esc(d.declineText) + '</button>' : '') +
          '<div class="rt-k-fine">' + h.esc(d.fine) + '</div>' +
        '</div>';
      },
    };

    // ── Yes / No: a one-click "yes" first, the email second ─────────────────
    T.twostep = {
      fonts: ["DM Serif Display:ital@0;1", "Geist:wght@400;500;600;700"],
      mount: "modal",
      css: BASE_CSS +
        ".rt-k-two{width:460px;max-width:calc(100vw - 32px);padding:42px 40px 32px;border-radius:14px;box-shadow:0 24px 70px rgba(20,24,20,.28);text-align:center}" +
        ".rt-k-two-eyebrow{display:inline-block;font-size:11px;letter-spacing:.2em;text-transform:uppercase;font-weight:600;padding:5px 10px;border-radius:99px;background:var(--k-soft)}" +
        ".rt-k-two-h{font-family:'DM Serif Display',serif;font-weight:400;font-size:40px;line-height:1.05;margin:18px 0 10px;letter-spacing:-.01em}" +
        ".rt-k-two-p{font-size:14px;line-height:1.55;opacity:.8;margin:0 auto 24px;max-width:330px}" +
        ".rt-k-two-no{display:block;width:100%;height:44px;margin-top:10px;border:1px solid color-mix(in srgb,var(--k-ink) 25%,transparent);border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:13px;opacity:.75;cursor:pointer}" +
        ".rt-k-two-no:hover{opacity:1}" +
        ".rt-k-two-step2{display:none;text-align:left}" +
        ".rt-k-two.is-step2 .rt-k-two-step1{display:none}.rt-k-two.is-step2 .rt-k-two-step2{display:block}" +
        "@media(max-width:480px){.rt-k-two{padding:34px 22px 24px}.rt-k-two-h{font-size:32px}}",
      render: function (d) {
        var p = pal(d, "sage");
        var step2 = h.preview && String(d.previewStep) === "2";
        return '<div class="rt-k rt-k-two' + (step2 ? " is-step2" : "") + '" style="' + vars(p) + '">' + closeX() +
          '<div class="rt-k-two-step1">' +
            '<span class="rt-k-two-eyebrow">' + h.esc(d.eyebrow) + '</span>' +
            '<h2 class="rt-k-two-h">' + h.rich(d.headline) + '</h2>' +
            '<p class="rt-k-two-p">' + h.esc(d.body) + '</p>' +
            '<button type="button" class="rt-k-btn" data-rt-yes>' + h.esc(d.yesText || "Yes, I want it") + '</button>' +
            '<button type="button" class="rt-k-two-no" data-rt-close>' + h.esc(d.noText || "No thanks") + '</button>' +
          '</div>' +
          '<div class="rt-k-two-step2">' +
            '<h2 class="rt-k-two-h" style="text-align:center">' + h.rich(d.headline2) + '</h2>' +
            '<p class="rt-k-two-p" style="text-align:center">' + h.esc(d.body2) + '</p>' +
            '<div class="rt-k-stack">' +
              '<input class="rt-k-input" type="email" data-rt-email autocomplete="email" placeholder="' + h.esc(d.placeholder || "Email address") + '">' +
              h.wa(d) +
              '<button type="button" class="rt-k-btn" data-rt-submit>' + h.esc(d.cta || "Send my code") + '</button>' +
            '</div>' +
            '<div data-rt-status></div>' +
            '<div class="rt-k-fine" style="text-align:center">' + h.esc(d.fine) + '</div>' +
          '</div>' +
        '</div>';
      },
      init: function (root) {
        var card = root.querySelector(".rt-k-two");
        var yes = root.querySelector("[data-rt-yes]");
        if (!card || !yes) return;
        yes.addEventListener("click", function () {
          card.className += " is-step2";
          var input = root.querySelector("[data-rt-email]");
          if (input) setTimeout(function () { input.focus(); }, 30);
        });
      },
    };

    // ── Corner Note: a quiet card that slides in and never blocks the page ─
    T.slidein = {
      fonts: ["Instrument Serif:ital@0;1", "Geist:wght@400;500;600;700"],
      mount: "corner",
      css: BASE_CSS +
        ".rt-k-corner{width:340px;max-width:calc(100vw - 24px);padding:22px 22px 18px;border-radius:12px;box-shadow:0 14px 44px rgba(20,24,20,.24);border:1px solid color-mix(in srgb,var(--k-ink) 10%,transparent)}" +
        ".rt-k-corner-top{display:flex;gap:12px;align-items:flex-start;padding-right:18px;margin-bottom:14px}" +
        ".rt-k-corner-ico{flex:none;width:38px;height:38px;border-radius:50%;background:var(--k-accent);color:var(--k-bg);display:flex;align-items:center;justify-content:center}" +
        ".rt-k-corner-h{font-family:'Instrument Serif',serif;font-size:24px;line-height:1.1;margin:0 0 4px;font-weight:400}" +
        ".rt-k-corner-p{font-size:13px;line-height:1.5;opacity:.78;margin:0}" +
        ".rt-k-corner-row{display:flex;gap:6px}" +
        ".rt-k-corner-row .rt-k-input{height:42px;font-size:13.5px}" +
        ".rt-k-corner-row .rt-k-btn{width:auto;height:42px;padding:0 16px;white-space:nowrap;font-size:13px}" +
        ".rt-k-corner .rt-k-x{top:8px;right:8px}",
      render: function (d) {
        var p = pal(d, "cream");
        return '<div class="rt-k rt-k-corner" style="' + vars(p) + '">' + closeX() +
          '<div class="rt-k-corner-top">' +
            '<span class="rt-k-corner-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="8" width="18" height="13" rx="1.5"/><path d="M12 8v13M3 12h18M12 8S10.5 3 7.5 3 5 6.5 7.5 8M12 8s1.5-5 4.5-5S19 6.5 16.5 8"/></svg></span>' +
            '<div><h2 class="rt-k-corner-h">' + h.rich(d.headline) + '</h2>' +
            '<p class="rt-k-corner-p">' + h.esc(d.body) + '</p></div>' +
          '</div>' +
          '<div class="rt-k-corner-row">' +
            '<input class="rt-k-input" type="email" data-rt-email autocomplete="email" placeholder="' + h.esc(d.placeholder || "Email address") + '">' +
            '<button type="button" class="rt-k-btn" data-rt-submit>' + h.esc(d.cta || "Get it") + '</button>' +
          '</div>' +
          h.wa(d) +
          '<div data-rt-status></div>' +
          '<div class="rt-k-fine">' + h.esc(d.fine) + '</div>' +
        '</div>';
      },
    };

    // ── Last Call: an honest per-visitor countdown ──────────────────────────
    T.countdown = {
      fonts: ["DM Serif Display:ital@0;1", "Geist:wght@400;500;600;700", "Geist Mono"],
      mount: "modal",
      css: BASE_CSS +
        ".rt-k-cd{width:480px;max-width:calc(100vw - 32px);padding:38px 40px 30px;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.4);text-align:center}" +
        ".rt-k-cd-label{font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:600;color:var(--k-accent)}" +
        ".rt-k-cd-clock{display:flex;justify-content:center;gap:10px;margin:14px 0 22px;font-family:'Geist Mono',monospace}" +
        ".rt-k-cd-unit{min-width:78px;padding:12px 8px 8px;border-radius:8px;background:var(--k-soft)}" +
        ".rt-k-cd-num{display:block;font-size:40px;line-height:1;font-weight:500;letter-spacing:-.02em}" +
        ".rt-k-cd-cap{display:block;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;opacity:.6;margin-top:6px;font-family:'Geist',sans-serif}" +
        ".rt-k-cd-sep{font-size:34px;line-height:60px;opacity:.4}" +
        ".rt-k-cd-h{font-family:'DM Serif Display',serif;font-weight:400;font-size:36px;line-height:1.05;margin:0 0 10px}" +
        ".rt-k-cd-p{font-size:14px;line-height:1.55;opacity:.78;margin:0 auto 22px;max-width:340px}" +
        ".rt-k-cd .rt-k-stack{text-align:left}" +
        "@media(max-width:480px){.rt-k-cd{padding:32px 20px 24px}.rt-k-cd-unit{min-width:64px}.rt-k-cd-num{font-size:32px}.rt-k-cd-h{font-size:30px}}",
      render: function (d) {
        var p = pal(d, "midnight");
        var mins = Math.max(1, Math.min(120, num(d.minutes, 15)));
        var mm = mins < 10 ? "0" + mins : String(mins);
        return '<div class="rt-k rt-k-cd" style="' + vars(p) + '">' + closeX() +
          '<div class="rt-k-cd-label">' + h.esc(d.eyebrow) + '</div>' +
          '<div class="rt-k-cd-clock" data-rt-timer data-minutes="' + mins + '">' +
            '<span class="rt-k-cd-unit"><span class="rt-k-cd-num" data-rt-mm>' + mm + '</span><span class="rt-k-cd-cap">min</span></span>' +
            '<span class="rt-k-cd-sep">:</span>' +
            '<span class="rt-k-cd-unit"><span class="rt-k-cd-num" data-rt-ss>00</span><span class="rt-k-cd-cap">sec</span></span>' +
          '</div>' +
          '<h2 class="rt-k-cd-h">' + h.rich(d.headline) + '</h2>' +
          '<p class="rt-k-cd-p">' + h.esc(d.body) + '</p>' +
          '<div class="rt-k-stack">' +
            '<input class="rt-k-input" type="email" data-rt-email autocomplete="email" placeholder="' + h.esc(d.placeholder || "Email address") + '">' +
            h.wa(d) +
            '<button type="button" class="rt-k-btn" data-rt-submit>' + h.esc(d.cta || "Claim before it's gone") + '</button>' +
          '</div>' +
          '<div data-rt-status></div>' +
          '<div class="rt-k-fine">' + h.esc(d.fine) + '</div>' +
        '</div>';
      },
      // The deadline is fixed the first time this visitor sees the offer and
      // survives reloads, so the clock never resets to make a fake new window.
      init: function (root) {
        var el = root.querySelector("[data-rt-timer]");
        if (!el) return;
        var mins = parseInt(el.getAttribute("data-minutes"), 10) || 15;
        var KEY = "rt_popup_deadline";
        var until = 0;
        try { until = parseInt(localStorage.getItem(KEY) || "0", 10); } catch (e) { until = 0; }
        if (!until || until < Date.now() - 24 * 3600 * 1000) {
          until = Date.now() + mins * 60 * 1000;
          try { localStorage.setItem(KEY, String(until)); } catch (e) { /* private mode */ }
        }
        var mmEl = root.querySelector("[data-rt-mm]");
        var ssEl = root.querySelector("[data-rt-ss]");
        function pad(n) { return n < 10 ? "0" + n : String(n); }
        function tick() {
          var left = Math.max(0, Math.floor((until - Date.now()) / 1000));
          if (mmEl) mmEl.textContent = pad(Math.floor(left / 60));
          if (ssEl) ssEl.textContent = pad(left % 60);
          if (left > 0 && document.body.contains(el)) setTimeout(tick, 1000);
        }
        tick();
      },
    };

    // ── The Dispatch: a newsletter signup with no discount at all ───────────
    T.newsletter = {
      fonts: ["Instrument Serif:ital@0;1", "Geist:wght@400;500;600;700"],
      mount: "modal",
      css: BASE_CSS +
        ".rt-k-news{width:540px;max-width:calc(100vw - 32px);padding:40px 42px 32px;border-radius:12px;box-shadow:0 24px 70px rgba(20,24,20,.26)}" +
        ".rt-k-news-kicker{display:flex;align-items:center;gap:10px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;font-weight:600;opacity:.75}" +
        ".rt-k-news-kicker::after{content:'';flex:1;height:1px;background:currentColor;opacity:.25}" +
        ".rt-k-news-h{font-family:'Instrument Serif',serif;font-weight:400;font-size:46px;line-height:1;margin:16px 0 12px;letter-spacing:-.01em}" +
        ".rt-k-news-p{font-size:14.5px;line-height:1.6;opacity:.82;margin:0 0 16px;max-width:420px}" +
        ".rt-k-news-list{list-style:none;padding:0;margin:0 0 20px}" +
        ".rt-k-news-list li{position:relative;padding-left:22px;font-size:13.5px;line-height:1.5;margin-bottom:6px}" +
        ".rt-k-news-list li::before{content:'';position:absolute;left:2px;top:7px;width:8px;height:8px;border-radius:50%;background:var(--k-accent)}" +
        ".rt-k-news-row{display:flex;gap:8px}" +
        ".rt-k-news-row .rt-k-btn{width:auto;padding:0 20px;white-space:nowrap}" +
        ".rt-k-news-proof{font-size:12px;opacity:.65;margin-top:12px}" +
        "@media(max-width:520px){.rt-k-news{padding:32px 22px 24px}.rt-k-news-h{font-size:36px}.rt-k-news-row{flex-direction:column}.rt-k-news-row .rt-k-btn{width:100%}}",
      render: function (d) {
        var p = pal(d, "cream");
        var items = String(d.bullets || "").split(/\n+/).filter(function (x) { return x.replace(/\s/g, "").length > 0; }).slice(0, 5);
        var list = items.length
          ? '<ul class="rt-k-news-list">' + items.map(function (x) { return "<li>" + h.esc(x) + "</li>"; }).join("") + "</ul>"
          : "";
        return '<div class="rt-k rt-k-news" style="' + vars(p) + '">' + closeX() +
          '<div class="rt-k-news-kicker">' + h.esc(d.eyebrow) + '</div>' +
          '<h2 class="rt-k-news-h">' + h.rich(d.headline) + '</h2>' +
          '<p class="rt-k-news-p">' + h.esc(d.body) + '</p>' + list +
          '<div class="rt-k-news-row">' +
            '<input class="rt-k-input" type="email" data-rt-email autocomplete="email" placeholder="' + h.esc(d.placeholder || "you@example.com") + '">' +
            '<button type="button" class="rt-k-btn" data-rt-submit>' + h.esc(d.cta || "Subscribe") + '</button>' +
          '</div>' +
          h.wa(d) +
          '<div data-rt-status></div>' +
          (d.proof ? '<div class="rt-k-news-proof">' + h.esc(d.proof) + '</div>' : '') +
          '<div class="rt-k-fine">' + h.esc(d.fine) + '</div>' +
        '</div>';
      },
    };

    // ── Announcement Bar: a slim strip across the top of the page ───────────
    T.bar = {
      fonts: ["Geist:wght@400;500;600;700"],
      mount: "bar",
      // A one-line strip has nowhere to put a phone field and a consent
      // checkbox, so it never collects WhatsApp opt-ins. Declared rather than
      // silently omitted: the server reads this and turns the option off for
      // this template instead of promising a capture that can't happen.
      noWhatsapp: true,
      css: BASE_CSS +
        ".rt-k-bar{width:100%;min-height:56px;padding:9px 52px 9px 20px;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;box-shadow:0 2px 14px rgba(0,0,0,.14)}" +
        ".rt-k-bar-text{font-size:14px;line-height:1.35;font-weight:500}" +
        ".rt-k-bar-text strong{color:var(--k-accent)}" +
        ".rt-k-bar-form{display:flex;gap:6px;align-items:center}" +
        ".rt-k-bar .rt-k-input{width:230px;height:38px;font-size:13px}" +
        ".rt-k-bar .rt-k-btn{width:auto;height:38px;padding:0 16px;font-size:13px;white-space:nowrap}" +
        ".rt-k-bar .rt-k-x{top:50%;transform:translateY(-50%);right:10px}" +
        ".rt-k-bar [data-rt-status]{margin:0;padding:8px 12px}" +
        "@media(max-width:640px){.rt-k-bar{justify-content:flex-start;padding:10px 44px 12px 14px}.rt-k-bar-form{width:100%}.rt-k-bar .rt-k-input{flex:1;width:auto}}",
      render: function (d) {
        var p = pal(d, "ink");
        return '<div class="rt-k rt-k-bar" style="' + vars(p) + '">' +
          '<div class="rt-k-bar-text">' + h.rich(d.headline) + '</div>' +
          '<div class="rt-k-bar-form">' +
            '<input class="rt-k-input" type="email" data-rt-email autocomplete="email" placeholder="' + h.esc(d.placeholder || "Email address") + '">' +
            '<button type="button" class="rt-k-btn" data-rt-submit>' + h.esc(d.cta || "Get 10% off") + '</button>' +
          '</div>' +
          '<div data-rt-status></div>' +
          closeX() +
        '</div>';
      },
    };

    return { templates: T, palettes: PALETTES };
  }
  /* rt-kit:end */

  var KIT = rtPopupKit({ esc: escapeHtml, rich: sanitizeRichHtml, wa: whatsappFieldsHtml, preview: false });

  function kitRenderer(id) {
    return function (d) {
      var t = KIT.templates[id];
      injectCss("rt-k-" + id + "-css", t.css + WA_OPTIN_CSS);
      return t.render(d);
    };
  }

  // Corner card and top bar: no backdrop, the page stays usable underneath.
  function mountFloating(innerHTML, kind) {
    var host = document.createElement("div");
    host.id = "rt-floating";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-live", "polite");
    var base = "position:fixed;z-index:999998;transition:transform .35s ease,opacity .35s ease;opacity:0;";
    if (kind === "bar") {
      host.style.cssText = base + "top:0;left:0;right:0;transform:translateY(-100%);";
    } else {
      var narrow = window.innerWidth < 560;
      host.style.cssText = base + (narrow ? "left:12px;right:12px;bottom:12px;" : "right:20px;bottom:20px;") +
        "transform:translateY(24px);";
    }
    host.innerHTML = innerHTML;
    document.body.appendChild(host);
    requestAnimationFrame(function () {
      host.style.opacity = "1";
      host.style.transform = "translateY(0)";
    });
    function close() {
      host.style.opacity = "0";
      host.style.transform = kind === "bar" ? "translateY(-100%)" : "translateY(24px)";
      setTimeout(function () { host.remove(); }, 380);
      markShown(_frequency);
    }
    host.querySelectorAll("[data-rt-close]").forEach(function (btn) {
      btn.addEventListener("click", close);
    });
    return { overlay: host, modal: host, close: close };
  }

  var RENDERERS = {
    editorial: renderEditorial,
    brutalist: renderBrutal,
    wheel: renderWheel,
    sticker: renderSticker,
    holiday: renderHoliday,
    custom: renderCustom,
  };
  for (var kitId in KIT.templates) {
    if (Object.prototype.hasOwnProperty.call(KIT.templates, kitId)) RENDERERS[kitId] = kitRenderer(kitId);
  }

  // ── Trigger ─────────────────────────────────────────────────────────────
  function show() {
    if (triggered) return;
    triggered = true;
    var renderer = RENDERERS[_templateId] || RENDERERS.editorial;
    var html = renderer(_tplData || {});
    // Custom template: merchant HTML owns the visible experience end-to-end
    // (backdrop, positioning, close chrome). Skip our overlay so we don't
    // double-wrap fixed-positioned merchant markup.
    var kit = KIT.templates[_templateId];
    var mounted = (_templateId === "custom")
      ? mountBare(html)
      : (kit && kit.mount !== "modal") ? mountFloating(html, kit.mount) : mountOverlay(html);
    wireSubmit(mounted.modal, mounted.close);
    if (_templateId === "holiday") wireCountdown(mounted.modal);
    if (kit && kit.init) kit.init(mounted.modal);
  }

  function whenReady(fn) {
    if (_configReady) return fn();
    setTimeout(function () { whenReady(fn); }, 100);
  }

  function setupTrigger() {
    if (FORCE_PREVIEW) { setTimeout(show, 800); return; }
    var trig = _tplData.trigger || "delay";
    if (trig === "exit") {
      // Desktop only — exit intent
      if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;
      var handler = function (e) {
        if (e.clientY <= 0) { document.removeEventListener("mouseleave", handler); show(); }
      };
      document.addEventListener("mouseleave", handler);
    } else if (trig === "scroll") {
      var scrollHandler = function () {
        var scrolled = window.scrollY + window.innerHeight;
        var total = document.documentElement.scrollHeight;
        if (total > 0 && scrolled / total >= 0.5) {
          window.removeEventListener("scroll", scrollHandler);
          show();
        }
      };
      window.addEventListener("scroll", scrollHandler, { passive: true });
    } else {
      var delaySec = parseInt(_tplData.delay != null ? _tplData.delay : "3", 10);
      setTimeout(show, Math.max(0, delaySec) * 1000);
    }
  }

  whenReady(function () {
    if (triggered) return; // suppressed by remote.enabled=false
    setupTrigger();
  });
})();
