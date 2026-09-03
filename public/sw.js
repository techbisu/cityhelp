/**
 * CityHelp Service Worker
 * Handles web push notifications for the provider PWA.
 *
 * Push payload (sent by /lib/push.ts):
 *   { title, body, tag, data: { orderId, providerId }, actions: [{action, title}] }
 *
 * Action handlers:
 *   "accept" → opens /?view=provider and triggers accept
 *   "reject" → fires reject API call
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "CityHelp", body: event.data ? event.data.text() : "New notification" };
  }
  const title = payload.title || "CityHelp";
  const options = {
    body: payload.body || "",
    icon: "/logo.svg",
    badge: "/logo.svg",
    tag: payload.tag || "cityhelp",
    data: payload.data || {},
    actions: payload.actions || [],
    requireInteraction: true,
    vibrate: [400, 200, 400, 200, 400],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { action, data } = event.notification;
  if (action === "accept" && data.orderId && data.providerId) {
    // Fire accept API call
    event.waitUntil(
      fetch(`/api/orders/${data.orderId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: data.providerId }),
      }).then(() => self.clients.openWindow("/?view=provider"))
    );
  } else if (action === "reject" && data.orderId && data.providerId) {
    event.waitUntil(
      fetch(`/api/orders/${data.orderId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: data.providerId }),
      })
    );
  } else {
    event.waitUntil(self.clients.openWindow("/?view=provider"));
  }
});
