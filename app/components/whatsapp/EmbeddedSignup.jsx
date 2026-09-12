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

  /**
   * FB.init options.
   *
   * use_fedcm_for_login opts out of the browser's FedCM flow. The SDK now
   * prefers FedCM over a popup, and FedCM called from a cross-origin iframe
   * needs allow="identity-credentials-get" on every parent frame — which for an
   * embedded Shopify app is set by Shopify's admin, not by us. The result is a
   * request that is cancelled within milliseconds: no popup, nothing logged,
   * and a callback carrying no code.
   *
   * The SDK ignores options it does not recognise, so this is safe whether or
   * not the flag still exists in the version being served.
   */
  // Load the FB SDK, and re-init it if the app it was initialised with is not
  // the one we are configured for now.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!appId || !configId) {
      setError("WhatsApp app is not configured (missing META_APP_ID / config id).");
      return;
    }
    const initOptions = {
      appId,
      autoLogAppEvents: true,
      xfbml: false,
      version: "v21.0",
      use_fedcm_for_login: false,
    };
    // The SDK initialises once per page load and keeps whatever appId it was
    // given. A tab left open across a deploy that changed META_APP_ID would
    // hold the old app while sending the new config_id — a mismatch Meta
    // rejects instantly, with no popup and no error in the console. Re-initing
    // is cheap and idempotent, so it happens on every mount rather than only
    // when we can prove it is needed.
    if (window.FB) {
      try {
        window.FB.init(initOptions);
      } catch {
        /* an SDK that refuses to re-init still works with what it has */
      }
      setSdkReady(true);
      return;
    }

    window.fbAsyncInit = function () {
      try {
        window.FB.init(initOptions);
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
          // The response shape is the only clue when the flow fails before a
          // window ever opens — a FedCM refusal inside an iframe looks exactly
          // like a merchant closing the popup.
          console.warn("[whatsapp-signup] no code returned", response);
          setError(
            "Sign-up was cancelled or did not complete. If no window opened at all, your browser may be blocking it — try again, or open Retainify in its own browser tab.",
          );
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
