// <rt-kit>
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
// </rt-kit>

export { rtPopupKit };
