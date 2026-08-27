/**
 * The storefront service worker, served as JavaScript.
 *
 * The notificationclick handler reports back to /track/push-click before opening
 * the target URL, which is what gives PushJob.clickedAt a real value. The report
 * is wrapped in the same waitUntil as the window open so the worker isn't killed
 * mid-beacon, and it never blocks navigation: if the beacon fails the shopper
 * still lands on the page.
 */
const SW_SOURCE = `
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Notification", {
      body: data.body || "",
      icon: data.icon || "/favicon.ico",
      data: { url: data.url || "/", jobId: data.jobId || "", trackUrl: data.trackUrl || "" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const info = event.notification.data || {};

  const report = info.jobId && info.trackUrl
    ? fetch(info.trackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: info.jobId }),
        keepalive: true,
        // The endpoint is on the app domain, not the storefront's.
        mode: "cors",
      }).catch(() => {})
    : Promise.resolve();

  // Open the destination regardless of whether the beacon lands — analytics
  // must never stand between a shopper and the page they tapped for.
  event.waitUntil(
    Promise.all([report, clients.openWindow(info.url || "/")]),
  );
});
`.trim();

export const loader = () => {
  return new Response(SW_SOURCE, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    },
  });
};
