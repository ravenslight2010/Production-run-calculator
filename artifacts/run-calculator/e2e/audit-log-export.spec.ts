/**
 * E2E: manager audit PDF exports preserve the selected filters and remain
 * recoverable when authorization or scope checks reject a download.
 */

import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const MANAGER_CAPABILITIES = [
  "manage-staff",
  "manage-inventory",
  "edit-production-rules",
  "approve-password-resets",
  "review-incidents",
  "use-ai-tools",
  "manage-factory-settings",
  "manage-profiles",
];
const START_DATE = "2026-01-01";
const END_DATE = "2026-01-02";
const RESOURCE_PREFIX = "e2e:audit-pdf:";

const testUsernames = new Set<string>();
let auditResourcePrefix = "";

async function signUp(page: Page, username: string): Promise<void> {
  if (!SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for audit export e2e.");
  }
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    onboarding: { visibilityTimeout: 5_000 },
  });
}

async function promoteToManager(username: string): Promise<string> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const user = await db.query("SELECT id FROM users WHERE username = $1", [username]);
    expect(user.rows).toHaveLength(1);
    await db.query(
      "UPDATE roles SET capabilities = $1::jsonb, updated_at = NOW() WHERE name = 'manager'",
      [JSON.stringify(MANAGER_CAPABILITIES)],
    );
    await db.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager', updated_at = NOW()`,
      [user.rows[0].id],
    );
    return user.rows[0].id as string;
  } finally {
    await db.end().catch(() => {});
  }
}

async function seedAuditRows(actor: string): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  auditResourcePrefix = `${RESOURCE_PREFIX}${uniqueTestId("fixture")}:`;
  try {
    await db.connect();
    await db.query(
      `INSERT INTO audit_logs (scope, actor, action, resource, changes, created_at)
       VALUES
         ('live', $1, 'factory_reset', $2, $3::jsonb, '2026-01-02T12:00:00.000Z'),
         ('live', $1, 'factory_reset', $4, $3::jsonb, '2026-01-01T12:00:00.000Z'),
         ('live', $1, 'factory_reset', $5, $3::jsonb, '2025-12-31T12:00:00.000Z')`,
      [
        actor,
        `${auditResourcePrefix}in-range-latest`,
        JSON.stringify({ outcome: "success" }),
        `${auditResourcePrefix}in-range-earlier`,
        `${auditResourcePrefix}outside-range`,
      ],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

async function cleanupFixtures(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    if (auditResourcePrefix) {
      await db.query("BEGIN");
      try {
        await db.query("SET LOCAL ROLE audit_maintenance");
        await db.query(
          "SELECT public.delete_audit_log(id, 'browser_fixture_cleanup') FROM audit_logs WHERE resource LIKE $1",
          [`${auditResourcePrefix}%`],
        );
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
}

async function openAuditLog(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Settings", exact: true }).click();
  await settings.getByRole("button", { name: "Data Health & Audit", exact: true }).click();
  await expect(page.getByText("Audit Log", { exact: true })).toBeVisible();
}

test.beforeAll(async () => {
  requireIsolatedTestDatabase("audit PDF export e2e");
});

test.afterAll(async () => {
  await cleanupFixtures();
});

test("exports the filtered audit PDF and safely retries rejected downloads", async ({
  page,
}, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  const username = uniqueTestId("e2e_audit_pdf_manager");
  testUsernames.add(username);

  await signUp(page, username);
  const managerId = await promoteToManager(username);
  await seedAuditRows(managerId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await openAuditLog(page);

  const filteredListResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname.endsWith("/api/audit-logs") &&
      url.searchParams.get("startDate") === START_DATE &&
      url.searchParams.get("endDate") === `${END_DATE}T23:59:59` &&
      url.searchParams.get("limit") === "1"
    );
  });
  const dateInputs = page.locator('input[type="date"]');
  const limitInput = page.locator('input[type="number"]').first();
  await expect(dateInputs).toHaveCount(2);
  await dateInputs.nth(0).fill(START_DATE);
  await dateInputs.nth(1).fill(END_DATE);
  await limitInput.fill("1");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect((await filteredListResponse).status()).toBe(200);
  await expect(page.getByText(`${auditResourcePrefix}in-range-latest`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${auditResourcePrefix}in-range-earlier`, { exact: true })).toHaveCount(0);
  await expect(page.getByText(`${auditResourcePrefix}outside-range`, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("audit-log-filtered-table.png") });

  const exportRequests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.endsWith("/api/audit-logs/export.pdf")) {
      exportRequests.push(url);
    }
  });
  let exportAttempt = 0;
  await page.route("**/api/audit-logs/export.pdf*", async (route) => {
    exportAttempt += 1;
    if (exportAttempt === 1) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "private audit payload" }),
      });
      return;
    }
    if (exportAttempt === 2) {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "private audit payload" }),
      });
      return;
    }
    await route.continue();
  });

  const pdfButton = page.getByRole("button", { name: "PDF", exact: true });
  const unauthorizedResponse = page.waitForResponse(
    (response) => response.url().includes("/api/audit-logs/export.pdf"),
  );
  await pdfButton.click();
  expect((await unauthorizedResponse).status()).toBe(401);
  await expect(page.getByText("Your session has expired. Sign in again and retry the PDF download.", { exact: true })).toBeVisible();
  expect(page.getByText("private audit payload", { exact: true })).toHaveCount(0);
  await expect(pdfButton).toBeEnabled();
  await expect(page.getByText(`${auditResourcePrefix}in-range-latest`, { exact: true })).toBeVisible();

  const nonLiveScopeResponse = page.waitForResponse(
    (response) => response.url().includes("/api/audit-logs/export.pdf"),
  );
  await pdfButton.click();
  expect((await nonLiveScopeResponse).status()).toBe(403);
  await expect(page.getByText("PDF export requires manager access in the live facility.", { exact: true })).toBeVisible();
  expect(page.getByText("private audit payload", { exact: true })).toHaveCount(0);
  await expect(pdfButton).toBeEnabled();
  await expect(page.getByText(`${auditResourcePrefix}in-range-latest`, { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  const successfulExportResponse = page.waitForResponse(
    (response) => response.url().includes("/api/audit-logs/export.pdf"),
  );
  await pdfButton.click();
  const [successfulResponse, download] = await Promise.all([
    successfulExportResponse,
    downloadPromise,
  ]);
  expect(successfulResponse.status()).toBe(200);
  expect(download.suggestedFilename()).toBe(
    `audit-logs-${START_DATE}-to-${END_DATE}.pdf`,
  );
  expect(exportRequests).toHaveLength(3);
  for (const requestUrl of exportRequests) {
    expect(requestUrl.searchParams.get("startDate")).toBe(`${START_DATE}T00:00:00.000Z`);
    expect(requestUrl.searchParams.get("endDate")).toBe(`${END_DATE}T23:59:59.999Z`);
    expect(requestUrl.searchParams.get("limit")).toBe("1");
  }
});