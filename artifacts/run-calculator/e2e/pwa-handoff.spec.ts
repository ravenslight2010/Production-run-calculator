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
import { isBackgroundWebKitNetworkDiagnostic } from "./qc-date-code-browser-diagnostics.mjs";
import * as XLSX from "xlsx";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { pwaFixtureBuildEnv } from "./pwaFixtureBuildEnv";
import { applySyncDeltaData, canonicalSyncJson, isSyncRecord } from "@workspace/sync-contract";
import { applyOperationalIntent } from "../../api-server/src/lib/operationalIntents";
import { syncSnapshotId } from "../../api-server/src/lib/syncContract";
import {
  mkdtemp,
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

function findHomeChunk(buildDir: string) {
  const assetsDir = path.join(buildDir, "assets");
  return readdir(assetsDir).then((assetNames) => {
    const name = assetNames.find((assetName) => /^home-[\w-]+\.js$/.test(assetName));
    if (!name) throw new Error("The PWA fixture could not find Home's lazy chunk");
    return name;
  });
}

async function divergeHomeChunk(buildDir: string, staleHomeChunk: string) {
  const assetsDir = path.join(buildDir, "assets");
  const assetNames = await readdir(assetsDir);
  const currentHomeChunk = assetNames.find((name) => /^home-[\w-]+\.js$/.test(name));
  if (!currentHomeChunk) throw new Error("The PWA fixture could not find Home's lazy chunk");
  const newName = staleHomeChunk.replace(/\.js$/, "-current.js");
  await rename(path.join(assetsDir, currentHomeChunk), path.join(assetsDir, newName));

  const files = [
    path.join(buildDir, "index.html"),
    path.join(buildDir, "service-worker.js"),
    ...(await readdir(assetsDir))
      .filter((name) => name.endsWith(".js"))
      .map((name) => path.join(assetsDir, name)),
  ];
  await Promise.all(files.map(async (file) => {
    const source = await readFile(file, "utf8");
    if (source.includes(currentHomeChunk)) {
      await writeFile(file, source.replaceAll(currentHomeChunk, newName));
    }
  }));
  return staleHomeChunk;
}

async function buildTwoVersionFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "run-calculator-pwa-handoff-"));
  try {
    const oldDir = path.join(root, "old");
    const newDir = path.join(root, "new");
    // Build distinct real bundles into this fixture's own directories. A full
    // release browser run serves dist/public at the same time; rebuilding there
    // can temporarily erase its JS chunks and break unrelated pages.
    for (const [version, outputDir] of [["old", oldDir], ["new", newDir]] as const) {
      await execFileAsync("pnpm", [
        "exec", "vite", "build", "--config", "vite.config.ts", "--outDir", outputDir,
      ], {
        cwd: packageRoot,
        // Production uses one minute. Keep the exact policy path while making
        // this two-version browser fixture finish promptly.
        env: pwaFixtureBuildEnv(process.env, version),
        maxBuffer: 10 * 1024 * 1024,
      });
      await Promise.all([
        stat(path.join(outputDir, "index.html")),
        stat(path.join(outputDir, "service-worker.js")),
        stat(path.join(outputDir, "favicon.ico")),
      ]);
    }
    await Promise.all([stampBuild(oldDir, "old"), stampBuild(newDir, "new")]);
    const staleHomeChunk = await divergeHomeChunk(newDir, await findHomeChunk(oldDir));
    return { root, oldDir, newDir, staleHomeChunk };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function startOldBuildThenTriggerStaleAssetFailure(
  page: import("@playwright/test").Page,
  server: Awaited<ReturnType<typeof startVersionedServer>>,
  staleHomeChunk: string,
  beforeStaleAssetFailure?: () => Promise<void>,
  trackWorkerLifecycle = true,
) {
  server.holdNextSessionResponse();
  await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.state === "activated";
  });
  await page.evaluate(async ({ missingHomeChunk, trackWorkerLifecycle }) => {
    const registration = await navigator.serviceWorker.ready;
    if (trackWorkerLifecycle) {
      const traceKey = "__pwa_recovery_worker_lifecycle";
      const record = (entry: { kind: string; state?: string }) => {
        const entries = JSON.parse(localStorage.getItem(traceKey) ?? "[]") as typeof entry[];
        entries.push(entry);
        localStorage.setItem(traceKey, JSON.stringify(entries));
      };
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        record({ kind: "installing", state: worker.state });
        worker.addEventListener("statechange", () => {
          record({ kind: "worker-state", state: worker.state });
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        record({ kind: "controllerchange" });
      });
    }
    // The stale Home chunk is deliberately absent from the network's new
    // version. Remove only this cached old response so the request reaches the
    // versioned server instead of being masked by the installed worker cache.
    for (const cacheName of await caches.keys()) {
      if (!cacheName.startsWith("workbox-precache")) continue;
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname.endsWith(`/assets/${missingHomeChunk}`)) {
          await cache.delete(request);
        }
      }
    }
  }, { missingHomeChunk: staleHomeChunk, trackWorkerLifecycle });

  await beforeStaleAssetFailure?.();
  server.publish("new");
  server.armStaleAssetFailure();
  server.releaseHeldSessionResponse();
  await expect.poll(() => server.staleAssetRequestCount()).toBe(1);
  await expect(page.getByRole("button", { name: "Update and reload" })).toBeVisible({
    timeout: 20_000,
  });
}

async function readPrecacheInventory(buildDir: string) {
  const worker = await readFile(path.join(buildDir, "service-worker.js"), "utf8");
  const firstRevision = worker.indexOf('"revision"');
  const manifestStart = worker.lastIndexOf("[", firstRevision);
  const manifestEnd = worker.indexOf("]", firstRevision) + 1;
  if (firstRevision < 0 || manifestStart < 0 || manifestEnd <= manifestStart) {
    throw new Error("The production worker does not contain an injected precache manifest");
  }

  const manifest = JSON.parse(worker.slice(manifestStart, manifestEnd)) as Array<{
    url: string;
    revision?: string | null;
  }>;
  const uniqueEntries = new Map(manifest.map((entry) => [entry.url, entry]));
  const entries = await Promise.all([...uniqueEntries.values()].map(async (entry) => {
    const assetPath = path.join(buildDir, entry.url);
    const assetStat = await stat(assetPath);
    return { ...entry, bytes: assetStat.size };
  }));
  const assetsDir = path.join(buildDir, "assets");
  const emittedJavaScript = (await readdir(assetsDir))
    .filter((name) => name.endsWith(".js"))
    .map((name) => `assets/${name}`);
  const precachedJavaScript = new Set(
    entries.filter((entry) => entry.url.endsWith(".js")).map((entry) => entry.url),
  );

  return {
    entries,
    totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    precachedJavaScript,
    unprecachedJavaScript: emittedJavaScript.filter((url) => !precachedJavaScript.has(url)),
    emittedJavaScript,
  };
}

async function startVersionedServer(
  versionDirs: Record<Version, string>,
  staleHomeChunk?: string,
  options: {
    sessionRecovery?: boolean;
    sessionRecoveryIntentOutbox?: boolean;
    sessionRecoveryRunId?: string;
    safeSessionSnapshot?: boolean;
    lifecycleSnapshot?: boolean;
    preHomeSafetyTimeout?: boolean;
    fieldCheckObservations?: boolean;
    completeHomeFixture?: boolean;
    initialUserId?: string;
  } = {},
) {
  let currentVersion: Version = "old";
  let failWorkerChecks = false;
  let failIdentityChecks = false;
  let staleAssetFailureArmed = false;
  let staleAssetFailureTriggered = false;
  let staleAssetRequestCount = 0;
  let sessionValid = true;
  let snapshotHasActiveRun = !options.safeSessionSnapshot;
  let lifecycleSnapshot: Record<string, unknown> | undefined;
  let lifecycleCanonicalRevision = 0;
  let operationalIntentCursor = 0;
  let intentPermissionGranted = true;
  let temporarySessionProbeFailuresRemaining = 0;
  const sessionProbeFailuresByTestTab = new Map<string, number>();
  let sessionProbesToHold = 0;
  let sessionResponsesToPause = 0;
  let releaseSessionResponses: (() => void) | undefined;
  let sessionResponsePause: Promise<void> | undefined;
  const sessionRecoveryRequests = {
    me: 0,
    acceptedMeResponses: 0,
    temporaryMeFailures: 0,
    heldMeProbes: 0,
    closedHeldMeProbes: 0,
    syncReads: 0,
    preHomeSafetyTimeouts: 0,
    syncWrites: 0,
    rejected: 0,
    acceptedWrites: 0,
    intentPosts: 0,
    intentApplications: 0,
    signIns: 0,
    permissionDenied: 0,
  };
  const sessionSnapshotReads: Array<{ date: string; activeRun: boolean }> = [];
  const fieldCheckObservations: Array<{
    observations: unknown[];
    acceptedMeResponsesAtReceipt: number;
  }> = [];
  const fieldCheckRequests: Array<{ userId: string; sandbox: boolean; status: number }> = [];
  let fieldCheckFailuresRemaining = 0;
  const intentRequestIds: string[] = [];
  const intentRequestUsers: string[] = [];
  const appliedIntentIds: string[] = [];
  const appliedIntentUsers: string[] = [];
  const signedInUsers: string[] = [];
  const fixtureErrors: string[] = [];
  const factoryDataRequests: Array<{
    method: string;
    origin: string | null;
    status: number;
    userId: string;
    authenticated: boolean;
  }> = [];
  const factoryData = new Map<string, { value: unknown; updatedAt: string }>();
  let releaseIntentAuthResponse: (() => void) | undefined;
  const intentAuthResponseGate = new Promise<void>((resolve) => {
    releaseIntentAuthResponse = resolve;
  });
  const sessionEventStreams = new Set<ServerResponse>();
  const homeApiFallbacks: string[] = [];
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
  const managerSessionUser = {
    ...sessionUser,
    userId: "pwa-session-manager",
    role: "manager",
    capabilities: ["manage-factory-settings"],
    name: "PWA Session Manager",
  };
  let activeSessionUserId = sessionUser.userId;
  const sessionUsers = new Map([
    [sessionUser.userId, sessionUser],
    ["pwa-session-user-b", { ...sessionUser, userId: "pwa-session-user-b", name: "PWA Session B" }],
    ["pwa-sandbox-user", {
      ...sessionUser,
      userId: "pwa-sandbox-user",
      name: "PWA Sandbox",
      role: "manager",
      capabilities: ["manage-factory-settings"],
      sandbox: true,
    }],
    [managerSessionUser.userId, managerSessionUser],
  ]);
  activeSessionUserId = options.initialUserId ?? activeSessionUserId;
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
      if ((failWorkerChecks && requestPath === "service-worker.js")
        || (failIdentityChecks && requestPath === "app-build.json")) {
        response.writeHead(503, { "cache-control": "no-store" }).end("Fixture unavailable");
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
        const sessionProbeUrl = new URL(request.url ?? "/", "http://pwa-smoke.test");
        const testTab = sessionProbeUrl.searchParams.get("__pwa_test_tab");
        const testTabFailures = testTab
          ? sessionProbeFailuresByTestTab.get(testTab) ?? 0
          : 0;
        if (testTabFailures > 0 || temporarySessionProbeFailuresRemaining > 0) {
          if (testTabFailures > 0 && testTab) {
            sessionProbeFailuresByTestTab.set(testTab, testTabFailures - 1);
          } else {
            temporarySessionProbeFailuresRemaining -= 1;
          }
          sessionRecoveryRequests.temporaryMeFailures += 1;
          response
            .writeHead(503, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Temporarily unavailable" }));
          return;
        }
        if (sessionProbesToHold > 0) {
          sessionProbesToHold -= 1;
          sessionRecoveryRequests.heldMeProbes += 1;
          await new Promise<void>((resolve) => {
            response.once("close", () => {
              sessionRecoveryRequests.closedHeldMeProbes += 1;
              resolve();
            });
          });
          return;
        }
        if (sessionResponsesToPause > 0 && sessionResponsePause) {
          sessionResponsesToPause -= 1;
          await sessionResponsePause;
          if (response.destroyed) return;
        }
        sessionRecoveryRequests.acceptedMeResponses += 1;
        response
          .writeHead(200, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify(sessionUsers.get(activeSessionUserId)));
        return;
      }
      if (
        options.sessionRecovery
        && (
          requestPath === "api/factory-data"
          || requestPath === "api/factory-data/operational"
        )
      ) {
        const authenticated = sessionValid;
        if (!authenticated) {
          factoryDataRequests.push({
            method: request.method ?? "GET",
            origin: request.headers.origin ?? null,
            status: 401,
            userId: activeSessionUserId,
            authenticated,
          });
          response
            .writeHead(401, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
        const canManageFactorySettings =
          sessionUsers.get(activeSessionUserId)?.capabilities.includes("manage-factory-settings")
          ?? false;
        if (!canManageFactorySettings) {
          factoryDataRequests.push({
            method: request.method ?? "GET",
            origin: request.headers.origin ?? null,
            status: 403,
            userId: activeSessionUserId,
            authenticated,
          });
          response
            .writeHead(403, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Forbidden" }));
          return;
        }
        if (request.method === "GET") {
          factoryDataRequests.push({
            method: "GET",
            origin: request.headers.origin ?? null,
            status: 200,
            userId: activeSessionUserId,
            authenticated,
          });
          response
            .writeHead(200, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ data: Object.fromEntries(factoryData) }));
          return;
        }
        if (request.method === "PUT") {
          let rawBody = "";
          for await (const chunk of request) rawBody += chunk;
          const payload = JSON.parse(rawBody || "{}") as {
            key?: unknown;
            value?: unknown;
          };
          if (typeof payload.key !== "string" || payload.key.trim().length === 0) {
            response
              .writeHead(400, { "content-type": "application/json; charset=utf-8" })
              .end(JSON.stringify({ error: "key must be a non-empty string" }));
            return;
          }
          if (payload.value === undefined) {
            response
              .writeHead(400, { "content-type": "application/json; charset=utf-8" })
              .end(JSON.stringify({ error: "value is required" }));
            return;
          }
          const updatedAt = new Date().toISOString();
          factoryData.set(payload.key.trim(), { value: payload.value, updatedAt });
          factoryDataRequests.push({
            method: "PUT",
            origin: request.headers.origin ?? null,
            status: 200,
            userId: activeSessionUserId,
            authenticated,
          });
          response
            .writeHead(200, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ updatedAt, value: payload.value }));
          return;
        }
      }
      if (
        options.sessionRecovery
        && requestPath === "api/incidents"
        && request.method === "POST"
      ) {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        }).end(JSON.stringify({
          incidentId: "pwa-fixture-incident",
          correlationId: "pwa-fixture-correlation",
          diagnosis: null,
          workaround: null,
          recurrence: null,
          aiGenerated: false,
        }));
        return;
      }
      if (
        options.fieldCheckObservations
        && requestPath === "api/field-checks/observations"
        && request.method === "POST"
      ) {
        let rawBody = "";
        for await (const chunk of request) rawBody += chunk;
        const payload = JSON.parse(rawBody || "{}") as { observations?: unknown[] };
        if (fieldCheckFailuresRemaining > 0) {
          fieldCheckFailuresRemaining -= 1;
          fieldCheckRequests.push({
            userId: activeSessionUserId,
            sandbox: sessionUsers.get(activeSessionUserId)?.sandbox ?? false,
            status: 503,
          });
          response.writeHead(503, {
            "content-type": "application/json; charset=utf-8",
          }).end(JSON.stringify({ error: "Temporary fixture failure" }));
          return;
        }
        fieldCheckRequests.push({
          userId: activeSessionUserId,
          sandbox: sessionUsers.get(activeSessionUserId)?.sandbox ?? false,
          status: 202,
        });
        fieldCheckObservations.push({
          observations: Array.isArray(payload.observations) ? payload.observations : [],
          acceptedMeResponsesAtReceipt: sessionRecoveryRequests.acceptedMeResponses,
        });
        response.writeHead(202, {
          "content-type": "application/json; charset=utf-8",
        }).end(JSON.stringify({
          accepted: fieldCheckObservations.at(-1)?.observations.length ?? 0,
          duplicate: 0,
        }));
        return;
      }
      if (options.sessionRecovery && requestPath === "api/auth/sign-out" && request.method === "POST") {
        sessionValid = false;
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": "rc_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
        }).end(JSON.stringify({ ok: true }));
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
          !credentials.username
          || !sessionUsers.has(credentials.username)
          || credentials.password !== "disposable-fixture"
        ) {
          response
            .writeHead(401, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Invalid username or password" }));
          return;
        }
        sessionValid = true;
        activeSessionUserId = credentials.username;
        sessionRecoveryRequests.signIns += 1;
        signedInUsers.push(activeSessionUserId);
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": "rc_auth=disposable-fixture-session; Path=/; HttpOnly; SameSite=Lax",
        }).end(JSON.stringify({
          token: "disposable-fixture-token",
          user: sessionUsers.get(activeSessionUserId),
        }));
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
          intent?: Parameters<typeof applyOperationalIntent>[1];
        };
        sessionRecoveryRequests.intentPosts += 1;
        intentRequestUsers.push(activeSessionUserId);
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
        // Test-only fault injection for the PWA outbox's explicit 403-retry
        // behavior. The real operational-intents route is auth-only; this
        // synthetic denial is not a capability contract.
        if (!intentPermissionGranted) {
          sessionRecoveryRequests.permissionDenied += 1;
          response
            .writeHead(403, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Forbidden" }));
          return;
        }
        sessionRecoveryRequests.intentApplications += 1;
        appliedIntentUsers.push(activeSessionUserId);
        if (payload.intent?.id) appliedIntentIds.push(payload.intent.id);
        if (!payload.intent) {
          response
            .writeHead(400, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Invalid operational intent" }));
          return;
        }
        const now = Date.now();
        const current = lifecycleSnapshot ?? {
          syncVersion: 1,
          completeness: "complete",
          dayState: { date: payload.intent.date, runs: [], currentIndex: 0 },
          runValues: {},
          runValuesUpdatedAt: {},
        };
        const applied = applyOperationalIntent(
          current,
          payload.intent,
          now,
          lifecycleCanonicalRevision,
        );
        lifecycleSnapshot = applied.data;
        if (!applied.duplicate) {
          lifecycleCanonicalRevision += 1;
          operationalIntentCursor += 1;
        }
        response
          .writeHead(200, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify({
            ok: true,
            outcome: applied.outcome,
            duplicate: applied.duplicate,
            cursor: operationalIntentCursor,
            canonicalRevision: lifecycleCanonicalRevision,
            serverTime: now,
            data: applied.data,
            snapshotId: syncSnapshotId(applied.data),
          }));
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
          if (options.preHomeSafetyTimeout && sessionRecoveryRequests.preHomeSafetyTimeouts === 0) {
            sessionRecoveryRequests.preHomeSafetyTimeouts += 1;
            await new Promise<void>((resolve) => {
              response.once("close", () => resolve());
            });
            return;
          }
          const url = new URL(request.url ?? "/", "http://pwa-smoke.test");
          const requestedDate = url.searchParams.get("today");
          const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
            ? requestedDate
            : new Date().toISOString().slice(0, 10);
          const run = {
            id: options.sessionRecoveryRunId
              ?? (options.lifecycleSnapshot ? "pwa-smoke-active-run" : "pwa-session-reconnect-run"),
            brand: options.lifecycleSnapshot ? "" : "Offline",
            flavor: options.lifecycleSnapshot ? "" : "Session",
            startedAt: 1_000,
          };
          const canonical = lifecycleSnapshot ?? {
            syncVersion: 1,
            completeness: "complete",
            dayState: {
              date,
              runs: snapshotHasActiveRun
                ? options.lifecycleSnapshot
                  ? [run, { id: "pwa-smoke-next-run", brand: "", flavor: "" }]
                  : [run]
                : [],
              // Match the API's emptySyncData baseline: an empty run list has
              // no selected index, so recovery cannot adopt an out-of-range one.
              ...(snapshotHasActiveRun ? { currentIndex: 0 } : {}),
            },
            runValues: snapshotHasActiveRun ? { [run.id]: {} } : {},
            runValuesUpdatedAt: {},
          };
          if (options.lifecycleSnapshot || options.sessionRecoveryIntentOutbox) {
            lifecycleSnapshot = canonical;
          }
          sessionSnapshotReads.push({ date, activeRun: snapshotHasActiveRun });
          const snapshotId = createHash("sha256")
            .update(canonicalSyncJson(canonical))
            .digest("hex");
          const serverTime = Date.now();
          response.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-sync-response": "complete",
            "x-sync-snapshot": snapshotId,
            "x-sync-canonical-revision": String(lifecycleCanonicalRevision),
            "x-sync-server-time": String(serverTime),
          }).end(JSON.stringify({
            ...canonical,
            resetEpoch: 0,
            rollover: false,
            canonicalRevision: lifecycleCanonicalRevision,
            serverTime,
          }));
          return;
        }
        if (method === "PUT") {
          if ((options.lifecycleSnapshot || options.sessionRecoveryIntentOutbox) && lifecycleSnapshot) {
            let raw = "";
            for await (const chunk of request) raw += chunk;
            const incoming: unknown = JSON.parse(raw || "{}");
            if (!isSyncRecord(incoming)) throw new Error("Invalid lifecycle fixture write");
            const delta = Object.fromEntries(
              ["dayState", "runValues"].filter((key) => key in incoming)
                .map((key) => [key, incoming[key]]),
            );
            const next = applySyncDeltaData(lifecycleSnapshot, delta);
            if (!next) throw new Error("Invalid lifecycle fixture delta");
            if (canonicalSyncJson(next) !== canonicalSyncJson(lifecycleSnapshot)) {
              lifecycleCanonicalRevision += 1;
            }
            lifecycleSnapshot = next;
          }
          sessionRecoveryRequests.syncWrites += 1;
          sessionRecoveryRequests.acceptedWrites += 1;
          response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ ok: true, data: null }));
          return;
        }
      }
      if (requestPath === "api/me") {
        const user = sessionUsers.get(activeSessionUserId);
        if (!sessionValid || !user) {
          response
            .writeHead(401, { "content-type": "application/json; charset=utf-8" })
            .end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
        response
          .writeHead(200, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify({
            userId: user.userId,
            role: user.role,
            capabilities: user.capabilities,
            email: null,
            name: user.name,
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
      if (
        requestPath === "api/qc/import-review-badges"
        && request.method === "GET"
      ) {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        }).end(JSON.stringify({ pending: 0, rejected: 0 }));
        return;
      }
      if (options.completeHomeFixture && request.method === "GET") {
        const homeResponses: Record<string, unknown> = {
          "api/freezer-surplus": { lots: [], allocations: [] },
          "api/freezer-surplus/confirmations": { confirmations: [] },
          "api/sync/scheduled": [],
          "api/sync/operational-intents/cursor": {
            cursor: operationalIntentCursor,
            hasMore: false,
            mutations: [],
          },
          "api/sync/reset-epoch": { epoch: 0, rollover: false },
          "api/die-types": { names: [] },
          "api/production-rules": { rules: [] },
          "api/run-templates": { templates: [] },
          "api/supervisor-pin": { configured: false },
          "api/ingredient-batch-weights": { weights: [] },
          "api/die-line-defaults": { entries: [] },
          "api/factory-data/operational": { data: {} },
          "api/merged-away": { names: [] },
          "api/brand-profiles": { items: [] },
          "api/completed-history": { history: [] },
          "api/applicator-batch-evidence": { evidence: [] },
          "api/master-data/bootstrap": {
            ingredients: [],
            doughRecipes: [],
            sauceRecipes: [],
            cheeseRecipes: [],
            mixes: [],
          },
        };
        if (Object.hasOwn(homeResponses, requestPath)) {
          response.writeHead(200, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          }).end(JSON.stringify(homeResponses[requestPath]));
          return;
        }
      }
      if (
        options.completeHomeFixture
        && requestPath === "api/inventory/consume-day-start"
        && request.method === "POST"
      ) {
        response.writeHead(403, {
          "content-type": "application/json; charset=utf-8",
        }).end(JSON.stringify({ error: "Forbidden" }));
        return;
      }
      if (requestPath === "api" || requestPath.startsWith("api/")) {
        if (options.completeHomeFixture) {
          homeApiFallbacks.push(`${request.method ?? "GET"} ${requestPath}`);
        }
        if (options.sessionRecovery && requestPath === "api/factory-data") {
          factoryDataRequests.push({
            method: request.method ?? "GET",
            origin: request.headers.origin ?? null,
            status: 404,
            userId: activeSessionUserId,
            authenticated: sessionValid,
          });
        }
        response
          .writeHead(404, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify({ error: "API endpoint not found" }));
        return;
      }

      const root = versionDirs[currentVersion];
      const candidate = path.join(root, requestPath);
      const withinRoot =
        candidate === root || candidate.startsWith(`${root}${path.sep}`);
      const oldCandidate = path.join(versionDirs.old, requestPath);
      const withinOldRoot =
        oldCandidate === versionDirs.old ||
        oldCandidate.startsWith(`${versionDirs.old}${path.sep}`);
      const oldFileAvailable =
        withinOldRoot &&
        requestPath !== `assets/${staleHomeChunk}` &&
        (await stat(oldCandidate).catch(() => null))?.isFile();
      const target =
        withinRoot && (await stat(candidate).catch(() => null))?.isFile()
          ? candidate
          : oldFileAvailable
            ? oldCandidate
            : path.join(root, "index.html");
      const content = await readFile(target);
      if (
        staleAssetFailureArmed
        && !staleAssetFailureTriggered
        && currentVersion === "old"
        && requestPath === entryScript
      ) {
        // Finish serving the old entry bundle, then deploy the new release
        // before its lazy Home import. The removed old Home filename now falls
        // through to new index.html with text/html, matching the production
        // failure this recovery path handles.
        staleAssetFailureTriggered = true;
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
    baseUrl: `http://localhost:${address.port}`,
    publish(version: Version) {
      currentVersion = version;
      staleAssetFailureTriggered = true;
    },
    failWorkerChecks(fail: boolean) { failWorkerChecks = fail; },
    failIdentityChecks(fail: boolean) { failIdentityChecks = fail; },
    armStaleAssetFailure() {
      staleAssetFailureArmed = true;
    },
    staleAssetRequestCount() {
      return staleAssetRequestCount;
    },
    setSessionValid(valid: boolean) {
      sessionValid = valid;
    },
    failNextFieldCheckObservations(count = 1) {
      fieldCheckFailuresRemaining = count;
    },
    setSnapshotActiveRun(active: boolean) {
      snapshotHasActiveRun = active;
    },
    setIntentPermissionGranted(granted: boolean) {
      intentPermissionGranted = granted;
    },
    failNextSessionProbes(count: number) {
      temporarySessionProbeFailuresRemaining = count;
    },
    failNextSessionProbesForTestTab(tab: string, count: number) {
      sessionProbeFailuresByTestTab.set(tab, count);
    },
    holdNextSessionProbes(count: number) {
      sessionProbesToHold = count;
    },
    holdNextSessionResponse() {
      sessionResponsesToPause = 1;
      sessionResponsePause = new Promise<void>((resolve) => {
        releaseSessionResponses = resolve;
      });
    },
    releaseHeldSessionResponse() {
      releaseSessionResponses?.();
      releaseSessionResponses = undefined;
      sessionResponsePause = undefined;
    },
    dropSessionEventStreams() {
      for (const stream of sessionEventStreams) stream.destroy();
      sessionEventStreams.clear();
    },
    sessionRecoveryRequests() {
      return {
        ...sessionRecoveryRequests,
        intentRequestIds: [...intentRequestIds],
        intentRequestUsers: [...intentRequestUsers],
        appliedIntentIds: [...appliedIntentIds],
        appliedIntentUsers: [...appliedIntentUsers],
        signedInUsers: [...signedInUsers],
      };
    },
    sessionSnapshotReads() {
      return sessionSnapshotReads.map((snapshot) => ({ ...snapshot }));
    },
    fieldCheckObservations() {
      return fieldCheckObservations.map((batch) => ({
        observations: [...batch.observations],
        acceptedMeResponsesAtReceipt: batch.acceptedMeResponsesAtReceipt,
      }));
    },
    fieldCheckRequests() {
      return fieldCheckRequests.map((request) => ({ ...request }));
    },
    fixtureErrors() {
      return [...fixtureErrors];
    },
    factoryDataRequests() {
      return factoryDataRequests.map((request) => ({ ...request }));
    },
    homeApiFallbacks() {
      return [...homeApiFallbacks];
    },
    releaseIntentAuthResponse() {
      releaseIntentAuthResponse?.();
    },
    async close() {
      // Browser keep-alive sockets can otherwise keep Node's close callback
      // pending after an assertion failure.
      releaseIntentAuthResponse?.();
      releaseSessionResponses?.();
      for (const stream of sessionEventStreams) stream.destroy();
      sessionEventStreams.clear();
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

  async function openControlledOld(page: import("@playwright/test").Page, server: Awaited<ReturnType<typeof startVersionedServer>>) {
    // Activity prevents automatic handoff while these tests exercise explicit actions.
    await page.addInitScript(() => { setInterval(() => window.dispatchEvent(new Event("mousedown")), 250); });
    await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === "activated");
    await page.goto("about:blank");
    await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await expect(page.getByTestId("button-start-run")).toBeVisible();
    await page.getByRole("button", { name: /App updates/ }).click();
    await expect(page.getByTestId("running-build")).toHaveText("pwa-old-build");
  }

  test("keeps update controls reachable and preserves stored work through a confirmed manual two-build handoff", async ({ page }) => {
    const server = await startVersionedServer({ old: fixture.oldDir, new: fixture.newDir }, fixture.staleHomeChunk);
    try {
      await openControlledOld(page, server);
      const preserved = await page.evaluate(async () => {
        // A valid persisted pending-sync record for a non-active scope must not
        // be delivered by this user or erased by update recovery.
        const key = "run-calculator:sync-pending-v1:pwa-preserved-scope:2099-01-01";
        const snapshot = { dayState: { date: "2099-01-01", runs: [] }, runValues: {} };
        const queued = JSON.stringify({
          version: 1, id: "preserve-pending", scope: "pwa-preserved-scope", date: "2099-01-01",
          epoch: 1, baseSnapshotId: "fixture-base", baseline: snapshot, payload: snapshot,
        });
        localStorage.setItem(key, queued);
        localStorage.setItem("run-calc:pwa-fixture-settings", JSON.stringify({ contrast: "high", sound: false }));
        // Use real application-owned preference/run-value keys too, not only
        // sentinel storage that startup code would never read.
        localStorage.setItem("run-calc-active-tab", "dough");
        history.replaceState(null, "", `${location.pathname}${location.search}#dough`);
        localStorage.setItem("run-calc-run-pwa-preserved-run", JSON.stringify({ pizzasPerCase: 12 }));
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("pwa-preserved-business-fixture", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("queued-work");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("queued-work", "readwrite");
            tx.objectStore("queued-work").put({ id: "fixture-review", reviewed: true }, "pending");
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
          };
        });
        return { key, queued };
      });
      const other = await page.context().newPage();
      await other.goto(`${server.baseUrl}/sign-in`, { waitUntil: "domcontentloaded" });
      await other.getByLabel(/username/i).fill("unsaved-fixture");
      server.publish("new");
      const check = page.getByRole("button", { name: "Check for updates", exact: true });
      await check.click();
      const update = page.getByRole("button", { name: "Update app", exact: true }).first();
      await expect(update).toBeVisible();
      for (const control of [check, update]) {
        const box = await control.boundingBox();
        const viewport = page.viewportSize()!;
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      }
      await update.click();
      try {
        await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", { timeout: 30_000 });
      } catch {
        const diagnostic = await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return {
            active: registration?.active?.state, waiting: registration?.waiting?.state,
            installing: registration?.installing?.state,
            events: JSON.parse(sessionStorage.getItem("run-calc:pwa-update-diagnostics:v1") ?? "[]"),
          };
        });
        throw new Error(`Manual handoff not confirmed: ${JSON.stringify(diagnostic)}`);
      }
      await page.getByRole("button", { name: /App updates/ }).click();
      await expect(page.getByTestId("running-build")).toHaveText("pwa-new-build");
      await expect.poll(() => page.evaluate(() => {
        const events = JSON.parse(sessionStorage.getItem("run-calc:pwa-update-diagnostics:v1") ?? "[]");
        return events.some((event: { phase: string }) => event.phase === "confirmed");
      })).toBe(true);
      await expect(other.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(other.getByLabel(/username/i)).toHaveValue("unsaved-fixture");
      const after = await page.evaluate(async ({ key }) => {
        const idb = await new Promise<unknown>((resolve, reject) => {
          const request = indexedDB.open("pwa-preserved-business-fixture", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("queued-work");
            const get = tx.objectStore("queued-work").get("pending");
            get.onsuccess = () => resolve(get.result);
            get.onerror = () => reject(get.error);
            tx.oncomplete = () => db.close();
          };
        });
        return {
          queued: localStorage.getItem(key), settings: localStorage.getItem("run-calc:pwa-fixture-settings"),
          activeTab: localStorage.getItem("run-calc-active-tab"),
          runValues: localStorage.getItem("run-calc-run-pwa-preserved-run"), idb,
        };
      }, preserved);
      expect(after).toEqual({
        queued: preserved.queued, settings: JSON.stringify({ contrast: "high", sound: false }),
        activeTab: "dough", runValues: JSON.stringify({ pizzasPerCase: 12 }),
        idb: { id: "fixture-review", reviewed: true },
      });
      await other.close();
    } finally { await server.close(); }
  });

  test("reproduces repeated old-shell refreshes after failed worker discovery and recovers on explicit retry without clearing data", async ({ page }) => {
    const server = await startVersionedServer({ old: fixture.oldDir, new: fixture.newDir }, fixture.staleHomeChunk);
    try {
      await openControlledOld(page, server);
      await page.evaluate(() => localStorage.setItem("pwa-retry-pending", "retained"));
      server.failWorkerChecks(true);
      server.publish("new");
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: /App updates/ }).click();
        await expect(page.getByTestId("running-build")).toHaveText("pwa-old-build");
      }
      await page.getByRole("button", { name: "Check for updates", exact: true }).click();
      await page.getByRole("button", { name: "Update app", exact: true }).first().click();
      await expect(page.getByRole("status").filter({ hasText: "Update failed" })).toBeVisible({ timeout: 25_000 });
      await expect(page.getByTestId("running-build")).toHaveText("pwa-old-build");
      server.failWorkerChecks(false);
      await page.getByRole("button", { name: "Check for updates", exact: true }).click();
      await page.getByRole("button", { name: "Update app", exact: true }).first().click();
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", { timeout: 30_000 });
      expect(await page.evaluate(() => localStorage.getItem("pwa-retry-pending"))).toBe("retained");
      await page.waitForTimeout(2000);
      expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("run-calc:pwa-update-diagnostics:v1") ?? "[]")
        .filter((event: { phase: string }) => event.phase === "confirmed").length)).toBe(1);
    } finally { await server.close(); }
  });

  test("does not call unavailable identity current and remains retryable across offline reconnect", async ({ page }) => {
    const server = await startVersionedServer({ old: fixture.oldDir, new: fixture.newDir }, fixture.staleHomeChunk);
    try {
      await openControlledOld(page, server);
      server.failIdentityChecks(true);
      await page.getByRole("button", { name: "Check for updates", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Update failed" })).toBeVisible();
      await page.context().setOffline(true);
      await page.getByRole("button", { name: "Check for updates", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();
      await expect(page.getByTestId("button-start-run")).toBeVisible();
      await page.context().setOffline(false);
      server.failIdentityChecks(false);
      await page.getByRole("button", { name: "Check for updates", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Current." })).toBeVisible();
    } finally { await page.context().setOffline(false); await server.close(); }
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
      const precache = await readPrecacheInventory(fixture.oldDir);
      const excluded = await Promise.all(precache.unprecachedJavaScript.map(async (url) => ({
        url,
        bytes: (await stat(path.join(fixture.oldDir, url))).size,
      })));
      expect(excluded).toHaveLength(1);
      expect(excluded[0].url).toMatch(/^assets\/heic2any-[\w-]+\.js$/);
      expect(excluded[0].bytes).toBeGreaterThan(1_000_000);
      const offlineFeatureChunkGroups = {
        "live run and app shell": ["home-"],
        "manager and setup tools": [
          "DeferredManagementSurface-",
          "StaffManagementSurface-",
          "MixesManager-",
          "ProductionRulesManager-",
          "FreezerPullItemsManager-",
          "CycleCountManager-",
          "CheeseRecipesManager-",
          "DieLineDefaultsManager-",
          "NamedRecipesManager-",
        ],
        "warehouse and inventory": ["WarehouseTabContent-", "InventoryTab-"],
        "quality, incidents, and downtime": [
          "QcWorkflowTab-",
          "IncidentsTab-",
          "DowntimeTrendsTab-",
        ],
        "workbook export": ["runExcel-", "xlsx-"],
        "workbook and recipe imports": [
          "ExcelImportDialog-",
          "SpecImportDialog-",
          "PremixImportDialog-",
          "ShippingImportDialog-",
          "RecipeGuideImportDialog-",
          "CheeseImportDialog-",
          "specImport-",
          "premixImport-",
          "shippingImport-",
          "recipeGuideImport-",
          "cheeseImport-",
        ],
      } satisfies Record<string, string[]>;
      const precachedJavaScriptFiles = [...precache.precachedJavaScript];
      const retainedOfflineFeatureChunks = Object.fromEntries(
        Object.entries(offlineFeatureChunkGroups).map(([feature, prefixes]) => {
          const matched = prefixes.map((prefix) => {
            const file = precachedJavaScriptFiles.find((url) =>
              path.posix.basename(url).startsWith(prefix),
            );
            expect(file, `${feature}: ${prefix} must remain available offline`).toBeDefined();
            return file;
          });
          return [feature, matched];
        }),
      );
      const transferReport = {
        uniquePrecacheEntries: precache.entries.length,
        currentPrecacheBytes: precache.totalBytes,
        excludedOptionalChunk: excluded[0],
        previousBroadGlobBytes: precache.totalBytes + excluded[0].bytes,
        savedBytes: excluded[0].bytes,
        retainedOfflineFeatureChunks,
      };
      console.info(`PWA precache transfer: ${JSON.stringify(transferReport)}`);

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
      const installedPrecache = await page.evaluate(async () => {
        const cacheName = (await caches.keys()).find((name) =>
          name.startsWith("workbox-precache-v2-"),
        );
        if (!cacheName) throw new Error("The Workbox precache was not installed");
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        return requests.map((request) => new URL(request.url).pathname.replace(/^\/+/, ""));
      });
      for (const entry of precache.entries) {
        expect(installedPrecache, `${entry.url} must be downloaded during service-worker install`)
          .toContain(entry.url);
      }
      expect(installedPrecache.some((url) => /(?:^|\/)heic2any-[\w-]+\.js$/.test(url)))
        .toBe(false);

      await page.goto("about:blank");
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await page.context().setOffline(true);
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      await page.goto("about:blank");
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(page.getByRole("heading", { name: "Unable to open Run Calculator" })).toBeVisible({
        timeout: 20_000,
      });

      const runExcelChunk = [...precache.precachedJavaScript].find((url) =>
        path.posix.basename(url).startsWith("runExcel-"),
      );
      const xlsxChunk = [...precache.precachedJavaScript].find((url) =>
        path.posix.basename(url).startsWith("xlsx-"),
      );
      if (!runExcelChunk || !xlsxChunk) {
        throw new Error("The production build is missing the cached workbook workflow chunks");
      }
      const inputWorkbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        inputWorkbook,
        XLSX.utils.aoa_to_sheet([
          ["Brand", "Flavor", "Cases Planned"],
          ["Offline", "Workbook", 1],
        ]),
        "Runs",
      );
      const serializedWorkbook = XLSX.write(inputWorkbook, {
        bookType: "xlsx",
        type: "array",
      });
      const workbookBytes = Array.from(
        serializedWorkbook instanceof ArrayBuffer
          ? new Uint8Array(serializedWorkbook)
          : serializedWorkbook,
      );
      const offlineWorkbook = await page.evaluate(async ({ runExcelPath, workbookBytes }) => {
        const runExcel = await import(new URL(runExcelPath, location.href).href) as Record<string, unknown>;
        const workbookWorkflow = runExcel as {
          buildRunWorkbook: (rows: Array<Record<string, string | number>>) => unknown;
          parseRunWorkbook: (
            data: ArrayBuffer | Uint8Array,
            sourceFile?: string,
          ) => { rows: Array<{ brand: string; flavor: string; casesPlanned: number }>; errors: unknown[] };
        };
        const exportedWorkbook = workbookWorkflow.buildRunWorkbook([{
          Date: "2026-10-15",
          Run: "Offline cache check",
          Brand: "Offline",
          Flavor: "Workbook",
          Status: "Upcoming",
          "Cases Planned": 1,
          "Cases Made": "",
          Pizzas: 0,
          PPM: "",
          Started: "",
          Ended: "",
          "Net Duration": "",
          Downtime: "0",
          Stoppages: "",
          "Dough Batches": 0,
          "Sauce Batches": 0,
          Notes: "",
        }]);
        const parsedWorkbook = workbookWorkflow.parseRunWorkbook(
          new Uint8Array(workbookBytes),
          "offline-cache-check.xlsx",
        );
        const result = exportedWorkbook as {
          SheetNames: string[];
          Sheets: Record<string, Record<string, { v?: unknown }>>;
        };
        return {
          sheetName: result.SheetNames[0],
          runLabel: result.Sheets["Production Runs"]?.B2?.v ?? null,
          parsedRows: parsedWorkbook.rows,
          parseErrors: parsedWorkbook.errors,
        };
      }, { runExcelPath: runExcelChunk, workbookBytes });
      expect(offlineWorkbook).toMatchObject({
        sheetName: "Production Runs",
        runLabel: "Offline cache check",
        parsedRows: [{
          brand: "Offline",
          flavor: "Workbook",
          casesPlanned: 1,
        }],
        parseErrors: [],
      });

      const heicChunk = excluded[0].url;
      const deferredFailure = await page.evaluate(async (assetPath) => {
        try {
          await import(new URL(assetPath, location.href).href);
          return { loaded: true };
        } catch (error) {
          return {
            loaded: false,
            errorName: error instanceof Error ? error.name : "unknown",
          };
        }
      }, heicChunk);
      expect(deferredFailure.loaded).toBe(false);
      await page.context().setOffline(false);
      // A failed module fetch is retained by the current document's module
      // loader. Reopening after connectivity returns models the user's recovery
      // path and gives the browser a fresh module graph for its on-demand retry.
      await page.goto("about:blank");
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      const deferredRecovery = await page.evaluate(async (assetPath) => {
        const module = await import(new URL(assetPath, location.href).href) as {
          default?: unknown;
        };
        return typeof module.default;
      }, heicChunk);
      expect(deferredRecovery).toBe("function");
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
    }, fixture.staleHomeChunk, { sessionRecovery: true, lifecycleSnapshot: true });

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
            startedAt: 1_000,
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

      const updateMessage = page.getByRole("button", {
        name: "App updates · Update ready", exact: true,
      });
      const reloadAction = page.getByRole("button", { name: "Update app", exact: true });
      await expect(updateMessage).toHaveCount(1);
      await expect(reloadAction).toHaveCount(1);
      await expect(updateMessage).toBeVisible({
        timeout: 20_000,
      });
      await expect(reloadAction).toBeVisible();
      await reloadAction.click();
      await expect(page.getByRole("button", {
        name: "App updates · Waiting for work to save", exact: true,
      })).toBeVisible();
      await page.waitForTimeout(1500);
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(stopRun).toBeVisible();
      // Verify the current queued-manual policy without turning the later
      // automatic-idle assertion into a queued-manual handoff.
      await page.getByRole("button", { name: "Cancel queued update", exact: true }).click();
      await expect(page.getByRole("button", {
        name: "App updates · Update paused", exact: true,
      })).toBeVisible();
      await page.getByRole("button", { name: "Check for updates", exact: true }).click();
      await expect(updateMessage).toBeVisible();
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

      let handoffNavigations = 0;
      page.on("request", (request) => {
        // Home also updates its fragment within the same document. Count real
        // main-document requests, not those harmless same-document events.
        if (request.isNavigationRequest() && request.resourceType() === "document"
          && request.frame() === page.mainFrame()) handoffNavigations += 1;
      });

      // Use Home's real run lifecycle. Stopping the run makes the calculator
      // safe, and the click starts a fresh uninterrupted inactivity window.
      await stopRun.click();
      await page.waitForTimeout(500);
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(reloadAction).toBeVisible();
      // The manual request was cancelled and discovery explicitly re-armed.
      // Only a new uninterrupted safe-idle window may hand off now.
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", {
        timeout: 30_000,
      });
      await page.getByRole("button", { name: /App updates/ }).click();
      await expect(page.getByTestId("running-build")).toHaveText("pwa-new-build");
      await expect.poll(() => page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("run-calc:pwa-update-diagnostics:v1") ?? "[]")
          .filter((event: { phase: string }) => event.phase === "confirmed").length,
      )).toBe(1);
      await page.waitForTimeout(1500);
      expect(handoffNavigations).toBe(1);
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
      {
        sessionRecovery: true,
        sessionRecoveryIntentOutbox: true,
      },
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

  test("keeps an authentication-blocked offline intent private across account switches", async ({
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
      {
        sessionRecovery: true,
        sessionRecoveryIntentOutbox: true,
        sessionRecoveryRunId: "pwa-account-switch-run",
      },
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
            id: "pwa-account-switch-run",
            brand: "Offline",
            flavor: "Account switch",
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

      // Account A saves a real PWA action while offline. Its session expires
      // before reconnection, so the existing fixture holds the 401 until /me
      // has signed the user out and the outbox can retain the blocked record.
      await page.context().setOffline(true);
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
        runId: "pwa-account-switch-run",
      });
      server.setSessionValid(false);
      server.dropSessionEventStreams();
      const meRequestsBeforeReconnect = server.sessionRecoveryRequests().me;
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect.poll(() => server.sessionRecoveryRequests().intentPosts).toBe(1);
      const blockedIntentId = server.sessionRecoveryRequests().intentRequestIds[0];
      await expect.poll(() => server.sessionRecoveryRequests().me)
        .toBeGreaterThan(meRequestsBeforeReconnect);
      expect(blockedIntentId).toBeTruthy();
      expect(server.sessionRecoveryRequests()).toMatchObject({
        intentRequestIds: [blockedIntentId],
        intentRequestUsers: ["pwa-session-user"],
        intentApplications: 0,
        appliedIntentIds: [],
      });
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toBeVisible();
      server.releaseIntentAuthResponse();
      await expect.poll(() => page.evaluate((id) => {
        const raw = localStorage.getItem(
          `run-calculator:operational-intent-outbox:v1:terminal:${id}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, blockedIntentId)).toMatchObject({
        id: blockedIntentId,
        owner: "live:pwa-session-user",
        state: "blocked",
        failure: "authentication",
      });

      // Signing in as B must not expose, retry, send, or apply A's blocked ID.
      await page.getByLabel("Username").fill("pwa-session-user-b");
      await page.locator("#password").fill("disposable-fixture");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toHaveCount(0);
      await expect(page.locator('button[title^="Sync"]')).toBeVisible();
      await page.locator('button[title^="Sync"]').click();
      await expect(page.getByText("Offline action queue")).toHaveCount(0);
      await page.waitForTimeout(500);
      expect(server.sessionRecoveryRequests()).toMatchObject({
        signIns: 1,
        signedInUsers: ["pwa-session-user-b"],
        intentPosts: 1,
        intentRequestIds: [blockedIntentId],
        intentRequestUsers: ["pwa-session-user"],
        intentApplications: 0,
        appliedIntentIds: [],
      });

      // Expire B's disposable session to return to the same sign-in screen,
      // then sign A back in. The exact blocked record must reappear without
      // automatically sending it.
      server.setSessionValid(false);
      server.dropSessionEventStreams();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toBeVisible();
      await page.getByLabel("Username").fill("pwa-session-user");
      await page.locator("#password").fill("disposable-fixture");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toHaveCount(0);
      await expect(page.locator('button[title^="Sync"]')).toBeVisible();
      await page.locator('button[title^="Sync"]').click();
      await expect(page.getByText("pause · Blocked")).toBeVisible();
      await expect(page.getByText("Sign in again, then choose Retry.")).toBeVisible();
      await expect(page.getByText(`#${blockedIntentId.slice(-6)}`)).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      await page.waitForTimeout(500);
      expect(server.sessionRecoveryRequests()).toMatchObject({
        signIns: 2,
        signedInUsers: ["pwa-session-user-b", "pwa-session-user"],
        intentPosts: 1,
        intentRequestIds: [blockedIntentId],
        intentRequestUsers: ["pwa-session-user"],
        intentApplications: 0,
        appliedIntentIds: [],
      });

      // A's explicit Retry is the only allowed replay and applies the same ID
      // exactly once under A's authenticated fixture identity.
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect.poll(() => server.sessionRecoveryRequests().intentApplications).toBe(1);
      expect(server.sessionRecoveryRequests()).toMatchObject({
        intentPosts: 2,
        intentRequestIds: [blockedIntentId, blockedIntentId],
        intentRequestUsers: ["pwa-session-user", "pwa-session-user"],
        intentApplications: 1,
        appliedIntentIds: [blockedIntentId],
        appliedIntentUsers: ["pwa-session-user"],
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

  test("matches the /api/me stub to the active authenticated fixture identity", async ({
    page,
  }) => {
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
    );

    try {
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Production Run Calculator" }))
        .toBeVisible();

      const authenticated = await page.evaluate(async () => {
        const response = await fetch("/api/me");
        return { status: response.status, user: await response.json() };
      });
      expect(authenticated).toMatchObject({
        status: 200,
        user: {
          userId: "pwa-session-user",
          role: "operator",
          capabilities: [],
          name: "PWA Session",
        },
      });

      server.setSessionValid(false);
      const unauthenticated = await page.evaluate(async () => {
        const response = await fetch("/api/me");
        return { status: response.status, body: await response.json() };
      });
      expect(unauthenticated).toEqual({
        status: 401,
        body: { error: "Unauthorized" },
      });
      expect(server.fixtureErrors()).toEqual([]);
    } finally {
      await server.close();
    }
  });

  test("matches factory-data access to the active session capability", async ({ page }) => {
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
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Production Run Calculator" }))
        .toBeVisible();

      const operatorResults = await page.evaluate(async () => {
        const read = await fetch("/api/factory-data");
        const write = await fetch("/api/factory-data", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: "operator-test", value: "denied" }),
        });
        return { readStatus: read.status, writeStatus: write.status };
      });
      expect(operatorResults).toEqual({ readStatus: 403, writeStatus: 403 });
      expect(server.factoryDataRequests()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          status: 403,
          userId: "pwa-session-user",
          authenticated: true,
        }),
        expect.objectContaining({
          method: "PUT",
          status: 403,
          userId: "pwa-session-user",
          authenticated: true,
        }),
      ]));

      // Expire the operator session to use the fixture's real sign-in path for
      // the manager identity rather than granting the operator extra access.
      server.setSessionValid(false);
      server.dropSessionEventStreams();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toBeVisible();
      await page.getByLabel("Username").fill("pwa-session-manager");
      await page.locator("#password").fill("disposable-fixture");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toHaveCount(0);
      await expect.poll(() => server.factoryDataRequests().some((request) =>
        request.method === "GET"
        && request.status === 200
        && request.userId === "pwa-session-manager",
      )).toBe(true);

      const managerResults = await page.evaluate(async () => {
        const write = await fetch("/api/factory-data", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: "manager-test", value: "allowed" }),
        });
        const written = await write.json();
        const read = await fetch("/api/factory-data");
        return {
          writeStatus: write.status,
          readStatus: read.status,
          written,
          data: await read.json(),
        };
      });
      expect(managerResults).toMatchObject({
        writeStatus: 200,
        readStatus: 200,
        written: { value: "allowed" },
        data: { data: { "manager-test": { value: "allowed" } } },
      });
      expect(server.factoryDataRequests()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          method: "PUT",
          status: 200,
          userId: "pwa-session-manager",
          authenticated: true,
        }),
        expect.objectContaining({
          method: "GET",
          status: 200,
          userId: "pwa-session-manager",
          authenticated: true,
        }),
      ]));

      server.setSessionValid(false);
      const unauthenticatedResults = await page.evaluate(async () => {
        const read = await fetch("/api/factory-data");
        const write = await fetch("/api/factory-data", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: "expired-session-test", value: "denied" }),
        });
        return { readStatus: read.status, writeStatus: write.status };
      });
      expect(unauthenticatedResults).toEqual({ readStatus: 401, writeStatus: 401 });
      expect(server.factoryDataRequests()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          status: 401,
          userId: "pwa-session-manager",
          authenticated: false,
        }),
        expect.objectContaining({
          method: "PUT",
          status: 401,
          userId: "pwa-session-manager",
          authenticated: false,
        }),
      ]));
      expect(pageErrors).toEqual([]);
      expect(server.fixtureErrors()).toEqual([]);
      expect(expectedExternalFontErrors.every((message) =>
        message.includes("fonts.googleapis.com/css2?family=Inter"),
      )).toBe(true);
    } finally {
      await server.close();
    }
  });

  test("keeps a permission-blocked offline intent until explicit retry", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const expectedExternalFontErrors: string[] = [];
    const classifiedWebKitBackgroundPaths: string[] = [];
    const browserEngine = test.info().project.name.toLowerCase().includes("webkit")
      ? "webkit"
      : "chromium";
    page.on("pageerror", (error) => {
      if (error.message.includes("fonts.googleapis.com/css2")) {
        expectedExternalFontErrors.push(error.message);
      } else if (
        browserEngine === "webkit"
        && isBackgroundWebKitNetworkDiagnostic(error, browserEngine)
      ) {
        const suffix = " due to access control checks.";
        const protocol = error.name.slice("Fetch API cannot load ".length);
        try {
          const parsed = new URL(`${protocol}:/${error.message.slice(0, -suffix.length)}`);
          if (parsed.pathname === "/api/incidents") {
            classifiedWebKitBackgroundPaths.push(parsed.pathname);
          } else {
            pageErrors.push(error.message);
          }
        } catch {
          pageErrors.push(error.message);
        }
      } else {
        pageErrors.push(error.message);
      }
    });
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      undefined,
      {
        sessionRecovery: true,
        sessionRecoveryIntentOutbox: true,
        sessionRecoveryRunId: "pwa-permission-recovery-run",
      },
    );
    server.setIntentPermissionGranted(false);

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
            id: "pwa-permission-recovery-run",
            brand: "Offline",
            flavor: "Permission",
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
        runId: "pwa-permission-recovery-run",
      });
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));

      await expect.poll(() => server.sessionRecoveryRequests().permissionDenied).toBe(1);
      const blockedIntentId = server.sessionRecoveryRequests().intentRequestIds[0];
      expect(blockedIntentId).toBeTruthy();
      await expect.poll(() => page.evaluate((id) => {
        const raw = localStorage.getItem(
          `run-calculator:operational-intent-outbox:v1:terminal:${id}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, blockedIntentId)).toMatchObject({
        id: blockedIntentId,
        state: "blocked",
        failure: "permission",
        guidance: "You do not have permission. Ask a manager, then Retry if access changes.",
      });
      const blockedIntentBeforeReload = await page.evaluate((id) => {
        const raw = localStorage.getItem(
          `run-calculator:operational-intent-outbox:v1:terminal:${id}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, blockedIntentId);
      expect(server.sessionRecoveryRequests()).toMatchObject({
        intentPosts: 1,
        intentApplications: 0,
        permissionDenied: 1,
        intentRequestIds: [blockedIntentId],
        appliedIntentIds: [],
      });

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
      expect(await page.evaluate((id) => {
        const raw = localStorage.getItem(
          `run-calculator:operational-intent-outbox:v1:terminal:${id}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, blockedIntentId)).toEqual(blockedIntentBeforeReload);
      await page.locator('button[title^="Sync"]').click();
      await expect(page.getByText("pause · Blocked")).toBeVisible();
      await expect(page.getByText(
        "You do not have permission. Ask a manager, then Retry if access changes.",
      )).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();

      // Restoring access and signing in as the same operator must not replay a
      // terminalized command. Only its explicit Retry can submit it again.
      server.setIntentPermissionGranted(true);
      server.setSessionValid(false);
      server.dropSessionEventStreams();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toBeVisible();
      expect(await page.evaluate((id) => {
        const raw = localStorage.getItem(
          `run-calculator:operational-intent-outbox:v1:terminal:${id}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, blockedIntentId)).toEqual(blockedIntentBeforeReload);
      await page.getByLabel("Username").fill("pwa-session-user");
      await page.locator("#password").fill("disposable-fixture");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toHaveCount(0);
      await expect(page.locator('button[title^="Sync"]')).toBeVisible();
      await page.waitForTimeout(500);
      expect(await page.evaluate((id) => {
        const raw = localStorage.getItem(
          `run-calculator:operational-intent-outbox:v1:terminal:${id}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, blockedIntentId)).toEqual(blockedIntentBeforeReload);
      expect(server.sessionRecoveryRequests()).toMatchObject({
        signIns: 1,
        intentPosts: 1,
        intentApplications: 0,
        permissionDenied: 1,
        intentRequestIds: [blockedIntentId],
        appliedIntentIds: [],
      });

      await page.locator('button[title^="Sync"]').click();
      await expect(page.getByText("pause · Blocked")).toBeVisible();
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect.poll(() => server.sessionRecoveryRequests().intentApplications).toBe(1);
      expect(server.sessionRecoveryRequests()).toMatchObject({
        signIns: 1,
        intentPosts: 2,
        intentApplications: 1,
        permissionDenied: 1,
        intentRequestIds: [blockedIntentId, blockedIntentId],
        appliedIntentIds: [blockedIntentId],
      });
      expect(
        server.factoryDataRequests()
          .filter((request) => request.method === "GET")
          .length,
      ).toBeGreaterThan(0);
      expect(
        server.factoryDataRequests()
          .filter((request) => request.method === "GET")
          .every((request) => request.status === (request.authenticated ? 403 : 401)),
      ).toBe(true);
      expect(
        server.factoryDataRequests().some((request) => request.method === "OPTIONS"),
      ).toBe(false);
      expect(
        server.factoryDataRequests()
          .filter((request) => request.method === "PUT")
          .every((request) => request.status === (request.authenticated ? 403 : 401)),
      ).toBe(true);
      await expect.poll(() => page.evaluate((id) => {
        const raw = localStorage.getItem(
          `run-calculator:operational-intent-outbox:v1:terminal:${id}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, blockedIntentId)).toMatchObject({
        id: blockedIntentId,
        state: "accepted",
      });
      await page.waitForTimeout(500);
      expect(server.sessionRecoveryRequests().intentPosts).toBe(2);
      expect(pageErrors).toEqual([]);
      if (classifiedWebKitBackgroundPaths.length > 0) {
        await test.info().attach("webkit-background-network-diagnostics.json", {
          body: JSON.stringify({
            project: test.info().project.name,
            paths: classifiedWebKitBackgroundPaths,
            note: "Classified by the existing WebKit network-diagnostic helper; this is not endpoint-success evidence.",
          }, null, 2),
          contentType: "application/json",
        });
      }
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

  test("keeps startup retry available after session checks time out", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const expectedExternalFontErrors: string[] = [];
    page.on("pageerror", (error) => {
      if (error.message.includes("fonts.googleapis.com")) {
        expectedExternalFontErrors.push(error.message);
      } else {
        pageErrors.push(error.message);
      }
    });
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      undefined,
      { sessionRecovery: true },
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
            id: "pwa-offline-timeout-startup-run",
            brand: "Offline",
            flavor: "Timeout",
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

      // Start from the cached app shell with no network. Stored production run
      // data must not bypass the fresh session check on this cold app start.
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

      // Hold both bounded probe attempts until the client aborts each at its
      // deadline. The fixture's close() also closes these sockets on assertion
      // failure, so a failed test cannot leave a held response behind.
      server.holdNextSessionProbes(2);
      await page.context().setOffline(false);
      const checksBeforeTimeout = server.sessionRecoveryRequests().me;
      const timeoutStartedAt = Date.now();
      await retry.click();
      await expect.poll(
        () => server.sessionRecoveryRequests().closedHeldMeProbes,
        { timeout: 30_000 },
      ).toBe(2);
      expect(Date.now() - timeoutStartedAt).toBeGreaterThanOrEqual(7_500);
      expect(server.sessionRecoveryRequests()).toMatchObject({
        me: checksBeforeTimeout + 2,
        heldMeProbes: 2,
        closedHeldMeProbes: 2,
      });
      await expect(startupError).toBeVisible();
      await expect(page.getByText(
        "We couldn't confirm your staff session. Check the connection and try again.",
      )).toBeVisible();
      await expect(retry).toBeVisible();
      await expect(page.getByRole("button", { name: "STOP RUN" })).toHaveCount(0);
      await expect(page.getByTestId("button-start-run")).toHaveCount(0);

      // Only a subsequent explicit retry receives the synthetic accepted
      // response and opens the calculator.
      const acceptedResponsesBeforeRetry =
        server.sessionRecoveryRequests().acceptedMeResponses;
      await retry.click();
      await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible({
        timeout: 20_000,
      });
      expect(server.sessionRecoveryRequests().acceptedMeResponses).toBe(
        acceptedResponsesBeforeRetry + 1,
      );
      await expect(startupError).toHaveCount(0);
      await expect(page.getByTestId("auth-startup-retry")).toHaveCount(0);
      expect(pageErrors).toEqual([]);
      expect(expectedExternalFontErrors.every((message) =>
        message.includes("fonts.googleapis.com/css2?family=Inter"),
      )).toBe(true);
      expect(server.fixtureErrors()).toEqual([]);
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
    }, fixture.staleHomeChunk, {
      sessionRecovery: true,
      safeSessionSnapshot: true,
      fieldCheckObservations: true,
      completeHomeFixture: true,
      initialUserId: "pwa-session-manager",
    });

    try {
      await page.context().addCookies([{
        name: "rc_auth", value: "disposable-fixture-session", url: server.baseUrl,
        httpOnly: true, sameSite: "Lax",
      }]);
      const healthyHomeResponses = [
        page.waitForResponse((response) =>
          new URL(response.url()).pathname === "/api/sync/reset-epoch" && response.status() === 200,
        ),
        page.waitForResponse((response) =>
          new URL(response.url()).pathname === "/api/factory-data" && response.status() === 200,
        ),
        page.waitForResponse((response) =>
          new URL(response.url()).pathname === "/api/master-data/bootstrap" && response.status() === 200,
        ),
      ];
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await Promise.all(healthyHomeResponses);
      try {
        await page.waitForFunction(async () => {
          const registration = await navigator.serviceWorker.ready;
          return registration.active?.state === "activated";
        });
      } catch (error) {
        const serviceWorkerState = await page.evaluate(async () => {
          if (!("serviceWorker" in navigator)) {
            return { supported: false, secureContext: isSecureContext, registrations: [] };
          }
          const registrations = await navigator.serviceWorker.getRegistrations();
          return {
            supported: true,
            secureContext: isSecureContext,
            hasController: Boolean(navigator.serviceWorker.controller),
            registrations: registrations.map((registration) => ({
              active: registration.active?.state ?? null,
              installing: registration.installing?.state ?? null,
              waiting: registration.waiting?.state ?? null,
            })),
          };
        }).catch(() => ({ evaluationFailed: true }));
        throw new Error(
          `Service worker did not activate: ${JSON.stringify({
            serviceWorkerState,
            fixtureErrorCount: server.fixtureErrors().length,
            cause: error instanceof Error ? error.message : String(error),
          })}`,
        );
      }
      const controlledHomeReady = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/sync/today" && response.status() === 200,
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await controlledHomeReady;
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await expect(page.getByTestId("button-start-run")).toBeVisible();
      await expect(page.getByText(/Couldn't confirm the current production state/i)).toHaveCount(0);
      await expect(page.getByText("Offline — local projection", { exact: true })).toHaveCount(0);
      await expect(page.getByText(/Operational lists unavailable/i)).toHaveCount(0);
      await expect(page.getByText(/Directory unavailable/i)).toHaveCount(0);
      await expect(page.getByText(/not loaded from the server/i)).toHaveCount(0);
      await expect(page.getByText(/tracking is paused/i)).toHaveCount(0);
      expect(server.homeApiFallbacks()).toEqual([]);
      await expect(page.getByTestId("app-update-control"))
        .toHaveAttribute("data-update-reload-safe", "true");

      server.publish("new");
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        if (!registration) throw new Error("Expected a service-worker registration");
        await registration.update();
      });
      await expect(page.getByRole("button", {
        name: "App updates · Update ready", exact: true,
      })).toBeVisible({
        timeout: 20_000,
      });

      try {
        await page.waitForFunction(
          () => document.body.dataset.pwaSmokeBuild === "new",
          undefined,
          { timeout: 20_000 },
        );
      } catch (error) {
        const handoffState = await page.evaluate(async () => {
          const rawEvents = sessionStorage.getItem("run-calc:pwa-update-diagnostics:v1");
          let events: Array<Record<string, unknown>> = [];
          try {
            const parsed: unknown = rawEvents ? JSON.parse(rawEvents) : [];
            if (Array.isArray(parsed)) {
              events = parsed.map((event) => {
                if (!event || typeof event !== "object") return {};
                const value = event as Record<string, unknown>;
                return {
                  phase: value.phase,
                  stage: value.stage,
                  running: value.running,
                  target: value.target,
                };
              });
            }
          } catch { /* The diagnostic is optional; the failure remains explicit. */ }
          const registrations = "serviceWorker" in navigator
            ? await navigator.serviceWorker.getRegistrations()
            : [];
          return {
            build: document.body.dataset.pwaSmokeBuild ?? null,
            updateButtonVisible: [...document.querySelectorAll("button")]
              .some((button) => button.textContent?.includes("Update ready")),
            reloadSafe: document.querySelector('[data-testid="app-update-control"]')
              ?.getAttribute("data-update-reload-safe") ?? null,
            reloadIdle: document.querySelector('[data-testid="app-update-control"]')
              ?.getAttribute("data-update-reload-idle") ?? null,
            recoveryNoticeVisible: document.body.innerText.includes(
              "Couldn't confirm the current production state",
            ),
            offlineProjectionVisible: document.body.innerText.includes(
              "Offline — local projection",
            ),
            trackingPausedVisible: document.body.innerText.includes("tracking is paused"),
            openDialogCount: document.querySelectorAll('[role="dialog"]').length,
            events,
            workers: registrations.map((registration) => ({
              active: registration.active?.state ?? null,
              installing: registration.installing?.state ?? null,
              waiting: registration.waiting?.state ?? null,
            })),
          };
        }).catch(() => ({ evaluationFailed: true }));
        const recoveryRequests = server.sessionRecoveryRequests();
        throw new Error(
          `App did not auto-reload into the published build: ${JSON.stringify({
            handoffState,
            recoveryRequests: {
              syncReads: recoveryRequests.syncReads,
              syncWrites: recoveryRequests.syncWrites,
              acceptedWrites: recoveryRequests.acceptedWrites,
              rejected: recoveryRequests.rejected,
              me: recoveryRequests.me,
              acceptedMeResponses: recoveryRequests.acceptedMeResponses,
            },
            homeApiFallbackCount: server.homeApiFallbacks().length,
            fixtureErrorCount: server.fixtureErrors().length,
            cause: error instanceof Error ? error.message : String(error),
          })}`,
        );
      }
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
    }, fixture.staleHomeChunk, {
      sessionRecovery: true,
      safeSessionSnapshot: true,
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    try {
      // Manual recovery must satisfy the same authenticated, idle-work safety
      // contract as automatic recovery; an unidentified session must stay put.
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: server.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await startOldBuildThenTriggerStaleAssetFailure(page, server, fixture.staleHomeChunk);
      await expect.poll(() => server.sessionRecoveryRequests().acceptedMeResponses)
        .toBeGreaterThan(0);

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

  test("automatically confirms stale-app recovery after safe idle authenticated startup", async ({
    page,
  }) => {
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      fixture.staleHomeChunk,
      {
        sessionRecovery: true,
        safeSessionSnapshot: true,
        fieldCheckObservations: true,
      },
    );

    try {
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: server.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await page.addInitScript(() => {
        const markerKey = "run-calc:stale-asset-recovery-pending:v1";
        const captureKey = "__pwa_recovery_marker_capture";
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (this === window.sessionStorage && key === markerKey) {
            const captured = JSON.parse(localStorage.getItem(captureKey) ?? "[]") as string[];
            captured.push(value);
            localStorage.setItem(captureKey, JSON.stringify(captured));
          }
          return originalSetItem.call(this, key, value);
        };
      });
      await startOldBuildThenTriggerStaleAssetFailure(
        page,
        server,
        fixture.staleHomeChunk,
      );
      await expect.poll(() => server.sessionRecoveryRequests().acceptedMeResponses)
        .toBeGreaterThan(0);
      const authenticatedStartsBeforeRecovery =
        server.sessionRecoveryRequests().acceptedMeResponses;

      // Do not tap the error screen's manual recovery button. Safe-idle recovery
      // must install the new worker and reload this authenticated session itself.
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", {
        timeout: 30_000,
      });
      await expect(page.getByTestId("button-start-run")).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => server.sessionRecoveryRequests().acceptedMeResponses)
        .toBeGreaterThan(authenticatedStartsBeforeRecovery);
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state === "activated" &&
          Boolean(navigator.serviceWorker.controller);
      });

      await expect.poll(() => server.fieldCheckObservations()
        .flatMap((batch) => batch.observations)
        .filter((observation) =>
          (observation as { checkName?: string; outcome?: string }).checkName ===
            "stale-deployment-recovery" &&
          (observation as { outcome?: string }).outcome === "success",
        ).length).toBe(1);

      const batches = server.fieldCheckObservations();
      const recoveryObservations = batches.flatMap((batch) =>
        batch.observations.map((observation) => ({
          observation: observation as {
            checkName?: string;
            outcome?: string;
            appBuild?: string;
            metrics?: Record<string, unknown>;
          },
          acceptedMeResponsesAtReceipt: batch.acceptedMeResponsesAtReceipt,
        })),
      ).filter(({ observation }) =>
        observation.checkName === "stale-deployment-recovery",
      );
      expect(recoveryObservations).toHaveLength(1);
      expect(recoveryObservations[0]).toMatchObject({
        observation: {
          outcome: "success",
          appBuild: "pwa-new-build",
          metrics: {},
        },
      });
      expect(recoveryObservations[0].acceptedMeResponsesAtReceipt)
        .toBeGreaterThan(authenticatedStartsBeforeRecovery);

      const markerSnapshots = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("__pwa_recovery_marker_capture") ?? "[]") as string[],
      );
      expect(markerSnapshots).toHaveLength(1);
      const marker = JSON.parse(markerSnapshots[0]);
      expect(Object.keys(marker).sort()).toEqual(["attemptedAt", "fromBuild"]);
      expect(marker).toMatchObject({
        fromBuild: expect.stringMatching(/^[a-f0-9]{1,8}$/),
        attemptedAt: expect.any(Number),
      });
      expect(markerSnapshots[0]).not.toMatch(/https?:|old-build/);
      const lifecycle = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("__pwa_recovery_worker_lifecycle") ?? "[]") as
          Array<{ kind: string; state?: string }>,
      );
      expect(lifecycle).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "worker-state", state: "installed" }),
        expect.objectContaining({ kind: "worker-state", state: "activated" }),
      ]));
      expect(server.staleAssetRequestCount()).toBe(1);
      expect(server.fixtureErrors()).toEqual([]);
    } finally {
      await server.close();
    }
  });

  test("keeps the old build when a run starts during safe-idle recovery", async ({
    page,
  }) => {
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      fixture.staleHomeChunk,
      {
        sessionRecovery: true,
        safeSessionSnapshot: true,
        fieldCheckObservations: true,
      },
    );

    try {
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: server.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await page.addInitScript(() => {
        const markerKey = "run-calc:stale-asset-recovery-pending:v1";
        const captureKey = "__pwa_late_run_recovery_marker_capture";
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (this === window.sessionStorage && key === markerKey) {
            const captured = JSON.parse(localStorage.getItem(captureKey) ?? "[]") as string[];
            captured.push(value);
            localStorage.setItem(captureKey, JSON.stringify(captured));
          }
          return originalSetItem.call(this, key, value);
        };
      });

      let initialSnapshotDate = "";
      await startOldBuildThenTriggerStaleAssetFailure(
        page,
        server,
        fixture.staleHomeChunk,
        async () => {
          const snapshot = await page.evaluate(async () => {
            const now = new Date();
            const today = [
              now.getFullYear(),
              String(now.getMonth() + 1).padStart(2, "0"),
              String(now.getDate()).padStart(2, "0"),
            ].join("-");
            const response = await fetch(
              `/api/sync/today?today=${encodeURIComponent(today)}`,
              { cache: "no-store", credentials: "same-origin" },
            );
            return {
              ok: response.ok,
              complete: response.headers.get("X-Sync-Response"),
              today,
              body: await response.json() as {
                completeness?: string;
                dayState?: { date?: string; runs?: unknown[] };
              },
            };
          });
          expect(snapshot).toMatchObject({
            ok: true,
            complete: "complete",
            body: {
              completeness: "complete",
              dayState: { date: snapshot.today, runs: [] },
            },
          });
          initialSnapshotDate = snapshot.today;
        },
      );
      await expect.poll(() => server.sessionRecoveryRequests().acceptedMeResponses)
        .toBeGreaterThan(0);

      const snapshotsBeforeRunStarts = server.sessionSnapshotReads().length;
      server.setSnapshotActiveRun(true);
      await expect.poll(() => server.sessionSnapshotReads().some(
        (snapshot, index) =>
          index >= snapshotsBeforeRunStarts &&
          snapshot.date === initialSnapshotDate &&
          snapshot.activeRun,
      )).toBe(true);

      // A run started on another device after the safe snapshot. The delayed
      // authenticated recheck must cancel recovery before worker/cache changes.
      await expect(page.getByText(
        /automatic recovery is paused because the app could not confirm that reloading was safe/i,
      )).toBeVisible();
      await page.waitForTimeout(1_500);
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(page.getByRole("button", { name: "Update and reload" })).toBeVisible();
      expect(await page.evaluate(() =>
        sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1"),
      )).toBeNull();
      expect(await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("__pwa_late_run_recovery_marker_capture") ?? "[]",
        ) as string[],
      )).toEqual([]);

      const outcomes = server.fieldCheckObservations()
        .flatMap((batch) => batch.observations) as Array<{
          checkName: string;
          outcome: string;
        }>;
      expect(outcomes.filter((item) =>
        item.checkName === "stale-deployment-recovery" && item.outcome === "success",
      )).toHaveLength(0);
      expect(server.staleAssetRequestCount()).toBe(1);
      expect(server.fixtureErrors()).toEqual([]);
    } finally {
      await server.close();
    }
  });

  test("opens Home after the pre-Home day-state read throws without recovering a stale chunk", async ({
    page,
  }) => {
    const homeServer = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      undefined,
      { sessionRecovery: true },
    );
    const staleChunkServer = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      fixture.staleHomeChunk,
      { sessionRecovery: true, fieldCheckObservations: true },
    );

    try {
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: homeServer.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await page.addInitScript(() => {
        const dayStateKey = "run-calc-day";
        const originalGetItem = Storage.prototype.getItem;
        const evidence = { firstReadThrew: false, successfulReads: 0 };
        Object.defineProperty(window, "__pwaDayStateReadEvidence", {
          value: evidence,
        });
        Storage.prototype.getItem = function (key: string) {
          if (
            this === window.localStorage &&
            key === dayStateKey &&
            !evidence.firstReadThrew
          ) {
            evidence.firstReadThrew = true;
            throw new DOMException("Storage is blocked", "SecurityError");
          }
          const value = originalGetItem.call(this, key);
          if (this === window.localStorage && key === dayStateKey) {
            evidence.successfulReads += 1;
          }
          return value;
        };

        const markerKey = "run-calc:stale-asset-recovery-pending:v1";
        const captureKey = "__pwa_recovery_marker_capture";
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (this === window.sessionStorage && key === markerKey) {
            const captured = JSON.parse(localStorage.getItem(captureKey) ?? "[]") as string[];
            captured.push(value);
            localStorage.setItem(captureKey, JSON.stringify(captured));
          }
          return originalSetItem.call(this, key, value);
        };
      });

      await page.goto(homeServer.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("button-start-run")).toBeVisible({ timeout: 20_000 });
      const homeStorageReadEvidence = await page.evaluate(() => (
        window as Window & {
          __pwaDayStateReadEvidence?: {
            firstReadThrew: boolean;
            successfulReads: number;
          };
        }
      ).__pwaDayStateReadEvidence);
      expect(homeStorageReadEvidence?.firstReadThrew).toBe(true);
      expect(homeStorageReadEvidence?.successfulReads).toBeGreaterThan(0);
      expect(homeServer.sessionRecoveryRequests().acceptedMeResponses).toBeGreaterThan(0);

      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: staleChunkServer.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await startOldBuildThenTriggerStaleAssetFailure(
        page,
        staleChunkServer,
        fixture.staleHomeChunk,
      );
      await expect(page.getByText(
        /automatic recovery is paused because the app could not confirm that reloading was safe/i,
      )).toBeVisible();

      const storageReadEvidence = await page.evaluate(() => {
        const evidence = (
          window as Window & {
            __pwaDayStateReadEvidence?: {
              firstReadThrew: boolean;
              successfulReads: number;
            };
          }
        ).__pwaDayStateReadEvidence;
        const successfulReadsBeforeProbe = evidence?.successfulReads ?? 0;
        const value = localStorage.getItem("run-calc-day");
        return {
          firstReadThrew: evidence?.firstReadThrew ?? false,
          successfulReadsBeforeProbe,
          value,
          laterReadWorks: true,
        };
      });
      expect(storageReadEvidence.firstReadThrew).toBe(true);
      expect(storageReadEvidence.laterReadWorks).toBe(true);

      // The shortened production idle timer has elapsed, but a failed local
      // day-state read must not authorize an automatic reload.
      await page.waitForTimeout(1_500);
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(page.getByRole("button", { name: "Update and reload" })).toBeVisible();
      expect(await page.evaluate(() =>
        sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1"),
      )).toBeNull();
      expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("__pwa_recovery_marker_capture") ?? "[]") as string[],
      )).toEqual([]);

      const observations = staleChunkServer.fieldCheckObservations()
        .flatMap((batch) => batch.observations) as Array<{
          checkName: string;
          outcome: string;
        }>;
      expect(observations.filter((item) =>
        item.checkName === "stale-deployment-recovery" && item.outcome === "success",
      )).toHaveLength(0);
      expect(staleChunkServer.staleAssetRequestCount()).toBe(1);
      expect(homeServer.fixtureErrors()).toEqual([]);
      expect(staleChunkServer.fixtureErrors()).toEqual([]);
    } finally {
      if (!page.isClosed()) await page.context().setOffline(false);
      await homeServer.close();
      await staleChunkServer.close();
    }
  });

  test("opens Home when day-state storage stays unavailable without recovering a stale chunk", async ({
    page,
  }) => {
    const homeServer = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      undefined,
      { sessionRecovery: true },
    );
    const staleChunkServer = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      fixture.staleHomeChunk,
      { sessionRecovery: true, fieldCheckObservations: true },
    );

    try {
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: homeServer.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await page.addInitScript(() => {
        const dayStateKey = "run-calc-day";
        const evidence = { readFailures: 0, writeFailures: 0 };
        Object.defineProperty(window, "__pwaPersistentDayStateFailureEvidence", {
          value: evidence,
        });

        const originalGetItem = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key: string) {
          if (this === window.localStorage && key === dayStateKey) {
            evidence.readFailures += 1;
            throw new DOMException("Storage is blocked", "SecurityError");
          }
          return originalGetItem.call(this, key);
        };

        const markerKey = "run-calc:stale-asset-recovery-pending:v1";
        const captureKey = "__pwa_recovery_marker_capture";
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (this === window.localStorage && key === dayStateKey) {
            evidence.writeFailures += 1;
            throw new DOMException("Storage is blocked", "SecurityError");
          }
          if (this === window.sessionStorage && key === markerKey) {
            const captured = JSON.parse(localStorage.getItem(captureKey) ?? "[]") as string[];
            captured.push(value);
            localStorage.setItem(captureKey, JSON.stringify(captured));
          }
          return originalSetItem.call(this, key, value);
        };
      });

      await page.goto(homeServer.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("button-start-run")).toBeVisible({ timeout: 20_000 });
      const homeStorageEvidence = await page.evaluate(() => {
        const evidence = (
          window as Window & {
            __pwaPersistentDayStateFailureEvidence?: {
              readFailures: number;
              writeFailures: number;
            };
          }
        ).__pwaPersistentDayStateFailureEvidence;
        let writeProbeRejected = false;
        try {
          localStorage.setItem("run-calc-day", "{}");
        } catch {
          writeProbeRejected = true;
        }
        return { ...evidence, writeProbeRejected };
      });
      expect(homeStorageEvidence?.readFailures).toBeGreaterThan(0);
      expect(homeStorageEvidence?.writeFailures).toBeGreaterThan(0);
      expect(homeStorageEvidence?.writeProbeRejected).toBe(true);
      expect(homeServer.sessionRecoveryRequests().acceptedMeResponses).toBeGreaterThan(0);

      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: staleChunkServer.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await startOldBuildThenTriggerStaleAssetFailure(
        page,
        staleChunkServer,
        fixture.staleHomeChunk,
      );
      await expect(page.getByText(
        /automatic recovery is paused because the app could not confirm that reloading was safe/i,
      )).toBeVisible();

      const blockedStorageEvidence = await page.evaluate(() => {
        const evidence = (
          window as Window & {
            __pwaPersistentDayStateFailureEvidence?: {
              readFailures: number;
              writeFailures: number;
            };
          }
        ).__pwaPersistentDayStateFailureEvidence;
        let writeProbeRejected = false;
        try {
          localStorage.setItem("run-calc-day", "{}");
        } catch {
          writeProbeRejected = true;
        }
        return { ...evidence, writeProbeRejected };
      });
      expect(blockedStorageEvidence?.readFailures).toBeGreaterThan(0);
      expect(blockedStorageEvidence?.writeFailures).toBeGreaterThan(0);
      expect(blockedStorageEvidence?.writeProbeRejected).toBe(true);

      // Persistent day-state failures keep pre-Home safety unknown; elapsed
      // idle time must not turn that unknown state into an automatic reload.
      await page.waitForTimeout(1_500);
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(page.getByRole("button", { name: "Update and reload" })).toBeVisible();
      expect(await page.evaluate(() =>
        sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1"),
      )).toBeNull();
      expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("__pwa_recovery_marker_capture") ?? "[]") as string[],
      )).toEqual([]);

      const observations = staleChunkServer.fieldCheckObservations()
        .flatMap((batch) => batch.observations) as Array<{
          checkName: string;
          outcome: string;
        }>;
      expect(observations.filter((item) =>
        item.checkName === "stale-deployment-recovery" && item.outcome === "success",
      )).toHaveLength(0);
      expect(staleChunkServer.staleAssetRequestCount()).toBe(1);
      expect(homeServer.fixtureErrors()).toEqual([]);
      expect(staleChunkServer.fixtureErrors()).toEqual([]);
    } finally {
      if (!page.isClosed()) await page.context().setOffline(false);
      await homeServer.close();
      await staleChunkServer.close();
    }
  });

  test("opens Home when every localStorage operation is blocked without stale-app recovery", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const homeServer = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      undefined,
      { sessionRecovery: true },
    );
    const staleChunkServer = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      fixture.staleHomeChunk,
      { sessionRecovery: true, fieldCheckObservations: true },
    );

    try {
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: homeServer.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await page.addInitScript(() => {
        const failures = {
          getItem: 0,
          setItem: 0,
          removeItem: 0,
          clear: 0,
          key: 0,
          length: 0,
          unhandledRejections: [] as string[],
          staleRecoveryMarkers: [] as string[],
        };
        Object.defineProperty(window, "__pwaWholeLocalStorageFailureEvidence", {
          value: failures,
        });
        window.addEventListener("unhandledrejection", (event) => {
          const reason = event.reason as { message?: unknown; stack?: unknown } | null;
          failures.unhandledRejections.push(
            `${String(reason?.message ?? reason)}\n${String(reason?.stack ?? "")}`,
          );
        });

        const failLocalStorage = (
          operation: "getItem" | "setItem" | "removeItem" | "clear" | "key" | "length",
        ) => {
          failures[operation] += 1;
          const error = new Error("All localStorage operations are blocked");
          error.name = "SecurityError";
          throw error;
        };
        const methods = ["getItem", "setItem", "removeItem", "clear", "key"] as const;
        for (const method of methods) {
          const original = Storage.prototype[method];
          Storage.prototype[method] = function (...args) {
            if (this === window.localStorage) {
              failLocalStorage(method);
            }
            return original.apply(this, args);
          } as typeof original;
        }

        const lengthDescriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "length");
        if (!lengthDescriptor?.get) {
          throw new Error("Storage.length cannot be instrumented by the PWA fixture");
        }
        Object.defineProperty(Storage.prototype, "length", {
          configurable: true,
          enumerable: lengthDescriptor.enumerable,
          get() {
            if (this === window.localStorage) failLocalStorage("length");
            return lengthDescriptor.get!.call(this);
          },
        });

        const markerKey = "run-calc:stale-asset-recovery-pending:v1";
        const originalSessionSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (this === window.sessionStorage && key === markerKey) {
            failures.staleRecoveryMarkers.push(value);
          }
          return originalSessionSetItem.call(this, key, value);
        };
      });

      await page.goto(homeServer.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("button-start-run")).toBeVisible({ timeout: 20_000 });
      expect(homeServer.sessionRecoveryRequests().acceptedMeResponses).toBeGreaterThan(0);
      const startupStorageEvidence = await page.evaluate(() => {
        const evidence = (
          window as Window & {
            __pwaWholeLocalStorageFailureEvidence?: {
              getItem: number;
              setItem: number;
              removeItem: number;
              clear: number;
              key: number;
              length: number;
              unhandledRejections: string[];
            };
          }
        ).__pwaWholeLocalStorageFailureEvidence;
        const probe = (run: () => unknown) => {
          try {
            run();
            return false;
          } catch {
            return true;
          }
        };
        return {
          ...evidence,
          probesRejected: {
            getItem: probe(() => localStorage.getItem("unrelated-startup-key")),
            setItem: probe(() => localStorage.setItem("unrelated-startup-key", "fixture")),
            removeItem: probe(() => localStorage.removeItem("unrelated-startup-key")),
            clear: probe(() => localStorage.clear()),
            key: probe(() => localStorage.key(0)),
            length: probe(() => localStorage.length),
          },
        };
      });
      expect(startupStorageEvidence.getItem).toBeGreaterThan(0);
      expect(startupStorageEvidence.setItem).toBeGreaterThan(0);
      expect(startupStorageEvidence.probesRejected).toEqual({
        getItem: true,
        setItem: true,
        removeItem: true,
        clear: true,
        key: true,
        length: true,
      });
      expect(pageErrors).toEqual([]);
      expect(startupStorageEvidence.unhandledRejections).toEqual([]);

      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: staleChunkServer.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await startOldBuildThenTriggerStaleAssetFailure(
        page,
        staleChunkServer,
        fixture.staleHomeChunk,
        undefined,
        false,
      );
      await expect(page.getByText(
        /automatic recovery is paused because the app could not confirm that reloading was safe/i,
      )).toBeVisible();

      await page.waitForTimeout(1_500);
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(page.getByRole("button", { name: "Update and reload" })).toBeVisible();
      const blockedStorageEvidence = await page.evaluate(() => (
        window as Window & {
          __pwaWholeLocalStorageFailureEvidence?: {
            getItem: number;
            setItem: number;
            removeItem: number;
            clear: number;
            key: number;
            length: number;
            staleRecoveryMarkers: string[];
          };
        }
      ).__pwaWholeLocalStorageFailureEvidence);
      expect(blockedStorageEvidence?.getItem).toBeGreaterThan(0);
      expect(blockedStorageEvidence?.setItem).toBeGreaterThan(0);
      expect(blockedStorageEvidence?.staleRecoveryMarkers).toEqual([]);
      expect(pageErrors).toEqual([]);

      const observations = staleChunkServer.fieldCheckObservations()
        .flatMap((batch) => batch.observations) as Array<{
          checkName: string;
          outcome: string;
        }>;
      expect(observations.filter((item) =>
        item.checkName === "stale-deployment-recovery" && item.outcome === "success",
      )).toHaveLength(0);
      expect(staleChunkServer.staleAssetRequestCount()).toBe(1);
      expect(homeServer.fixtureErrors()).toEqual([]);
      expect(staleChunkServer.fixtureErrors()).toEqual([]);
    } finally {
      if (!page.isClosed()) await page.context().setOffline(false);
      await homeServer.close();
      await staleChunkServer.close();
    }
  });

  test("opens Home after a pre-Home safety timeout without automatically recovering a stale chunk", async ({
    page,
  }) => {
    const homeServer = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      undefined,
      { sessionRecovery: true, preHomeSafetyTimeout: true },
    );
    const staleChunkServer = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      fixture.staleHomeChunk,
      {
        sessionRecovery: true,
        preHomeSafetyTimeout: true,
        fieldCheckObservations: true,
      },
    );

    try {
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: homeServer.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await page.goto(homeServer.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("button-start-run")).toBeVisible({ timeout: 20_000 });
      expect(homeServer.sessionRecoveryRequests().preHomeSafetyTimeouts).toBe(1);

      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: staleChunkServer.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await page.addInitScript(() => {
        const markerKey = "run-calc:stale-asset-recovery-pending:v1";
        const captureKey = "__pwa_recovery_marker_capture";
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (this === window.sessionStorage && key === markerKey) {
            const captured = JSON.parse(localStorage.getItem(captureKey) ?? "[]") as string[];
            captured.push(value);
            localStorage.setItem(captureKey, JSON.stringify(captured));
          }
          return originalSetItem.call(this, key, value);
        };
      });
      await startOldBuildThenTriggerStaleAssetFailure(
        page,
        staleChunkServer,
        fixture.staleHomeChunk,
      );
      await expect.poll(() => staleChunkServer.sessionRecoveryRequests().preHomeSafetyTimeouts)
        .toBe(1);
      await expect.poll(() => staleChunkServer.sessionRecoveryRequests().acceptedMeResponses)
        .toBeGreaterThan(0);
      await expect(page.getByText(
        /automatic recovery is paused because the app could not confirm that reloading was safe/i,
      )).toBeVisible();

      // The shortened production idle timer has elapsed, but unavailable
      // current-day safety data must not authorize an automatic reload.
      await page.waitForTimeout(1_500);
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(page.getByRole("button", { name: "Update and reload" })).toBeVisible();
      expect(await page.evaluate(() =>
        sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1"),
      )).toBeNull();
      expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("__pwa_recovery_marker_capture") ?? "[]") as string[],
      )).toEqual([]);

      const observations = staleChunkServer.fieldCheckObservations()
        .flatMap((batch) => batch.observations) as Array<{
          checkName: string;
          outcome: string;
        }>;
      expect(observations.filter((item) =>
        item.checkName === "stale-deployment-recovery" && item.outcome === "success",
      )).toHaveLength(0);
      expect(staleChunkServer.staleAssetRequestCount()).toBe(1);
      expect(staleChunkServer.fixtureErrors()).toEqual([]);
    } finally {
      if (!page.isClosed()) await page.context().setOffline(false);
      await homeServer.close();
      await staleChunkServer.close();
    }
  });

  test("keeps offline field-check evidence with its live or sandbox account", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      undefined,
      {
        sessionRecovery: true,
        sessionRecoveryIntentOutbox: true,
        fieldCheckObservations: true,
        initialUserId: "pwa-session-manager",
      },
    );

    try {
      await page.route("https://fonts.googleapis.com/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/css", body: "" }),
      );
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: server.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("button-start-run")).toBeVisible();
      await expect.poll(() => server.fieldCheckObservations().length).toBeGreaterThan(0);

      server.failNextFieldCheckObservations();
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent(
        "calculator-field-check-signal",
        { detail: { checkName: "offline-queue-replay", outcome: "failure" } },
      )));
      const queuedLiveObservationId = await page.evaluate(async () => {
        const findQueuedObservation = () => {
          const queue = JSON.parse(
            localStorage.getItem("run-calc-field-check-queue") ?? "[]",
          ) as Array<{ observationId?: string; checkName?: string; originScope?: string }>;
          return queue.find((item) => item.checkName === "offline-queue-replay") ?? null;
        };
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const item = findQueuedObservation();
          if (item) return item;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return null;
      });
      expect(queuedLiveObservationId).toMatchObject({
        checkName: "offline-queue-replay",
        originScope: "live:pwa-session-manager",
      });
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect.poll(() => server.fieldCheckRequests().filter((request) =>
        request.status === 503,
      ).length).toBe(1);

      await page.evaluate(async () => {
        const response = await fetch("/api/auth/sign-out", { method: "POST" });
        if (!response.ok) throw new Error(`Sign-out failed (${response.status})`);
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toBeVisible();
      await page.getByLabel("Username").fill("pwa-sandbox-user");
      await page.locator("#password").fill("disposable-fixture");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toHaveCount(0);
      await expect(page.getByText(
        "Sandbox mode — changes here are isolated and never affect live data.",
      )).toBeVisible();
      await expect.poll(() => server.fieldCheckRequests().some((request) =>
        request.userId === "pwa-sandbox-user" && request.sandbox && request.status === 202,
      )).toBe(true);

      const observationsBeforeReturningLive = server.fieldCheckObservations()
        .flatMap((batch) => batch.observations) as Array<{ observationId: string }>;
      expect(observationsBeforeReturningLive.some((item) =>
        item.observationId === queuedLiveObservationId?.observationId,
      )).toBe(false);
      expect(await page.evaluate((observationId) => {
        const queue = JSON.parse(localStorage.getItem("run-calc-field-check-queue") ?? "[]") as
          Array<{ observationId?: string; originScope?: string }>;
        return queue.find((item) => item.observationId === observationId) ?? null;
      }, queuedLiveObservationId?.observationId)).toMatchObject({
        observationId: queuedLiveObservationId?.observationId,
        originScope: "live:pwa-session-manager",
      });

      await page.evaluate(async () => {
        const response = await fetch("/api/auth/sign-out", { method: "POST" });
        if (!response.ok) throw new Error(`Sign-out failed (${response.status})`);
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toBeVisible();
      await page.getByLabel("Username").fill("pwa-session-manager");
      await page.locator("#password").fill("disposable-fixture");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("auth-screen")).toHaveCount(0);
      await expect.poll(() => server.fieldCheckObservations()
        .flatMap((batch) => batch.observations)
        .some((item) =>
          (item as { observationId?: string }).observationId ===
          queuedLiveObservationId?.observationId,
        )).toBe(true);
      expect(server.fieldCheckRequests().some((request) =>
        request.userId === "pwa-session-manager" && !request.sandbox && request.status === 202,
      )).toBe(true);
      expect(pageErrors).toEqual([]);
      expect(server.fixtureErrors()).toEqual([]);
    } finally {
      if (!page.isClosed()) await page.context().setOffline(false);
      await server.close();
    }
  });

  test("does not automatically reload a stale app while a production run is active", async ({
    page,
  }) => {
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      fixture.staleHomeChunk,
      { sessionRecovery: true, fieldCheckObservations: true },
    );

    try {
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: server.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await startOldBuildThenTriggerStaleAssetFailure(
        page,
        server,
        fixture.staleHomeChunk,
      );
      await expect.poll(() => server.sessionRecoveryRequests().acceptedMeResponses)
        .toBeGreaterThan(0);
      await expect(page.getByText(
        /automatic recovery is paused because the app could not confirm that reloading was safe/i,
      )).toBeVisible();

      // The fixture snapshot contains an active run, so waiting past the
      // shortened idle interval must not trigger the automatic path.
      await page.waitForTimeout(1_500);
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await expect(page.getByRole("button", { name: "Update and reload" })).toBeVisible();
      expect(await page.evaluate(() =>
        sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1"),
      )).toBeNull();
      const outcomes = server.fieldCheckObservations()
        .flatMap((batch) => batch.observations) as Array<{
          checkName: string;
          outcome: string;
        }>;
      expect(outcomes.filter((item) =>
        item.checkName === "stale-deployment-recovery" && item.outcome === "success",
      )).toHaveLength(0);
      expect(server.staleAssetRequestCount()).toBe(1);
      expect(server.fixtureErrors()).toEqual([]);
    } finally {
      await server.close();
    }
  });

  test("confirms stale-app recovery once after the updated worker reloads into an authenticated build", async ({
    page,
  }) => {
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      fixture.staleHomeChunk,
      { sessionRecovery: true, fieldCheckObservations: true, safeSessionSnapshot: true },
    );

    try {
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: server.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await page.addInitScript(() => {
        // Model manual recovery through activity, not by inventing an active
        // server run that the explicit update would now correctly refuse.
        setInterval(() => window.dispatchEvent(new Event("mousedown")), 250);
        const markerKey = "run-calc:stale-asset-recovery-pending:v1";
        const captureKey = "__pwa_recovery_marker_capture";
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (this === window.sessionStorage && key === markerKey) {
            const captured = JSON.parse(localStorage.getItem(captureKey) ?? "[]") as string[];
            captured.push(value);
            localStorage.setItem(captureKey, JSON.stringify(captured));
          }
          return originalSetItem.call(this, key, value);
        };
      });
      await startOldBuildThenTriggerStaleAssetFailure(
        page,
        server,
        fixture.staleHomeChunk,
      );
      await expect.poll(() => server.sessionRecoveryRequests().acceptedMeResponses)
        .toBeGreaterThan(0);
      const authenticatedStartsBeforeReload =
        server.sessionRecoveryRequests().acceptedMeResponses;

      await page.getByRole("button", { name: "Update and reload" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", {
        timeout: 20_000,
      });
      await expect(page.getByTestId("button-start-run")).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => server.sessionRecoveryRequests().acceptedMeResponses)
        .toBeGreaterThan(authenticatedStartsBeforeReload);
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state === "activated" &&
          Boolean(navigator.serviceWorker.controller);
      });

      await expect.poll(() => server.fieldCheckObservations()
        .flatMap((batch) => batch.observations)
        .filter((observation) =>
          (observation as { checkName?: string; outcome?: string }).checkName ===
            "stale-deployment-recovery" &&
          (observation as { outcome?: string }).outcome === "success",
        ).length).toBe(1);

      const observations = server.fieldCheckObservations()
        .flatMap((batch) => batch.observations) as Array<{
          checkName: string;
          outcome: string;
          appBuild: string;
          metrics: Record<string, unknown>;
        }>;
      const recoveryObservations = observations.filter(
        (observation) => observation.checkName === "stale-deployment-recovery",
      );
      expect(recoveryObservations).toHaveLength(1);
      expect(recoveryObservations[0]).toMatchObject({
        outcome: "success",
        appBuild: "pwa-new-build",
        metrics: {},
      });
      expect(server.sessionRecoveryRequests().acceptedMeResponses)
        .toBeGreaterThan(authenticatedStartsBeforeReload);

      const markerSnapshots = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("__pwa_recovery_marker_capture") ?? "[]") as string[],
      );
      expect(markerSnapshots).toHaveLength(1);
      const marker = JSON.parse(markerSnapshots[0]);
      expect(Object.keys(marker).sort()).toEqual(["attemptedAt", "fromBuild"]);
      expect(marker).toMatchObject({
        fromBuild: expect.stringMatching(/^[a-f0-9]{1,8}$/),
        attemptedAt: expect.any(Number),
      });
      expect(markerSnapshots[0]).not.toMatch(/https?:|old-build/);
      const lifecycle = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("__pwa_recovery_worker_lifecycle") ?? "[]") as
          Array<{ kind: string; state?: string }>,
      );
      expect(lifecycle).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "worker-state", state: "installed" }),
        expect.objectContaining({ kind: "worker-state", state: "activated" }),
      ]));
      expect(JSON.stringify(observations)).not.toMatch(
        /https?:|stack|userId|clientId|deviceId|runId|errorStack|errorUrl/i,
      );
      expect(server.staleAssetRequestCount()).toBe(1);
      expect(server.fixtureErrors()).toEqual([]);
    } finally {
      await server.close();
    }
  });

  test("keeps stale-recovery confirmation local to the tab that attempted recovery", async ({
    page,
  }) => {
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      fixture.staleHomeChunk,
      { sessionRecovery: true, fieldCheckObservations: true, safeSessionSnapshot: true },
    );
    const otherPage = await page.context().newPage();
    const markerCaptureScript = (testTab: string) => {
      setInterval(() => window.dispatchEvent(new Event("mousedown")), 250);
      const markerKey = "run-calc:stale-asset-recovery-pending:v1";
      const captureKey = "__pwa_tab_local_recovery_marker_capture";
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (this === window.sessionStorage && key === markerKey) {
          const captured = JSON.parse(sessionStorage.getItem(captureKey) ?? "[]") as string[];
          captured.push(value);
          originalSetItem.call(sessionStorage, captureKey, JSON.stringify(captured));
        }
        return originalSetItem.call(this, key, value);
      };
      const originalFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const inputUrl = input instanceof Request ? input.url : String(input);
        const requestUrl = new URL(inputUrl, location.href);
        if (requestUrl.pathname === "/api/me") {
          requestUrl.searchParams.set("__pwa_test_tab", testTab);
          return originalFetch(requestUrl.toString(), init);
        }
        return originalFetch(input, init);
      }) as typeof window.fetch;
    };
    const primaryObservations: Array<Record<string, unknown>> = [];
    const otherObservations: Array<Record<string, unknown>> = [];
    let primaryAcceptedMeResponses = 0;
    let otherAcceptedMeResponses = 0;
    const captureAcceptedObservations = (
      observedPage: typeof page,
      target: Array<Record<string, unknown>>,
    ) => {
      observedPage.on("response", (response) => {
        if (
          new URL(response.url()).pathname !== "/api/field-checks/observations" ||
          response.status() !== 202
        ) return;
        const payload = response.request().postDataJSON() as {
          observations?: Array<Record<string, unknown>>;
        } | null;
        if (Array.isArray(payload?.observations)) target.push(...payload.observations);
      });
    };

    try {
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: server.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await page.addInitScript(markerCaptureScript, "recovery");
      await otherPage.addInitScript(markerCaptureScript, "other");
      captureAcceptedObservations(page, primaryObservations);
      captureAcceptedObservations(otherPage, otherObservations);
      page.on("response", (response) => {
        if (
          new URL(response.url()).pathname === "/api/me" &&
          response.status() === 200
        ) primaryAcceptedMeResponses += 1;
      });
      otherPage.on("response", (response) => {
        if (
          new URL(response.url()).pathname === "/api/me" &&
          response.status() === 200
        ) otherAcceptedMeResponses += 1;
      });

      // Install and control the old worker in the second tab first. It remains
      // a distinct top-level browsing context in the same origin and browser
      // context, so the service-worker registration is shared but sessionStorage
      // is not.
      await otherPage.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(otherPage.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await otherPage.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state === "activated";
      });
      await otherPage.goto("about:blank");
      await otherPage.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
      await expect(otherPage.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
      await otherPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await expect(otherPage.getByTestId("button-start-run")).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => otherAcceptedMeResponses).toBeGreaterThan(0);

      await startOldBuildThenTriggerStaleAssetFailure(
        page,
        server,
        fixture.staleHomeChunk,
      );
      await expect.poll(() => primaryAcceptedMeResponses).toBeGreaterThan(0);
      await expect(page.getByRole("button", { name: "Update and reload" })).toBeVisible();

      // Keep the recovery tab before authenticated startup while the second
      // tab reloads against the already-updated worker. If marker storage were
      // shared, that startup could consume the first tab's evidence.
      server.failNextSessionProbesForTestTab("recovery", 2);
      await page.getByRole("button", { name: "Update and reload" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", {
        timeout: 20_000,
      });
      await expect(page.getByTestId("auth-startup-retry")).toBeVisible({ timeout: 20_000 });
      await expect.poll(
        () => server.sessionRecoveryRequests().temporaryMeFailures,
      ).toBe(2);
      const primaryPendingMarker = await page.evaluate(() =>
        sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1"),
      );
      expect(primaryPendingMarker).not.toBeNull();
      expect(Object.keys(JSON.parse(primaryPendingMarker!)).sort())
        .toEqual(["attemptedAt", "fromBuild"]);

      const otherAuthResponsesBeforeReload = otherAcceptedMeResponses;
      await otherPage.reload({ waitUntil: "domcontentloaded" });
      await expect(otherPage.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", {
        timeout: 20_000,
      });
      await expect(otherPage.getByTestId("button-start-run")).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => otherAcceptedMeResponses)
        .toBeGreaterThan(otherAuthResponsesBeforeReload);
      await expect.poll(() => otherObservations.some((observation) =>
        observation.checkName === "startup" && observation.outcome === "success",
      )).toBe(true);
      expect(await otherPage.evaluate(() =>
        sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1"),
      )).toBeNull();
      expect(otherObservations.filter((observation) =>
        observation.checkName === "stale-deployment-recovery" &&
        observation.outcome === "success",
      )).toEqual([]);
      expect(primaryObservations.filter((observation) =>
        observation.checkName === "stale-deployment-recovery" &&
        observation.outcome === "success",
      )).toEqual([]);

      await page.getByTestId("auth-startup-retry").click();
      await expect(page.getByTestId("button-start-run")).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => primaryObservations.filter((observation) =>
        observation.checkName === "stale-deployment-recovery" &&
        observation.outcome === "success",
      ).length).toBe(1);
      expect(await page.evaluate(() =>
        sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1"),
      )).toBeNull();

      const primaryMarkerSnapshots = await page.evaluate(() =>
        JSON.parse(
          sessionStorage.getItem("__pwa_tab_local_recovery_marker_capture") ?? "[]",
        ) as string[],
      );
      expect(primaryMarkerSnapshots).toHaveLength(1);
      const marker = JSON.parse(primaryMarkerSnapshots[0]);
      expect(Object.keys(marker).sort()).toEqual(["attemptedAt", "fromBuild"]);
      expect(marker).toMatchObject({
        fromBuild: expect.stringMatching(/^[a-f0-9]{1,8}$/),
        attemptedAt: expect.any(Number),
      });
      expect(primaryMarkerSnapshots[0]).not.toMatch(/https?:|stack|user|device|old-build/i);
      expect(await otherPage.evaluate(() =>
        JSON.parse(sessionStorage.getItem("__pwa_tab_local_recovery_marker_capture") ?? "[]"),
      )).toEqual([]);

      const acceptedRecoveryObservations = server.fieldCheckObservations()
        .flatMap((batch) => batch.observations) as Array<{
          checkName: string;
          outcome: string;
          appBuild: string;
          metrics: Record<string, unknown>;
        }>;
      const recoverySuccesses = acceptedRecoveryObservations.filter((observation) =>
        observation.checkName === "stale-deployment-recovery" &&
        observation.outcome === "success",
      );
      expect(recoverySuccesses).toHaveLength(1);
      expect(recoverySuccesses[0]).toMatchObject({
        appBuild: "pwa-new-build",
        metrics: {},
      });
      expect(JSON.stringify(acceptedRecoveryObservations)).not.toMatch(
        /https?:|stack|userId|clientId|deviceId|runId|errorStack|errorUrl/i,
      );
      expect(server.staleAssetRequestCount()).toBe(1);
      expect(server.fixtureErrors()).toEqual([]);
    } finally {
      if (!otherPage.isClosed()) await otherPage.close();
      await server.close();
    }
  });

  test("leaves the attempt unconfirmed when reload returns to the same build without an update", async ({
    page,
  }) => {
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      fixture.staleHomeChunk,
      { sessionRecovery: true, fieldCheckObservations: true },
    );

    try {
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: server.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await startOldBuildThenTriggerStaleAssetFailure(
        page,
        server,
        fixture.staleHomeChunk,
      );
      await expect.poll(() => server.sessionRecoveryRequests().acceptedMeResponses)
        .toBeGreaterThan(0);

      // Revert the fixture before the update check: the worker is unavailable
      // and the fallback reload remains on the same app build.
      server.publish("old");
      const sameBuildReload = page.waitForEvent("domcontentloaded");
      await page.getByRole("button", { name: "Update and reload" }).click();
      await sameBuildReload;
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old", {
        timeout: 20_000,
      });
      await expect(page.getByTestId("button-start-run")).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => server.sessionRecoveryRequests().acceptedMeResponses)
        .toBeGreaterThan(1);

      const observations = server.fieldCheckObservations()
        .flatMap((batch) => batch.observations) as Array<{
          checkName: string;
          outcome: string;
        }>;
      const recoveryOutcomes = observations.filter((item) =>
        item.checkName === "stale-deployment-recovery",
      ).map((item) => item.outcome);
      expect(recoveryOutcomes).not.toContain("success");
      expect(recoveryOutcomes).not.toContain("failure");
      expect(server.staleAssetRequestCount()).toBe(1);
      expect(server.fixtureErrors()).toEqual([]);
    } finally {
      await server.close();
    }
  });

  test("keeps recovery unconfirmed when the updated build cannot complete authenticated startup", async ({
    page,
  }) => {
    const server = await startVersionedServer(
      { old: fixture.oldDir, new: fixture.newDir },
      fixture.staleHomeChunk,
      { sessionRecovery: true, fieldCheckObservations: true },
    );

    try {
      await page.context().addCookies([{
        name: "rc_auth",
        value: "disposable-fixture-session",
        url: server.baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      await startOldBuildThenTriggerStaleAssetFailure(
        page,
        server,
        fixture.staleHomeChunk,
      );
      await expect.poll(() => server.sessionRecoveryRequests().acceptedMeResponses)
        .toBeGreaterThan(0);
      server.failNextSessionProbes(2);

      await page.getByRole("button", { name: "Update and reload" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", {
        timeout: 20_000,
      });
      await expect(page.getByTestId("auth-startup-retry")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("button-start-run")).toHaveCount(0);
      const pendingMarker = await page.evaluate(() =>
        sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1"),
      );
      expect(pendingMarker).not.toBeNull();
      expect(Object.keys(JSON.parse(pendingMarker!)).sort())
        .toEqual(["attemptedAt", "fromBuild"]);

      const observations = server.fieldCheckObservations()
        .flatMap((batch) => batch.observations) as Array<{
          checkName: string;
          outcome: string;
        }>;
      const recoveryOutcomes = observations.filter((item) =>
        item.checkName === "stale-deployment-recovery",
      ).map((item) => item.outcome);
      expect(recoveryOutcomes).not.toContain("success");
      expect(recoveryOutcomes).not.toContain("failure");
      expect(server.sessionRecoveryRequests().temporaryMeFailures).toBe(2);
      expect(server.staleAssetRequestCount()).toBe(1);
      expect(server.fixtureErrors()).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
