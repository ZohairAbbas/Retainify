/**
 * Meta WhatsApp Cloud API sender.
 *
 * Sends a template (HSM) message via the Graph API. Business-initiated marketing
 * (abandoned cart, win-back) must use approved templates — that is the only
 * message type this path produces. Free-form session messages are out of scope.
 *
 * Returns the canonical SendWhatsappResult so the worker treats it like any
 * other channel adapter. Permanent recipient errors set `invalid` so the worker
 * can suppress the number instead of retrying.
 */
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

// Meta error codes that mean the recipient can't receive messages — retrying
// won't help, so suppress the number. (131026 message undeliverable,
// 131047 re-engagement required is transient; 131049/131051 invalid recipient.)
const PERMANENT_RECIPIENT_CODES = new Set([131026, 131049, 131051, 131053]);

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

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language || "en_US" },
      ...(Array.isArray(components) && components.length ? { components } : {}),
    },
  };

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
      const message = err.message || `HTTP ${res.status}`;
      return {
        ok: false,
        error: message,
        invalid: PERMANENT_RECIPIENT_CODES.has(code),
      };
    }

    const wamid = json?.messages?.[0]?.id || "";
    return { ok: true, providerMessageId: wamid };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
