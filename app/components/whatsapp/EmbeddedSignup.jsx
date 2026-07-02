import { useEffect, useRef, useState } from "react";

/**
 * Meta WhatsApp Embedded Signup button.
 *
 * Loads the Facebook JS SDK, runs FB.login with the app's Login-for-Business
 * config, and captures both the OAuth `code` (from FB.login) and the WABA /
 * phone-number ids (from the WA_EMBEDDED_SIGNUP postMessage). On success it
 * submits { intent:"connect", code, wabaId, businessId } to the /app/whatsapp
 * action via the fetcher passed in from the page.
 *
 * Pre-approval / misconfig is handled gracefully: if the SDK can't load or
 * Meta rejects, we surface a message instead of throwing.
 */
export default function EmbeddedSignup({ appId, configId, fetcher }) {
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  // The signup postMessage and the FB.login callback arrive independently;
  // stash the WABA payload here so the callback can pair it with the code.
  const signupData = useRef(null);

  // Load the FB SDK once.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!appId || !configId) {
      setError("WhatsApp app is not configured (missing META_APP_ID / config id).");
      return;
    }
    if (window.FB) {
      setSdkReady(true);
      return;
    }

    window.fbAsyncInit = function () {
      try {
        window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v21.0" });
        setSdkReady(true);
      } catch (e) {
        setError("Failed to initialize the Meta SDK.");
      }
    };

    const id = "facebook-jssdk";
    if (!document.getElementById(id)) {
      const js = document.createElement("script");
      js.id = id;
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      js.async = true;
      js.defer = true;
      js.onerror = () => setError("Could not load the Meta SDK. Check your network / ad-blocker.");
      document.body.appendChild(js);
    }
  }, [appId, configId]);

  // Capture the Embedded Signup postMessage carrying WABA + phone ids.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onMessage(event) {
      if (!/facebook\.com$/.test(new URL(event.origin).hostname)) return;
      let payload;
      try {
        payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (payload?.type === "WA_EMBEDDED_SIGNUP") {
        signupData.current = payload.data || null;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function launch() {
    setError("");
    if (!window.FB) {
      setError("Meta SDK not ready yet — try again in a moment.");
      return;
    }
    setWorking(true);
    window.FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setWorking(false);
          setError("Sign-up was cancelled or did not complete.");
          return;
        }
        const data = signupData.current || {};
        fetcher.submit(
          {
            intent: "connect",
            code,
            wabaId: data.waba_id || "",
            businessId: data.business_id || "",
          },
          { method: "post" },
        );
        // The fetcher result drives the page; stop the local spinner once it
        // settles (handled by the effect below).
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  }

  // Clear the local spinner when the fetcher finishes.
  useEffect(() => {
    if (fetcher.state === "idle" && working && fetcher.data) setWorking(false);
  }, [fetcher.state, fetcher.data, working]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button
        className="btn btn-primary"
        onClick={launch}
        disabled={!sdkReady || working}
        style={{ background: "var(--node-whatsapp-ink)", borderColor: "var(--node-whatsapp-ink)" }}
      >
        {working ? "Connecting…" : "Connect WhatsApp"}
      </button>
      {!sdkReady && !error && (
        <div className="t-small muted">Loading Meta SDK…</div>
      )}
      {error && (
        <div
          className="t-small"
          style={{ background: "var(--danger-bg)", color: "var(--danger-ink)", padding: "8px 12px", borderRadius: "var(--r-2)" }}
        >
          {error}
        </div>
      )}
      {fetcher.data?.ok === false && fetcher.data?.error && (
        <div
          className="t-small"
          style={{ background: "var(--danger-bg)", color: "var(--danger-ink)", padding: "8px 12px", borderRadius: "var(--r-2)" }}
        >
          {fetcher.data.error}
        </div>
      )}
    </div>
  );
}
