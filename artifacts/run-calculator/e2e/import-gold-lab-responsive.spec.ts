import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  uniqueTestId,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

const API_BASE = requireLocalFixtureApiOrigin("Import Gold responsive manager panel");
const PASSWORD = "GoldLabTest123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";

test("Import Gold manager panel fits and remains reviewable at this browser viewport", async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_import_gold"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    await page.route("**/api/import-gold/config", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        cleanupEnabled: false,
        localConfigured: false,
        localAvailable: false,
        localScoringSwitchAvailable: false,
        localScoringEnabled: false,
        syntheticFixtureAvailable: false,
        geminiConfigured: false,
        retention: "Cases remain until a manager deletes them.",
        persistsAcrossFactoryPurge: true,
      }),
    }));
    await page.route("**/api/import-gold/cases?*", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cases: [{
          id: 91,
          importType: "spec",
          sourceLabel: "Spec import",
          excluded: false,
          createdAt: "2026-10-21T12:00:00.000Z",
          scores: [{
            id: 7,
            provider: "local",
            status: "scored",
            accuracy: 66.67,
            comparedFields: 3,
            equalFields: 2,
            errorCode: null,
            fieldDiffs: [{ field: "recipes[0].rows[0].lbs", expected: 1, predicted: 2 }],
            createdAt: "2026-10-21T12:01:00.000Z",
          }],
        }],
      }),
    }));
    let deletionVerified = false;
    await page.route("**/api/import-gold/retention?*", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revision: (deletionVerified ? "b" : "a").repeat(64),
        records: [
          {
            caseId: 91,
            capturedAt: "2026-09-01T12:00:00.000Z",
            deleteBy: "2026-10-01T12:00:00.000Z",
            status: "overdue",
            verifiedAt: null,
            verifiedBy: null,
          },
          {
            caseId: 92,
            capturedAt: "2026-09-05T12:00:00.000Z",
            deleteBy: "2026-10-05T12:00:00.000Z",
            status: deletionVerified ? "verified" : "verification_needed",
            verifiedAt: deletionVerified ? "2026-10-06T12:00:00.000Z" : null,
            verifiedBy: deletionVerified ? "manager-fixture" : null,
          },
        ],
        hasMore: false,
        nextOffset: null,
      }),
    }));
    await page.route("**/api/import-gold/retention/92/verification", async (route) => {
      deletionVerified = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          caseId: 92,
          verifiedAt: "2026-10-06T12:00:00.000Z",
          verifiedBy: "manager-fixture",
        }),
      });
    });
    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await page.locator('button[title="More"]').click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Settings", exact: true }).click();
    await settings.getByRole("button", { name: "Data Health & Audit", exact: true }).click();

    const lab = settings.getByTestId("import-gold-lab");
    await expect(lab).toBeVisible({ timeout: 15_000 });
    await expect(lab.getByText("Import Gold Lab", { exact: true })).toBeVisible();
    await expect(lab.getByText("local: 66.67% (2/3)", { exact: true })).toBeVisible();
    await expect(lab.getByTestId("gold-retention-record-91")).toContainText("Overdue");
    await expect(lab.getByTestId("gold-retention-record-92")).toContainText("Deletion verification needed");
    await expect(lab.getByText("This register covers application case and score deletion only.", { exact: false })).toBeVisible();
    await lab.getByTestId("button-verify-gold-case-92").click();
    await expect(lab.getByTestId("gold-retention-record-92")).toContainText("App deletion verified");
    await expect(lab.getByTestId("gold-retention-verification-92")).toContainText("manager-fixture");
    await lab.getByText("Review field differences", { exact: true }).click();
    await expect(lab.getByText("Expected: 1", { exact: false })).toBeVisible();

    await expectResponsiveBounds(lab);
  } finally {
    await fixtures.cleanup();
  }
});

test("Import Gold cleanup-only manager panel fits, deletes, and refreshes in this browser viewport", async ({
  page,
  playwright,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_import_gold_cleanup"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    let caseDeleted = false;
    const deletionRequests: string[] = [];
    await page.route("**/api/import-gold/config", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: false,
        cleanupEnabled: true,
        localConfigured: false,
        localAvailable: false,
        localScoringSwitchAvailable: false,
        localScoringEnabled: false,
        syntheticFixtureAvailable: false,
        geminiConfigured: false,
        retention: "Synthetic cleanup fixture only.",
        persistsAcrossFactoryPurge: true,
      }),
    }));
    await page.route("**/api/import-gold/cleanup-cases", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cases: caseDeleted ? [] : [{
          id: 92,
          importType: "premix",
          createdAt: "2026-10-21T12:00:00.000Z",
        }],
      }),
    }));
    await page.route("**/api/import-gold/cleanup-cases/*", async (route) => {
      deletionRequests.push(route.request().url());
      caseDeleted = true;
      await route.fulfill({ status: 204, body: "" });
    });
    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await page.locator('button[title="More"]').click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Settings", exact: true }).click();
    await settings.getByRole("button", { name: "Data Health & Audit", exact: true }).click();

    const lab = settings.getByTestId("import-gold-lab");
    await expect(lab).toBeVisible({ timeout: 15_000 });
    const cleanupPanel = lab.getByTestId("import-gold-cleanup-only");
    await expect(cleanupPanel).toContainText("Source approval is off");
    await expect(cleanupPanel).toContainText("premix · #92");
    await expect(cleanupPanel).not.toContainText(/SYNTHETIC_PRIVATE|Expected:|Predicted:/);
    await expect(lab.getByRole("button", { name: "Export JSONL" })).toHaveCount(0);
    await expect(lab.getByRole("button", { name: "Score locally" })).toHaveCount(0);
    await lab.screenshot({ path: testInfo.outputPath("cleanup-only-before.png") });
    await expectResponsiveBounds(lab);

    page.once("dialog", (dialog) => dialog.accept());
    await cleanupPanel.getByRole("button", { name: "Delete case and scores" }).click();
    await expect(cleanupPanel).toContainText("No retained cases are available for cleanup in this scope.");
    expect(deletionRequests).toEqual([expect.stringContaining("/api/import-gold/cleanup-cases/92")]);
    await lab.screenshot({ path: testInfo.outputPath("cleanup-only-after.png") });
    await expectResponsiveBounds(lab);
  } finally {
    await fixtures.cleanup();
  }
});

async function expectResponsiveBounds(lab: Locator): Promise<void> {
  const geometry = await lab.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const dialog = element.closest('[role="dialog"]');
    const dialogRect = dialog?.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      dialogLeft: dialogRect?.left ?? 0,
      dialogRight: dialogRect?.right ?? window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.dialogLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.dialogRight);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
}

test("QC Manager can use the scoped retention panel without opening the Gold Lab", async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_gold_retention_qc"),
      password: PASSWORD,
      capabilities: ["manage-qc"],
      onboardingSeen: true,
    });
    await fixtures.assignQcManagerRole(account);
    let verified = false;
    await page.route("**/api/import-gold/retention?*", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revision: (verified ? "b" : "a").repeat(64),
        records: [{
          caseId: 92,
          capturedAt: "2026-09-05T12:00:00.000Z",
          deleteBy: "2026-10-05T12:00:00.000Z",
          status: verified ? "verified" : "verification_needed",
          verifiedAt: verified ? "2026-10-06T12:00:00.000Z" : null,
          verifiedBy: verified ? "qc-manager-fixture" : null,
        }],
        hasMore: false,
        nextOffset: null,
      }),
    }));
    await page.route("**/api/import-gold/retention/92/verification", async (route) => {
      verified = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          caseId: 92,
          verifiedAt: "2026-10-06T12:00:00.000Z",
          verifiedBy: "qc-manager-fixture",
        }),
      });
    });
    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await page.locator('button[title="More"]').click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Settings", exact: true }).click();
    await settings.getByRole("button", { name: "Gold Lab Retention", exact: true }).click();

    const panel = settings.getByTestId("import-gold-retention");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("Gold Lab retention", { exact: true })).toBeVisible();
    await expect(panel.getByTestId("gold-retention-record-92")).toContainText("Deletion verification needed");
    await expect(settings.getByText("Import Gold Lab", { exact: true })).toHaveCount(0);
    await panel.getByTestId("button-verify-gold-case-92").click();
    await expect(panel.getByTestId("gold-retention-record-92")).toContainText("App deletion verified");
    await expect(panel.getByTestId("gold-retention-verification-92")).toContainText("qc-manager-fixture");

    const geometry = await panel.evaluate((element) => ({
      right: element.getBoundingClientRect().right,
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  } finally {
    await fixtures.cleanup();
  }
});

test("daily retention reminders stay metadata-only and scoped by role", async ({
  page,
  playwright,
}, testInfo) => {
  test.setTimeout(180_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  try {
    const manager = await fixtures.createAccount({
      username: uniqueTestId("e2e_gold_reminder_manager"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    const qcManager = await fixtures.createAccount({
      username: uniqueTestId("e2e_gold_reminder_qc"),
      password: PASSWORD,
      capabilities: ["manage-qc"],
      onboardingSeen: true,
    });
    await fixtures.assignQcManagerRole(qcManager);
    const staff = await fixtures.createAccount({
      username: uniqueTestId("e2e_gold_reminder_staff"),
      password: PASSWORD,
      capabilities: [],
      onboardingSeen: true,
    });

    let retentionRequests = 0;
    const retentionQueries: Array<{ status: string | null; offset: string | null }> = [];
    let goldCaseRequests = 0;
    await page.route("**/api/import-gold/config", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        cleanupEnabled: false,
        localConfigured: false,
        localAvailable: false,
        localScoringSwitchAvailable: false,
        localScoringEnabled: false,
        syntheticFixtureAvailable: false,
        geminiConfigured: false,
        retention: "Synthetic reminder fixture.",
        persistsAcrossFactoryPurge: true,
      }),
    }));
    await page.route("**/api/import-gold/retention?*", async (route) => {
      retentionRequests += 1;
      const requestUrl = new URL(route.request().url());
      const status = requestUrl.searchParams.get("status");
      const offset = requestUrl.searchParams.get("offset");
      retentionQueries.push({ status, offset });
      const overdueRecord = {
        caseId: 91,
        capturedAt: "2026-09-01T12:00:00.000Z",
        deleteBy: "2026-10-01T12:00:00.000Z",
        status: "overdue",
        verifiedAt: null,
        verifiedBy: null,
      };
      const dueSoonRecord = {
        caseId: 92,
        capturedAt: "2026-10-05T12:00:00.000Z",
        deleteBy: "2026-11-04T12:00:00.000Z",
        status: "due_soon",
        verifiedAt: null,
        verifiedBy: null,
      };
      const allRecords = [overdueRecord, dueSoonRecord, { ...dueSoonRecord, caseId: 93 }];
      const matchingRecords = status === null ? allRecords : allRecords.filter((record) => record.status === status);
      const pageOffset = Number(offset ?? 0);
      const filteredRecords = matchingRecords.slice(pageOffset, pageOffset + 1);
      const hasMore = matchingRecords.length > pageOffset + 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: "a".repeat(64),
          records: filteredRecords,
          hasMore,
          nextOffset: hasMore ? pageOffset + 1 : null,
        }),
      });
    });
    await page.route("**/api/import-gold/cases?*", async (route) => {
      goldCaseRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ cases: [] }),
      });
    });

    const openHome = async (token: string) => {
      await page.context().clearCookies();
      await page.context().addCookies([{ name: "rc_auth", value: token, url: API_BASE }]);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    };
    await openHome(manager.token);
    const reminders = page.getByTestId("gold-retention-reminders");
    await expect(reminders).toBeVisible({ timeout: 15_000 });
    await expect(reminders.getByTestId("gold-retention-due-soon-reminder")).toContainText("2 deadlines due within 7 days");
    await expect(reminders.getByTestId("gold-retention-overdue-reminder")).toContainText("1 overdue deadline");
    await expect(reminders).not.toContainText(/SYNTHETIC_PRIVATE|Expected:|Predicted:|Spec import/);
    await expectResponsiveBounds(reminders);
    await reminders.getByTestId("gold-retention-overdue-reminder").click();

    const managerSettings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
    const managerRetention = managerSettings.getByTestId("import-gold-retention");
    await expect(managerRetention).toBeVisible({ timeout: 15_000 });
    await expect(managerRetention.getByTestId("gold-retention-record-91")).toContainText("Overdue");
    await expect(managerSettings.getByText("Import Gold Lab", { exact: true })).toHaveCount(0);
    await expect(managerSettings.getByRole("button", { name: /Delete app case/ })).toHaveCount(0);
    await expect(managerRetention.getByTestId("gold-retention-record-91")).toBeVisible();
    await expect(managerRetention.getByTestId("gold-retention-record-92")).toHaveCount(0);
    await managerRetention.getByTestId("button-load-more-gold-retention").click();
    await expect(managerRetention.getByTestId("gold-retention-record-92")).toBeVisible();
    await managerRetention.getByTestId("gold-retention-status-filter").selectOption("due_soon");
    await expect(managerRetention.getByTestId("gold-retention-record-92")).toBeVisible();
    await expect(managerRetention.getByTestId("gold-retention-record-91")).toHaveCount(0);
    expect(retentionQueries).toContainEqual({ status: "due_soon", offset: "0" });
    await managerRetention.getByTestId("button-load-more-gold-retention").click();
    await expect(managerRetention.getByTestId("gold-retention-record-93")).toBeVisible();
    expect(retentionQueries).toContainEqual({ status: "due_soon", offset: "1" });
    await expect(managerRetention.getByTestId("button-load-more-gold-retention")).toHaveCount(0);
    await expectResponsiveBounds(managerRetention);
    await managerRetention.screenshot({ path: testInfo.outputPath("retention-status-due-soon.png") });
    expect(goldCaseRequests).toBe(0);

    await openHome(qcManager.token);
    const qcReminders = page.getByTestId("gold-retention-reminders");
    await expect(qcReminders).toBeVisible({ timeout: 15_000 });
    await expectResponsiveBounds(qcReminders);
    await qcReminders.getByTestId("gold-retention-due-soon-reminder").click();
    const qcSettings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
    const qcRetention = qcSettings.getByTestId("import-gold-retention");
    await expect(qcRetention).toBeVisible({ timeout: 15_000 });
    await expect(qcSettings.getByText("Import Gold Lab", { exact: true })).toHaveCount(0);
    await expect(qcSettings.getByRole("button", { name: /Delete app case/ })).toHaveCount(0);
    await qcRetention.getByTestId("gold-retention-status-filter").selectOption("overdue");
    await expect(qcRetention.getByTestId("gold-retention-record-91")).toBeVisible();
    await expect(qcRetention.getByTestId("gold-retention-record-92")).toHaveCount(0);
    expect(retentionQueries).toContainEqual({ status: "overdue", offset: "0" });
    await expectResponsiveBounds(qcRetention);
    expect(goldCaseRequests).toBe(0);

    const retentionRequestsBeforeStaff = retentionRequests;
    await openHome(staff.token);
    await expect(page.getByTestId("gold-retention-reminders")).toHaveCount(0);
    await expect(page.getByTestId("gold-retention-reminder-error")).toHaveCount(0);
    expect(retentionRequests).toBe(retentionRequestsBeforeStaff);
    expect(goldCaseRequests).toBe(0);
  } finally {
    await fixtures.cleanup();
  }
});
