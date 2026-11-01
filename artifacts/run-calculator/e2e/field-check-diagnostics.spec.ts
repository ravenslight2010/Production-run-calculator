import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";

const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL!;
let fixtures: AuthorizedBrowserFixtures;

test.beforeAll(async ({ playwright }) => {
  requireIsolatedTestDatabase("field-check diagnostic manager view");
  fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, process.env.STAFF_SIGNUP_CODE!);
});
test.afterAll(async () => { await fixtures?.cleanup(); });

test("manager sees safe sync categories and performance sources from isolated API evidence", async ({ page, request, browserName }, testInfo) => {
  let browserPhase = "setup";
  // Relative-age labels are not the observation-retention invariant. Keep Date
  // fixed while real timers and the export/recovery requests continue normally.
  await page.clock.setFixedTime(Date.now());
  let reloading = false;
  const reloadNetworkDiagnostics: Array<{ phase: string; route: string }> = [];
  const { reloadNetworkPath } = await import("./field-check-browser-diagnostics.mjs");
  const networkCategory = (error: { name: string; message: string }) =>
    reloadNetworkPath(error, { engine: browserName, reloading, origin: new URL(page.url()).origin });
  const finishManagerReload = async () => {
    // Probe explicitly: query-cache reuse, 304s and startup polling jitter must
    // not be mistaken for failed connectivity or satisfy a fresh-read check.
    const reads = await page.evaluate(async () => Promise.all(
      ["/api/incidents", "/api/factory-data"].map(async (route) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetch(route, { cache: "no-store", signal: controller.signal });
          return { route, status: response.status, json: response.headers.get("content-type")?.includes("application/json") };
        } finally { clearTimeout(timer); }
      }),
    ));
    expect(reads).toEqual([
      { route: "/api/incidents", status: 200, json: true },
      { route: "/api/factory-data", status: 200, json: true },
    ]);
    reloading = false;
  };
  const uncaughtPageErrors: Array<{ phase: string; name: string; message: string }> = [];
  const consoleErrorPhases: string[] = [];
  page.on("pageerror", (error) => {
    const route = networkCategory(error);
    if (route) {
      reloadNetworkDiagnostics.push({ phase: browserPhase, route });
      return;
    }
    const message = `${error.name}: ${error.message}`
      .replace(/https?:\/\/\S+/gi, "[url]")
      .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/\b(token|secret|password)\b\s*[:=]\s*\S+/gi, "$1=[redacted]")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[id]")
      .replace(/\s+/g, " ")
      .slice(0, 220);
    uncaughtPageErrors.push({ phase: browserPhase, name: "unclassified browser error", message });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const match = message.text().match(/^Fetch API cannot load (https?):\/(\/\S+ due to access control checks\.)$/);
    const route = match && networkCategory({ name: `Fetch API cannot load ${match[1]}`, message: match[2] });
    if (route) {
      reloadNetworkDiagnostics.push({ phase: browserPhase, route });
      return;
    }
    consoleErrorPhases.push(browserPhase);
  });
  const account = await fixtures.createAccount({
    username: uniqueTestId("field_diagnostics"), password: "TestPass123!",
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });
  // This suite owns only diagnostic tables in a disposable database, not production runs.
  const db = new Client({ connectionString: requireIsolatedTestDatabase("clear isolated diagnostic fixtures") });
  try {
    await db.connect();
    await db.query("TRUNCATE field_check_observations, field_check_issues");
  } finally { await db.end(); }
  const samples = [
    ...[1, 2, 3].map((failureCode) => ({ checkName: "sync-acknowledgment", metrics: { failureCode } })),
    ...[1, 2, 3, 4].map((sourceCode) => ({ checkName: "performance", metrics: { sourceCode, durationMs: 20_000 + sourceCode } })),
  ].map((sample, index) => ({
    ...sample, observationId: `${uniqueTestId("field_view")}-${index}`, checkVersion: "3",
    outcome: "failure", observedAt: new Date(Date.now() - index * 1000).toISOString(),
    appBuild: "local", deviceCategory: "mobile-chrome",
  }));
  const result = await request.post(`${API_BASE}/api/field-checks/observations`, {
    headers: { Authorization: `Bearer ${account.token}` }, data: { observations: samples },
  });
  expect(result.status()).toBe(202);
  const requestReference = randomUUID();
  const requestFailure = await request.post(`${API_BASE}/api/field-checks/observations`, {
    headers: { Authorization: `Bearer ${account.token}` },
    data: { observations: [{
      observationId: uniqueTestId("api_request_failure"),
      checkName: "performance",
      checkVersion: "4",
      outcome: "failure",
      observedAt: new Date().toISOString(),
      appBuild: "local",
      deviceCategory: "mobile-chrome",
      metrics: {
        durationMs: 4_023_360,
        sourceCode: 5,
        outcomeCode: 1,
        operationCode: 6,
        backgroundCode: 1,
        httpStatusCode: 500,
      },
      reportedRequestCorrelationId: requestReference,
    }] },
  });
  expect(requestFailure.status()).toBe(202);
  const incidentRequestReference = randomUUID();
  const incidentObservedAt = new Date().toISOString();
  const incidentResponse = await request.post(`${API_BASE}/api/incidents`, {
    headers: { Authorization: `Bearer ${account.token}` },
    data: {
      source: "auto_crash",
      screen: "/",
      appPlatform: "web",
      appVersion: "app-build:identified",
      errorMessage: "API 500",
      diagnostics: {
        action: "call_api",
        outcome: "error",
        retryCount: 0,
        connectivity: "online",
        syncState: "unknown",
        signalKind: "api_failure",
        correlationId: incidentRequestReference,
        requestOperationCategory: "sync",
        requestOutcome: "http_server_error",
        requestElapsedMs: 4_023_360,
        requestObservedAt: incidentObservedAt,
        requestBackgroundInvolvement: "not_observed",
        requestHttpStatus: 500,
      },
    },
  });
  expect(incidentResponse.status()).toBe(200);
  const incidentData = await incidentResponse.json();
  expect(incidentData.correlationId).not.toBe(incidentRequestReference);
  const guidanceIncidents: Array<{ status: 400 | 403 | 409; correlationId: string }> = [];
  for (const status of [400, 403, 409] as const) {
    const response = await request.post(`${API_BASE}/api/incidents`, {
      headers: { Authorization: `Bearer ${account.token}` },
      data: {
        source: "auto_crash",
        screen: "/",
        appPlatform: "web",
        appVersion: "app-build:identified",
        errorMessage: `API ${status}`,
        diagnostics: {
          action: "call_api",
          outcome: "error",
          retryCount: 0,
          connectivity: "online",
          syncState: "blocked",
          signalKind: "api_failure",
          correlationId: randomUUID(),
          requestOperationCategory: status === 403 ? "other" : "sync",
          requestRoute: status === 403 ? "other" : "sync_manual_section",
          requestOutcome: "http_client_error",
          ...(status === 400 ? { requestReasonCode: "SYNC_VALIDATION_FAILED" } : {}),
          requestElapsedMs: 150,
          requestBackgroundInvolvement: "not_observed",
          requestHttpStatus: status,
        },
      },
    });
    expect(response.status()).toBe(200);
    guidanceIncidents.push({ status, correlationId: (await response.json()).correlationId });
  }
  const recoveryAttempt = await request.post(`${API_BASE}/api/field-checks/observations`, {
    headers: { Authorization: `Bearer ${account.token}` },
    data: { observations: [{
      observationId: uniqueTestId("stale_recovery_attempt"),
      checkName: "stale-deployment-recovery",
      checkVersion: "3",
      outcome: "incomplete",
      observedAt: new Date().toISOString(),
      appBuild: "fixture-old-build",
      deviceCategory: "mobile-chrome",
      metrics: {},
    }] },
  });
  expect(recoveryAttempt.status()).toBe(202);
  // Passive observations from this test browser must not recover the seeded failures.
  await page.route("**/api/field-checks/observations", (route) => route.fulfill({
    status: 202, json: { accepted: 0, duplicate: 0 },
  }));
  const legacyBrandKey = "run-calc-fkv-legacy-review:unowned:run-calc-brands";
  const legacyBrandRaw = JSON.stringify(["Fixture Brand"]);
  const historyKey = "run-calc-history";
  const historyRows = [
    { date: "2026-10-20", runs: [{ id: "fixture-local-only-1" }], runValues: {} },
    { date: "2026-10-21", runs: [{ id: "fixture-local-only-2" }], runValues: {} },
  ];
  const historyRaw = JSON.stringify(historyRows);
  const unrelatedKey = "run-calc-review-fixture-unrelated";
  const unrelatedRaw = "keep-this-unrelated-value";
  const seededMarker = "run-calc-review-fixture-seeded";
  await page.addInitScript(({ legacyBrandKey, legacyBrandRaw, historyKey, historyRaw, unrelatedKey, unrelatedRaw, seededMarker }) => {
    if (sessionStorage.getItem(seededMarker) === "1") return;
    localStorage.setItem(legacyBrandKey, legacyBrandRaw);
    localStorage.setItem(historyKey, historyRaw);
    localStorage.setItem(unrelatedKey, unrelatedRaw);
    sessionStorage.setItem(seededMarker, "1");
  }, { legacyBrandKey, legacyBrandRaw, historyKey, historyRaw, unrelatedKey, unrelatedRaw, seededMarker });
  await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  browserPhase = "manager-view";
  await page.goto("/");
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 30_000 });
  const legacyReview = page.getByTestId("factory-directory-review");
  await legacyReview.locator("details > summary").click();
  await expect(legacyReview).toContainText("1 saved facility-list edits need review");
  await expect(legacyReview).toContainText("Currently in use");
  await expect(legacyReview).toContainText("Saved copy on this device");
  await expect(legacyReview).toContainText("Fixture Brand");
  const legacyRemoval = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  await legacyReview.getByRole("button", { name: "Remove saved copy from this device" }).click();
  await legacyRemoval;
  // The removed item disappears, but its success receipt remains readable.
  await expect(legacyReview.locator("details")).toHaveCount(0);
  await expect(legacyReview.getByRole("status")).toHaveText("Saved copy removed from this device.");
  expect(await page.evaluate((key) => localStorage.getItem(key), legacyBrandKey)).toBeNull();

  const retainedReview = page.getByTestId("shared-records-status");
  await expect(retainedReview).toContainText("Older device history");
  await retainedReview.locator("details > summary").click();
  await expect(retainedReview).toContainText("Item 1 of 2 on this device. Date: 2026-10-20.");
  await expect(retainedReview).toContainText("Item 2 of 2 on this device. Date: 2026-10-21.");
  await expect(retainedReview).not.toContainText("run-calc-history");
  const historyItem = retainedReview.getByRole("listitem").filter({
    hasText: "Item 1 of 2 on this device. Date: 2026-10-20.",
  });
  const historyRemoval = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  await historyItem.getByRole("button", { name: "Remove this saved copy from this device" }).click();
  await historyRemoval;
  await expect(historyItem).toHaveCount(0);
  expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), historyKey)) ?? "null"))
    .toEqual([historyRows[1]]);
  expect(await page.evaluate((key) => localStorage.getItem(key), unrelatedKey)).toBe(unrelatedRaw);
  reloading = true;
  await page.reload();
  await expect(page.getByTestId("shared-records-status"))
    .toContainText("Saved record on this device. Date: 2026-10-21.");
  await expect(page.getByTestId("shared-records-status"))
    .not.toContainText("2026-10-20");
  expect(await page.evaluate((key) => localStorage.getItem(key), unrelatedKey)).toBe(unrelatedRaw);
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Reported issues" }).click();
  await finishManagerReload();
  const failures = page.getByLabel("Actionable field-check failures");
  await expect(failures).toBeVisible();
  await expect(page.getByText(incidentData.correlationId, { exact: true }).first()).toBeVisible();
  for (const { status, correlationId } of guidanceIncidents) {
    const incidentRow = page.getByTestId("incident-row").filter({ hasText: correlationId }).first();
    await expect(incidentRow.getByText(correlationId, { exact: true })).toBeVisible();
    if (status === 403) {
      await expect(incidentRow.getByText(/This request was denied because this account does not currently have permission/)).toBeVisible();
      await expect(incidentRow.getByText(/support route: not identified in the available diagnostics/)).toBeVisible();
    } else if (status === 409) {
      await expect(incidentRow.getByText(/The shared value changed before this save reached the server/)).toBeVisible();
    } else {
      await expect(incidentRow.getByText(/This sync update did not pass a validation check/)).toBeVisible();
      await expect(incidentRow.getByText("Support code: SYNC_VALIDATION_FAILED")).toBeVisible();
    }
  }
  await expect(page.getByText(incidentRequestReference, { exact: true })).toBeVisible();
  const serverErrorRow = page.getByTestId("incident-row").filter({ hasText: incidentData.correlationId }).first();
  await expect(serverErrorRow.getByText(/Syncing saved changes · the server reported an error · HTTP 500/)).toBeVisible();
  await expect(serverErrorRow.getByText(/Observed by this browser at/)).toBeVisible();
  await expect(serverErrorRow.getByText(/browser waited 4023360 ms/)).toBeVisible();
  await expect(serverErrorRow.getByText(/No background change was detected; the operating-system pause state is unknown/)).toBeVisible();
  await expect(serverErrorRow.getByText(/The browser wait is not server processing time/)).toBeVisible();
  await expect(serverErrorRow.getByText(/build reference app-build:identified/)).toBeVisible();
  const fieldChecks = page.getByTestId("field-checks-panel");
  await expect(fieldChecks.getByText("Evidence coverage: Never observed").first()).toBeVisible();
  const recoveryCard = fieldChecks.getByText("Stale-deployment recovery", { exact: true }).locator("../..");
  await expect(recoveryCard).toContainText("Evidence coverage: Observed, no success");
  await expect(recoveryCard).toContainText("Failures: 0 · Incomplete: 1 · No issue recorded");
  await expect(recoveryCard).toContainText("Last success: Not yet");
  await expect(fieldChecks.getByText(/Server receipt delay estimate: Unknown\/unconfirmed/).first()).toBeVisible();
  await expect(fieldChecks.getByText(/Server receipt delay estimate: .*after the browser timestamp/).first()).toBeVisible();
  for (const label of [
    "The account or permission was rejected",
    "The saved update was out of date or came after a reset",
    "The app tried to sync again but did not receive confirmation",
    "Home screen did not load · browser wait 20001 ms. Browser wait is not server processing time.",
    "Page did not open · browser wait 20002 ms. Browser wait is not server processing time.",
  ]) {
    await expect(failures.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(failures.getByText(/Server returned an error · syncing · server error · HTTP 500 · browser wait 4023360 ms/))
    .toBeVisible();
  await expect(failures.getByText(requestReference, { exact: true })).toBeVisible();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 820, height: 1180 },
    { width: 1180, height: 820 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(failures).toContainText(requestReference);
    await expect(page.getByText(incidentData.correlationId, { exact: true }).first()).toBeVisible();
    expect(await page.locator("html").evaluate((html) => html.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // The UI intentionally shows three failures per check; the API retains all four sources.
  const report = await request.get(`${API_BASE}/api/field-checks`, { headers: { Authorization: `Bearer ${account.token}` } });
  const data = await report.json();
  expect(data.checks.find((check: { name: string }) => check.name === "performance").recentFailures)
    .toEqual(expect.arrayContaining([expect.objectContaining({ metrics: { sourceCode: 4, durationMs: 20004 } })]));
  expect(await failures.innerText()).not.toMatch(/Bearer|field_view|field_diagnostics|\/api\//);
  await expect(failures.getByText("Unidentified local build; not release verification evidence.").first()).toBeVisible();
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await page.evaluate(() => innerWidth));
  await failures.screenshot({ path: testInfo.outputPath("safe-field-check-details.png") });

  const downloadButton = page.getByRole("button", { name: "Download safe field-check report" });
  await expect(downloadButton).toBeVisible();
  // Preserve the support-download regression alongside filtering: a failed
  // download must never delete or recover observations.
  const before = await failures.innerText();
  browserPhase = "simulated-export-failure";
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = () => { throw new Error("isolated download failure"); };
    (window as unknown as { restoreExportUrl: () => void }).restoreExportUrl = () => { URL.createObjectURL = original; };
  });
  await downloadButton.click();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn’t download the report" })).toBeVisible();
  expect(await failures.innerText()).toBe(before);
  browserPhase = "manager-view";
  await page.evaluate(() => (window as unknown as { restoreExportUrl: () => void }).restoreExportUrl());
  const downloadEvent = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^field-check-report-v1-\d{4}-[\dTZ-]+\.json$/);
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  expect(Buffer.byteLength(text)).toBeLessThan(64_000);
  expect(text).not.toMatch(/Bearer|field_view|field_diagnostics|\/api\/|observationId|userId|clientId|runId/);
  const exported = JSON.parse(text);
  expect(exported).toMatchObject({ schemaVersion: 1, facilityScope: "current facility",
    provenance: { kind: "advisory-field-evidence", environment: "unknown", buildIdentity: "unknown" } });
  expect(exported.checks.find((check: { name: string }) => check.name === "performance").recentFailures)
    .toEqual(expect.arrayContaining([expect.objectContaining({
      buildCategory: "unknown-local", deviceCategory: "mobile-chrome",
      diagnostics: expect.objectContaining({ sourceCode: 4, durationMs: 20004 }),
    })]));
  expect(exported.checks.find((check: { name: string }) => check.name === "performance").recentFailures)
    .toEqual(expect.arrayContaining([expect.objectContaining({
      reportedRequestCorrelationId: requestReference,
      diagnostics: expect.objectContaining({ requestOutcomeCode: 1, httpStatusCode: 500 }),
    })]));
  await expect(page.getByRole("alert").filter({ hasText: "Couldn’t download the report" })).toHaveCount(0);
  expect(await failures.innerText()).toBe(before);
  const after = await request.get(`${API_BASE}/api/field-checks`, { headers: { Authorization: `Bearer ${account.token}` } });
  expect((await after.json()).checks).toEqual(data.checks);
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await page.evaluate(() => innerWidth));

  // These older failures are outside the five most recent global rows. Filtering
  // must query the full retained population, not those five rows in the browser.
  const selectedSamples = Array.from({ length: 7 }, (_, i) => ({
    observationId: `${uniqueTestId("selected_field")}-${i}`,
    checkName: "sync-acknowledgment", checkVersion: "3", outcome: "failure",
    observedAt: new Date(Date.now() - 120_000 - i * 1000).toISOString(),
    appBuild: "fixture-build-a", deviceCategory: "mobile-safari", metrics: { failureCode: 2 },
  }));
  expect((await request.post(`${API_BASE}/api/field-checks/observations`, {
    headers: { Authorization: `Bearer ${account.token}` }, data: { observations: selectedSamples },
  })).status()).toBe(202);
  const panel = page.getByTestId("field-checks-panel");
  const filters = page.getByRole("group", { name: "Field evidence filters" });
  const population = page.getByTestId("field-evidence-population");
  await expect(population).toContainText("Unfiltered:");
  await filters.getByLabel("Build", { exact: true }).selectOption("exact");
  await filters.getByLabel("Exact build identifier", { exact: true }).fill("fixture-build-a");
  await filters.getByLabel("Browser category").selectOption("mobile-safari");
  await filters.getByRole("button", { name: "Apply field filters" }).click();
  await expect(population).toContainText("Selected population: fixture-build-a · mobile-safari");
  await expect(panel.getByText("Failures: 7 · Incomplete: 0 · Open", { exact: true })).toBeVisible();
  await expect(failures).toContainText("fixture-build-a");
  await expect(failures).not.toContainText("build local");
  await expect(panel.getByText("The saved update was out of date or came after a reset", { exact: true }).first()).toBeVisible();

  await filters.getByLabel("Browser category").selectOption("desktop-firefox");
  await filters.getByRole("button", { name: "Apply field filters" }).click();
  await expect(panel.getByText("Failures: 7 · Incomplete: 0 · Open", { exact: true })).toHaveCount(0);
  await expect(failures).toHaveCount(0);
  await expect(population).toContainText("desktop-firefox");

  await filters.getByLabel("Build", { exact: true }).selectOption("unknown");
  await filters.getByLabel("Browser category").selectOption("mobile-chrome");
  await filters.getByRole("button", { name: "Apply field filters" }).click();
  await expect(population).toContainText("Unknown build (local)");
  await expect(failures.getByText("Unidentified local build; not release verification evidence.").first()).toBeVisible();
  await expect(failures).not.toContainText("fixture-build-a");
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await page.evaluate(() => innerWidth));
  await filters.scrollIntoViewIfNeeded();
  await filters.screenshot({ path: testInfo.outputPath("field-evidence-filters.png") });

  // A rejected read must not leave previous population results displayed.
  browserPhase = "simulated-read-rejection";
  await page.route("**/api/field-checks?*", (route) => route.fulfill({
    status: 400, json: { error: "Invalid field-check filters" },
  }));
  await filters.getByLabel("Build", { exact: true }).selectOption("exact");
  await filters.getByLabel("Exact build identifier", { exact: true }).fill("fixture-error");
  await filters.getByRole("button", { name: "Apply field filters" }).click();
  await expect(panel.getByText("Couldn’t load field-check evidence.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(failures).toHaveCount(0);
  await page.unroute("**/api/field-checks?*");
  browserPhase = "manager-recovery";
  await filters.getByRole("button", { name: "Clear field filters" }).click();
  await expect(population).toContainText("Unfiltered:");
  await expect(failures).toBeVisible();
  reloading = true;
  await page.reload();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 30_000 });
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Reported issues" }).click();
  await expect(page.getByTestId("field-evidence-population")).toContainText("Unfiltered:");
  await finishManagerReload();
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await page.evaluate(() => innerWidth));
  const restricted = await fixtures.createAccount({
    username: uniqueTestId("field_no_review"), password: "TestPass123!",
    capabilities: DEFAULT_MANAGER_CAPABILITIES.filter((capability) => capability !== "review-incidents"),
  });
  const denied = await request.get(`${API_BASE}/api/field-checks`, {
    headers: { Authorization: `Bearer ${restricted.token}` },
  });
  expect(denied.status()).toBe(403);
  browserPhase = "restricted-manager-view";
  await page.context().addCookies([{ name: "rc_auth", value: restricted.token, url: API_BASE }]);
  await page.reload();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 30_000 });
  await expect(downloadButton).toHaveCount(0);
  await page.getByRole("button", { name: /^More/ }).click();
  await expect(page.getByRole("menuitem", { name: "Reported issues" })).toHaveCount(0);
  expect(uncaughtPageErrors).toEqual([]);
  const expectedErrorPhases = new Set([
    "simulated-export-failure",
    "simulated-read-rejection",
    "restricted-manager-view",
  ]);
  expect(consoleErrorPhases.filter((phase) => !expectedErrorPhases.has(phase))).toEqual([]);
  await testInfo.attach("bounded-reload-network-diagnostics", {
    contentType: "application/json",
    body: Buffer.from(JSON.stringify({
      kind: "synthetic-isolated-browser-evidence",
      diagnostics: reloadNetworkDiagnostics,
      interpretation: "WPE network-console messages during explicit reloads; cause not established. Fresh successful reads of both routes were required after every manager reload.",
    })),
  });
});
