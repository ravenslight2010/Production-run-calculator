import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "../../node_modules/.pnpm/node_modules/playwright/index.mjs";

const LEGACY_HTML = `<!doctype html>
<html lang="en"><head><title>V1 retained shell</title></head>
<body><main id="legacy-app">V1 retained shell</main></body></html>`;

const LEGACY_SERVICE_WORKER = `
const cacheName = "workbox-precache-v2-" + self.registration.scope;
const legacyHtml = ${JSON.stringify(LEGACY_HTML)};
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.put("/manifest.webmanifest", new Response('{"name":"V1 stale manifest"}', {
      headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
    }));
    await cache.put("/favicon.ico", new Response("<svg><title>V1 stale icon</title></svg>", {
      headers: { "Content-Type": "image/svg+xml" },
    }));
  })());
});
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.put("/", new Response(legacyHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));
    await caches.open("google-fonts-cache");
    await caches.open("gstatic-fonts-cache");
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  const pathname = new URL(event.request.url).pathname;
  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match("/")) || fetch(event.request);
    })());
    return;
  }
  if (!["/manifest.webmanifest", "/favicon.ico"].includes(pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(event.request)) || fetch(event.request);
  })());
});
`;

const V2_ASSETS = new Map([
  ["/", ["../web/index.html", "text/html; charset=utf-8"]],
  ["/v2/web/app-shell.html", ["../web/index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["../web/manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/v2/web/manifest.webmanifest", ["../web/manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/service-worker.js", ["../web/service-worker.js", "text/javascript; charset=utf-8"]],
  ["/favicon.ico", ["../web/favicon.svg", "image/svg+xml"]],
  ["/v2/web/favicon.svg", ["../web/favicon.svg", "image/svg+xml"]],
  ["/v2/web/app.js", ["../web/app.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/inventory.js", ["../web/inventory.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/styles.css", ["../web/styles.css", "text/css; charset=utf-8"]],
  ["/v2/web/write-gate.mjs", ["../web/write-gate.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/import-csv-templates.mjs", ["../core/import-csv-templates.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/station-workflows.mjs", ["../core/station-workflows.mjs", "text/javascript; charset=utf-8"]],
]);

test("V2 replaces the cached V1 shell without clearing browser data", { timeout: 60_000 }, async (t) => {
  let servedVersion = "v1";
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (servedVersion === "v1" && pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : LEGACY_HTML);
      return;
    }
    if (servedVersion === "v1" && pathname === "/service-worker.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : LEGACY_SERVICE_WORKER);
      return;
    }
    if (servedVersion === "v2" && pathname === "/api/v2/auth/session") {
      response.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "NOT_SIGNED_IN" }));
      return;
    }
    const asset = servedVersion === "v2" ? V2_ASSETS.get(pathname) : undefined;
    if (!asset || !["GET", "HEAD"].includes(request.method)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const contents = await readFile(new URL(asset[0], import.meta.url));
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Length": contents.byteLength,
        "Content-Type": asset[1],
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => new Promise((resolve) => server.close(resolve)));

  const browserPath = process.env.CHROMIUM_PATH
    || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  const browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ["--no-sandbox"] });
  t.after(() => browser.close());

  const context = await browser.newContext();
  const page = await context.newPage();
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  await context.addCookies([{ name: "preserve-session", value: "yes", url: baseUrl }]);
  await page.goto(baseUrl);
  await page.evaluate(async (legacyHtml) => {
    localStorage.setItem("v1-cache-migration", "preserve");
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("v1-cache-migration", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("state", "readwrite");
        transaction.objectStore("state").put("preserve", "sentinel");
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const unrelatedCache = await caches.open("unrelated-app-shell");
    await unrelatedCache.put("/", new Response(legacyHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  }, LEGACY_HTML);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.reload();
  await page.locator("#legacy-app").waitFor();

  const oldCacheState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return {
      names: await caches.keys(),
      v1Cache: `workbox-precache-v2-${registration.scope}`,
    };
  });
  assert.ok(oldCacheState.names.includes(oldCacheState.v1Cache));
  assert.ok(oldCacheState.names.includes("google-fonts-cache"));
  assert.ok(oldCacheState.names.includes("gstatic-fonts-cache"));
  assert.ok(oldCacheState.names.includes("unrelated-app-shell"));

  servedVersion = "v2";
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    await registration.update();
  });
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const names = await caches.keys();
    return names.includes("fieldline-v2-shell-6")
      && !names.includes(`workbox-precache-v2-${registration.scope}`)
      && !names.includes("google-fonts-cache")
      && !names.includes("gstatic-fonts-cache");
  });
  assert.ok((await page.evaluate(() => caches.keys())).includes("unrelated-app-shell"));
  const cachedShell = await page.evaluate(async () => (
    await (await caches.open("fieldline-v2-shell-6")).match("/")
  )?.text());
  assert.match(cachedShell ?? "", /Sign in to the floor/);
  const cachedRootAssets = await page.evaluate(async () => {
    const cache = await caches.open("fieldline-v2-shell-6");
    const manifest = await cache.match("/manifest.webmanifest");
    const icon = await cache.match("/favicon.ico");
    return {
      icon: await icon?.text(),
      manifest: await manifest?.text(),
    };
  });
  assert.match(cachedRootAssets.manifest ?? "", /Fieldline Production Floor/);
  assert.match(cachedRootAssets.icon ?? "", /FF9500/i);

  await page.reload();
  await page.waitForFunction(() => document.title === "Run control — Fieldline");
  const preservedData = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("v1-cache-migration", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const stored = await new Promise((resolve, reject) => {
      const request = database.transaction("state").objectStore("state").get("sentinel");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return {
      cookie: document.cookie,
      indexedDb: stored,
      localStorage: localStorage.getItem("v1-cache-migration"),
    };
  });
  assert.deepEqual(preservedData, {
    cookie: "preserve-session=yes",
    indexedDb: "preserve",
    localStorage: "preserve",
  });

  await context.setOffline(true);
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.title === "Run control — Fieldline");
  assert.equal(await page.locator("#legacy-app").count(), 0);
  await context.close();
});
