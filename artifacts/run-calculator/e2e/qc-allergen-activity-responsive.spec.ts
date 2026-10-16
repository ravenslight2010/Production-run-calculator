import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  requireDedicatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";

type BrowserDiagnostics = {
  pageErrors: string[];
  consoleErrors: string[];
  failedResponses: Array<{ status: number; path: string }>;
};

function collectBrowserErrors(page: Page, diagnostics: BrowserDiagnostics): void {
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      diagnostics.failedResponses.push({
        status: response.status(),
        path: new URL(response.url()).pathname,
      });
    }
  });
}

function facilityToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

test("renders the daily allergen report from recorded current-day sources", async ({
  browser,
  playwright,
  baseURL,
}, testInfo: TestInfo) => {
  test.skip(!baseURL, "The isolated browser runner must provide a local web origin.");
  const webOrigin = baseURL!;
  const apiBase = requireLocalFixtureApiOrigin("QC allergen activity responsive browser test");
  const fixtureDbUrl = requireDedicatedTestDatabase("QC allergen activity responsive browser test");
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, apiBase, SIGNUP_CODE);
  const username = uniqueTestId("qc-activity-operator");
  const runId = uniqueTestId("qc-activity-run");
  const date = facilityToday();
  const operationId = uniqueTestId("qc-activity-review-operation");
  const recordId = uniqueTestId("qc-activity-review-record");
  const db = new Client({ connectionString: fixtureDbUrl });
  const browserDiagnostics: BrowserDiagnostics = {
    pageErrors: [],
    consoleErrors: [],
    failedResponses: [],
  };
  let operatorContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let managerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    await db.connect();
    const operator = await fixtures.createAccount({
      username,
      password: "TestPass123!",
      capabilities: ["record-qc"],
      onboardingSeen: true,
    });
    const manager = await fixtures.createAccount({
      username: uniqueTestId("qc-activity-manager"),
      password: "TestPass123!",
      capabilities: ["record-qc", "manage-qc"],
      onboardingSeen: true,
    });
    await fixtures.seedTodaySync({
      token: operator.token,
      senderId: uniqueTestId("qc-activity-sync-sender"),
      date,
      payload: {
        dayState: {
          date,
          runs: [{ id: runId, brand: "Responsive Fixture", flavor: "Cheese", casesNeeded: 1, seeded: false }],
          currentIndex: 0,
          resetAt: 0,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        },
        runValues: { [runId]: { allergen: "none", casesNeeded: 1, casesPerSkid: 12 } },
        runValuesUpdatedAt: { [runId]: Date.now() },
        packagingProgress: {},
      },
    });
    const reviewInsert = await db.query<{ id: number }>(
      `INSERT INTO qc_workflow_events
         (scope, operation_id, record_id, event_type, run_id, actor_id, payload)
       VALUES ('live', $1, $2, 'allergen-review', $3, $4, $5::jsonb)
       RETURNING id`,
      [
        operationId,
        recordId,
        runId,
        operator.userId,
        JSON.stringify({
          footprintReviewed: true,
          footprint: { status: "complete", allergens: [], unknownIngredients: [], missingComponents: [] },
          note: "Responsive fixture review",
        }),
      ],
    );
    const reviewId = String(reviewInsert.rows[0]!.id);
    await db.query(
      `INSERT INTO qc_workflow_events
         (scope, operation_id, record_id, event_type, run_id, related_event_id, actor_id, payload)
       VALUES
         ('live', $1, $2, 'correction', $3, $4, $5, $6::jsonb),
         ('live', $7, $8, 'redaction', $3, $4, $5, $9::jsonb)`,
      [
        uniqueTestId("qc-activity-correction-operation"),
        uniqueTestId("qc-activity-correction-record"),
        runId,
        reviewId,
        manager.userId,
        JSON.stringify({
          reason: "Corrected the reviewed footprint",
          replacement: { note: "Corrected private fixture note" },
        }),
        uniqueTestId("qc-activity-redaction-operation"),
        uniqueTestId("qc-activity-redaction-record"),
        JSON.stringify({ reason: "Removed private note", fields: ["payload.note"] }),
      ],
    );

    operatorContext = await browser.newContext({
      viewport: test.info().project.use.viewport as { width: number; height: number } | undefined,
    });
    await operatorContext.addCookies([{
      name: "rc_auth",
      value: operator.token,
      url: new URL(webOrigin).origin,
      httpOnly: true,
      sameSite: "Lax",
    }]);
    const page = await operatorContext.newPage();
    collectBrowserErrors(page, browserDiagnostics);
    await page.goto(webOrigin, { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await page.getByTitle("More").click();
    await page.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
    await expect(page.getByTestId("qc-workflow-tab")).toBeVisible();
    await page.getByTestId("button-toggle-allergen-activity").click();

    const report = page.getByTestId("qc-allergen-activity-report");
    await expect(report).toBeVisible();
    await expect(report.getByLabel("Production date")).toHaveValue(date);
    await expect(page.getByTestId(`card-allergen-activity-${runId}`)).toContainText("Current-day snapshot");
    await expect(page.getByTestId(`text-manual-allergen-${runId}`)).toContainText("none · recorded");
    await expect(page.getByTestId(`text-derived-review-${runId}`))
      .toHaveText("Reviewed — no tracked allergens recorded");
    const reviewCard = page.getByTestId(`card-allergen-review-${reviewId}`);
    await expect(reviewCard).toContainText("[redacted]");
    await expect(reviewCard).not.toContainText("Corrected the reviewed footprint");
    await expect(reviewCard).not.toContainText("Removed private note");
    await expect(reviewCard).not.toContainText(manager.userId);
    await expect(report).toContainText("Recorded activity only.");
    await expect(report).toContainText("does not establish cleaning between runs");
    await expect(page.getByRole("button", { name: "Back to run QC" })).toBeVisible();

    managerContext = await browser.newContext({
      viewport: test.info().project.use.viewport as { width: number; height: number } | undefined,
    });
    await managerContext.addCookies([{
      name: "rc_auth",
      value: manager.token,
      url: new URL(webOrigin).origin,
      httpOnly: true,
      sameSite: "Lax",
    }]);
    const managerPage = await managerContext.newPage();
    collectBrowserErrors(managerPage, browserDiagnostics);
    await managerPage.goto(webOrigin, { waitUntil: "domcontentloaded" });
    await managerPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await managerPage.getByTitle("More").click();
    await managerPage.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
    await managerPage.getByTestId("button-toggle-allergen-activity").click();

    const managerReviewCard = managerPage.getByTestId(`card-allergen-review-${reviewId}`);
    await expect(managerReviewCard).toContainText("Corrected the reviewed footprint");
    await expect(managerReviewCard).toContainText("Removed private note");
    await expect(managerReviewCard).toContainText(manager.userId);
    await expect(managerReviewCard).toContainText("[redacted]");
    await expect(managerReviewCard).not.toContainText("Responsive fixture review");
    await expect(managerReviewCard).not.toContainText("Corrected private fixture note");
    const screenshot = await managerPage.screenshot({ fullPage: true, animations: "disabled" });
    await testInfo.attach("manager-daily-allergen-audit-details", {
      body: screenshot,
      contentType: "image/png",
    });
    const expectedForbiddenPaths = new Set([
      "/api/inventory/consume-day-start",
      "/api/factory-data",
    ]);
    const unexpectedResponses = browserDiagnostics.failedResponses.filter((response) =>
      response.status !== 403 || !expectedForbiddenPaths.has(response.path),
    );
    const forbiddenConsoleErrors = browserDiagnostics.consoleErrors.filter((message) =>
      message.includes("status of 403 (Forbidden)"),
    );
    const otherConsoleErrors = browserDiagnostics.consoleErrors.filter((message) =>
      !message.includes("status of 403 (Forbidden)"),
    );
    await testInfo.attach("qc-audit-browser-console", {
      body: JSON.stringify({
        ...browserDiagnostics,
        expectedForbiddenPaths: [...expectedForbiddenPaths],
      }, null, 2),
      contentType: "text/plain",
    });
    expect(browserDiagnostics.pageErrors, "Operator and manager page errors").toEqual([]);
    expect(otherConsoleErrors, "Unexpected browser console errors").toEqual([]);
    expect(unexpectedResponses, "Unexpected failed browser responses").toEqual([]);
    expect(forbiddenConsoleErrors, "Each expected 403 should match a protected API response")
      .toHaveLength(browserDiagnostics.failedResponses.length);
  } finally {
    await operatorContext?.close().catch(() => {});
    await managerContext?.close().catch(() => {});
    await db.query(
      "DELETE FROM qc_workflow_events WHERE scope = 'live' AND run_id = $1",
      [runId],
    ).catch(() => {});
    await db.end().catch(() => {});
    await fixtures.cleanup({ syncDates: [date] });
  }
});
