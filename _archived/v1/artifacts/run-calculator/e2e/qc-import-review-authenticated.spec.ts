import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  requireDedicatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";
import { isBackgroundWebKitNetworkDiagnostic } from "./qc-date-code-browser-diagnostics.mjs";

const evidenceDir = resolve(process.cwd(), "../../.local/tasks/evidence/qc-slice-4-import-review");
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
] as const;

async function openQc(page: Page, origin: string) {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await navigateQc(page);
}

async function navigateQc(page: Page) {
  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
}

async function openImportReview(page: Page, origin: string) {
  await openQc(page, origin);
  await page.getByTestId("button-toggle-qc-import-review").click();
  await expect(page.getByTestId("section-qc-import-review")).toBeVisible();
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = resolve(evidenceDir, `${testInfo.project.name}-${name}.jpg`);
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path, type: "jpeg", quality: 78, fullPage: false });
  await testInfo.attach(name, { path, contentType: "image/jpeg" });
}

async function badgeCount(page: Page, testId: string) {
  const badgeValue = page.getByTestId(testId);
  if (await badgeValue.count() === 0) return 0;
  const match = (await badgeValue.innerText()).match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function safeDiagnostic(value: string) {
  return value
    .replace(/rc_auth=[^&\s;]+/gi, "rc_auth=[redacted]")
    .replace(/PRIVATE_SENTINEL/g, "[redacted sentinel]")
    .replace(/(password|token|secret|authorization)\s*[:=]\s*[^,\s]+/gi, "$1=[redacted]")
    .slice(0, 260);
}

test("authenticated managers review committed imports with stale conflict, retry, badge refresh, and persistence", async ({ browser, playwright, baseURL }, testInfo) => {
  const apiOrigin = requireLocalFixtureApiOrigin("QC import-review synthetic verification");
  const dbUrl = requireDedicatedTestDatabase("QC import-review synthetic verification");
  const fixtures = await AuthorizedBrowserFixtures.create(
    playwright, apiOrigin, process.env.STAFF_SIGNUP_CODE ?? "",
  );
  const db = new Client({ connectionString: dbUrl });
  const date = new Date().toISOString().slice(0, 10);
  const runId = uniqueTestId("import-review-run");
  const operationId = uniqueTestId("premix-review");
  const retryOperationId = uniqueTestId("premix-retry");
  const mixId = uniqueTestId("qc-mix");
  const retryMixId = uniqueTestId("qc-retry-mix");
  const mixIds = [mixId, retryMixId];
  const mixName = uniqueTestId("Synthetic QC premix");
  const privateSentinel = "PRIVATE_SENTINEL";
  const diagnostics: string[] = [];
  const unexpectedPageErrors: string[] = [];
  const taskRouteFailures: string[] = [];
  const taskRouteStatuses: number[] = [];
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
  let persisted: { reviewEvents: number; rejected: boolean; verified: boolean; reasonsPersisted: boolean } | null = null;
  let fixtureCleanup = "not started";

  try {
    await db.connect();
    const importer = await fixtures.createAccount({
      username: uniqueTestId("qc-importer"), password: "FixturePass123!",
      capabilities: ["manage-inventory", "manage-profiles"], onboardingSeen: true,
    });
    const manager1 = await fixtures.createAccount({
      username: uniqueTestId("qc-manager1"), password: "FixturePass123!",
      capabilities: ["record-qc", "manage-qc"], onboardingSeen: true,
    });
    const manager2 = await fixtures.createAccount({
      username: uniqueTestId("qc-manager2"), password: "FixturePass123!",
      capabilities: ["record-qc", "manage-qc"], onboardingSeen: true,
    });
    const operator = await fixtures.createAccount({
      username: uniqueTestId("qc-operator"), password: "FixturePass123!",
      capabilities: ["record-qc"], onboardingSeen: true,
    });

    await fixtures.seedTodaySync({
      token: manager1.token, senderId: uniqueTestId("qc-import-review-seed"), date,
      payload: {
        dayState: {
          date,
          runs: [{ id: runId, brand: uniqueTestId("Synthetic brand"), flavor: "Synthetic only", casesNeeded: 1, seeded: false }],
          currentIndex: 0, resetAt: 0, substitutions: [], substitutionLog: [], stagedItems: {},
        },
        runValues: {
          [runId]: {
            casesNeeded: 1, casesPerSkid: 12, pizzasPerCase: 12,
            doughRecipe: [], frontlineRecipe: [], app1Type: "", app2Type: "",
            app3Type: "", app4Type: "", pep1Type: "", pep1TypeB: "", pep2Type: "", pep2TypeB: "",
          },
        },
        runValuesUpdatedAt: { [runId]: Date.now() }, packagingProgress: {},
      },
    });

    const request = await playwright.request.newContext();
    try {
      for (const id of [operationId, retryOperationId]) {
        expect(id.length).toBeGreaterThanOrEqual(16);
        expect(id.length).toBeLessThanOrEqual(120);
        expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
        const response = await request.post(`${apiOrigin}/api/import-operations/${id}/apply`, {
          headers: { Cookie: `rc_auth=${importer.token}` },
          data: {
            importType: "premix",
            sourceLabel: "Synthetic isolated QC review fixture",
            changes: {
              mixes: {
                upsert: [{
                  id: id === operationId ? mixId : retryMixId,
                  name: id === operationId ? mixName : uniqueTestId("Synthetic retry premix"),
                  brand: uniqueTestId("Synthetic brand"),
                  flavor: "Synthetic only",
                  batchSize: 1,
                  daysEarly: 0,
                  notes: privateSentinel,
                  amountAlreadyMade: 0,
                  components: [],
                  enabled: true,
                  isPrep: false,
                }],
              },
            },
          },
        });
        expect(response.status(), `synthetic ${id} Apply should commit in the disposable DB`).toBe(200);
        const result = await response.json();
        expect(result.operation.status).toBe("applied");
        expect(result.operation.resultHash).toMatch(/^[a-f0-9]{64}$/);
      }
    } finally {
      await request.dispose();
    }

    const origin = baseURL ?? process.env.PLAYWRIGHT_BASE_URL;
    if (!origin) throw new Error("Isolated Playwright base URL was not supplied.");
    const managerContext1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const managerContext2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const operatorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.push(managerContext1, managerContext2, operatorContext);
    for (const [context, account] of [
      [managerContext1, manager1], [managerContext2, manager2], [operatorContext, operator],
    ] as const) {
      await context.addCookies([{
        name: "rc_auth", value: account.token, url: new URL(origin).origin,
        httpOnly: true, sameSite: "Lax",
      }]);
    }
    const page1 = await managerContext1.newPage();
    const page2 = await managerContext2.newPage();
    const operatorPage = await operatorContext.newPage();

    for (const page of [page1, page2, operatorPage]) {
      page.on("pageerror", (error) => {
        const entry = safeDiagnostic(`${error.name}: ${error.message}`);
        diagnostics.push(`pageerror: ${entry}`);
        if (!isBackgroundWebKitNetworkDiagnostic(error, testInfo.project.name)) {
          unexpectedPageErrors.push(entry);
        }
      });
      page.on("console", (message) => {
        if (message.type() === "error") diagnostics.push(`console: ${safeDiagnostic(message.text())}`);
      });
      page.on("response", (response) => {
        const url = response.url();
        if (!/\/api\/qc\/import-review(?:s|-badges)/.test(url)) return;
        taskRouteStatuses.push(response.status());
        if (response.status() >= 400 && response.status() !== 409) {
          taskRouteFailures.push(`${response.status()} ${safeDiagnostic(new URL(url).pathname)}`);
        }
      });
    }

    await openImportReview(page1, origin);
    await openImportReview(page2, origin);
    await openQc(operatorPage, origin);
    const detail1 = page1.getByTestId(`detail-qc-import-${operationId}`);
    const detail2 = page2.getByTestId(`detail-qc-import-${operationId}`);
    await page1.getByTestId(`button-qc-import-item-${operationId}`).click();
    await expect(detail1).toBeVisible();
    await page2.getByTestId(`button-qc-import-item-${operationId}`).click();
    await expect(detail2).toBeVisible();
    await expect(detail1.getByTestId("status-qc-import-apply")).toHaveText("Apply applied");
    await expect(detail1.getByTestId("status-qc-import-qc")).toHaveText("QC pending");
    await expect(detail1.getByTestId("text-qc-import-operation-id")).toHaveText(operationId);
    await expect(detail1.getByTestId("text-qc-import-hash")).toHaveText(/^[a-f0-9]{64}$/);
    await expect(detail1.getByTestId("table-qc-import-entities")).toContainText("mixes");
    await expect(detail1.getByTestId("row-qc-import-change-0")).toContainText(mixName);
    await expect(detail1.getByTestId("row-qc-import-change-0")).toContainText("notes");
    await expect(detail1).not.toContainText(privateSentinel);
    await expect(detail1.getByTestId("text-qc-import-undo-guidance")).toContainText("QC review never undoes or replays an import");
    await expect(detail1.getByRole("button", { name: /undo/i })).toHaveCount(0);
    await expect(detail1.getByTestId("button-qc-import-verify")).toBeDisabled();

    await expect(page2.getByTestId("status-qc-import-qc")).toHaveText("QC pending");
    await expect(operatorPage.getByTestId("badge-qc-import-review")).toBeVisible();
    const initialPending = await badgeCount(operatorPage, "text-qc-import-badge-pending");
    const initialRejected = await badgeCount(operatorPage, "text-qc-import-badge-rejected");
    expect(initialPending).toBeGreaterThanOrEqual(2);
    await expect(operatorPage.getByTestId("button-toggle-qc-import-review")).toHaveCount(0);
    const operatorCookie = { Cookie: `rc_auth=${operator.token}` };
    const operatorDetail = await operatorContext.request.get(
      `${apiOrigin}/api/qc/import-reviews/${operationId}`, { headers: operatorCookie },
    );
    const operatorDecision = await operatorContext.request.post(
      `${apiOrigin}/api/qc/import-reviews/${operationId}/decisions`,
      {
        headers: operatorCookie,
        data: {
          decisionId: uniqueTestId("forbidden-qc-decision"),
          expectedResultHash: "0".repeat(64),
          expectedRevision: 0,
          status: "verified",
          reason: "Synthetic authorization probe only.",
        },
      },
    );
    const operatorApply = await operatorContext.request.post(
      `${apiOrigin}/api/import-operations/${operationId}/apply`,
      { headers: operatorCookie, data: { importType: "premix", changes: { mixes: { upsert: [] } } } },
    );
    const operatorUndo = await operatorContext.request.post(
      `${apiOrigin}/api/import-operations/${operationId}/undo`,
      { headers: operatorCookie, data: {} },
    );
    expect(operatorDetail.status()).toBe(403);
    expect(operatorDecision.status()).toBe(403);
    expect(operatorApply.status()).toBe(403);
    expect(operatorUndo.status()).toBe(403);

    for (const viewport of viewports) {
      for (const page of [page1, page2, operatorPage]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `${viewport.name} document overflow`).toBeLessThanOrEqual(viewport.width);
        await expect(page.getByTitle("More")).toBeVisible();
      }
      await expect(page1.getByTestId("button-toggle-qc-import-review")).toBeVisible();
      await expect(page1.getByTestId("section-qc-import-review")).toBeVisible();
      await expect(page1.getByTestId("textarea-qc-import-reason")).toBeVisible();
      await expect(operatorPage.getByTestId("button-toggle-qc-import-review")).toHaveCount(0);
      await expect(operatorPage.getByTestId("badge-qc-import-review")).toBeVisible();
      await detail1.scrollIntoViewIfNeeded();
      await attachScreenshot(page1, testInfo, `${viewport.name}-before-decision`);
    }

    // The page-two detail was deliberately hydrated before page one's save.
    await detail1.getByTestId("textarea-qc-import-reason").fill("Synthetic review: retained summary checked; no production decision implied.");
    await detail1.getByTestId("textarea-qc-import-reason").press("Tab");
    await expect(detail1.getByTestId("button-qc-import-verify")).toBeFocused();
    const verifiedResponsePromise = page1.waitForResponse((response) =>
      response.url().includes(`/api/qc/import-reviews/${operationId}/decisions`) &&
      response.request().method() === "POST" && response.status() === 201,
    );
    await page1.keyboard.press("Enter");
    const verifiedResponse = await verifiedResponsePromise;
    expect((await verifiedResponse.json()).qcStatus).toBe("verified");
    await expect(detail1.getByTestId("status-qc-import-receipt")).toContainText("Decision saved: verified");

    await detail2.getByTestId("textarea-qc-import-reason").fill("Synthetic stale review attempt; expected revision is deliberately outdated.");
    const conflictPromise = page2.waitForResponse((response) =>
      response.url().includes(`/api/qc/import-reviews/${operationId}/decisions`) &&
      response.request().method() === "POST",
    );
    await detail2.getByTestId("button-qc-import-reject").click();
    const conflict = await conflictPromise;
    expect(conflict.status()).toBe(409);
    expect(taskRouteStatuses).toContain(409);
    await expect(detail2.getByTestId("alert-qc-import-conflict")).toBeVisible();
    await expect(detail2.getByTestId("status-qc-import-receipt")).toHaveCount(0);
    await detail2.getByTestId("button-qc-import-refresh").click();
    await expect(detail2.getByTestId("status-qc-import-qc")).toHaveText("QC verified");
    await detail2.getByTestId("textarea-qc-import-reason").fill("Synthetic rejection after refreshing the current committed revision.");
    const rejectedPromise = page2.waitForResponse((response) =>
      response.url().includes(`/api/qc/import-reviews/${operationId}/decisions`) &&
      response.request().method() === "POST" && response.status() === 201,
    );
    await detail2.getByTestId("button-qc-import-reject").click();
    const rejected = await (await rejectedPromise).json();
    expect(rejected.qcStatus).toBe("rejected");
    await expect(detail2.getByTestId("status-qc-import-receipt")).toContainText("Decision saved: rejected");

    // These two decisions replace the same operation's status, so it leaves
    // Pending once. Refresh rather than waiting through another 30-second badge
    // poll; the dedicated reload-badge case verifies live cross-device polling.
    await operatorPage.reload({ waitUntil: "domcontentloaded" });
    await operatorPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await navigateQc(operatorPage);
    await expect(operatorPage.getByTestId("text-qc-import-badge-pending")).toHaveText(`${initialPending - 1} pending`, { timeout: 35_000 });
    await expect(operatorPage.getByTestId("text-qc-import-badge-rejected")).toHaveText(`${initialRejected + 1} rejected`);

    // Second pending import: the first response is dropped only after route.fetch
    // commits it, so Retry must replay the exact immutable decision identity/body.
    await page1.getByTestId(`button-qc-import-item-${retryOperationId}`).click();
    const retryDetail = page1.getByTestId(`detail-qc-import-${retryOperationId}`);
    await expect(retryDetail).toBeVisible();
    const decisionBodies: unknown[] = [];
    let committedStatus = 0;
    let dropFirstResponse = true;
    const decisionRoute = `**/api/qc/import-reviews/${retryOperationId}/decisions`;
    await page1.route(decisionRoute, async (route) => {
      decisionBodies.push(route.request().postDataJSON());
      if (dropFirstResponse) {
        dropFirstResponse = false;
        const committed = await route.fetch();
        committedStatus = committed.status();
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await retryDetail.getByTestId("textarea-qc-import-reason").fill("Synthetic retry: server commit was acknowledged only by idempotent replay.");
    await retryDetail.getByTestId("button-qc-import-verify").click();
    await expect(retryDetail.getByTestId("alert-qc-import-network")).toBeVisible();
    await expect(retryDetail.getByTestId("button-qc-import-retry")).toBeEnabled();
    const firstDecision = decisionBodies[0] as Record<string, unknown>;
    expect(committedStatus).toBe(201);
    expect(firstDecision).toMatchObject({ status: "verified", reason: "Synthetic retry: server commit was acknowledged only by idempotent replay." });
    const replayPromise = page1.waitForResponse((response) =>
      response.url().includes(`/api/qc/import-reviews/${retryOperationId}/decisions`) &&
      response.request().method() === "POST" && response.status() === 200,
    );
    await retryDetail.getByTestId("button-qc-import-retry").click();
    const replay = await (await replayPromise).json();
    expect(decisionBodies).toHaveLength(2);
    expect(decisionBodies[1]).toEqual(decisionBodies[0]);
    expect(replay.replayed).toBe(true);
    expect(replay.qcStatus).toBe("verified");
    await expect(retryDetail.getByTestId("status-qc-import-receipt")).toContainText("Decision saved: verified (already recorded)");
    await page1.unroute(decisionRoute);

    await operatorPage.reload({ waitUntil: "domcontentloaded" });
    await operatorPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await navigateQc(operatorPage);
    await expect(operatorPage.getByTestId("text-qc-import-badge-pending")).toHaveText(`${initialPending - 2} pending`, { timeout: 35_000 });
    await expect(operatorPage.getByTestId("text-qc-import-badge-rejected")).toHaveText(`${initialRejected + 1} rejected`);

    await page1.reload({ waitUntil: "domcontentloaded" });
    await openImportReview(page1, origin);
    const statusFilter = page1.getByTestId("select-qc-import-status");
    await statusFilter.selectOption("rejected");
    await page1.getByTestId(`button-qc-import-item-${operationId}`).click();
    const persistedRejected = page1.getByTestId(`detail-qc-import-${operationId}`);
    await expect(persistedRejected.getByTestId("status-qc-import-qc")).toHaveText("QC rejected");
    await expect(persistedRejected).toContainText("Synthetic rejection after refreshing the current committed revision.");
    await expect(persistedRejected.getByTestId("status-qc-import-apply")).toHaveText("Apply applied");
    await statusFilter.selectOption("all");
    await page1.getByTestId(`button-qc-import-item-${retryOperationId}`).click();
    const persistedVerified = page1.getByTestId(`detail-qc-import-${retryOperationId}`);
    await expect(persistedVerified.getByTestId("status-qc-import-qc")).toHaveText("QC verified");
    await expect(persistedVerified).toContainText("Synthetic retry: server commit was acknowledged only by idempotent replay.");
    await statusFilter.selectOption("rejected");
    await page1.getByTestId(`button-qc-import-item-${operationId}`).click();
    for (const viewport of viewports) {
      await page1.setViewportSize({ width: viewport.width, height: viewport.height });
      expect(await page1.evaluate(() => document.documentElement.scrollWidth), `${viewport.name} persisted document overflow`).toBeLessThanOrEqual(viewport.width);
      await expect(page1.getByTitle("More")).toBeVisible();
      await expect(page1.getByTestId("button-toggle-qc-import-review")).toBeVisible();
      await persistedRejected.scrollIntoViewIfNeeded();
      await attachScreenshot(page1, testInfo, `${viewport.name}-after-reload`);
    }

    const dbEvents = await db.query(
      `SELECT record_id, payload->>'status' AS status, payload->>'reason' AS reason
       FROM qc_workflow_events WHERE event_type = 'import-review'
       AND record_id = ANY($1::text[]) ORDER BY id`,
      [[operationId, retryOperationId]],
    );
    const latest = new Map<string, { status: string; reason: string }>();
    for (const row of dbEvents.rows) latest.set(row.record_id, { status: row.status, reason: row.reason });
    persisted = {
      reviewEvents: dbEvents.rows.length,
      rejected: latest.get(operationId)?.status === "rejected",
      verified: latest.get(retryOperationId)?.status === "verified",
      reasonsPersisted:
        latest.get(operationId)?.reason === "Synthetic rejection after refreshing the current committed revision." &&
        latest.get(retryOperationId)?.reason === "Synthetic retry: server commit was acknowledged only by idempotent replay.",
    };
    expect(persisted.reviewEvents).toBe(3);
    expect(persisted.rejected).toBe(true);
    expect(persisted.verified).toBe(true);
    expect(persisted.reasonsPersisted).toBe(true);
    expect(unexpectedPageErrors, "unexpected JavaScript/page errors").toEqual([]);
    expect(taskRouteFailures, "unexpected QC import review API failures").toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await db.end().catch(() => {});
    fixtureCleanup = "attempted against isolated disposable DB";
    await fixtures.cleanup({ syncDates: [date], mixIds });
    mkdirSync(evidenceDir, { recursive: true });
    const report = {
      environment: "isolated disposable PostgreSQL only",
      engine: testInfo.project.name,
      viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
      physicalAndroidChrome: "NOT RUN",
      physicalIosSafariPwa: "NOT RUN",
      counts: { taskRouteStatuses: taskRouteStatuses.length, consoleDiagnostics: diagnostics.filter((entry) => entry.startsWith("console:")).length },
      taskRouteStatuses,
      taskRouteFailures,
      unexpectedPageErrors,
      diagnostics: diagnostics.map(safeDiagnostic),
      persisted,
      fixtureCleanup,
      traces: "off",
      rawCredentialsOrTrace: "not retained",
    };
    writeFileSync(resolve(evidenceDir, `${testInfo.project.name}-sanitized-result.json`), `${JSON.stringify(report, null, 2)}\n`);
    await testInfo.attach("sanitized-import-review-result", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(report, null, 2)),
    });
  }
});
