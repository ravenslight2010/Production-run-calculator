const CACHE_NAME = "fieldline-v2-shell-6";
const SHELL_ASSETS = [
  // V1's active Workbox worker can intercept shared root URLs during install.
  // Fetch V2-only aliases, then store them under the canonical app URLs.
  ["/v2/web/app-shell.html", "/"],
  ["/v2/web/manifest.webmanifest", "/manifest.webmanifest"],
  ["/v2/web/favicon.svg", "/favicon.ico"],
  ["/v2/web/styles.css", "/v2/web/styles.css"],
  ["/v2/web/write-gate.mjs", "/v2/web/write-gate.mjs"],
  ["/v2/web/app.js", "/v2/web/app.js"],
  ["/v2/web/inventory.js", "/v2/web/inventory.js"],
  ["/v2/web/setup-catalog.js", "/v2/web/setup-catalog.js"],
  ["/v2/core/import-csv-templates.mjs", "/v2/core/import-csv-templates.mjs"],
  ["/v2/core/import-csv.mjs", "/v2/core/import-csv.mjs"],
  ["/v2/core/setup-catalog-csv.mjs", "/v2/core/setup-catalog-csv.mjs"],
  ["/v2/core/station-workflows.mjs", "/v2/core/station-workflows.mjs"],
];
const SHELL_URLS = new Set(SHELL_ASSETS.map(([, cacheUrl]) => cacheUrl));
const LEGACY_V1_CACHE_NAMES = new Set([
  `workbox-precache-v2-${self.registration.scope}`,
  "google-fonts-cache",
  "gstatic-fonts-cache",
]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL_ASSETS.map(async ([sourceUrl, cacheUrl]) => {
      const response = await fetch(sourceUrl, { cache: "reload" });
      if (!response.ok) throw new Error(`Could not cache the V2 shell asset ${sourceUrl}.`);
      await cache.put(cacheUrl, response);
    }));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => (
          (key.startsWith("fieldline-v2-shell-") && key !== CACHE_NAME)
          || LEGACY_V1_CACHE_NAMES.has(key)
        )).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (
      (await (await caches.open(CACHE_NAME)).match("/")) || Response.error()
    )));
    return;
  }

  if (!SHELL_URLS.has(url.pathname)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return Response.error();
    }
  }));
});
