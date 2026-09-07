/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { parsePushAlertPayload } from "./pushPayload";
import { claimAlertReceipt } from "./alertReceipts";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
self.addEventListener("install", () => { void self.skipWaiting(); });

// Retain the runtime font behavior from the previous generated worker.
registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({ cacheName: "google-fonts-cache", plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 })] }),
);
registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({ cacheName: "gstatic-fonts-cache", plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 })] }),
);

async function tellClients(alertId: string): Promise<void> {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: "alert-receipt", alertId }));
}

self.addEventListener("push", (event) => {
  let raw: unknown;
  try { raw = event.data?.json(); } catch { return; }
  const payload = parsePushAlertPayload(raw);
  if (!payload) return;
  event.waitUntil((async () => {
    // A local fallback can fire while offline. When its queued server push is
    // delivered later, the shared receipt store makes this a receipt only.
    if (!await claimAlertReceipt(payload.alertId)) {
      await tellClients(payload.alertId);
      return;
    }
    await Promise.all([
      tellClients(payload.alertId),
      self.registration.showNotification("Production Run Calculator", {
      // Do not put server alert details on a lock screen; details remain in-app.
      body: "A production alert needs your attention. Open the app for details.",
      icon: "pwa-192x192.png",
      badge: "pwa-64x64.png",
      tag: `alert-${payload.alertId}`,
      data: payload,
      }),
    ]);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const payload = parsePushAlertPayload(event.notification.data);
  const target = new URL(payload?.url ?? "/", self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const match = clients.find((client) => "focus" in client) as WindowClient | undefined;
    if (match) {
      await match.focus();
      match.postMessage({ type: "alert-receipt", alertId: payload?.alertId });
      return;
    }
    await self.clients.openWindow(target);
  })());
});