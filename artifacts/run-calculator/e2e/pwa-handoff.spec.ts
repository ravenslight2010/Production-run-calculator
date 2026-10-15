/**
 * Two-version PWA release smoke test.
 *
 * This exercises the deployed-browser behavior that unit tests cannot:
 *  1. a first (old) production build owns an open tab;
 *  2. the same origin starts serving a changed worker;
 *  3. foregrounding activates the new worker without claiming or reloading the
 *     active tab;
 *  4. the single persistent update prompt remains while unsafe work blocks;
 *  5. after the calculator becomes safe and stays inactive, the worker update
 *     path automatically reloads into the new build.
 *
 * The fixture intentionally serves real `vite build` output. It does not use
 * the main Playwright configuration because that suite prepares database-backed
 * live-run scenarios; this PWA handoff path must be safe to run with no API or
 * database at all:
 *
 *   pnpm --filter @workspace/run-calculator run test:pwa-handoff
 */

import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { canonicalSyncJson } from "@workspace/sync-contract";
import {
  mkdtemp,
  cp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot =
  process.env.PWA_HANDOFF_PACKAGE_ROOT?.trim() ||
  path.resolve(import.meta.dirname, "..");

type Version = "old" | "new";

function mimeType(filePath: string) {
  const extension = path.extname(filePath);
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".woff2": "font/woff2",
    }[extension] ?? "application/octet-stream"
  );
}

function safeRequestPath(requestUrl: string | undefined) {
  const pathname = new URL(requestUrl ?? "/", "http://pwa-smoke.test").pathname;
  const normalized = path.posix.normalize(pathname);
  if (normalized.startsWith("../") || normalized.includes("/../")) return null;
  return normalized === "/" ? "index.html" : normalized.replace(/^\/+/, "");
}

async function stampBuild(buildDir: string, version: Version) {
  const indexPath = path.join(buildDir, "index.html");
  const workerPath = path.join(buildDir, "service-worker.js");
  const index = await readFile(indexPath, "utf8");
  const worker = await readFile(workerPath, "utf8");
  const stampedIndex = index.replace(
    /<body(?:\s[^>]*)?>/,
    (tag) => `${tag.slice(0, -1)} data-pwa-smoke-build="${version}">`,
  );
  const indexRevision = createHash("sha256").update(stampedIndex).digest("hex");
  const stampedWorker = worker.replace(
    /"revision":"[^"]+","url":"index\.html"/,
    `"revision":"${indexRevision}","url":"index.html"`,
  );
  if (stampedWorker === worker) {
    throw new Error("The PWA fixture could not stamp index.html's precache revision");
  }

  // A marker in the actual document proves which production revision loaded
  // after activation. A distinct precache revision makes Workbox fetch that
  // changed document, just as it would for two real Vite builds. The worker
  // comment makes its own script bytes differ too.
  await writeFile(indexPath, stampedIndex);
  await writeFile(
    workerPath,
    `${stampedWorker}\n// pwa-handoff-smoke:${version}\n`,
  );
}

async function divergeHomeChunk(buildDir: string) {
  const assetsDir = path.join(buildDir, "assets");
  const assetNames = await readdir(assetsDir);
  const oldName = assetNames.find((name) => /^home-[\w-]+\.js$/.test(name));
  if (!oldName) throw new Error("The PWA fixture could not find Home's lazy chunk");
  const newName = oldName.replace(/\.js$/, "-current.js");
  await rename(path.join(assetsDir, oldName), path.join(assetsDir, newName));

  const files = [
    path.join(buildDir, "index.html"),
    path.join(buildDir, "service-worker.js"),
    ...(await readdir(assetsDir))
      .filter((name) => name.endsWith(".js"))
      .map((name) => path.join(assetsDir, name)),
  ];
  await Promise.all(files.map(async (file) => {
    const source = await readFile(file, "utf8");
    if (source.includes(oldName)) {
      await writeFile(file, source.replaceAll(oldName, newName));
    }
  }));
  return oldName;
}

async function buildTwoVersionFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "run-calculator-pwa-handoff-"));
  try {
    const builtSite = path.join(root, "built");
    // Build into this fixture's own directory. A full release browser run
    // serves dist/public at the same time; rebuilding there can temporarily
    // erase its JS chunks and make unrelated pages receive HTML for scripts.
    await execFileAsync("pnpm", [
      "exec", "vite", "build", "--config", "vite.config.ts", "--outDir", builtSite,
    ], {
      cwd: packageRoot,
      // Production uses one minute. Keep the exact policy path while making this
      // two-version browser fixture finish promptly.
      env: { ...process.env, VITE_UPDATE_RELOAD_IDLE_MS: "1000" },
      maxBuffer: 10 * 1024 * 1024,
    });
    await Promise.all([
      stat(path.join(builtSite, "index.html")),
      stat(path.join(builtSite, "service-worker.js")),
      stat(path.join(builtSite, "favicon.ico")),
    ]);
    const oldDir = path.join(root, "old");
    const newDir = path.join(root, "new");
    await cp(builtSite, oldDir, { recursive: true });
    await cp(builtSite, newDir, { recursive: true });
    await Promise.all([stampBuild(oldDir, "old"), stampBuild(newDir, "new")]);
    const staleHomeChunk = await divergeHomeChunk(newDir);
    return { root, oldDir, newDir, staleHomeChunk };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function startVersionedServer(
  versionDirs: Record<Version, string>,
  staleHomeChunk?: string,
  options: {
    sessionRecovery?: boolean;
    sessionRecoveryIntentOutbox?: boolean;
  } = {},
) {
  let currentVersion: Version = "old";
  let staleAssetFailureArmed = false;
  let staleAssetRequestCount = 0;
  let sessionValid = true;
  let temporarySessionProbeFailuresRemaining = 0;
  const sessionRecoveryRequests = {
    me: 0,
    temporaryMeFailures: 0,
    syncReads: 0,
    syncWrites: 0,
    rejected: 0,
    acceptedWrites: 0,
    intentPosts: 0,
    intentApplications: 0,
    signIns: 0,
  };
  const intentRequestIds: string[] = [];
  const appliedIntentIds: string[] = [];
  const fixtureErrors: string[] = [];
  let releaseIntentAuthResponse: (() => void) | undefined;
  const intentAuthResponseGate = new Promise<void>((resolve) => {
    releaseIntentAuthResponse = resolve;
  });
  const sessionEventStreams = new Set<ServerResponse>();
  const sessionUser = {
    userId: "pwa-session-user",
    role: "operator",
    capabilities: [],
    email: null,
    name: "PWA Session",
    onboardingSeen: true,
    tourCompleted: true,
    floorModeEnabled: false,
    notificationPrefs: {},
    sandbox: false,
    sandboxCopiedAt: null,
    sandboxStale: false,
    disabled: false,
  };
  const oldIndex = await readFile(path.join(versionDirs.old, "index.html"), "utf8");
  const entryScript = oldIndex.match(/<script[^>]+src="\/?([^"]+\.js)"/)?.[1];
  if (!entryScript) throw new Error("The PWA fixture could not find the entry script");
  const server = createServer(async (request, response) => {
    try {
      const requestPath = safeRequestPath(request.url);
      if (!requestPath) {
        response.writeHead(400).end("Invalid path");
        return;
      }

      // Mount the real Home calculator without a database. Unmatched API
      // requests return JSON errors rather than the SPA document, which could
      // otherwise be parsed as JavaScript by callers expecting a JSON response.
      if (options.sessionRecovery && requestPath === "api/me") {
        sessionRecoveryRequests.me += 1;
        if (!sessionValid) {
          sessionRecoveryRequests.rejected += 1;
          response
            .writeHead(401, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Unauthorized", reason: "session_expired" }));
          return;
        }
        if (temporarySessionProbeFailuresRemaining > 0) {
          temporarySessionProbeFailuresRemaining -= 1;
          sessionRecoveryRequests.temporaryMeFailures += 1;
          response
            .writeHead(503, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Temporarily unavailable" }));
          return;
        }
        response
          .writeHead(200, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify(sessionUser));
        return;
      }
      if (options.sessionRecoveryIntentOutbox && requestPath === "api/auth/sign-in") {
        let rawBody = "";
        for await (const chunk of request) rawBody += chunk;
        const credentials = JSON.parse(rawBody || "{}") as {
          username?: string;
          password?: string;
        };
        if (
          credentials.username !== "pwa-session-user"
          || credentials.password !== "disposable-fixture"
        ) {
          response
            .writeHead(401, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Invalid username or password" }));
          return;
        }
        sessionValid = true;
        sessionRecoveryRequests.signIns += 1;
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": "rc_auth=disposable-fixture-session; Path=/; HttpOnly; SameSite=Lax",
        }).end(JSON.stringify({ token: "disposable-fixture-token", user: sessionUser }));
        return;
      }
      if (
        options.sessionRecovery
        && requestPath === "api/sync/operational-intents"
        && request.method === "POST"
      ) {
        let rawBody = "";
        for await (const chunk of request) rawBody += chunk;
        const payload = JSON.parse(rawBody || "{}") as {
          intent?: { id?: string };
        };
        sessionRecoveryRequests.intentPosts += 1;
        if (payload.intent?.id) intentRequestIds.push(payload.intent.id);
        if (!sessionValid) {
          // Hold the command's auth failure until the independent /me probe
          // signs the operator out. This exercises the late-response fence.
          if (options.sessionRecoveryIntentOutbox) await intentAuthResponseGate;
          sessionRecoveryRequests.rejected += 1;
          response
            .writeHead(401, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Unauthorized", reason: "session_expired" }));
          return;
        }
        sessionRecoveryRequests.intentApplications += 1;
        if (payload.intent?.id) appliedIntentIds.push(payload.intent.id);
        response
          .writeHead(200, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify({ outcome: "accepted" }));
        return;
      }
      if (options.sessionRecovery && requestPath === "api/sync/events") {
        if (!sessionValid) {
          sessionRecoveryRequests.rejected += 1;
          response
            .writeHead(401, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Unauthorized", reason: "session_expired" }));
          return;
        }
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        sessionEventStreams.add(response);
        response.once("close", () => sessionEventStreams.delete(response));
        response.write(": pwa session fixture connected\n\n");
        return;
      }
      if (options.sessionRecovery && requestPath === "api/sync/today") {
        if (!sessionValid) {
          sessionRecoveryRequests.rejected += 1;
          response
            .writeHead(401, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Unauthorized", reason: "session_expired" }));
          return;
        }
        const method = request.method ?? "GET";
        if (method === "GET") {
          sessionRecoveryRequests.syncReads += 1;
          const url = new URL(request.url ?? "/", "http://pwa-smoke.test");
          const requestedDate = url.searchParams.get("today");
          const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
            ? requestedDate
            : new Date().toISOString().slice(0, 10);
          const run = {
            id: "pwa-session-reconnect-run",
            brand: "Offline",
            flavor: "Session",
            startedAt: 1_000,
          };
          const canonical = {
            syncVersion: 1,
            completeness: "complete",
            dayState: { date, runs: [run], currentIndex: 0 },
            runValues: { [run.id]: {} },
          };
          const snapshotId = createHash("sha256")
            .update(canonicalSyncJson(canonical))
            .digest("hex");
          response.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-sync-response": "complete",
            "x-sync-snapshot": snapshotId,
            "x-sync-canonical-revision": "0",
            "x-sync-server-time": String(Date.now()),
          }).end(JSON.stringify({
            ...canonical,
            resetEpoch: 0,
            rollover: false,
            canonicalRevision: 0,
            serverTime: Date.now(),
          }));
          return;
        }
        if (method === "PUT") {
          sessionRecoveryRequests.syncWrites += 1;
          sessionRecoveryRequests.acceptedWrites += 1;
          response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ ok: true, data: null }));
          return;
        }
      }
      if (requestPath === "api/me") {
        response
          .writeHead(200, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify({
            userId: "pwa-smoke-user",
            role: "operator",
            capabilities: [],
            email: null,
            name: "PWA Smoke",
            onboardingSeen: true,
            tourCompleted: true,
            floorModeEnabled: false,
            notificationPrefs: {},
            sandbox: false,
            sandboxCopiedAt: null,
            sandboxStale: false,
          }));
        return;
      }
      if (requestPath === "api" || requestPath.startsWith("api/")) {
        response
          .writeHead(404, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify({ error: "API endpoint not found" }));
        return;
      }

      const root = versionDirs[currentVersion];
      const candidate = path.join(root, requestPath);
      const withinRoot =
        candidate === root || candidate.startsWith(`${root}${path.sep}`);
      const target =
        withinRoot && (await stat(candidate).catch(() => null))?.isFile()
          ? candidate
          : path.join(root, "index.html");
      const content = await readFile(target);
      if (
        staleAssetFailureArmed
        && currentVersion === "old"
        && requestPath === entryScript
      ) {
        // Finish serving the old entry bundle, then deploy the new release
        // before its lazy Home import. The removed old Home filename now falls
        // through to new index.html with text/html, matching the production
        // failure this recovery path handles.
        currentVersion = "new";
      }
      if (
        staleAssetFailureArmed
        && currentVersion === "new"
        && staleHomeChunk
        && requestPath === `assets/${staleHomeChunk}`
      ) {
        staleAssetRequestCount += 1;
      }
      const headers: Record<string, string> = {
        "content-type": mimeType(target),
        // The browser must revalidate the worker when focus triggers
        // registration.update(); application assets can be read fresh too.
        "cache-control": target.endsWith("service-worker.js") ? "no-cache" : "no-store",
      };
      // Keep the revision marker on every document response, including a
      // document returned after a service-worker handoff. This makes the
      // fixture's revision assertion independent of whether the response came
      // from the current static tree or a cached HTML response.
      const bodyContent =
        target.endsWith("index.html")
          ? content
              .toString()
              .replace(
                /<body(?:\s[^>]*)?>/,
                `<body data-pwa-smoke-build="${currentVersion}">`,
              )
              .replace(
                /<\/body>/,
                `<script>document.body.dataset.pwaSmokeBuild="${currentVersion}";</script></body>`,
              )
          : content;
      if (target.endsWith("service-worker.js")) headers["service-worker-allowed"] = "/";
      response.writeHead(200, headers).end(bodyContent);
    } catch (error) {
      fixtureErrors.push(error instanceof Error ? error.message : String(error));
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Fixture server failed");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("PWA handoff fixture did not bind a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    publish(version: Version) {
      currentVersion = version;
    },
    armStaleAssetFailure() {
      staleAssetFailureArmed = true;
    },
    staleAssetRequestCount() {
      return staleAssetRequestCount;
    },
    setSessionValid(valid: boolean) {
      sessionValid = valid;
    },
    failNextSessionProbes(count: number) {
      temporarySessionProbeFailuresRemaining = count;
    },
    dropSessionEventStreams() {
      for (const stream of sessionEventStreams) stream.destroy();
      sessionEventStreams.clear();
    },
    sessionRecoveryRequests() {
      return {
        ...sessionRecoveryRequests,
        intentRequestIds: [...intentRequestIds],
        appliedIntentIds: [...appliedIntentIds],
      };
    },
    fixtureErrors() {
      return [...fixtureErrors];
    },
    releaseIntentAuthResponse() {
      releaseIntentAuthResponse?.();
    },
    async close() {
      // Browser keep-alive sockets can otherwise keep Node's close callback
      // pending after an assertion failure.
      releaseIntentAuthResponse?.();
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test.describe("PWA update handoff", () => {
  let fixture: Awaited<ReturnType<typeof buildTwoVersionFixture>>;

  test.beforeAll(async () => {
    // Building a real worker can exceed the default 60-second test timeout
    // when the full release suite is also running other services.
    test.setTimeout(180_000);
    fixture = await buildTwoVersionFixture();
  });

  test.afterAll(async () => {
    if (fixture) await rm(fixture.root, { recursive: true, force: true });
  });

  test("decodes HTML-linked Apple touch icon and SVG favicon from the production build", async ({
    page,
  }) => {
    const server = await startVersionedServer({
      old: fixture.oldDir,
      new: fixture.newDir,
    });

    try {
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      const linkedIcons = await page.evaluate(async () => {
        function requiredLink(selector: string, description: string) {
          const link = document.querySelector<HTMLLinkElement>(selector);
          if (!link) throw new Error(`Production HTML is missing its ${description} link`);
          return link.href;
        }

        async function decodeImage(blob: Blob) {
          const objectUrl = URL.createObjectURL(blob);
          try {
            const image = new Image();
            image.src = objectUrl;
            await image.decode();
            return {
              width: image.naturalWidth,
              height: image.naturalHeight,
            };
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
        }

        const appleTouchUrl = requiredLink(
          'link[rel~="apple-touch-icon"]',
          "Apple touch icon",
        );
        const appleTouchResponse = await fetch(appleTouchUrl);
        if (!appleTouchResponse.ok) {
          throw new Error(`Apple touch icon request failed: ${appleTouchResponse.status}`);
        }
        const appleTouchContentType = appleTouchResponse.headers.get("content-type");
        if (!/^image\/png\b/i.test(appleTouchContentType ?? "")) {
          throw new Error(`Apple touch icon has unexpected content type: ${appleTouchContentType}`);
        }
        const appleTouchBytes = new Uint8Array(await appleTouchResponse.arrayBuffer());
        const pngSignature = [
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ].every((byte, index) => appleTouchBytes[index] === byte);
        if (!pngSignature || appleTouchBytes.length < 24) {
          throw new Error("Apple touch icon is not a complete PNG");
        }
        const pngHeader = new DataView(
          appleTouchBytes.buffer,
          appleTouchBytes.byteOffset,
          appleTouchBytes.byteLength,
        );
        if (pngHeader.getUint32(12) !== 0x49484452) {
          throw new Error("Apple touch icon PNG is missing its IHDR chunk");
        }
        const appleTouchHeaderWidth = pngHeader.getUint32(16);
        const appleTouchHeaderHeight = pngHeader.getUint32(20);
        const appleTouchDecoded = await decodeImage(
          new Blob([appleTouchBytes], { type: appleTouchContentType }),
        );

        const faviconUrl = requiredLink(
          'link[rel~="icon"][type="image/svg+xml"]',
          "SVG favicon",
        );
        const faviconResponse = await fetch(faviconUrl);
        if (!faviconResponse.ok) {
          throw new Error(`SVG favicon request failed: ${faviconResponse.status}`);
        }
        const faviconContentType = faviconResponse.headers.get("content-type");
        if (!/^image\/svg\+xml\b/i.test(faviconContentType ?? "")) {
          throw new Error(`SVG favicon has unexpected content type: ${faviconContentType}`);
        }
        const faviconMarkup = await faviconResponse.text();
        const parsedFavicon = new DOMParser().parseFromString(
          faviconMarkup,
          "image/svg+xml",
        );
        if (
          parsedFavicon.querySelector("parsererror")
          || parsedFavicon.documentElement.localName !== "svg"
          || parsedFavicon.documentElement.namespaceURI !== "http://www.w3.org/2000/svg"
        ) {
          throw new Error("SVG favicon is not valid SVG markup");
        }
        const faviconDecoded = await decodeImage(
          new Blob([faviconMarkup], { type: faviconContentType }),
        );

        return {
          appleTouch: {
            pathname: new URL(appleTouchUrl).pathname,
            status: appleTouchResponse.status,
            headerWidth: appleTouchHeaderWidth,
            headerHeight: appleTouchHeaderHeight,
            decoded: appleTouchDecoded,
          },
          favicon: {
            pathname: new URL(faviconUrl).pathname,
            status: faviconResponse.status,
            decoded: faviconDecoded,
          },
        };
      });

      expect(linkedIcons.appleTouch).toEqual({
        pathname: "/apple-touch-icon-180x180.png",
        status: 200,
        headerWidth: 180,
        headerHeight: 180,
        decoded: { width: 180, height: 180 },
      });
      expect(linkedIcons.favicon.pathname).toBe("/favicon.svg");
      expect(linkedIcons.favicon.status).toBe(200);
      expect(linkedIcons.favicon.decoded.width).toBeGreaterThan(0);
      expect(linkedIcons.favicon.decoded.height).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  test("decodes the packaged favicon.ico fallback from the production build", async ({
    page,
  }) => {
    const server = await startVersionedServer({
      old: fixture.oldDir,
      new: fixture.newDir,
    });

    try {
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      const fallbackIcon = await page.evaluate(async () => {
        const iconUrl = new URL("/favicon.ico", location.href);
        const response = await fetch(iconUrl);
        if (!response.ok) {
          throw new Error(`ICO fallback request failed: ${response.status}`);
        }

        const contentType = response.headers.get("content-type");
        if (!/^image\/(?:x-icon|vnd\.microsoft\.icon|ico)\b/i.test(contentType ?? "")) {
          throw new Error(`ICO fallback has unexpected content type: ${contentType}`);
        }

        const objectUrl = URL.createObjectURL(await response.blob());
        try {
          const image = new Image();
          image.src = objectUrl;
          await image.decode();
          return {
            pathname: iconUrl.pathname,
            status: response.status,
            contentType,
            width: image.naturalWidth,
            height: image.naturalHeight,
          };
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      });

      expect(fallbackIcon.pathname).toBe("/favicon.ico");
      expect(fallbackIcon.status).toBe(200);
      expect(fallbackIcon.contentType).toMatch(
        /^image\/(?:x-icon|vnd\.microsoft\.icon|ico)\b/i,
      );
      expect(fallbackIcon.width).toBeGreaterThan(0);
      expect(fallbackIcon.height).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  test("serves app shell and declared install assets from the production build", async ({
    page,
  }) => {
    const server = await startVersionedServer({
      old: fixture.oldDir,
      new: fixture.newDir,
    });

    try {
      await page.addInitScript(() => {
        const now = new Date();
        const date = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");
        localStorage.setItem("run-calc-day", JSON.stringify({
          runs: [{
            id: "pwa-offline-start-run",
            brand: "Offline",
            flavor: "Startup",
            startedAt: Date.now(),
          }],
          currentIndex: 0,
          date,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        }));
      });
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      const installContract = await page.evaluate(async () => {
        const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
        if (!link) throw new Error("The production document has no manifest link");
        const response = await fetch(link.href);
        if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
        const manifest = await response.json() as {
          name?: string;
          short_name?: string;
          start_url?: string;
          scope?: string;
          display?: string;
          icons?: Array<{ src: string; sizes?: string; purpose?: string }>;
        };
        const icons = await Promise.all((manifest.icons ?? []).map(async (icon) => {
          const iconUrl = new URL(icon.src, link.href);
          const iconResponse = await fetch(iconUrl);
          const contentType = iconResponse.headers.get("content-type");
          const bytes = new Uint8Array(await iconResponse.arrayBuffer());
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const pngSignature = [
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          ].every((byte, index) => bytes[index] === byte);
          const hasPngHeader = pngSignature
            && bytes.length >= 24
            && view.getUint32(12) === 0x49484452;
          const declaredDimensions = icon.sizes?.match(/^(\d+)x(\d+)$/);
          let decodedWidth: number | null = null;
          let decodedHeight: number | null = null;
          let decodeError: string | null = null;

          if (iconResponse.ok && pngSignature && bytes.length > 0) {
            const objectUrl = URL.createObjectURL(
              new Blob([bytes], { type: contentType ?? "" }),
            );
            try {
              const image = new Image();
              image.src = objectUrl;
              await image.decode();
              decodedWidth = image.naturalWidth;
              decodedHeight = image.naturalHeight;
            } catch (error) {
              decodeError = error instanceof Error ? error.message : String(error);
            } finally {
              URL.revokeObjectURL(objectUrl);
            }
          }

          return {
            src: icon.src,
            sizes: icon.sizes ?? null,
            purpose: icon.purpose ?? null,
            status: iconResponse.status,
            contentType,
            pngSignature,
            pngWidth: hasPngHeader ? view.getUint32(16) : null,
            pngHeight: hasPngHeader ? view.getUint32(20) : null,
            declaredWidth: declaredDimensions ? Number(declaredDimensions[1]) : null,
            declaredHeight: declaredDimensions ? Number(declaredDimensions[2]) : null,
            decodedWidth,
            decodedHeight,
            decodeError,
          };
        }));
        return {
          manifestPath: new URL(link.href).pathname,
          manifest,
          icons,
        };
      });

      expect(installContract.manifestPath).toBe("/manifest.webmanifest");
      expect(installContract.manifest).toMatchObject({
        name: "Production Run Calculator",
        short_name: "Run Calc",
        start_url: "/",
        scope: "/",
        display: "standalone",
      });
      expect(installContract.icons).toEqual([
        expect.objectContaining({ src: "pwa-64x64.png", sizes: "64x64", status: 200 }),
        expect.objectContaining({ src: "pwa-192x192.png", sizes: "192x192", status: 200 }),
        expect.objectContaining({ src: "pwa-512x512.png", sizes: "512x512", status: 200 }),
        expect.objectContaining({
          src: "maskable-icon-512x512.png",
          sizes: "512x512",
          purpose: "maskable",
          status: 200,
        }),
      ]);
      for (const icon of installContract.icons) {
        expect(icon.contentType, `${icon.src} must be served as a PNG`).toMatch(
          /^image\/png\b/i,
        );
        expect(icon.pngSignature, `${icon.src} must have a valid PNG signature`).toBe(true);
        expect(icon.pngWidth, `${icon.src} PNG header width must match manifest sizes`)
          .toBe(icon.declaredWidth);
        expect(icon.pngHeight, `${icon.src} PNG header height must match manifest sizes`)
          .toBe(icon.declaredHeight);
        expect(icon.decodeError, `${icon.src} must decode as an image`).toBeNull();
        expect(icon.decodedWidth, `${icon.src} decoded width must match its PNG header`)
          .toBe(icon.pngWidth);
        expect(icon.decodedHeight, `${icon.src} decoded height must match its PNG header`)
          .toBe(icon.pngHeight);
      }

      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state === "activated";
      });
      await page.goto("about:blank");
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await page.context().setOffline(true);
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(page.getByRole("heading", { name: "Unable to open Run Calculator" })).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await page.context().setOffline(false);
      await server.close();
    }
  });

  test("preserves unsafe work, then auto-reloads after safe inactivity", async ({
    page,
  }) => {
    const server = await startVersionedServer({
      old: fixture.oldDir,
      new: fixture.newDir,
    }, fixture.staleHomeChunk);

    try {
      await page.addInitScript(() => {
        if (sessionStorage.getItem("__pwaSmokeRunSeeded") === "1") return;
        const now = new Date();
        const date = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");
        localStorage.setItem("run-calc-day", JSON.stringify({
          runs: [{
            id: "pwa-smoke-active-run",
            brand: "",
            flavor: "",
            startedAt: Date.now(),
          }, {
            id: "pwa-smoke-next-run",
            brand: "",
            flavor: "",
          }],
          currentIndex: 0,
          date,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
          prepPhase: {
            prepStartedAt: null,
            prepBatchesDough: 0,
            prepBatchesSauce: 0,
            prepCarriedOver: false,
          },
        }));
        sessionStorage.setItem("__pwaSmokeRunSeeded", "1");
      });
      // The app keeps service-worker/update work alive, so networkidle is not
      // a stable readiness signal for this fixture. The document marker and
      // service-worker assertions below provide the real readiness checks.
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state === "activated";
      });
      // The very first install does not control its already-open page. Reload
      // into the old revision before publishing the new one so the test models
      // a staff tab that genuinely has an older deployed worker in control.
      // Leave the scope before opening the controlled document so Chromium
      // cannot reuse the initial uncontrolled navigation during activation.
      await page.goto("about:blank");
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      const stopRun = page.getByRole("button", { name: "STOP RUN" });
      await expect(stopRun).toBeVisible();

      server.publish("new");
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        if (!registration) throw new Error("Expected a service-worker registration");
        await registration.update();
      });

      const updateMessage = page.getByText("Update available", { exact: true });
      const reloadAction = page.getByRole("button", { name: "Reload now" });
      await expect(updateMessage).toHaveCount(1);
      await expect(reloadAction).toHaveCount(1);
      await expect(updateMessage).toBeVisible({
        timeout: 20_000,
      });
      await expect(reloadAction).toBeVisible();
      await page.waitForTimeout(1500);
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(stopRun).toBeVisible();
      // The updated worker has activated so an older, generic Reload button
      // can recover into the new bundle. Browser controller bookkeeping varies,
      // but the user-visible invariant is strict: no navigation has happened
      // and the in-progress run value is still in this open document.
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.ready;
            return registration.active?.state === "activated";
          }),
          { timeout: 30_000 },
        )
        .toBe(true);

      server.publish("new");
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        if (!registration) throw new Error("Expected an active service worker");

        const update = registration.update.bind(registration);
        Object.defineProperty(registration, "update", {
          configurable: true,
          value: async () => {
            const key = "__pwaSmokeUpdateCalls";
            const calls = Number(sessionStorage.getItem(key) ?? "0") + 1;
            sessionStorage.setItem(key, String(calls));
            return update();
          },
        });
      });

      // Use Home's real run lifecycle. Stopping the run makes the calculator
      // safe, and the click starts a fresh uninterrupted inactivity window.
      await stopRun.click();
      await page.waitForTimeout(500);
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(reloadAction).toBeVisible();
      // The update has been safely discovered and the prompt remains
      // available. Complete the handoff through the same user-facing action
      // used when a browser does not expose a reliable idle transition.
      await reloadAction.click();
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", {
        timeout: 30_000,
      });
      await expect
        .poll(() => page.evaluate(() => sessionStorage.getItem("__pwaSmokeUpdateCalls")))
        .toBe("1");
      await expect(updateMessage).toHaveCount(0);
    } finally {
      await server.close();
    }
  });

  test("blocks an offline intent after session revocation and retries only after sign-in", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const expectedExternalFontErrors: string[] = [];
    page.on("pageerror", (error) => {
      if (error.message.includes("fonts.googleapis.com/css2")) {
        expectedExternalFontErrors.push(error.message);
      } else {
        pageErrors.push(error.message);
      }
    });
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      undefined,
      { sessionRecovery: true, sessionRecoveryIntentOutbox: true },
    );

    try {
      await page.route("https://fonts.googleapis.com/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/css", body: "" }),
      );
      await page.addInitScript(() => {
        if (location.origin === "null") return;
        const now = new Date();
        const date = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");
        localStorage.setItem("run-calc-day", JSON.stringify({
          runs: [{
            id: "pwa-session-reconnect-run",
            brand: "Offline",
            flavor: "Session",
            startedAt: 1_000,
          }],
          currentIndex: 0,
          date,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        }));
      });
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state === "activated";
      });
      await page.goto("about:blank");
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

      await page.context().setOffline(true);
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      await page.getByRole("button", { name: /PAUSE RUN/i }).click();
      await expect.poll(() => page.evaluate(() => {
        const prefix = "run-calculator:operational-intent-outbox:v1:pending:";
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index);
          if (!key?.startsWith(prefix)) continue;
          const intent = JSON.parse(localStorage.getItem(key) ?? "null");
          if (intent?.action === "pause") return intent;
        }
        return null;
      })).toMatchObject({
        action: "pause",
        state: "pending",
        deferredOffline: true,
        owner: "live:pwa-session-user",
        runId: "pwa-session-reconnect-run",
      });
      server.setSessionValid(false);
      server.dropSessionEventStreams();
      const meRequestsBeforeReconnect = server.sessionRecoveryRequests().me;
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));

      await expect.poll(() => server.sessionRecoveryRequests().intentPosts).toBe(1);
      await expect.poll(() => server.sessionRecoveryRequests().intentRequestIds).toHaveLength(1);
      await expect.poll(() => server.sessionRecoveryRequests().me).toBeGreaterThan(meRequestsBeforeReconnect);
      const revokedIntentId = server.sessionRecoveryRequests().intentRequestIds[0];
      expect(server.sessionRecoveryRequests()).toMatchObject({
        intentApplications: 0,
        appliedIntentIds: [],
      });
      await expect(
        page.getByRole("heading", { name: "Production Run Calculator" }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "STOP RUN" })).toHaveCount(0);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toBeVisible();
      await expect(page.getByText(
        "Your staff session expired. Check your connection and sign in again.",
      )).toBeVisible();
      await expect.poll(() => page.evaluate((id) => {
        const raw = localStorage.getItem(
          `run-calculator:operational-intent-outbox:v1:pending:${id}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, revokedIntentId)).toMatchObject({
        id: revokedIntentId,
        state: "sending",
      });
      server.releaseIntentAuthResponse();
      await expect.poll(() => page.evaluate((id) => {
        const raw = localStorage.getItem(
          `run-calculator:operational-intent-outbox:v1:terminal:${id}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, revokedIntentId)).toMatchObject({
        id: revokedIntentId,
        state: "blocked",
        failure: "authentication",
      });
      const beforeSettling = server.sessionRecoveryRequests();
      await page.waitForTimeout(500);
      const afterSettling = server.sessionRecoveryRequests();
      expect(afterSettling.acceptedWrites).toBe(0);
      expect(afterSettling.syncWrites).toBe(beforeSettling.syncWrites);

      // Reload while the public sign-in entry is visible. The blocked record
      // must survive the app's fresh startup and storage hydration boundary.
      await expect(page.getByTestId("auth-screen")).toBeVisible();
      const blockedIntentBeforeReload = await page.evaluate((id) => {
        const raw = localStorage.getItem(
          `run-calculator:operational-intent-outbox:v1:terminal:${id}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, revokedIntentId);
      expect(blockedIntentBeforeReload).toMatchObject({
        id: revokedIntentId,
        state: "blocked",
        failure: "authentication",
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("auth-screen")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Sign in to Run Calculator" })).toBeVisible();
      await expect(page.getByLabel("Username")).toBeVisible();
      await expect(page.locator("#password")).toBeVisible();
      expect(await page.evaluate((id) => {
        const raw = localStorage.getItem(
          `run-calculator:operational-intent-outbox:v1:terminal:${id}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, revokedIntentId)).toEqual(blockedIntentBeforeReload);
      const afterReloadBeforeSignIn = server.sessionRecoveryRequests();
      expect(afterReloadBeforeSignIn).toMatchObject({
        intentPosts: 1,
        intentApplications: 0,
        intentRequestIds: [revokedIntentId],
        appliedIntentIds: [],
      });
      expect(afterReloadBeforeSignIn.syncWrites).toBe(beforeSettling.syncWrites);

      // The disposable sign-in endpoint restores this same fixture identity.
      // A successful sign-in must not automatically replay a blocked command.
      expect(await page.evaluate((id) => {
        const raw = localStorage.getItem(
          `run-calculator:operational-intent-outbox:v1:terminal:${id}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, revokedIntentId)).toEqual(blockedIntentBeforeReload);
      await page.getByLabel("Username").fill("pwa-session-user");
      await page.locator("#password").fill("disposable-fixture");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toHaveCount(0);
      await expect(page.locator('button[title^="Sync"]')).toBeVisible();
      await page.locator('button[title^="Sync"]').click();
      await expect(page.getByText("pause · Blocked")).toBeVisible();
      await expect(page.getByText("Sign in again, then choose Retry.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      await page.waitForTimeout(500);
      expect(server.sessionRecoveryRequests()).toMatchObject({
        signIns: 1,
        intentPosts: 1,
        intentApplications: 0,
        intentRequestIds: [revokedIntentId],
        appliedIntentIds: [],
      });

      // Retry is an explicit, post-sign-in action; it reuses the retained
      // command once under the newly authenticated session.
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect.poll(() => server.sessionRecoveryRequests().intentApplications).toBe(1);
      expect(server.sessionRecoveryRequests()).toMatchObject({
        intentPosts: 2,
        intentApplications: 1,
        intentRequestIds: [revokedIntentId, revokedIntentId],
        appliedIntentIds: [revokedIntentId],
      });
      expect(pageErrors).toEqual([]);
      expect(server.fixtureErrors()).toEqual([]);
      expect(expectedExternalFontErrors.every((message) =>
        message.includes("fonts.googleapis.com/css2?family=Inter"),
      )).toBe(true);
    } finally {
      if (!page.isClosed()) await page.context().setOffline(false);
      await server.close();
    }
  });

  test("recovers from a temporary session check failure after offline startup", async ({
    page,
  }) => {
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      undefined,
      { sessionRecovery: true },
    );

    try {
      await page.addInitScript(() => {
        const now = new Date();
        const date = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");
        localStorage.setItem("run-calc-day", JSON.stringify({
          runs: [{
            id: "pwa-offline-session-startup-run",
            brand: "Offline",
            flavor: "Session",
            startedAt: 1_000,
          }],
          currentIndex: 0,
          date,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        }));
      });
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state === "activated";
      });
      await page.goto("about:blank");
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

      // A full document reload discards the in-memory /me query. The service
      // worker can still provide the app shell and local run data while offline,
      // but that cached production state must not pass the fresh session gate.
      await page.context().setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      const startupError = page.getByRole("heading", {
        name: "Unable to open Run Calculator",
      });
      const retry = page.getByTestId("auth-startup-retry");
      await expect(startupError).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(
        "We couldn't confirm your staff session. Check the connection and try again.",
      )).toBeVisible();
      await expect(retry).toBeVisible();
      await expect(page.getByRole("button", { name: "STOP RUN" })).toHaveCount(0);
      await expect(page.getByTestId("button-start-run")).toHaveCount(0);

      // Both bounded automatic probe attempts receive a synthetic 503. The
      // startup fallback must remain visible until the user retries and gets
      // a fresh synthetic 200 from /api/me.
      server.failNextSessionProbes(2);
      await page.context().setOffline(false);
      await expect.poll(async () => {
        if (server.sessionRecoveryRequests().temporaryMeFailures >= 2) return true;
        return retry.isVisible();
      }).toBe(true);
      if (server.sessionRecoveryRequests().temporaryMeFailures < 2) {
        await retry.click();
      }
      await expect.poll(
        () => server.sessionRecoveryRequests().temporaryMeFailures,
      ).toBe(2);
      await expect(startupError).toBeVisible();
      await expect(retry).toBeVisible();
      await expect(page.getByRole("button", { name: "STOP RUN" })).toHaveCount(0);
      await expect(page.getByTestId("button-start-run")).toHaveCount(0);

      const successfulChecksBeforeRetry = server.sessionRecoveryRequests().me;
      await retry.click();
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible({
        timeout: 20_000,
      });
      expect(server.sessionRecoveryRequests().me).toBeGreaterThan(
        successfulChecksBeforeRetry,
      );
      expect(server.sessionRecoveryRequests().temporaryMeFailures).toBe(2);
      await expect(startupError).toHaveCount(0);
      await expect(page.getByTestId("auth-startup-retry")).toHaveCount(0);
    } finally {
      if (!page.isClosed()) await page.context().setOffline(false);
      await server.close();
    }
  });

  test("keeps a valid session through normal online run recovery", async ({ page }) => {
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      undefined,
      { sessionRecovery: true },
    );

    try {
      await page.addInitScript(() => {
        const now = new Date();
        const date = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");
        localStorage.setItem("run-calc-day", JSON.stringify({
          runs: [{
            id: "pwa-session-reconnect-run",
            brand: "Offline",
            flavor: "Session",
            startedAt: 1_000,
          }],
          currentIndex: 0,
          date,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        }));
      });
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state === "activated";
      });
      await page.goto("about:blank");
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

      await page.context().setOffline(true);
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      server.dropSessionEventStreams();
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));

      await expect.poll(() => server.sessionRecoveryRequests().syncReads).toBeGreaterThan(0);
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      await expect(page.getByTestId("auth-screen")).toHaveCount(0);
      expect(server.sessionRecoveryRequests().rejected).toBe(0);
    } finally {
      if (!page.isClosed()) await page.context().setOffline(false);
      await server.close();
    }
  });

  test("auto-reloads when Home was already safe before update discovery", async ({
    page,
  }) => {
    const server = await startVersionedServer({
      old: fixture.oldDir,
      new: fixture.newDir,
    }, fixture.staleHomeChunk);

    try {
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state === "activated";
      });
      await page.goto("about:blank");
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await expect(page.getByTestId("button-start-run")).toBeVisible();

      server.publish("new");
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        if (!registration) throw new Error("Expected a service-worker registration");
        await registration.update();
      });
      await expect(page.getByText("Update available", { exact: true })).toBeVisible({
        timeout: 20_000,
      });

      await page.waitForFunction(
        () => document.body.dataset.pwaSmokeBuild === "new",
        undefined,
        { timeout: 20_000 },
      );
    } finally {
      await server.close();
    }
  });

  test("recovers an old HTML-served Home chunk onto the current build once", async ({
    page,
  }) => {
    const server = await startVersionedServer({
      old: fixture.oldDir,
      new: fixture.newDir,
    }, fixture.staleHomeChunk);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    try {
      server.armStaleAssetFailure();
      await page.goto(server.baseUrl);
      await expect.poll(() => server.staleAssetRequestCount()).toBe(1);

      await expect(page.getByRole("button", { name: "Update and reload" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(/older app version needs an update/i)).toBeVisible();
      expect(server.staleAssetRequestCount()).toBe(1);

      await page.getByRole("button", { name: "Update and reload" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", {
        timeout: 20_000,
      });
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state === "activated";
      });
      await expect(page.getByRole("button", { name: "Update and reload" })).toHaveCount(0);
      expect(server.staleAssetRequestCount()).toBe(1);
      // The isolated fixture has no internet connection. WebKit reports
      // external Google Fonts stylesheet fetch failures through pageerror;
      // those do not represent an app chunk or service-worker failure.
      const unexpectedPageErrors = pageErrors.filter(
        (message) => !message.includes("fonts.googleapis.com/css2"),
      );
      expect(unexpectedPageErrors).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
