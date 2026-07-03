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
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

// Meta error codes that mean the recipient can't receive messages — retrying
// won't help, so suppress the number. (131026 message undeliverable,
// 131049/131051/131053 invalid recipient.)
const PERMANENT_RECIPIENT_CODES = new Set([131026, 131049, 131051, 131053]);

// 131047 = "re-engagement message" — outside the 24h window a free-form message
// is rejected and a template is required. Transient, not a permanent failure.
const REENGAGEMENT_CODE = 131047;

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
      }
      return { ok: false, error: message, invalid: PERMANENT_RECIPIENT_CODES.has(code) };
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
    // Already-registered numbers return an error we can treat as success.
    if (/already/i.test(err.message || "")) return { ok: true, alreadyRegistered: true };
    let message = err.error_user_msg || err.message || `HTTP ${res.status}`;
    if (code === 133005) message = "Incorrect PIN for this number's two-step verification.";
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
