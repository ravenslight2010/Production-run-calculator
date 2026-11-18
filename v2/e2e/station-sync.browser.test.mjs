import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "../../node_modules/.pnpm/node_modules/playwright/index.mjs";
import * as XLSX from "xlsx";
import { parseOpeningCountCsv, parseSetupImportCsv } from "../core/import-csv.mjs";
import {
  linkWorkbookCapacityRows,
  parseDoughCapacityWorkbook,
  parseShippingCapacityWorkbook,
} from "../core/workbook-capacity-import.mjs";
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
  dough: ["autoTrackRatePerMinute", "timerDurationSeconds", "traysPerBatch"],
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
    setupSnapshot: {
      label: "Browser test run", targetCases: 100, productCode: "DOUGH-A", productionSetupCode: "LINE-A",
    },
    doughCapacity: { status: "available", reasons: [], doughballYield: 645.19, pizzasPerCase: 12 },
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
    fixture.stationCommandOutcomes.push({ mode: command.mode, outcome: "conflict" });
    return { outcome: "conflict", currentRun: snapshot(fixture) };
  }
  if (command.mode === "timer_start" && fixture.forceTimerStartConflict) {
    fixture.forceTimerStartConflict = false;
    fixture.stationCommandOutcomes.push({ mode: command.mode, outcome: "conflict" });
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
  fixture.stationCommandOutcomes.push({ mode: command.mode, outcome: "accepted" });
  return { outcome: "accepted", replayed: false, run: resultRun };
}

function startMockServerStationWorker(fixture) {
  const worker = setInterval(() => {
    if (fixture.run.status !== "running") return;
    const now = Date.now();
    for (const [stationKey, state] of Object.entries(fixture.run.stationProgress)) {
      const rate = Number(state.inputs.autoTrackRatePerMinute) || 0;
      const current = Number(state.progress[AUTO_FIELD[stationKey]]) || 0;
      const dueAt = Date.parse(state.nextDueAt || "");
      if (rate <= 0 || current >= fixture.run.setupSnapshot.targetCases || !Number.isFinite(dueAt) || dueAt > now) continue;
      applyCommand(fixture, {
        commandId: crypto.randomUUID(),
        expectedRevision: fixture.run.revision,
        runId: fixture.run.id,
        stationKey,
        mode: "auto_track",
        changes: {},
      });
    }
  }, 25);
  return () => clearInterval(worker);
}

async function createFixture(t, viewport = { width: 1440, height: 900 }, { manager = false } = {}) {
  const fixture = {
    run: newRun(),
    receipts: new Map(),
    pageErrors: [],
    consoleErrors: [],
    imports: [],
    stationCommandOutcomes: [],
    browserStationCommands: [],
    forceTimerStartConflict: false,
  };
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
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ imports: fixture.imports }) });
        return;
      }
      if (manager && url.pathname === "/api/v2/inventory/warehouses" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ warehouses: [] }) });
        return;
      }
      if (manager && url.pathname === "/api/v2/inventory/products" && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ products: [{ code: "DOUGH-A", name: "North Shop", unit: "case" }] }),
        });
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
      if (url.pathname === "/api/v2/runs/products" && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            productionWarehouse: { id: "74000000-0000-4000-8000-000000000010", name: "Main Warehouse" },
            products: [{
              code: "DOUGH-A",
              name: "Dough Product",
              doughCapacity: fixture.run.doughCapacity,
              productionSetups: [{ code: "LINE-A", name: "Main Line" }],
            }],
          }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/imports/workbooks/preview" && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const body = request.postDataJSON();
        const workbookBuffer = Buffer.from(body.workbookBase64, "base64");
        const parsed = body.family === "dough-procedure"
          ? parseDoughCapacityWorkbook(workbookBuffer, body.fileName)
          : parseShippingCapacityWorkbook(workbookBuffer, body.fileName);
        const products = [{ code: "DOUGH-A", name: "North Shop" }];
        const rows = linkWorkbookCapacityRows(parsed.rows, products, []);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            sourceFamily: body.family,
            fileName: parsed.fileName,
            fileSha256: parsed.fileSha256,
            rows: rows.map((row) => ({
              sourceKey: row.sourceKey,
              name: row.name,
              row: row.source.row,
              reason: row.linkType,
              productCode: row.productCode,
            })),
            products,
          }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/imports/workbooks" && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const body = request.postDataJSON();
        const workbookBuffer = Buffer.from(body.workbookBase64, "base64");
        const parsed = body.family === "dough-procedure"
          ? parseDoughCapacityWorkbook(workbookBuffer, body.fileName)
          : parseShippingCapacityWorkbook(workbookBuffer, body.fileName);
        const rows = linkWorkbookCapacityRows(
          parsed.rows,
          [{ code: "DOUGH-A", name: "North Shop" }],
          [],
          body.productLinks || [],
        );
        const records = rows.filter((row) => row.productCode).map((row) => ({
          code: `${body.family === "dough-procedure" ? "DOUGH" : "SHIP"}-${row.sourceKey}`,
          name: row.name,
          productCode: row.productCode,
          data: body.family === "dough-procedure"
            ? {
              sourceFamily: body.family,
              sourceKey: row.sourceKey,
              fileName: parsed.fileName,
              fileSha256: parsed.fileSha256,
              source: row.source,
              doughballYield: row.doughballYield,
              doughballWeightOz: row.doughballWeightOz,
              doughballsPerTray: row.doughballsPerTray,
            }
            : {
              sourceFamily: body.family,
              sourceKey: row.sourceKey,
              fileName: parsed.fileName,
              fileSha256: parsed.fileSha256,
              source: row.source,
              pizzasPerCase: row.pizzasPerCase,
            },
        }));
        const importId = "74000000-0000-4000-8000-000000000001";
        const kind = body.family === "dough-procedure" ? "recipes" : "production-setups";
        const history = {
          id: importId,
          kind,
          status: "staged",
          records,
          rowCount: records.length,
          createdBy: STAFF_ID,
          appliedBy: null,
          undoneBy: null,
          createdAt: new Date().toISOString(),
        };
        fixture.imports = [history, ...fixture.imports];
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            outcome: "staged",
            importId,
            kind,
            rowCount: records.length,
            replayed: false,
            records,
            sourceFamily: body.family,
            fileName: parsed.fileName,
            fileSha256: parsed.fileSha256,
            linkedCount: records.length,
            rememberedCount: 0,
            managerMappedCount: rows.filter((row) => row.linkType === "manager").length,
            unmatchedRows: rows.filter((row) => !row.productCode).map((row) => ({
              sourceKey: row.sourceKey, name: row.name, row: row.source.row, reason: row.linkType,
            })),
            unmatchedCount: rows.filter((row) => !row.productCode).length,
            invalidValueCount: records.filter((record) => body.family === "dough-procedure"
              ? record.data.doughballYield === null
              : record.data.pizzasPerCase === null).length,
          }),
        });
        return;
      }
      const applyImport = url.pathname.match(/^\/api\/v2\/imports\/([0-9a-f-]{36})\/apply$/i);
      if (manager && applyImport && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const item = fixture.imports.find((entry) => entry.id === applyImport[1]);
        if (!item) {
          await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Import not found." }) });
          return;
        }
        item.status = "applied";
        item.appliedBy = STAFF_ID;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ outcome: "applied", importId: item.id, kind: item.kind, replayed: false }),
        });
        return;
      }
      const undoImport = url.pathname.match(/^\/api\/v2\/imports\/([0-9a-f-]{36})\/undo$/i);
      if (manager && undoImport && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const item = fixture.imports.find((entry) => entry.id === undoImport[1]);
        if (!item || item.status !== "applied") {
          await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Import cannot be undone." }) });
          return;
        }
        item.status = "undone";
        item.undoneBy = STAFF_ID;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ outcome: "undone", importId: item.id, kind: item.kind, replayed: false }),
        });
        return;
      }
      const match = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/stations\/([^/]+)\/commands$/);
      if (match && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const body = JSON.parse(request.postData() || "{}");
        fixture.browserStationCommands.push(body.mode);
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
    page.on("console", (message) => {
      if (message.type() === "error") fixture.consoleErrors.push(message.text());
    });
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

test("dough capacity is derived from the selected product and has no editable override", async (t) => {
  const { fixture, openDevice } = await createFixture(t);
  const { page } = await openDevice();

  await page.getByTestId("tab-station-dough").click();
  assert.match(await page.locator("#run-product").inputValue(), /DOUGH-A/u);
  assert.equal(await page.locator('[data-station-field="casesPerBatch"]').count(), 0);
  assert.equal(await page.getByText("Cases per dough batch").count(), 1);
  assert.equal(await page.getByText("53.7658 cases", { exact: true }).count(), 1);
  await page.locator('[data-station-field="traysPerBatch"]').fill("84");
  await page.getByTestId("button-save-station").click();
  await page.getByText("Saved to the shared run.").waitFor();
  assert.equal(fixture.run.stationProgress.dough.inputs.traysPerBatch, 84);

  await page.reload();
  await page.locator("#station-panel:not([hidden])").waitFor({ timeout: 5000 });
  await page.getByTestId("tab-station-dough").click();
  assert.equal(await page.locator('[data-station-field="casesPerBatch"]').count(), 0);
  assert.equal(await page.getByText("53.7658 cases", { exact: true }).count(), 1);
  assert.equal(await page.locator('[data-station-field="traysPerBatch"]').inputValue(), "84");
  assert.equal(fixture.run.doughCapacity.doughballYield, 645.19);

  fixture.run.doughCapacity = {
    status: "available",
    reasons: [],
    doughballYield: 648,
    pizzasPerCase: 12,
  };
  await page.reload();
  await page.locator("#station-panel:not([hidden])").waitFor({ timeout: 5000 });
  await page.getByTestId("tab-station-dough").click();
  assert.equal(await page.getByText("54.0000 cases", { exact: true }).count(), 1);
  assert.deepEqual(fixture.pageErrors, []);
  assert.deepEqual(fixture.consoleErrors, []);
});

test("manager resolves an unmatched workbook row, reviews its link, and applies it", async (t) => {
  const browserState = await createFixture(t, { width: 1440, height: 900 }, { manager: true });
  const { page } = await browserState.openDevice();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Customer", "OZ", "LBS", "YIELD", "PER TRAY"],
    ["North Shop", 7.7, 310.5, 645.19, 84],
    ["Nroth Shop", 7.8, 310.5, 646, 84],
  ]), "Procedure");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  await page.locator("#capacity-workbook-file").setInputFiles({
    name: "north-shop-dough.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.getByRole("button", { name: "Preview workbook links" }).click();
  await page.getByText("Exact name match · DOUGH-A").waitFor();
  await page.getByLabel("Choose a product for Nroth Shop, workbook row 3").selectOption("DOUGH-A");
  await page.getByRole("button", { name: "Stage reviewed workbook" }).click();
  await page.getByText(/Staged · dough-procedure/u).waitFor();
  await page.getByText(/2 rows staged/u).waitFor();
  await page.getByText(/1 manager-selected links included/u).waitFor();
  await page.getByText("North Shop", { exact: true }).first().waitFor();
  await page.getByText(/Product: DOUGH-A/u).first().waitFor();
  await page.getByRole("button", { name: "Apply reviewed workbook" }).click();
  await page.locator("#capacity-workbook-actions").waitFor({ state: "hidden" });
  await page.getByText("recipes · applied", { exact: true }).waitFor();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByText("recipes · undone", { exact: true }).waitFor();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    const input = page.locator("#capacity-workbook-file");
    await input.scrollIntoViewIfNeeded();
    const bounds = await input.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width,
      `workbook upload control fits ${viewport.width}×${viewport.height}`);
  }
  assert.ok((await page.locator("body").evaluate(() => document.documentElement.scrollWidth)) <= 1024);
  assert.deepEqual(await page.locator("#capacity-workbook-preview").isVisible(), true);
  assert.deepEqual(browserState.fixture.pageErrors, []);
  assert.deepEqual(browserState.fixture.consoleErrors, []);
});

test("missing dough sources display unavailable instead of estimating batches", async (t) => {
  const { fixture, openDevice } = await createFixture(t);
  fixture.run.doughCapacity = {
    status: "unavailable",
    reasons: ["dough_source_missing", "shipping_source_missing"],
    doughballYield: null,
    pizzasPerCase: null,
  };
  const { page } = await openDevice();
  await page.getByTestId("tab-station-dough").click();
  await page.getByText(/Dough capacity unavailable/u).waitFor();
  assert.equal(await page.getByText("53.7658 cases", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Batches needed").count(), 0);
  assert.match(await page.locator("#run-product").inputValue(), /DOUGH-A/u);
  assert.deepEqual(fixture.pageErrors, []);
  assert.deepEqual(fixture.consoleErrors, []);
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
  fixture.forceTimerStartConflict = true;
  t.after(startMockServerStationWorker(fixture));
  const deviceA = await openDevice();
  const deviceB = await openDevice({ width: 390, height: 844 });

  await waitForState(() => fixture.run.stationProgress.line.progress.casesProduced >= 1);
  await deviceB.page.waitForFunction(() => (
    Number(document.querySelector('[data-station-field="casesProduced"]')?.value) >= 1
  ), null, { timeout: 7000 });

  await deviceA.page.getByRole("button", { name: "Start timer" }).click();
  try {
    await waitForState(() => fixture.run.stationProgress.line.progress.timerStatus === "running", 5000);
  } catch {
    assert.fail(`timer command was not accepted: ${JSON.stringify({
      state: fixture.run.stationProgress.line,
      outcomes: fixture.stationCommandOutcomes,
    })}`);
  }
  await deviceA.page.getByText(/Timer running/).waitFor();
  await deviceB.page.getByText(/Timer running/).waitFor();
  const timerStartOutcomes = fixture.stationCommandOutcomes
    .filter(({ mode }) => mode === "timer_start")
    .map(({ outcome }) => outcome);
  assert.ok(timerStartOutcomes.length >= 2);
  assert.equal(timerStartOutcomes[0], "conflict");
  assert.equal(timerStartOutcomes.at(-1), "accepted");
  assert.ok(timerStartOutcomes.slice(1, -1).every((outcome) => outcome === "conflict"));
  await deviceB.page.getByRole("button", { name: "Pause timer" }).click();
  await deviceB.page.getByText(/Timer paused/).waitFor();
  await deviceA.page.getByText(/Timer paused/).waitFor();
  assert.equal(fixture.run.stationProgress.line.progress.timerStatus, "paused");
  assert.ok(Number(fixture.run.stationProgress.line.progress.timerElapsedMs) >= 0);
  assert.ok(!fixture.browserStationCommands.includes("auto_track"));
  assert.deepEqual(fixture.pageErrors, []);
});

test("manager downloads each CSV template with parser-valid synthetic examples", async (t) => {
  const fixture = await createFixture(t, undefined, { manager: true });
  const { page } = await fixture.openDevice();
  await page.locator("#manager-tools:not([hidden])").waitFor();
  await page.getByText("No setup imports recorded yet.").waitFor();
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.getByLabel("Production warehouse").count(), 1);
    assert.equal(await page.getByRole("button", { name: "Set production warehouse" }).getAttribute("type"), "button");
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      `manager inventory layout should not overflow at ${width}px`,
    );
  }

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
