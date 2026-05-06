/**
 * EmailAdapter interface — every channel implementation must satisfy this shape.
 * Swap the implementation by changing the export in index.server.js.
 */

/**
 * @typedef {Object} SendEmailOptions
 * @property {string} to
 * @property {string} from        - "Name <email@domain.com>"
 * @property {string} replyTo
 * @property {string} subject
 * @property {string} html
 * @property {string} [messageId] - idempotency key
 */

/**
 * @typedef {Object} SendEmailResult
 * @property {boolean} ok
 * @property {string}  [providerMessageId]
 * @property {string}  [error]
 */

/**
 * @param {SendEmailOptions} _options
 * @returns {Promise<SendEmailResult>}
 */
export async function sendEmail(_options) {
  throw new Error("sendEmail not implemented — use a concrete adapter");
}
