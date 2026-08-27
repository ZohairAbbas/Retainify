import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

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
    return { ok: false, error: err.message };
  }
}
