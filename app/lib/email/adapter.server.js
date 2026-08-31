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
 * @property {string} [text]      - text/plain alternative. Always supply one for
 *                                  marketing sends: HTML-only is a spam signal.
 * @property {Record<string,string>} [headers]
 *                                - extra MIME headers. Carries List-Unsubscribe
 *                                  and List-Unsubscribe-Post, which Gmail and
 *                                  Yahoo require from bulk senders.
 * @property {string} [idempotencyKey]
 *                                - stable per logical send (we use JourneyJob.id)
 *                                  so a retried job cannot double-deliver.
 */

/**
 * @typedef {Object} SendEmailResult
 * @property {boolean} ok
 * @property {string}  [providerMessageId]
 * @property {string}  [error]
 * @property {"permanent"|"transient"|"ops"} [errorClass]
 *                                - how the caller should treat the failure. Set
 *                                  by the adapter, because only the adapter
 *                                  understands its provider's error vocabulary.
 *                                  Classifying here rather than by matching
 *                                  message text in the worker means a provider
 *                                  rewording its prose cannot silently turn a
 *                                  retryable failure into a discarded send.
 *                                  See lib/journey/failure-policy.server.js.
 * @property {string}  [errorCode] - the provider's own code, kept for logging
 *                                  and for diagnosing misclassification.
 */

/**
 * @param {SendEmailOptions} _options
 * @returns {Promise<SendEmailResult>}
 */
export async function sendEmail(_options) {
  throw new Error("sendEmail not implemented — use a concrete adapter");
}
