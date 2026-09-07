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
import { createServer } from "node:http";
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
const packageRoot = path.resolve(import.meta.dirname, "..");
const builtSite = path.join(packageRoot, "dist", "public");

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
    "<body>",
    `<body data-pwa-smoke-build="${version}">`,
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
  await execFileAsync("pnpm", ["run", "build"], {
    cwd: packageRoot,
    // Production uses one minute. Keep the exact policy path while making this
    // two-build browser fixture finish promptly.
    env: { ...process.env, VITE_UPDATE_RELOAD_IDLE_MS: "1000" },
    maxBuffer: 10 * 1024 * 1024,
  });

  const root = await mkdtemp(path.join(os.tmpdir(), "run-calculator-pwa-handoff-"));
  const oldDir = path.join(root, "old");
  const newDir = path.join(root, "new");
  await cp(builtSite, oldDir, { recursive: true });
  await cp(builtSite, newDir, { recursive: true });
  await Promise.all([stampBuild(oldDir, "old"), stampBuild(newDir, "new")]);
  const staleHomeChunk = await divergeHomeChunk(newDir);

  return { root, oldDir, newDir, staleHomeChunk };
}

async function startVersionedServer(
  versionDirs: Record<Version, string>,
  staleHomeChunk?: string,
) {
  let currentVersion: Version = "old";
  let staleAssetFailureArmed = false;
  let staleAssetRequestCount = 0;
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

      // Mount the real Home calculator without a database. The remaining API
      // requests deliberately fall through to the static document and fail
      // non-destructively inside the app's existing best-effort loaders.
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
      if (target.endsWith("service-worker.js")) headers["service-worker-allowed"] = "/";
      response.writeHead(200, headers).end(content);
    } catch (error) {
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
    async close() {
      // Browser keep-alive sockets can otherwise keep Node's close callback
      // pending after an assertion failure.
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
    fixture = await buildTwoVersionFixture();
  });

  test.afterAll(async () => {
    if (fixture) await rm(fixture.root, { recursive: true, force: true });
  });

  test("preserves unsafe work, then auto-reloads after safe inactivity", async ({
    page,
  }) => {
    const server = await startVersionedServer({
      old: fixture.oldDir,
      new: fixture.newDir,
    });

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
      await page.goto(server.baseUrl, { waitUntil: "networkidle" });
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
      await page.goto(server.baseUrl, { waitUntil: "networkidle" });
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      const stopRun = page.getByRole("button", { name: "STOP RUN" });
      await expect(stopRun).toBeVisible();

      server.publish("new");
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
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
            const registration = await navigator.serviceWorker.getRegistration();
            return Boolean(registration?.active && !registration.waiting);
          }),
        )
        .toBe(true);

      // Count the automatic handoff's update check. It must still use the same
      // worker recovery path as Reload now.
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
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
      await page.waitForFunction(
        () => document.body.dataset.pwaSmokeBuild === "new",
        undefined,
        { timeout: 20_000 },
      );
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", {
        timeout: 20_000,
      });
      await expect
        .poll(() => page.evaluate(() => sessionStorage.getItem("__pwaSmokeUpdateCalls")))
        .toBe("1");
      await expect(updateMessage).toHaveCount(0);
    } finally {
      await server.close();
    }
  });

  test("auto-reloads when Home was already safe before update discovery", async ({
    page,
  }) => {
    const server = await startVersionedServer({
      old: fixture.oldDir,
      new: fixture.newDir,
    });

    try {
      await page.goto(server.baseUrl, { waitUntil: "networkidle" });
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state === "activated";
      });
      await page.goto("about:blank");
      await page.goto(server.baseUrl, { waitUntil: "networkidle" });
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await expect(page.getByTestId("button-start-run")).toBeVisible();

      server.publish("new");
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
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
      expect(pageErrors).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
