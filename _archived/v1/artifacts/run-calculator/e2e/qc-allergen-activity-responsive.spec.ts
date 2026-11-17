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

const RESPONSIVE_VIEWPORTS = [
  { name: "phone-320", width: 320, height: 740 },
  { name: "phone-375", width: 375, height: 812 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-430", width: 430, height: 932 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "phone-short-landscape", width: 568, height: 320 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

async function assertActivityReportLayout(
  page: Page,
  viewport: { name: string; width: number; height: number },
): Promise<{ cardWidth: number; headingFontSize: number }> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const geometry = await page.evaluate(() => {
    const report = document.querySelector<HTMLElement>(
      '[data-testid="qc-allergen-activity-report"]',
    );
    const card = report?.querySelector<HTMLElement>('[data-testid^="card-allergen-activity-"]');
    const heading = card?.querySelector<HTMLElement>("h3");
    if (!report || !card || !heading) return null;
    const reportRect = report.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const visibleControls = Array.from(
      report.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]"),
    ).flatMap((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display === "none"
        || style.visibility === "hidden"
        || Number(style.opacity) === 0
        || rect.width <= 0
        || rect.height <= 0
      ) return [];
      return rect.left < -1 || rect.right > window.innerWidth + 1
        ? [{
            label: element.getAttribute("aria-label")
              || element.textContent?.trim().slice(0, 50)
              || element.tagName,
            left: rect.left,
            right: rect.right,
          }]
        : [];
    });
    return {
      reportLeft: reportRect.left,
      reportRight: reportRect.right,
      reportWidth: report.clientWidth,
      reportScrollWidth: report.scrollWidth,
      cardLeft: cardRect.left,
      cardRight: cardRect.right,
      cardWidth: card.clientWidth,
      cardScrollWidth: card.scrollWidth,
      headingClientWidth: heading.clientWidth,
      headingScrollWidth: heading.scrollWidth,
      headingClientHeight: heading.clientHeight,
      headingScrollHeight: heading.scrollHeight,
      headingTextOverflow: getComputedStyle(heading).textOverflow,
      headingFontSize: Number.parseFloat(getComputedStyle(heading).fontSize),
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      visibleControls,
    };
  });
  expect(geometry, `daily report should render at ${viewport.name}`).not.toBeNull();
  expect(geometry!.reportLeft, `${viewport.name} report left edge`).toBeGreaterThanOrEqual(-1);
  expect(geometry!.reportRight, `${viewport.name} report right edge`).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry!.reportScrollWidth, `${viewport.name} report contents`).toBeLessThanOrEqual(geometry!.reportWidth + 1);
  expect(geometry!.cardLeft, `${viewport.name} activity card left edge`).toBeGreaterThanOrEqual(-1);
  expect(geometry!.cardRight, `${viewport.name} activity card right edge`).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry!.cardScrollWidth, `${viewport.name} activity card contents`).toBeLessThanOrEqual(geometry!.cardWidth + 1);
  expect(geometry!.headingTextOverflow, `${viewport.name} run label must not be ellipsized`).not.toBe("ellipsis");
  expect(geometry!.headingScrollWidth, `${viewport.name} run label width`).toBeLessThanOrEqual(geometry!.headingClientWidth + 1);
  expect(geometry!.headingScrollHeight, `${viewport.name} run label height`).toBeLessThanOrEqual(geometry!.headingClientHeight + 1);
  expect(geometry!.documentScrollWidth, `${viewport.name} document width`).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry!.bodyScrollWidth, `${viewport.name} body width`).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry!.visibleControls, `${viewport.name} report controls`).toEqual([]);
  return { cardWidth: geometry!.cardWidth, headingFontSize: geometry!.headingFontSize };
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
  const runId = `${uniqueTestId("qc-activity-run")}-long-report-reference-${"run-".repeat(6)}`;
  const longBrand = "Responsive Fixture — Extra-long family-size product name for phone and tablet review";
  const longFlavor = "Cheese — Limited seasonal format";
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
          runs: [{ id: runId, brand: longBrand, flavor: longFlavor, casesNeeded: 1, seeded: false }],
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
    const backToQc = page.getByRole("button", { name: "Back to run QC" });
    await expect(page.getByTestId(`card-allergen-activity-${runId}`).locator("h3"))
      .toContainText(longBrand);
    const operatorViewportMetrics: Record<string, { cardWidth: number; headingFontSize: number }> = {};
    for (const viewport of RESPONSIVE_VIEWPORTS) {
      operatorViewportMetrics[viewport.name] = await assertActivityReportLayout(page, viewport);
      await expect(backToQc, viewport.name).toBeVisible();
      await backToQc.scrollIntoViewIfNeeded();
      const backButtonBounds = await backToQc.boundingBox();
      expect(backButtonBounds?.x, `${viewport.name} return action left edge`).toBeGreaterThanOrEqual(-1);
      expect(backButtonBounds && backButtonBounds.x + backButtonBounds.width, `${viewport.name} return action right edge`)
        .toBeLessThanOrEqual(viewport.width + 1);
      expect(backButtonBounds?.y, `${viewport.name} return action top edge`).toBeGreaterThanOrEqual(-1);
      expect(backButtonBounds && backButtonBounds.y + backButtonBounds.height, `${viewport.name} return action bottom edge`)
        .toBeLessThanOrEqual(viewport.height + 1);
      await expect(backToQc).toBeEnabled();
      expect(await backToQc.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        return hit === element || Boolean(hit && element.contains(hit));
      }), `${viewport.name} return action is not covered`).toBe(true);
      await backToQc.focus();
      await expect(backToQc).toBeFocused();
    }
    expect(operatorViewportMetrics["tablet-landscape"]!.cardWidth)
      .toBeGreaterThan(operatorViewportMetrics["phone-320"]!.cardWidth);
    expect(operatorViewportMetrics["tablet-landscape"]!.headingFontSize)
      .toBeGreaterThanOrEqual(operatorViewportMetrics["phone-320"]!.headingFontSize);
    await page.setViewportSize({ width: 320, height: 740 });
    const operatorLargeTextStyle = await page.addStyleTag({
      content: "html { font-size: 200% !important; }",
    });
    const largeTextMetrics = await assertActivityReportLayout(page, {
      name: "phone-320-large-text",
      width: 320,
      height: 740,
    });
    expect(largeTextMetrics.headingFontSize, "large-text report heading should remain readable")
      .toBeGreaterThanOrEqual(24);
    const operatorPhoneEvidence = await report.screenshot({
      animations: "disabled",
      mask: [page.getByText(runId, { exact: true })],
    });
    await testInfo.attach("operator-daily-allergen-report-phone-320-large-text", {
      body: operatorPhoneEvidence,
      contentType: "image/png",
    });
    await operatorLargeTextStyle.evaluate((element) => element.remove());
    await page.setViewportSize({ width: 1440, height: 900 });
    await backToQc.click();
    await expect(report).toBeHidden();
    await expect(page.getByTestId("qc-workflow-tab")).toBeVisible();

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
    const managerViewportMetrics: Record<string, { cardWidth: number; headingFontSize: number }> = {};
    for (const viewport of RESPONSIVE_VIEWPORTS) {
      managerViewportMetrics[viewport.name] = await assertActivityReportLayout(managerPage, viewport);
      await managerReviewCard.scrollIntoViewIfNeeded();
      await expect(managerReviewCard, `${viewport.name} manager audit content`).toBeVisible();
    }
    expect(managerViewportMetrics["tablet-landscape"]!.cardWidth)
      .toBeGreaterThan(managerViewportMetrics["phone-320"]!.cardWidth);
    expect(managerViewportMetrics["tablet-landscape"]!.headingFontSize)
      .toBeGreaterThanOrEqual(managerViewportMetrics["phone-320"]!.headingFontSize);
    await managerPage.setViewportSize({ width: 1440, height: 900 });
    const screenshot = await managerPage.screenshot({
      fullPage: true,
      animations: "disabled",
      mask: [
        managerReviewCard,
        managerPage.getByTestId("text-qc-run-id"),
      ],
    });
    await testInfo.attach("manager-daily-allergen-audit-details", {
      body: screenshot,
      contentType: "image/png",
    });
    await testInfo.attach("qc-responsive-evidence-manifest", {
      body: JSON.stringify({
        capturedAt: new Date().toISOString(),
        environment: "isolated browser run with disposable database and synthetic fixtures",
        revision: "unknown in the local isolated browser harness",
        browserProject: testInfo.project.name,
        viewports: RESPONSIVE_VIEWPORTS.map(({ name, width, height }) => ({
          name,
          width,
          height,
        })),
        largeText: "simulated with a 200% root font size at 320px CSS viewport width",
        screenshots: "account/run identifiers and manager audit records masked or omitted",
        evidenceScope: "rendered layout only; not physical-device or production verification",
      }, null, 2),
      contentType: "application/json",
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
