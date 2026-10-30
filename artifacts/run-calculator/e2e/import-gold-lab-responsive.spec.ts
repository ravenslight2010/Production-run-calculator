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
