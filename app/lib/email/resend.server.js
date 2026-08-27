import { Resend } from "resend";

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
      return { ok: false, error: error.message };
    }

    return { ok: true, providerMessageId: data?.id ?? "" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
