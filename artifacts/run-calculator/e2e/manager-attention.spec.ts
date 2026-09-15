import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";

const API_BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const BACKGROUND_OPERATION = "server-job-prune";

async function replaceBackgroundFailures(ageMs: number): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("seed background-operation warning"),
  });
  try {
    await db.connect();
    await db.query("DELETE FROM background_operation_events WHERE operation = $1", [
      BACKGROUND_OPERATION,
    ]);
    await db.query(
      `INSERT INTO background_operation_events (operation, error_code, occurred_at)
       SELECT $1, 'e2e_failure', NOW() - ($2::bigint * INTERVAL '1 millisecond')
       FROM generate_series(1, 3)`,
      [BACKGROUND_OPERATION, ageMs],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

async function clearBackgroundFailures(): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("clean up background-operation warning"),
  });
  try {
    await db.connect();
    await db.query("DELETE FROM background_operation_events WHERE operation = $1", [
      BACKGROUND_OPERATION,
    ]);
  } finally {
    await db.end().catch(() => {});
  }
}

async function openManagerAttention(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Manager attention", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Manager attention" })).toBeVisible();
}

async function openSummary(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
}

test("manager attention remains stable across dialog and destination transitions", async ({
  browser,
  page,
  playwright,
}, testInfo: TestInfo) => {
  test.setTimeout(150_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  const staffContext = await browser.newContext();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_manager_attention"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    const staff = await fixtures.createAccount({
      username: uniqueTestId("e2e_background_staff"),
      password: PASSWORD,
      capabilities: [],
      onboardingSeen: true,
    });
    await replaceBackgroundFailures(0);
    const scheduledBrand = uniqueTestId("AttentionBrand");
    const scheduledFlavor = uniqueTestId("AttentionFlavor");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    await page.route("**/api/password-reset-requests", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          id: uniqueTestId("reset"),
          userId: uniqueTestId("staff"),
          username: "fixture-staff",
          requestedAt: new Date().toISOString(),
        }]),
      });
    });
    await page.route("**/api/incidents/actionable-count", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 1 }),
      }));
    await page.route("**/api/sync/scheduled?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          date: tomorrow,
          runCount: 1,
          runs: [{
            id: uniqueTestId("scheduled"),
            brand: scheduledBrand,
            flavor: scheduledFlavor,
            casesNeeded: 10,
            dieType: "",
          }],
        }]),
      }));

    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    const initialDiagnostics = page.waitForResponse(
      (response) =>
        response.request().method() === "GET"
        && response.url().includes("/api/background-operations/diagnostics")
        && response.status() === 200,
    );
    await openSummary(page);
    const initialDiagnosticsBody = await (await initialDiagnostics).json() as {
      windowMs: number;
      warnings: Array<{ operation: string; lastFailureAt: string }>;
    };
    expect(initialDiagnosticsBody.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: BACKGROUND_OPERATION }),
      ]),
    );
    expect(JSON.stringify(initialDiagnosticsBody)).not.toContain("e2e_failure");
    await expect(page.getByTestId("summary-tools-header")).toBeVisible();
    await expect(page.getByTestId("background-operation-warning")).toBeVisible();
    await expect(
      page.getByTestId(`background-operation-${BACKGROUND_OPERATION}`),
    ).toContainText("Job cleanup");
    await page.screenshot({
      path: testInfo.outputPath("background-operation-warning-visible.png"),
    });

    await replaceBackgroundFailures(initialDiagnosticsBody.windowMs + 60_000);
    await page.waitForResponse(
      (response) =>
        response.request().method() === "GET"
        && response.url().includes("/api/background-operations/diagnostics")
        && response.status() === 200,
      { timeout: 40_000 },
    );
    await expect(page.getByTestId("background-operation-warning")).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath("background-operation-warning-cleared.png"),
    });
    await page.getByTestId("tab-run").click();

    await staffContext.addCookies([{ name: "rc_auth", value: staff.token, url: API_BASE }]);
    const staffPage = await staffContext.newPage();
    let staffDiagnosticRequests = 0;
    staffPage.on("request", (request) => {
      if (request.url().includes("/api/background-operations/diagnostics")) {
        staffDiagnosticRequests += 1;
      }
    });
    await staffPage.goto("/", { waitUntil: "domcontentloaded" });
    await staffPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await openSummary(staffPage);
    await expect(staffPage.getByTestId("background-operation-warning")).toHaveCount(0);
    expect(staffDiagnosticRequests).toBe(0);
    const denied = await staffPage.request.get(
      `${API_BASE}/api/background-operations/diagnostics`,
    );
    expect(denied.status()).toBe(403);

    await openManagerAttention(page);
    await expect(page.getByTestId("manager-attention-password-resets")).toBeVisible();
    await expect(page.getByTestId("manager-attention-incidents")).toBeVisible();
    await expect(page.getByTestId("manager-attention-recipe-setup")).toBeVisible();
    await expect(page.getByText("Urgent", { exact: true })).toBeVisible();
    await expect(page.getByText("High", { exact: true })).toBeVisible();
    await expect(page.getByText("Upcoming", { exact: true })).toBeVisible();
    await expect(page.getByText(`${scheduledBrand} — ${scheduledFlavor}`, { exact: true })).toBeVisible();
    await expect(page.getByText(/10 cases cannot be planned reliably/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open full manager queue" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("manager-attention-open.png") });

    await page.getByRole("dialog", { name: "Manager attention" })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "Manager attention" })).toBeHidden();
    await expect(page.getByRole("button", { name: /^More/ })).toBeFocused();
    await openManagerAttention(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("dialog", { name: "Manager attention" })).toBeVisible();
    await expect(page.getByTestId("manager-attention-recipe-setup")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("manager-attention-phone.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByTestId("manager-attention-action-password-resets").click();
    await expect(page.getByRole("heading", { name: "Staff Roster" })).toBeVisible();

    await openManagerAttention(page);
    await page.getByTestId("manager-attention-action-incidents").click();
    await expect(page.getByText("Reported issues", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Incident list", exact: true })).toBeVisible();

    await openManagerAttention(page);
    await page.getByTestId("manager-attention-action-recipe-setup").click();
    await expect(page.getByRole("heading", { name: "Setup Profiles" })).toBeVisible();
    await expect(page.getByText(scheduledBrand, { exact: true })).toBeVisible();
    await expect(page.getByText(scheduledFlavor, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("manager-attention-destination.png") });
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await openManagerAttention(page);
    await expect(page.getByTestId("manager-attention-list")).toBeVisible();
    await page.getByRole("button", { name: "Open full manager queue" }).click();
    await expect(page.getByTestId("manager-action-queue")).toBeVisible();
    expect(browserErrors).toEqual([]);
  } finally {
    await clearBackgroundFailures().catch(() => {});
    await staffContext.close().catch(() => {});
    await fixtures.cleanup();
  }
});