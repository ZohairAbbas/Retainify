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
            body: JSON.stringify({
              shop: config.shop,
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

  if (isSuppressed()) return;

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
  };

  var _fontsLoaded = false;
  function loadTemplateFonts(templateId) {
    if (_fontsLoaded) return;
    _fontsLoaded = true;
    var families = FONT_FAMILIES_BY_TEMPLATE[templateId] || FONT_FAMILIES_BY_TEMPLATE.editorial;
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

  (function fetchRemoteConfig() {
    var endpoint = config.configEndpoint;
    var shop = config.shop;
    if (!endpoint || !shop) { _configReady = true; return; }
    fetch(endpoint + "?shop=" + encodeURIComponent(shop))
      .then(function (r) { return r.json(); })
      .then(function (remote) {
        if (remote.enabled === false) {
          triggered = true; // suppress entirely
        } else {
          _templateId = remote.template || "editorial";
          _tplData = remote.config || {};
          _frequency = _tplData.frequency || "session";
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

  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    var style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
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

  // Wire up the email-submit form inside any template. Each template's renderer
  // must expose an input with [data-rt-email], a submit button [data-rt-submit],
  // and a status node [data-rt-status].
  function wireSubmit(modal, close) {
    var input = modal.querySelector("[data-rt-email]");
    var btn = modal.querySelector("[data-rt-submit]");
    var status = modal.querySelector("[data-rt-status]");
    if (!input || !btn) return;

    function submit() {
      var email = (input.value || "").trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        input.style.outline = "2px solid #e00";
        input.focus();
        return;
      }
      var originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Saving…";
      primePermissionRequest();

      var endpoint = config.endpoint || "/apps/retainify/popup-signup";
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, shop: config.shop, anonId: getAnonId() }),
      })
        .then(function (r) { return r.json(); })
        .then(function () {
          localStorage.setItem(STORAGE_KEY_FOREVER, "1");
          requestPushPermission(email);
          var spinMs = (_templateId === "wheel") ? spinWheel(modal) : 0;
          setTimeout(function () {
            if (status) {
              status.innerHTML =
                "<strong>Almost there!</strong><br/>Check your inbox to confirm your email and get your discount.";
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
      ".rt-tpl-editorial [data-rt-status]{display:none;background:#1F2A1E;color:#F4EDDE;padding:12px;font-size:12px;margin-top:12px;text-align:center}"
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
      ".rt-tpl-brutal-btn{background:var(--br-ink);color:var(--br-bg);border:2px solid var(--br-ink);font-family:'Archivo Black',sans-serif;font-size:13px;letter-spacing:.1em;padding:0 22px;cursor:pointer;text-transform:uppercase}" +
      ".rt-tpl-brutal-fine{font-size:10px;margin-top:12px;letter-spacing:.06em;opacity:.6;font-weight:500}" +
      ".rt-tpl-brutal-close{position:absolute;top:14px;right:14px;background:var(--br-bg);border:2px solid var(--br-ink);color:var(--br-ink);width:30px;height:30px;cursor:pointer;font-family:'Archivo Black',sans-serif;font-size:14px;display:flex;align-items:center;justify-content:center}" +
      ".rt-tpl-brutal [data-rt-status]{display:none;color:var(--br-ink);font-size:13px;margin-top:12px;text-align:center;font-weight:700}"
    );

    return '<div class="rt-tpl-brutal" style="--br-bg:' + p.bg + ';--br-ink:' + p.ink + ';--br-shadow:' + p.shadow + '">' +
      '<button class="rt-tpl-brutal-close" data-rt-close aria-label="Close">×</button>' +
      '<div class="rt-tpl-brutal-marquee"><div class="rt-tpl-brutal-marquee-inner"><span>' + marqueeRow + '</span><span>' + marqueeRow + '</span></div></div>' +
      '<div class="rt-tpl-brutal-body">' +
        '<span class="rt-tpl-brutal-eyebrow">' + escapeHtml(d.eyebrow || "STOP RIGHT THERE") + '</span>' +
        '<h2 class="rt-tpl-brutal-h">' + escapeHtml(d.headline || "TAKE ") + '<span class="pct">' + escapeHtml(d.discount || 15) + '</span></h2>' +
        '<div class="rt-tpl-brutal-sub">' + escapeHtml(d.sub) + '</div>' +
        '<div class="rt-tpl-brutal-form">' +
          '<input class="rt-tpl-brutal-input" type="email" data-rt-email placeholder="EMAIL@HERE.COM" autocomplete="email">' +
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
      ".rt-tpl-wheel [data-rt-status]{display:none;color:#FFF1D2;font-size:13px;margin-top:12px;text-align:center}"
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
      ".rt-tpl-sticker [data-rt-status]{display:none;font-size:13px;margin-top:12px;text-align:center;font-weight:700;color:#2A1F12}"
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
      ".rt-tpl-holiday [data-rt-status]{display:none;color:var(--hd-ink);font-size:13px;margin-top:12px;text-align:center}"
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

  var RENDERERS = {
    editorial: renderEditorial,
    brutalist: renderBrutal,
    wheel: renderWheel,
    sticker: renderSticker,
    holiday: renderHoliday,
  };

  // ── Trigger ─────────────────────────────────────────────────────────────
  function show() {
    if (triggered) return;
    triggered = true;
    var renderer = RENDERERS[_templateId] || RENDERERS.editorial;
    var html = renderer(_tplData || {});
    var mounted = mountOverlay(html);
    wireSubmit(mounted.modal, mounted.close);
    if (_templateId === "holiday") wireCountdown(mounted.modal);
  }

  function whenReady(fn) {
    if (_configReady) return fn();
    setTimeout(function () { whenReady(fn); }, 100);
  }

  function setupTrigger() {
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
