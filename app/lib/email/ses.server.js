import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { OPS, PERMANENT, TRANSIENT } from "../journey/failure-policy.server.js";

/**
 * SES exception names, mapped to how the queue should react. The AWS SDK puts
 * the API's error code on err.name, so this keys on the same machine-readable
 * signal as the Resend adapter rather than on message text.
 */
const SES_ERROR_CLASS = {
  // Capacity and throttling — resolve on their own.
  TooManyRequestsException: TRANSIENT,
  Throttling: TRANSIENT,
  ThrottlingException: TRANSIENT,
  ServiceUnavailable: TRANSIENT,
  InternalServiceErrorException: TRANSIENT,
  LimitExceededException: TRANSIENT,
  TimeoutError: TRANSIENT,

  // Our account or identity configuration — a human must fix it, and the queued
  // work should survive until they do. The observed cases were an unverified
  // sending identity and an IAM policy missing ses:SendEmail.
  AccountSuspendedException: OPS,
  MailFromDomainNotVerifiedException: OPS,
  MessageRejected: OPS,
  NotFoundException: OPS,
  AccessDeniedException: OPS,
  UnrecognizedClientException: OPS,
  InvalidClientTokenId: OPS,
  SendingPausedException: OPS,

  // The request itself is malformed; retrying changes nothing.
  BadRequestException: PERMANENT,
  InvalidParameterValue: PERMANENT,
  ValidationException: PERMANENT,
};

/** Exported for unit tests — see classifyResendError. */
export function classifySesError(err) {
  const name = err?.name || "";
  if (SES_ERROR_CLASS[name]) return SES_ERROR_CLASS[name];

  const status = Number(err?.$metadata?.httpStatusCode) || 0;
  if (status === 429) return TRANSIENT;
  if (status >= 500) return TRANSIENT;
  if (status === 401 || status === 403) return OPS;
  if (status >= 400) return PERMANENT;
  // Unknown: retry rather than discard.
  return TRANSIENT;
}

let _client = null;

function getClient() {
  if (!_client) {
    _client = new SESv2Client({
      // eslint-disable-next-line no-undef
      region: process.env.AWS_REGION || "us-east-1",
      // Credentials are picked up from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
      // by the SDK's default provider chain — no need to pass them explicitly.
    });
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
}) {
  try {
    const client = getClient();

    // SESv2 takes custom headers as a list of {Name, Value} on the Simple
    // message. Note SES rejects headers it manages itself, so only pass the
    // List-Unsubscribe pair we actually set.
    const headerList = Object.entries(headers || {}).map(([Name, Value]) => ({
      Name,
      Value: String(Value),
    }));

    const command = new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      ReplyToAddresses: replyTo ? [replyTo] : undefined,
      // Attach the configuration set so open/click/bounce/complaint events are
      // published to SNS and ingested by /webhooks/ses.
      // eslint-disable-next-line no-undef
      ConfigurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: html, Charset: "UTF-8" },
            ...(text ? { Text: { Data: text, Charset: "UTF-8" } } : {}),
          },
          ...(headerList.length ? { Headers: headerList } : {}),
        },
      },
    });

    const response = await client.send(command);
    return { ok: true, providerMessageId: response.MessageId ?? "" };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      errorClass: classifySesError(err),
      errorCode: err?.name || "",
    };
  }
}
