import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
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

async function navigateQc(page: Page) {
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
}

async function openQc(page: Page, origin: string) {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await navigateQc(page);
}

async function openImportReview(page: Page, origin: string) {
  await openQc(page, origin);
  await page.getByTestId("button-toggle-qc-import-review").click();
  await expect(page.getByTestId("section-qc-import-review")).toBeVisible();
}

async function getBadgeCount(page: Page, testId: string): Promise<number> {
  const value = page.getByTestId(testId);
  if (await value.count() === 0) return 0;
  return Number((await value.innerText()).match(/\d+/)?.[0] ?? 0);
}

async function captureAfter(page: Page, testInfo: TestInfo, viewport: string) {
  mkdirSync(evidenceDir, { recursive: true });
  const path = resolve(evidenceDir, `${testInfo.project.name}-after-decision-verified-${viewport}.jpg`);
  await page.screenshot({ path, type: "jpeg", quality: 78, fullPage: false });
  await testInfo.attach(`after-decision-${viewport}`, { path, contentType: "image/jpeg" });
}

test("retained import QC reload and badge deltas", async ({ browser, playwright, baseURL }, testInfo) => {
  const apiOrigin = requireLocalFixtureApiOrigin("QC import-review reload and badge delta verification");
  const fixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    apiOrigin,
    process.env.STAFF_SIGNUP_CODE ?? "",
  );
  const date = new Date().toISOString().slice(0, 10);
  const runId = uniqueTestId("qc-reload-run");
  const verifiedOperationId = uniqueTestId("qc-reload-verified");
  const rejectedOperationId = uniqueTestId("qc-reload-rejected");
  const verifiedMixId = uniqueTestId("qc-reload-mix-v");
  const rejectedMixId = uniqueTestId("qc-reload-mix-r");
  const mixIds = [verifiedMixId, rejectedMixId];
  const verifiedReason = "Synthetic API fixture: retained evidence reviewed and accepted.";
  const rejectedReason = "Synthetic API fixture: retained evidence rejected for validation.";
  const responseFailureCounts = new Map<string, number>();
  const requestFailureCounts = new Map<string, number>();
  const cancelledRequestCounts = new Map<string, number>();
  const taskRouteFailures: string[] = [];
  const expectedNavigationAborts = new Map<string, number>();
  const unexpectedPageErrors: string[] = [];
  const classifiedWebKitBackgroundPaths: string[] = [];
  const consoleMessages = new Set<string>();
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
  let baseline = { pending: 0, rejected: 0 };
  let badgeAfterReject: { pending: number; rejected: number } | null = null;
  let reloadVerified = false;
  let screenshotsCaptured = 0;
  let apiSetupDecisions = 0;
  let fixtureCleanup = "not started";
  let fixtureContextCleanupInProgress = false;
  let browserPhase = "fixture setup";

  const addCount = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  const observePage = (page: Page) => {
    page.on("response", (response) => {
      const status = response.status();
      if (status < 400 || status >= 600) return;
      const pathname = new URL(response.url()).pathname;
      addCount(responseFailureCounts, `${status} ${pathname}`);
      if (pathname.startsWith("/api/qc/import-review")) taskRouteFailures.push(`${status} ${pathname}`);
    });
    page.on("requestfailed", (request) => {
      const pathname = new URL(request.url()).pathname;
      const failure = request.failure()?.errorText ?? "unknown";
      const key = `${browserPhase} | ${failure} ${pathname}`;
      addCount(requestFailureCounts, key);
      if (pathname.startsWith("/api/qc/import-review")) {
        const browserCancellation = failure === "net::ERR_ABORTED" || failure === "Load request cancelled";
        const flowTransition = /navigation|filter|select (verified|rejected)|full reload|fixture context teardown/i.test(browserPhase);
        if (browserCancellation && (flowTransition || fixtureContextCleanupInProgress)) {
          addCount(cancelledRequestCounts, key);
        } else {
          taskRouteFailures.push(`requestfailed ${key}`);
        }
      }
    });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      consoleMessages.add(message.text().replace(/https?:\/\/[^\s]+/g, "[url redacted]").slice(0, 200));
    });
    page.on("pageerror", (error) => {
      if (isBackgroundWebKitNetworkDiagnostic(error, testInfo.project.name)) {
        const suffix = " due to access control checks.";
        const protocol = error.name.slice("Fetch API cannot load ".length);
        try {
          const parsed = new URL(`${protocol}:/${error.message.slice(0, -suffix.length)}`);
          classifiedWebKitBackgroundPaths.push(parsed.pathname);
        } catch {
          classifiedWebKitBackgroundPaths.push("classified background network diagnostic (path unavailable)");
        }
        return;
      }
      const sanitized = `${error.name}: ${error.message.replace(/https?:\/\/[^\s]+/g, "[url redacted]")}`.slice(0, 240);
      unexpectedPageErrors.push(sanitized);
    });
  };
  const outputReport = resolve(evidenceDir, `${testInfo.project.name}-reload-badge-followup-retested.json`);

  try {
    const importer = await fixtures.createAccount({
      username: uniqueTestId("qc-reload-importer"),
      password: "FixturePass123!",
      capabilities: ["manage-inventory", "manage-profiles"],
      onboardingSeen: true,
    });
    const manager = await fixtures.createAccount({
      username: uniqueTestId("qc-reload-manager"),
      password: "FixturePass123!",
      capabilities: ["record-qc", "manage-qc"],
      onboardingSeen: true,
    });
    const operator = await fixtures.createAccount({
      username: uniqueTestId("qc-reload-operator"),
      password: "FixturePass123!",
      capabilities: ["record-qc"],
      onboardingSeen: true,
    });
    const origin = baseURL ?? process.env.PLAYWRIGHT_BASE_URL;
    if (!origin) throw new Error("Isolated Playwright base URL was not supplied.");

    await fixtures.seedTodaySync({
      token: manager.token,
      senderId: uniqueTestId("qc-reload-seed"),
      date,
      payload: {
        dayState: {
          date,
          runs: [{
            id: runId,
            brand: uniqueTestId("Synthetic reload brand"),
            flavor: "Synthetic only",
            casesNeeded: 1,
            seeded: false,
          }],
          currentIndex: 0,
          resetAt: 0,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        },
        runValues: {
          [runId]: {
            casesNeeded: 1,
            casesPerSkid: 12,
            pizzasPerCase: 12,
            doughRecipe: [],
            frontlineRecipe: [],
            app1Type: "",
            app2Type: "",
            app3Type: "",
            app4Type: "",
            pep1Type: "",
            pep1TypeB: "",
            pep2Type: "",
            pep2TypeB: "",
          },
        },
        runValuesUpdatedAt: { [runId]: Date.now() },
        packagingProgress: {},
      },
    });

    const api = await playwright.request.newContext();
    const cookie = (token: string) => ({ Cookie: `rc_auth=${token}` });
    let verifiedHash = "";
    let rejectedHash = "";
    try {
      for (const fixture of [
        { id: verifiedOperationId, mixId: verifiedMixId, name: uniqueTestId("Synthetic retained verified premix") },
        { id: rejectedOperationId, mixId: rejectedMixId, name: uniqueTestId("Synthetic retained rejected premix") },
      ]) {
        expect(fixture.id.length).toBeGreaterThanOrEqual(16);
        expect(fixture.id.length).toBeLessThanOrEqual(120);
        expect(fixture.id).toMatch(/^[A-Za-z0-9_-]+$/);
        const response = await api.post(`${apiOrigin}/api/import-operations/${fixture.id}/apply`, {
          headers: cookie(importer.token),
          data: {
            importType: "premix",
            sourceLabel: "Synthetic API-seeded reload and badge fixture",
            changes: {
              mixes: {
                upsert: [{
                  id: fixture.mixId,
                  name: fixture.name,
                  brand: uniqueTestId("Synthetic brand"),
                  flavor: "Synthetic only",
                  batchSize: 1,
                  daysEarly: 0,
                  notes: "PRIVATE_SENTINEL",
                  amountAlreadyMade: 0,
                  components: [],
                  enabled: true,
                  isPrep: false,
                }],
              },
            },
          },
        });
        expect(response.status()).toBe(200);
        const operation = (await response.json()).operation;
        expect(operation.status).toBe("applied");
        expect(operation.resultHash).toMatch(/^[a-f0-9]{64}$/);
        if (fixture.id === verifiedOperationId) verifiedHash = operation.resultHash;
        else rejectedHash = operation.resultHash;
      }

      // Setup decisions are API-seeded, not browser decision actions.
      const verifiedDecision = await api.post(
        `${apiOrigin}/api/qc/import-reviews/${verifiedOperationId}/decisions`,
        {
          headers: cookie(manager.token),
          data: {
            decisionId: uniqueTestId("qc-api-verified"),
            expectedResultHash: verifiedHash,
            expectedRevision: 0,
            status: "verified",
            reason: verifiedReason,
          },
        },
      );
      expect(verifiedDecision.status()).toBe(201);
      expect((await verifiedDecision.json()).qcStatus).toBe("verified");
      apiSetupDecisions++;
    } finally {
      await api.dispose();
    }

    // Read the badge before the second decision, then keep this same operator page open.
    const operatorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.push(operatorContext);
    await operatorContext.addCookies([{
      name: "rc_auth",
      value: operator.token,
      url: new URL(origin).origin,
      httpOnly: true,
      sameSite: "Lax",
    }]);
    const operatorPage = await operatorContext.newPage();
    observePage(operatorPage);
    browserPhase = "operator initial navigation";
    await openQc(operatorPage, origin);
    await expect(operatorPage.getByTestId("button-toggle-qc-import-review")).toHaveCount(0);
    await expect(operatorPage.getByTestId("badge-qc-import-review")).toBeVisible();
    baseline = {
      pending: await getBadgeCount(operatorPage, "text-qc-import-badge-pending"),
      rejected: await getBadgeCount(operatorPage, "text-qc-import-badge-rejected"),
    };
    expect(baseline.pending).toBeGreaterThanOrEqual(1);

    // API reject the pending operation while the ordinary operator's page remains open.
    const rejectApi = await playwright.request.newContext();
    try {
      browserPhase = "operator badge delta after API reject";
      const rejectedDecision = await rejectApi.post(
        `${apiOrigin}/api/qc/import-reviews/${rejectedOperationId}/decisions`,
        {
          headers: cookie(manager.token),
          data: {
            decisionId: uniqueTestId("qc-api-rejected"),
            expectedResultHash: rejectedHash,
            expectedRevision: 0,
            status: "rejected",
            reason: rejectedReason,
          },
        },
      );
      expect(rejectedDecision.status()).toBe(201);
      expect((await rejectedDecision.json()).qcStatus).toBe("rejected");
      apiSetupDecisions++;
    } finally {
      await rejectApi.dispose();
    }
    await expect(operatorPage.getByTestId("text-qc-import-badge-pending"))
      .toHaveText(`${baseline.pending - 1} pending`, { timeout: 45_000 });
    await expect(operatorPage.getByTestId("text-qc-import-badge-rejected"))
      .toHaveText(`${baseline.rejected + 1} rejected`, { timeout: 45_000 });
    badgeAfterReject = {
      pending: await getBadgeCount(operatorPage, "text-qc-import-badge-pending"),
      rejected: await getBadgeCount(operatorPage, "text-qc-import-badge-rejected"),
    };

    const managerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.push(managerContext);
    await managerContext.addCookies([{
      name: "rc_auth",
      value: manager.token,
      url: new URL(origin).origin,
      httpOnly: true,
      sameSite: "Lax",
    }]);
    const managerPage = await managerContext.newPage();
    observePage(managerPage);
    browserPhase = "manager fresh navigation";
    await openImportReview(managerPage, origin);
    const queue = managerPage.getByTestId("section-qc-import-review");
    await expect(queue.getByTestId("text-qc-import-empty")).toBeVisible();
    browserPhase = "manager initial filter all";
    await managerPage.getByTestId("select-qc-import-status").selectOption("all");
    await expect(managerPage.getByTestId(`button-qc-import-item-${verifiedOperationId}`)).toBeVisible();
    await expect(managerPage.getByTestId(`button-qc-import-item-${rejectedOperationId}`)).toBeVisible();
    browserPhase = "manager select verified";
    await managerPage.getByTestId(`button-qc-import-item-${verifiedOperationId}`).click();
    const verifiedDetail = managerPage.getByTestId(`detail-qc-import-${verifiedOperationId}`);
    await expect(verifiedDetail.getByTestId("status-qc-import-qc")).toHaveText("QC verified");
    await expect(verifiedDetail.getByTestId("status-qc-import-apply")).toHaveText("Apply applied");
    await expect(verifiedDetail).toContainText(verifiedReason);
    await expect(verifiedDetail).not.toContainText("PRIVATE_SENTINEL");

    browserPhase = "manager select rejected";
    await managerPage.getByTestId(`button-qc-import-item-${rejectedOperationId}`).click();
    let rejectedDetail = managerPage.getByTestId(`detail-qc-import-${rejectedOperationId}`);
    await expect(rejectedDetail.getByTestId("status-qc-import-qc")).toHaveText("QC rejected");
    await expect(rejectedDetail.getByTestId("status-qc-import-apply")).toHaveText("Apply applied");
    await expect(rejectedDetail).toContainText(rejectedReason);
    await expect(rejectedDetail).not.toContainText("PRIVATE_SENTINEL");

    browserPhase = "manager full reload";
    await managerPage.reload({ waitUntil: "domcontentloaded" });
    browserPhase = "manager post-reload QC navigation";
    await navigateQc(managerPage);
    await managerPage.getByTestId("button-toggle-qc-import-review").click();
    await expect(managerPage.getByTestId("section-qc-import-review")).toBeVisible();
    await expect(managerPage.getByTestId("section-qc-import-review").getByTestId("text-qc-import-empty")).toBeVisible();
    browserPhase = "manager post-reload filter all";
    await managerPage.getByTestId("select-qc-import-status").selectOption("all");
    await expect(managerPage.getByTestId(`button-qc-import-item-${verifiedOperationId}`)).toBeVisible();
    await expect(managerPage.getByTestId(`button-qc-import-item-${rejectedOperationId}`)).toBeVisible();
    browserPhase = "manager post-reload select verified";
    await managerPage.getByTestId(`button-qc-import-item-${verifiedOperationId}`).click();
    const persistedVerified = managerPage.getByTestId(`detail-qc-import-${verifiedOperationId}`);
    await expect(persistedVerified.getByTestId("status-qc-import-qc")).toHaveText("QC verified");
    await expect(persistedVerified.getByTestId("status-qc-import-apply")).toHaveText("Apply applied");
    await expect(persistedVerified).toContainText(verifiedReason);
    await expect(persistedVerified).not.toContainText("PRIVATE_SENTINEL");
    browserPhase = "manager post-reload select rejected";
    await managerPage.getByTestId(`button-qc-import-item-${rejectedOperationId}`).click();
    rejectedDetail = managerPage.getByTestId(`detail-qc-import-${rejectedOperationId}`);
    await expect(rejectedDetail.getByTestId("status-qc-import-qc")).toHaveText("QC rejected");
    await expect(rejectedDetail.getByTestId("status-qc-import-apply")).toHaveText("Apply applied");
    await expect(rejectedDetail).toContainText(rejectedReason);
    await expect(rejectedDetail).not.toContainText("PRIVATE_SENTINEL");
    reloadVerified = true;

    for (const viewport of viewports) {
      browserPhase = `post-decision layout ${viewport.name}`;
      await managerPage.setViewportSize({ width: viewport.width, height: viewport.height });
      await managerPage.evaluate(() => window.scrollTo(0, 0));
      expect(
        await managerPage.evaluate(() => document.documentElement.scrollWidth),
        `${viewport.name} post-decision document overflow`,
      ).toBeLessThanOrEqual(viewport.width);
      await expect(managerPage.getByTestId("tab-run")).toBeAttached();
      await expect(managerPage.getByTitle("More")).toBeVisible();
      await expect(managerPage.getByTestId("button-toggle-qc-import-review")).toBeVisible();
      await expect(managerPage.getByTestId("section-qc-import-review")).toBeVisible();
      await expect(managerPage.getByTestId(`button-qc-import-item-${verifiedOperationId}`)).toBeVisible();
      await expect(managerPage.getByTestId(`button-qc-import-item-${rejectedOperationId}`)).toBeVisible();
      const rationale = rejectedDetail.getByTestId("textarea-qc-import-reason");
      await expect(rationale).toBeVisible();
      await expect(managerPage.getByLabel("Rationale (required)")).toBeVisible();
      await expect(rationale).toHaveAttribute("maxlength", "1000");
      await rationale.focus();
      await rationale.fill("Synthetic keyboard-only focus check; no decision submitted.");
      await rationale.press("Tab");
      await expect(rejectedDetail.getByTestId("button-qc-import-verify")).toBeFocused();
      await expect(rejectedDetail.getByTestId("button-qc-import-verify")).toBeEnabled();
      await rationale.fill("");
      await rejectedDetail.scrollIntoViewIfNeeded();
      await captureAfter(managerPage, testInfo, viewport.name);
      screenshotsCaptured++;
    }

    expect(unexpectedPageErrors, "unexpected JavaScript/pageerrors").toEqual([]);
    expect(taskRouteFailures, "QC import-review task-route HTTP/request failures").toEqual([]);
  } finally {
    fixtureContextCleanupInProgress = true;
    browserPhase = "fixture context teardown";
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    fixtureCleanup = "attempted against isolated disposable DB";
    await fixtures.cleanup({ syncDates: [date], mixIds });
    mkdirSync(evidenceDir, { recursive: true });
    const report = {
      environment: "fresh isolated disposable PostgreSQL only",
      engine: testInfo.project.name,
      test: "retained import QC reload and badge deltas",
      viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
      apiSetupDecisions,
      browserDecisionActions: 0,
      operatorBadgeBaseline: baseline,
      operatorBadgeAfterApiReject: badgeAfterReject,
      reloadVerified,
      screenshotsCaptured,
      response4xx5xxByStatusAndPath: [...responseFailureCounts.entries()].map(([key, count]) => ({ key, count })),
      requestFailedByPathAndError: [...requestFailureCounts.entries()].map(([key, count]) => ({ key, count })),
      browserCancelledDuringExplicitFlowTransition: [...cancelledRequestCounts.entries()].map(([key, count]) => ({ key, count })),
      qcTaskRouteFailures: taskRouteFailures,
      unexpectedPageErrors,
      classifiedWebKitBackgroundPaths,
      consoleErrorCount: consoleMessages.size,
      consoleErrorSamples: [...consoleMessages].slice(0, 12),
      physicalAndroidChrome: "NOT RUN",
      physicalIosSafariPwa: "NOT RUN",
      fixtureCleanup,
      traces: "off",
      rawUrlsQueriesHeadersBodiesCredentials: "not retained in diagnostics",
    };
    writeFileSync(outputReport, `${JSON.stringify(report, null, 2)}\n`);
    await testInfo.attach("sanitized-reload-badge-followup", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(report, null, 2)),
    });
  }
});
