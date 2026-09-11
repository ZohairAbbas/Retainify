/**
 * Meta WhatsApp Cloud API sender.
 *
 * sendWhatsappMessage sends a template (HSM) message — the only type used for
 * business-initiated marketing (abandoned cart, win-back). sendSessionText sends
 * a free-form text message, which WhatsApp only permits inside the 24-hour
 * customer-service window (i.e. after the recipient has messaged the business).
 * It exists mainly for testing while templates await approval.
 *
 * Both return the canonical SendWhatsappResult. Permanent recipient errors set
 * `invalid` so the worker can suppress the number instead of retrying.
 */
import { OPS, PERMANENT, TRANSIENT } from "../journey/failure-policy.server.js";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

// Meta error codes that mean the recipient can't receive messages — retrying
// won't help, so suppress the number. (131026 message undeliverable,
// 131049/131051/131053 invalid recipient.)
const PERMANENT_RECIPIENT_CODES = new Set([131026, 131049, 131051, 131053]);

// 131047 = "re-engagement message" — outside the 24h window a free-form message
// is rejected and a template is required. Transient, not a permanent failure.
const REENGAGEMENT_CODE = 131047;

// Failures of the CONNECTION rather than of one message. Every send for the
// shop fails identically until a human fixes something at Meta, and nothing in
// the app says so unless the account row is marked. (190 expired/revoked token,
// 200 and 10 missing permission, 133010 number never registered for the Cloud
// API, 131037 a WhatsApp-provided +1 555 number whose display name Meta has
// not yet approved.)
//
// These classify as OPS, not TRANSIENT. The difference is what happens to a
// queued campaign while the merchant waits on Meta: TRANSIENT retries for 24h
// and then fails the job for good, so a display-name review that takes two days
// silently discards every message. OPS holds the job without spending its retry
// budget, and the queue is still intact when the fix lands — the same treatment
// a suspended email key already gets.
const ACCOUNT_ERROR_CODES = new Set([190, 200, 10, 133010, 131037]);

// 131037's text names the problem but not the fix, and "WhatsApp provided
// number" reads like our jargon rather than Meta's.
const DISPLAY_NAME_CODE = 131037;

/**
 * Low-level POST to the messages endpoint with shared error handling.
 * @returns {Promise<import('./adapter.server.js').SendWhatsappResult>}
 */
async function postMessage(phoneNumberId, accessToken, body) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = json?.error || {};
      const code = Number(err.code);
      let message = err.error_user_msg || err.message || `HTTP ${res.status}`;
      if (code === REENGAGEMENT_CODE) {
        message =
          "This number hasn't messaged you in the last 24 hours, so free-text isn't allowed. Ask them to message your WhatsApp number first, or use an approved template.";
      } else if (code === 190 || code === 200 || code === 10) {
        message = `WhatsApp connection is no longer authorized (${message}). Reconnect your WhatsApp Business account.`;
      } else if (code === 133010) {
        message = "This number isn't registered for the Cloud API yet. Register it on the WhatsApp page.";
      } else if (code === DISPLAY_NAME_CODE) {
        message =
          "Meta won't let this number send yet: it's a free WhatsApp-provided (+1 555) number, and those need their display name reviewed and approved first. Submit the display name in WhatsApp Manager, or connect a number you own.";
      }
      const accountError = ACCOUNT_ERROR_CODES.has(code);
      const invalid = PERMANENT_RECIPIENT_CODES.has(code);
      return {
        ok: false,
        error: message,
        invalid,
        accountError,
        errorClass: accountError ? OPS : invalid ? PERMANENT : TRANSIENT,
        errorCode: code || undefined,
      };
    }

    const wamid = json?.messages?.[0]?.id || "";
    return { ok: true, providerMessageId: wamid };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * @param {import('./adapter.server.js').SendWhatsappOptions} options
 * @returns {Promise<import('./adapter.server.js').SendWhatsappResult>}
 */
export async function sendWhatsappMessage({
  phoneNumberId,
  accessToken,
  to,
  templateName,
  language,
  components,
}) {
  if (!phoneNumberId || !accessToken) {
    return { ok: false, error: "missing WABA phoneNumberId or accessToken" };
  }
  if (!to) return { ok: false, error: "missing recipient phone" };
  if (!templateName) return { ok: false, error: "missing template name" };

  return postMessage(phoneNumberId, accessToken, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language || "en_US" },
      ...(Array.isArray(components) && components.length ? { components } : {}),
    },
  });
}

/**
 * Whether this number is already registered with the Cloud API.
 *
 * Meta reports it as `status` on the phone number: CONNECTED means registered
 * and able to send. A test number from the app dashboard arrives that way, and
 * so does any number a merchant registered elsewhere before connecting here.
 *
 * Worth a round trip before asking for a PIN, because the failure without it is
 * a dead end rather than an error: re-registering an already-registered number
 * requires the two-step PIN that was set when it was first registered, and a
 * merchant who never chose one has nothing to type. They are told "Incorrect
 * PIN" about a PIN that does not exist, for a step they did not need.
 *
 * @param {{ phoneNumberId: string, accessToken: string }} opts
 * @returns {Promise<{ ok: boolean, registered?: boolean, status?: string, error?: string }>}
 */
export async function getRegistrationStatus({ phoneNumberId, accessToken }) {
  if (!phoneNumberId || !accessToken) {
    return { ok: false, error: "missing WABA phoneNumberId or accessToken" };
  }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}?fields=status`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.error?.message || `HTTP ${res.status}` };
    }
    const status = String(json?.status || "");
    return { ok: true, registered: status.toUpperCase() === "CONNECTED", status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Register a phone number for the Cloud API. Required once before the number
 * can send any message (else Meta returns #133010 "Account not registered").
 *
 * The `pin` is the number's 6-digit two-step verification PIN: if two-step was
 * never enabled, this call sets it; if a PIN already exists, it must match.
 *
 * @param {{ phoneNumberId: string, accessToken: string, pin: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string, alreadyRegistered?: boolean }>}
 */
export async function registerPhoneNumber({ phoneNumberId, accessToken, pin }) {
  if (!phoneNumberId || !accessToken) {
    return { ok: false, error: "missing WABA phoneNumberId or accessToken" };
  }
  if (!/^\d{6}$/.test(String(pin || ""))) {
    return { ok: false, error: "PIN must be exactly 6 digits." };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/register`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin: String(pin) }),
    });
    const json = await res.json().catch(() => ({}));

    if (res.ok && json?.success !== false) return { ok: true };

    const err = json?.error || {};
    const code = Number(err.code);
    // 133005 = wrong PIN; 133006 = PIN needs reset via 2FA; 133004 = server busy.
    if (/already/i.test(err.message || "")) return { ok: true, alreadyRegistered: true };
    let message = err.error_user_msg || err.message || `HTTP ${res.status}`;
    if (code === 133005) {
      // Almost always means the number was already registered rather than that
      // the merchant mistyped: re-registering demands the PIN set at first
      // registration, which for a pre-registered or test number nobody chose.
      // The caller checks the real status before showing this, so by the time
      // it is read the number is genuinely unregistered and the PIN genuinely
      // wrong.
      message =
        "Incorrect PIN for this number's two-step verification. If you never set one, reset it in WhatsApp Manager under Two-step verification.";
    }
    if (code === 133006) {
      message =
        "This number's PIN must be reset before it can be registered. Do that in WhatsApp Manager under Two-step verification, then try again.";
    }
    return { ok: false, error: message };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Send a free-form text message. Only succeeds inside the 24h customer-service
 * window; otherwise Meta returns the re-engagement error surfaced above.
 * @param {{ phoneNumberId: string, accessToken: string, to: string, text: string }} opts
 * @returns {Promise<import('./adapter.server.js').SendWhatsappResult>}
 */
export async function sendSessionText({ phoneNumberId, accessToken, to, text }) {
  if (!phoneNumberId || !accessToken) {
    return { ok: false, error: "missing WABA phoneNumberId or accessToken" };
  }
  if (!to) return { ok: false, error: "missing recipient phone" };
  if (!text || !String(text).trim()) return { ok: false, error: "missing message text" };

  return postMessage(phoneNumberId, accessToken, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: String(text) },
  });
}
