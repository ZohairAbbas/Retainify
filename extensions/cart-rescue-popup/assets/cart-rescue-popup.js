(function () {
  "use strict";

  var config = window.__retainifyPopup || {};
  var STORAGE_KEY = "retainify_popup_shown";
  var SESSION_KEY = "retainify_popup_session";
  var ANON_KEY = "__rt_anon";

  // Ensure an anonymous ID exists for push subscription linkage
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

  // Standard VAPID key conversion helper
  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function requestPushPermission(capturedEmail) {
    var vapidKey = config.vapidPublicKey;
    var subscribeUrl = config.pushSubscribeUrl;
    if (!vapidKey || !subscribeUrl) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    Notification.requestPermission().then(function (permission) {
      if (permission !== "granted") return;
      navigator.serviceWorker.register("/apps/retainify/push-sw.js")
        .then(function () { return navigator.serviceWorker.ready; })
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
        .catch(function () { /* silent — push is enhancement, not critical */ });
    });
  }

  // Don't show if already submitted or shown this session
  if (localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(SESSION_KEY)) return;

  var triggered = false;
  var _configReady = false;

  // Fetch DB-stored popup config and merge over window.__retainifyPopup (block settings as fallback)
  (function fetchRemoteConfig() {
    var endpoint = config.configEndpoint;
    var shop = config.shop;
    if (!endpoint || !shop) { _configReady = true; return; }

    fetch(endpoint + "?shop=" + encodeURIComponent(shop))
      .then(function (r) { return r.json(); })
      .then(function (remote) {
        if (remote.enabled === false) {
          triggered = true; // suppress popup entirely
        } else {
          if (remote.headline)              config.headline   = remote.headline;
          if (remote.bodyText)              config.body       = remote.bodyText;
          if (remote.buttonText)            config.buttonText = remote.buttonText;
          if (remote.brandColor)            config.brandColor = remote.brandColor;
          if (remote.logoUrl !== undefined) config.logoUrl    = remote.logoUrl;
          if (remote.discountPct !== undefined) config.discountPct = remote.discountPct;
          if (remote.delayMs !== undefined) config.delayMs    = remote.delayMs;
        }
        _configReady = true;
      })
      .catch(function () { _configReady = true; }); // fallback to block settings on error
  })();

  function injectStyles() {
    var style = document.createElement("style");
    style.textContent = [
      "#rp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:999998;opacity:0;transition:opacity .25s;}",
      "#rp-overlay.rp-visible{opacity:1;}",
      "#rp-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.94);z-index:999999;",
      "background:#fff;border-radius:12px;padding:36px 32px;max-width:420px;width:calc(100% - 32px);",
      "box-shadow:0 20px 60px rgba(0,0,0,.18);opacity:0;transition:opacity .25s,transform .25s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}",
      "#rp-modal.rp-visible{opacity:1;transform:translate(-50%,-50%) scale(1);}",
      "#rp-close{position:absolute;top:12px;right:14px;background:none;border:none;font-size:20px;cursor:pointer;color:#888;line-height:1;}",
      "#rp-logo{display:block;max-height:48px;max-width:160px;margin:0 auto 16px;}",
      "#rp-headline{margin:0 0 8px;font-size:22px;font-weight:700;color:#111;text-align:center;}",
      "#rp-body{margin:0 0 20px;font-size:14px;color:#555;text-align:center;line-height:1.6;}",
      "#rp-form{display:flex;flex-direction:column;gap:10px;}",
      "#rp-email{width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid #ddd;border-radius:8px;font-size:15px;outline:none;}",
      "#rp-email:focus{border-color:",config.brandColor || "#000","}",
      "#rp-submit{width:100%;padding:13px;background:",config.brandColor || "#000",";color:#fff;border:none;border-radius:8px;",
      "font-size:15px;font-weight:600;cursor:pointer;transition:opacity .15s;}",
      "#rp-submit:hover{opacity:.88;}",
      "#rp-submit:disabled{opacity:.5;cursor:not-allowed;}",
      "#rp-success{text-align:center;padding:8px 0;}",
      "#rp-fine{margin-top:10px;font-size:11px;color:#aaa;text-align:center;}",
    ].join("");
    document.head.appendChild(style);
  }

  function buildModal() {
    var overlay = document.createElement("div");
    overlay.id = "rp-overlay";

    var modal = document.createElement("div");
    modal.id = "rp-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "rp-headline");

    var closeBtn = document.createElement("button");
    closeBtn.id = "rp-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", closeModal);

    var html = "";
    if (config.logoUrl) {
      html += '<img id="rp-logo" src="' + config.logoUrl + '" alt="logo" />';
    }
    html += '<h2 id="rp-headline">' + (config.headline || "Wait — don't go yet!") + "</h2>";
    html +=
      '<p id="rp-body">' +
      (config.body || "Enter your email for an exclusive discount on your first order.") +
      "</p>";
    html += '<div id="rp-form">';
    html += '<input id="rp-email" type="email" placeholder="your@email.com" autocomplete="email" required />';
    html += '<button id="rp-submit" type="button">' + (config.buttonText || "Get my discount") + "</button>";
    html += "</div>";
    if (config.discountPct) {
      html +=
        '<p id="rp-fine">By subscribing you agree to receive marketing emails. Unsubscribe anytime.</p>';
    }

    modal.innerHTML = html;
    modal.prepend(closeBtn);

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    overlay.addEventListener("click", closeModal);
    document.getElementById("rp-submit").addEventListener("click", handleSubmit);
    document.getElementById("rp-email").addEventListener("keydown", function (e) {
      if (e.key === "Enter") handleSubmit();
    });

    requestAnimationFrame(function () {
      overlay.classList.add("rp-visible");
      modal.classList.add("rp-visible");
    });
  }

  function closeModal() {
    var overlay = document.getElementById("rp-overlay");
    var modal = document.getElementById("rp-modal");
    if (!overlay) return;
    overlay.classList.remove("rp-visible");
    modal.classList.remove("rp-visible");
    setTimeout(function () {
      overlay.remove();
      modal.remove();
    }, 300);
    sessionStorage.setItem(SESSION_KEY, "1");
  }

  function handleSubmit() {
    var emailInput = document.getElementById("rp-email");
    var submitBtn = document.getElementById("rp-submit");
    var email = (emailInput.value || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.style.borderColor = "#e00";
      emailInput.focus();
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";

    var endpoint = config.endpoint || "/apps/retainify/popup-signup";
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, shop: config.shop, anonId: getAnonId() }),
    })
      .then(function (r) { return r.json(); })
      .then(function () {
        localStorage.setItem(STORAGE_KEY, "1");
        var form = document.getElementById("rp-form");
        var fine = document.getElementById("rp-fine");
        if (form) {
          form.innerHTML =
            '<div id="rp-success">' +
            "<strong>Almost there!</strong><br/>" +
            "Check your inbox to confirm your email and get your discount." +
            "</div>";
        }
        if (fine) fine.remove();
        requestPushPermission(email);
        setTimeout(closeModal, 3000);
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = config.buttonText || "Get my discount";
      });
  }

  function trigger() {
    console.log("[rp] trigger called, triggered=", triggered, "_configReady=", _configReady);
    if (triggered) return;
    if (!_configReady) {
      setTimeout(trigger, 200);
      return;
    }
    triggered = true;
    injectStyles();
    buildModal();
  }

  // Show popup after delay
  setTimeout(trigger, (config.delayMs || 3000));
})();
