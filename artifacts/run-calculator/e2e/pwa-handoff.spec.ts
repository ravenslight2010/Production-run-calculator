/**
 * Two-version PWA release smoke test.
 *
 * This exercises the deployed-browser behavior that unit tests cannot:
 *  1. a first (old) production build owns an open tab;
 *  2. the same origin starts serving a changed worker;
 *  3. foregrounding activates the new worker without claiming or reloading the
 *     active tab;
 *  4. the single persistent update prompt runs the worker update path and
 *     reloads only after staff choose Reload now.
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
import { mkdtemp, cp, readFile, rm, writeFile, stat } from "node:fs/promises";
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
  const workerPath = path.join(buildDir, "sw.js");
  const index = await readFile(indexPath, "utf8");
  const worker = await readFile(workerPath, "utf8");
  const stampedIndex = index.replace(
    "<body>",
    `<body data-pwa-smoke-build="${version}">`,
  );
  const indexRevision = createHash("sha256").update(stampedIndex).digest("hex");
  const stampedWorker = worker.replace(
    /url:"index\.html",revision:"[^"]+"/,
    `url:"index.html",revision:"${indexRevision}"`,
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

async function buildTwoVersionFixture() {
  await execFileAsync("pnpm", ["run", "build"], {
    cwd: packageRoot,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  const root = await mkdtemp(path.join(os.tmpdir(), "run-calculator-pwa-handoff-"));
  const oldDir = path.join(root, "old");
  const newDir = path.join(root, "new");
  await cp(builtSite, oldDir, { recursive: true });
  await cp(builtSite, newDir, { recursive: true });
  await Promise.all([stampBuild(oldDir, "old"), stampBuild(newDir, "new")]);

  return { root, oldDir, newDir };
}

async function startVersionedServer(versionDirs: Record<Version, string>) {
  let currentVersion: Version = "old";
  const server = createServer(async (request, response) => {
    try {
      const requestPath = safeRequestPath(request.url);
      if (!requestPath) {
        response.writeHead(400).end("Invalid path");
        return;
      }

      // AppUpdatePrompt mounts before authentication. Answer its one startup
      // probe as signed out, so the real production app can render its landing
      // page without a database or an account.
      if (requestPath === "api/auth/me") {
        response
          .writeHead(401, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify({ error: "Not signed in" }));
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
      const headers: Record<string, string> = {
        "content-type": mimeType(target),
        // The browser must revalidate the worker when focus triggers
        // registration.update(); application assets can be read fresh too.
        "cache-control": target.endsWith("sw.js") ? "no-cache" : "no-store",
      };
      if (target.endsWith("sw.js")) headers["service-worker-allowed"] = "/";
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
  test("shows one prompt and reloads only after staff choose Reload now", async ({
    page,
  }) => {
    const fixture = await buildTwoVersionFixture();
    const server = await startVersionedServer({
      old: fixture.oldDir,
      new: fixture.newDir,
    });

    try {
      await page.goto(server.baseUrl, { waitUntil: "networkidle" });
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return Boolean(registration?.active);
      });
      // The very first install does not control its already-open page. Reload
      // into the old revision before publishing the new one so the test models
      // a staff tab that genuinely has an older deployed worker in control.
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

      // This in-memory value stands in for a live run in the mounted document:
      // it would disappear on any automatic reload. It must survive discovery.
      await page.evaluate(() => {
        (window as Window & { __pwaSmokeActiveRun?: string }).__pwaSmokeActiveRun =
          "running";
      });

      server.publish("new");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));

      const updateMessage = page.getByText("Update available", { exact: true });
      const reloadAction = page.getByRole("button", { name: "Reload now" });
      await expect(updateMessage).toHaveCount(1);
      await expect(reloadAction).toHaveCount(1);
      await expect(updateMessage).toBeVisible({
        timeout: 20_000,
      });
      await expect(reloadAction).toBeVisible();
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as Window & { __pwaSmokeActiveRun?: string })
                .__pwaSmokeActiveRun,
          ),
        )
        .toBe("running");
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

      // Count only the user-action update check. The button must go through the
      // service-worker handoff path before it reloads, even when skipWaiting
      // has already activated the discovered worker.
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

      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle" }),
        reloadAction.click(),
      ]);
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", {
        timeout: 20_000,
      });
      await expect
        .poll(() => page.evaluate(() => sessionStorage.getItem("__pwaSmokeUpdateCalls")))
        .toBe("1");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as Window & { __pwaSmokeActiveRun?: string })
                .__pwaSmokeActiveRun,
          ),
        )
        .toBeUndefined();
    } finally {
      await server.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});