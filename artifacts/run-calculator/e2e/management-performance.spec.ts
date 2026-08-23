/**
 * E2E: authenticated startup and deferred staff-management performance.
 *
 * This journey deliberately opens the staff surface only after the
 * authenticated shell has settled. It protects the startup path from
 * accidentally importing the staff-management bundle eagerly.
 */

import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers, requireIsolatedTestDatabase, uniqueTestId } from "./isolation";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

type CapturedDiagnostic = {
  name: string;
  durationMs: number;
  kind: string;
};

async function signUp(page: Page, username: string): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.locator("#accessCode").fill(SIGNUP_CODE);
  const response = page.waitForResponse((candidate) =>
    candidate.url().includes("/api/auth/sign-up"),
  );
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  expect((await response).status(), "isolated sign-up should succeed").toBeGreaterThanOrEqual(200);
  expect((await response).status(), "isolated sign-up should not be rejected").toBeLessThan(300);
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  const getStarted = page.getByRole("button", { name: /^get.?started$/i });
  if (await getStarted.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await getStarted.click();
  }
  await page.keyboard.press("Escape");
}

async function promoteToManager(username: string): Promise<void> {
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await database.connect();
    const user = await database.query("SELECT id FROM users WHERE username = $1", [username]);
    expect(user.rows).toHaveLength(1);
    await database.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager'`,
      [user.rows[0].id],
    );
  } finally {
    await database.end().catch(() => {});
  }
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.evaluate(() => fetch("/api/auth/sign-out", { method: "POST" }));
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign.?in|log.?in/i }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await page.keyboard.press("Escape");
}

async function capturedDiagnostics(page: Page): Promise<CapturedDiagnostic[]> {
  return page.evaluate(() => {
    const diagnostics = (window as Window & {
      __calculatorPerformance?: CapturedDiagnostic[];
    }).__calculatorPerformance ?? [];
    return diagnostics.map(({ name, durationMs, kind }) => ({ name, durationMs, kind }));
  });
}

test.beforeAll(async () => {
  requireIsolatedTestDatabase("management performance e2e");
  if (!SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for management performance e2e.");
  }
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await database.connect();
    await cleanupTestUsers(database, testUsernames);
  } finally {
    await database.end().catch(() => {});
  }
});

test("captures authenticated initial load and deferred staff visit budgets", async ({ page }, testInfo: TestInfo) => {
  await page.addInitScript(() => {
    (window as Window & { __calculatorPerformance?: CapturedDiagnostic[] }).__calculatorPerformance = [];
    window.addEventListener("calculator-performance", (event) => {
      const detail = (event as CustomEvent<CapturedDiagnostic>).detail;
      if (!detail || typeof detail.name !== "string" || typeof detail.durationMs !== "number") return;
      (window as Window & { __calculatorPerformance: CapturedDiagnostic[] })
        .__calculatorPerformance.push({
          name: detail.name,
          durationMs: detail.durationMs,
          kind: detail.kind,
        });
    });
  });

  const username = uniqueTestId("e2e_management_performance");
  testUsernames.add(username);
  const staffChunkRequests: string[] = [];

  page.on("request", (request) => {
    if (request.url().includes("StaffManagementSurface")) staffChunkRequests.push(request.url().split("?")[0]);
  });

  await signUp(page, username);
  await promoteToManager(username);
  await signIn(page, username);

  // Signing in again after granting the role ensures the browser fixture has
  // the same authenticated capability state as a normal manager visit.
  await page.waitForLoadState("load");
  await expect.poll(() => capturedDiagnostics(page)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "browser:navigation-to-dom-content-loaded", kind: "load" }),
      expect.objectContaining({ name: "browser:navigation-to-load", kind: "load" }),
    ]),
  );
  expect(staffChunkRequests, "staff surface must stay deferred during startup").toEqual([]);

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Staff roster", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Staff Roster" })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => staffChunkRequests.length).toBe(1);

  await expect.poll(async () => {
    const diagnostics = await capturedDiagnostics(page);
    return diagnostics.filter((entry) =>
      entry.name === "management:staff-chunk-load" ||
      entry.name === "management:staff-first-visit",
    );
  }).toEqual([
    expect.objectContaining({ name: "management:staff-chunk-load", kind: "load" }),
    expect.objectContaining({ name: "management:staff-first-visit", kind: "navigation" }),
  ]);

  const diagnostics = await capturedDiagnostics(page);
  const report = diagnostics
    .filter((entry) =>
      entry.name === "browser:navigation-to-dom-content-loaded" ||
      entry.name === "browser:navigation-to-load" ||
      entry.name === "management:staff-chunk-load" ||
      entry.name === "management:staff-first-visit",
    )
    .map(({ name, durationMs, kind }) => ({
      name,
      kind,
      durationMs: Math.round(durationMs * 100) / 100,
    }));
  await testInfo.attach("calculator-performance-diagnostics.json", {
    body: JSON.stringify({ diagnostics: report, staffChunkRequests: staffChunkRequests.length }, null, 2),
    contentType: "application/json",
  });
  console.log("calculator performance diagnostics", JSON.stringify(report));
});