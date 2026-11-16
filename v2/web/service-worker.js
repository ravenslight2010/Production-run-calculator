const CACHE_NAME = "fieldline-v2-shell-3";
const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/v2/web/styles.css",
  "/v2/web/write-gate.mjs",
  "/v2/web/app.js",
  "/v2/web/inventory.js",
  "/v2/core/import-csv-templates.mjs",
  "/v2/core/station-workflows.mjs",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("fieldline-v2-shell-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (
      (await caches.match("/")) || Response.error()
    )));
    return;
  }

  if (!SHELL_URLS.includes(url.pathname)) return;
  event.respondWith(caches.match(request).then(async (cached) => {
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return Response.error();
    }
  }));
});
