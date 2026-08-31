import { Resend } from "resend";
import { OPS, PERMANENT, TRANSIENT } from "../journey/failure-policy.server.js";

/**
 * Resend's error `name` values, mapped to how the queue should react.
 *
 * Keyed on the machine-readable name rather than the message: the message is
 * English prose Resend can reword at any time, and the old code's only record
 * of a failure was that prose. `daily_quota_exceeded` is the one that matters
 * most — it accounted for 20,564 of this database's 20,578 dead jobs.
 */
const RESEND_ERROR_CLASS = {
  // Capacity — resolves on its own.
  daily_quota_exceeded: TRANSIENT,
  rate_limit_exceeded: TRANSIENT,
  too_many_requests: TRANSIENT,
  application_error: TRANSIENT,
  internal_server_error: TRANSIENT,

  // Our configuration is broken; the send itself is fine.
  suspended_api_key: OPS,
  restricted_api_key: OPS,
  invalid_api_key: OPS,
  missing_api_key: OPS,
  not_found: OPS,
  invalid_from_address: OPS,
  // Domain not verified — the merchant or we must act; no retry will fix it.
  invalid_sender: OPS,

  // The request or recipient is wrong and always will be.
  validation_error: PERMANENT,
  invalid_to_address: PERMANENT,
  invalid_attachment: PERMANENT,
  invalid_scope: PERMANENT,
};

/** HTTP status fallback when Resend sends a name we do not know yet. */
function classFromStatus(status) {
  if (status === 429) return TRANSIENT;
  if (status >= 500) return TRANSIENT;
  if (status === 401 || status === 403) return OPS;
  if (status >= 400) return PERMANENT;
  return TRANSIENT;
}

/**
 * Decide how a Resend failure should be treated.
 *
 * Exported so the mapping can be unit-tested against the failures this database
 * actually recorded, without sending live mail to find out.
 * Unknown names fall back to the status code, and an absent status falls back
 * to TRANSIENT — retrying an unrecognised failure is recoverable, discarding a
 * send is not.
 */
export function classifyResendError(error) {
  const name = error?.name || "";
  if (RESEND_ERROR_CLASS[name]) return RESEND_ERROR_CLASS[name];
  return classFromStatus(Number(error?.statusCode) || 0);
}

let _client = null;

function getClient() {
  if (!_client) {
    // eslint-disable-next-line no-undef
    _client = new Resend(process.env.RESEND_API_KEY);
  }
  return _client;
}

/**
 * @param {import('./adapter.server.js').SendEmailOptions} options
 * @returns {Promise<import('./adapter.server.js').SendEmailResult>}
 */
export async function sendEmail({
  to,
  from,
  replyTo,
  subject,
  html,
  text,
  headers,
  idempotencyKey,
}) {
  try {
    const client = getClient();
    const { data, error } = await client.emails.send(
      {
        from,
        to,
        // Resend SDK v6 expects camelCase `replyTo` (it maps to the API's `reply_to`
        // internally). Passing snake_case here is silently dropped → no Reply-To header.
        replyTo: replyTo || undefined,
        subject,
        html,
        // text/plain alternative — omitted rather than sent empty so Resend
        // doesn't attach a blank part.
        ...(text ? { text } : {}),
        // List-Unsubscribe / List-Unsubscribe-Post ride here.
        ...(headers && Object.keys(headers).length ? { headers } : {}),
      },
      // Sent as the Idempotency-Key header. A worker retry after a timeout that
      // actually succeeded upstream would otherwise deliver the email twice.
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    if (error) {
      return {
        ok: false,
        error: error.message,
        errorClass: classifyResendError(error),
        errorCode: error.name || "",
      };
    }

    return { ok: true, providerMessageId: data?.id ?? "" };
  } catch (err) {
    // A throw here is the SDK or the network, never a rejection of the message
    // itself — so it is retryable by definition.
    return { ok: false, error: err.message, errorClass: TRANSIENT, errorCode: err.name || "" };
  }
}
