import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "../../node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/index.mjs";
import { parseOpeningCountCsv, parseSetupImportCsv } from "../core/import-csv.mjs";
import {
  openingCountCsvTemplate,
  renderImportCsvTemplate,
  setupImportCsvTemplates,
} from "../core/import-csv-templates.mjs";

const CSRF_TOKEN = "a".repeat(43);
const STAFF_ID = "72000000-0000-4000-8000-000000000001";
const RUN_ID = "73000000-0000-4000-8000-000000000001";
const INPUTS = Object.freeze({
  line: ["autoTrackRatePerMinute", "timerDurationSeconds", "casesPerSkid"],
  dough: ["autoTrackRatePerMinute", "timerDurationSeconds", "casesPerBatch", "traysPerBatch"],
  cheese: ["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "batchLbs"],
  pepperoni: ["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "batchLbs"],
  sauce: ["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "barrelLbs"],
  frontline: ["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "batchLbs"],
  packaging: ["autoTrackRatePerMinute", "timerDurationSeconds", "casesPerSkid"],
});
const PROGRESS = Object.freeze({
  line: ["casesProduced", "casesOnLine", "casesInFreezer"],
  dough: ["casesProduced", "traysOnLine", "batchesReady", "batchesMade"],
  cheese: ["casesCompleted", "batchesMade", "stockOnLineLbs"],
  pepperoni: ["casesCompleted", "batchesMade", "stockOnLineLbs"],
  sauce: ["barrelsMade", "stockBarrels"],
  frontline: ["casesCompleted", "batchesMade", "stockOnLineLbs"],
  packaging: ["casesPacked"],
});
const AUTO_FIELD = Object.freeze({
  line: "casesProduced", dough: "casesProduced", cheese: "casesCompleted",
  pepperoni: "casesCompleted", sauce: "barrelsMade", frontline: "batchesMade",
  packaging: "casesPacked",
});
const WEB_ASSETS = new Map([
  ["/", ["../web/index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["../web/manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/service-worker.js", ["../web/service-worker.js", "text/javascript; charset=utf-8"]],
  ["/favicon.ico", ["../web/favicon.svg", "image/svg+xml"]],
  ["/v2/web/app.js", ["../web/app.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/inventory.js", ["../web/inventory.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/styles.css", ["../web/styles.css", "text/css; charset=utf-8"]],
  ["/v2/web/write-gate.mjs", ["../web/write-gate.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/import-csv-templates.mjs", ["../core/import-csv-templates.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/station-workflows.mjs", ["../core/station-workflows.mjs", "text/javascript; charset=utf-8"]],
]);

function stationSnapshot({ inputs = {}, progress = {}, revision = 0, nextDueAt = null } = {}) {
  return {
    status: "not_started",
    revision,
    inputs,
    progress,
    startedAt: null,
    pausedAt: null,
    completedAt: null,
    nextDueAt,
    updatedAt: new Date().toISOString(),
  };
}

function newRun(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: RUN_ID,
    status: "running",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    serverNow: now,
    startedAt: now,
    pausedAt: null,
    resumedAt: null,
    completedAt: null,
    setupSnapshot: { label: "Browser test run", targetCases: 100 },
    pauseIntervals: [],
    stationProgress: {},
    ...overrides,
  };
}

function snapshot(fixture) {
  fixture.run.serverNow = new Date().toISOString();
  return JSON.parse(JSON.stringify(fixture.run));
}

function applyCommand(fixture, command) {
  if (fixture.receipts.has(command.commandId)) {
    return { outcome: "accepted", replayed: true, run: fixture.receipts.get(command.commandId) };
  }
  if (command.expectedRevision !== fixture.run.revision) {
    return { outcome: "conflict", currentRun: snapshot(fixture) };
  }
  const key = command.stationKey;
  const previous = fixture.run.stationProgress[key] || stationSnapshot();
  const state = structuredClone(previous);
  const now = new Date().toISOString();
  if (command.mode === "manual") {
    for (const [field, value] of Object.entries(command.changes)) {
      if (INPUTS[key].includes(field)) state.inputs[field] = value;
      if (PROGRESS[key].includes(field)) state.progress[field] = value;
    }
    state.nextDueAt = Number(state.inputs.autoTrackRatePerMinute) > 0
      ? new Date(Date.now() + 1000).toISOString()
      : null;
  } else if (command.mode === "auto_track") {
    const field = AUTO_FIELD[key];
    state.progress[field] = (Number(state.progress[field]) || 0) + 1;
    state.nextDueAt = new Date(Date.now() + 1000).toISOString();
  } else if (command.mode === "timer_start") {
    state.progress.timerStatus = "running";
    state.progress.timerStartedAt = now;
    state.progress.timerElapsedMs = 0;
    state.status = "running";
    state.startedAt ||= now;
  } else if (command.mode === "timer_pause") {
    state.progress.timerElapsedMs = Number(state.progress.timerElapsedMs) || 0;
    state.progress.timerStatus = "paused";
    state.progress.timerStartedAt = null;
    state.progress.timerPausedAt = now;
    state.status = "paused";
  } else if (command.mode === "timer_resume") {
    state.progress.timerStatus = "running";
    state.progress.timerStartedAt = now;
    state.progress.timerPausedAt = null;
    state.status = "running";
  } else if (command.mode === "timer_reset") {
    state.progress.timerStatus = "idle";
    state.progress.timerStartedAt = null;
    state.progress.timerPausedAt = null;
    state.progress.timerElapsedMs = 0;
    state.status = "not_started";
  }
  state.revision += 1;
  state.updatedAt = now;
  fixture.run.stationProgress[key] = state;
  fixture.run.revision += 1;
  fixture.run.updatedAt = now;
  const resultRun = snapshot(fixture);
  fixture.receipts.set(command.commandId, resultRun);
  return { outcome: "accepted", replayed: false, run: resultRun };
}

async function createFixture(t, viewport = { width: 1440, height: 900 }, { manager = false } = {}) {
  const fixture = { run: newRun(), receipts: new Map(), pageErrors: [] };
  const server = createServer(async (request, response) => {
    const asset = WEB_ASSETS.get(new URL(request.url, "http://v2.test").pathname);
    if (!asset || !["GET", "HEAD"].includes(request.method)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const file = new URL(asset[0], import.meta.url);
      const content = await readFile(file);
      response.writeHead(200, {
        "Content-Type": asset[1],
        "Cache-Control": "no-cache",
        "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; worker-src 'self'",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const browserPath = process.env.CHROMIUM_PATH
    || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  const browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function openDevice(deviceViewport = viewport) {
    const context = await browser.newContext({ viewport: deviceViewport });
    const routeApi = async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/v2/auth/session" && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Set-Cookie": `v2_csrf=${CSRF_TOKEN}; Path=/; SameSite=Strict` },
          body: JSON.stringify({
            staff: {
              userId: STAFF_ID,
              username: "station_tester",
              role: "manager",
              capabilities: ["station.command", ...(manager ? ["manage-inventory"] : [])],
            },
          }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/imports" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ imports: [] }) });
        return;
      }
      if (manager && url.pathname === "/api/v2/inventory/warehouses" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ warehouses: [] }) });
        return;
      }
      if (manager && url.pathname === "/api/v2/inventory/products" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) });
        return;
      }
      if (manager && url.pathname === "/api/v2/inventory/opening-counts" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: [] }) });
        return;
      }
      if (url.pathname === "/api/v2/runs" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: [snapshot(fixture)] }) });
        return;
      }
      const match = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/stations\/([^/]+)\/commands$/);
      if (match && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const body = JSON.parse(request.postData() || "{}");
        const result = applyCommand(fixture, {
          ...body,
          runId: match[1],
          stationKey: decodeURIComponent(match[2]),
        });
        await route.fulfill({
          status: result.outcome === "conflict" ? 409 : 200,
          contentType: "application/json",
          body: JSON.stringify(result),
        });
        return;
      }
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found." }) });
    };
    await context.route("**/api/v2/**", routeApi);
    const page = await context.newPage();
    page.on("pageerror", (error) => fixture.pageErrors.push(error.message));
    await page.goto(baseUrl);
    await page.locator("#station-panel:not([hidden])").waitFor({ timeout: 5000 });
    await page.getByTestId("tab-station-line").waitFor();
    return { context, page, routeApi };
  }

  return { baseUrl, browser, fixture, openDevice };
}

async function waitForState(predicate, timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Timed out waiting for shared test state.");
}

test("two live sessions preserve a manual edit when another device wins first", async (t) => {
  const { fixture, openDevice } = await createFixture(t);
  const deviceA = await openDevice();
  const deviceB = await openDevice();

  await deviceA.page.locator('[data-station-field="casesProduced"]').fill("5");
  await deviceA.page.getByTestId("button-save-station").click();
  await deviceA.page.getByText("Saved to the shared run.").waitFor();
  assert.equal(fixture.run.stationProgress.line.progress.casesProduced, 5);

  await deviceB.page.locator('[data-station-field="casesProduced"]').fill("7");
  await deviceB.page.getByTestId("button-save-station").click();
  await deviceB.page.getByText(/Another device changed the run/).waitFor();
  assert.equal(await deviceB.page.locator('[data-station-field="casesProduced"]').inputValue(), "7");
  await deviceB.page.screenshot({ path: join(tmpdir(), "v2-station-conflict-review.png") });

  await deviceB.page.getByTestId("button-save-station").click();
  await deviceB.page.getByText("Saved to the shared run.").waitFor();
  assert.equal(fixture.run.stationProgress.line.progress.casesProduced, 7);
  assert.equal(fixture.run.revision, 3);
  assert.deepEqual(fixture.pageErrors, []);
});

test("offline reload stays read-only and wakes into the latest server state", async (t) => {
  const { fixture, openDevice } = await createFixture(t, { width: 390, height: 844 });
  const pausedAt = new Date().toISOString();
  fixture.run.status = "paused";
  fixture.run.pausedAt = pausedAt;
  fixture.run.pauseIntervals = [{ startedAt: pausedAt, endedAt: null }];
  fixture.run.stationProgress.line = stationSnapshot({ progress: { casesProduced: 12 } });
  const { context, page, routeApi } = await openDevice();
  await page.evaluate(() => navigator.serviceWorker.ready);
  assert.equal(await page.getByTestId("status-run").textContent(), "paused");
  assert.equal(await page.getByTestId("button-resume").isDisabled(), false);

  await context.unroute("**/api/v2/**", routeApi);
  await context.setOffline(true);
  await page.reload();
  await page.locator("#station-panel:not([hidden])").waitFor({ timeout: 7000 });
  assert.equal(await page.locator('[data-station-field="casesProduced"]').inputValue(), "12");
  assert.equal(await page.getByTestId("status-run").textContent(), "paused");
  assert.equal(await page.getByTestId("button-save-station").isDisabled(), true);
  assert.equal(await page.locator('[data-station-field="casesProduced"]').isDisabled(), true);
  await page.screenshot({ path: join(tmpdir(), "v2-station-offline-readonly.png") });

  fixture.run.stationProgress.line.progress.casesProduced = 20;
  fixture.run.pauseIntervals[0].endedAt = new Date().toISOString();
  fixture.run.status = "running";
  fixture.run.pausedAt = null;
  fixture.run.resumedAt = fixture.run.pauseIntervals[0].endedAt;
  fixture.run.revision += 1;
  fixture.run.updatedAt = fixture.run.resumedAt;
  fixture.run.serverNow = fixture.run.resumedAt;
  await context.route("**/api/v2/**", routeApi);
  await context.setOffline(false);
  await page.waitForFunction(() => (
    document.querySelector('[data-station-field="casesProduced"]')?.value === "20"
  ), null, { timeout: 7000 });
  assert.equal(await page.getByTestId("status-run").textContent(), "running");
  assert.equal(await page.getByTestId("button-pause").isDisabled(), false);
  assert.equal(await page.getByTestId("button-save-station").isDisabled(), false);
  assert.deepEqual(fixture.pageErrors, []);
});

test("server auto-tracking and station timers are shared across devices", async (t) => {
  const { fixture, openDevice } = await createFixture(t);
  const dueAt = new Date(Date.now() - 1000).toISOString();
  fixture.run.stationProgress.line = stationSnapshot({
    inputs: { autoTrackRatePerMinute: 60, timerDurationSeconds: 10 },
    progress: { casesProduced: 0 },
    nextDueAt: dueAt,
  });
  const deviceA = await openDevice();
  const deviceB = await openDevice({ width: 390, height: 844 });

  await waitForState(() => fixture.run.stationProgress.line.progress.casesProduced >= 1);
  await deviceB.page.waitForFunction(() => (
    Number(document.querySelector('[data-station-field="casesProduced"]')?.value) >= 1
  ), null, { timeout: 7000 });

  await deviceA.page.getByRole("button", { name: "Start timer" }).click();
  await deviceA.page.getByText(/Timer running/).waitFor();
  await deviceB.page.getByText(/Timer running/).waitFor();
  await deviceB.page.getByRole("button", { name: "Pause timer" }).click();
  await deviceB.page.getByText(/Timer paused/).waitFor();
  await deviceA.page.getByText(/Timer paused/).waitFor();
  assert.equal(fixture.run.stationProgress.line.progress.timerStatus, "paused");
  assert.ok(Number(fixture.run.stationProgress.line.progress.timerElapsedMs) >= 0);
  assert.deepEqual(fixture.pageErrors, []);
});

test("manager downloads each CSV template with parser-valid synthetic examples", async (t) => {
  const fixture = await createFixture(t, undefined, { manager: true });
  const { page } = await fixture.openDevice();
  await page.locator("#manager-tools:not([hidden])").waitFor();
  await page.getByText("No setup imports recorded yet.").waitFor();

  for (const [kind, template] of Object.entries(setupImportCsvTemplates)) {
    await page.locator("#import-kind").selectOption(kind);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#csv-template-download").click(),
    ]);
    assert.equal(download.suggestedFilename(), template.fileName);
    const csv = await readFile(await download.path(), "utf8");
    assert.equal(csv, renderImportCsvTemplate(template));
    assert.equal(parseSetupImportCsv(kind, csv).length, template.rows.length);
  }

  const [countDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#opening-count-template-download").click(),
  ]);
  assert.equal(countDownload.suggestedFilename(), openingCountCsvTemplate.fileName);
  const countCsv = await readFile(await countDownload.path(), "utf8");
  assert.equal(countCsv, renderImportCsvTemplate(openingCountCsvTemplate));
  parseOpeningCountCsv(countCsv, setupImportCsvTemplates.products.rows.map(([code]) => code));

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    const link = page.locator("#csv-template-download");
    await link.scrollIntoViewIfNeeded();
    const bounds = await link.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width,
      `template download link fits ${viewport.width}×${viewport.height}`);
  }
});
