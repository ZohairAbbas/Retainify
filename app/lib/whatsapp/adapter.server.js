/**
 * WhatsApp channel adapter contract (typedefs only — mirrors email/push).
 *
 * @typedef {Object} SendWhatsappOptions
 * @property {string} phoneNumberId - The shop's WABA phone number ID (Graph API path segment).
 * @property {string} accessToken   - Decrypted long-lived WABA token.
 * @property {string} to            - Recipient phone in E.164 (no leading "+").
 * @property {string} templateName  - Meta-approved HSM template name.
 * @property {string} language      - Template language code, e.g. "en_US".
 * @property {Array<object>} [components] - Meta `components` array (body params, buttons, header media).
 *
 * @typedef {Object} SendWhatsappResult
 * @property {boolean} ok
 * @property {string} [providerMessageId] - Meta wamid; matched by the status webhook.
 * @property {string} [error]
 * @property {boolean} [invalid] - Permanent recipient failure (bad/unreachable number) → suppress.
 */
export {};
