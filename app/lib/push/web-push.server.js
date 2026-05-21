import webpush from "web-push";

webpush.setVapidDetails(
  process.env.VAPID_MAILTO || "mailto:admin@retainify.app",
  process.env.VAPID_PUBLIC_KEY || "",
  process.env.VAPID_PRIVATE_KEY || "",
);

/**
 * @param {import('./adapter.server.js').PushTarget} target
 * @param {import('./adapter.server.js').PushPayload} payload
 * @returns {Promise<import('./adapter.server.js').PushResult>}
 */
export async function sendPushNotification(target, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message, gone: err.statusCode === 410 };
  }
}
