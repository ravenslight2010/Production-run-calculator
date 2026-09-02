/**
 * Department workflow evidence:
 * sign in → start one uniquely-owned run → verify warehouse needs → open QC
 * history → change a manager setting → reload and verify the live run remains.
 *
 * This suite intentionally does not use the destructive global setup from the
 * main Playwright config. The account and run are unique to the test, and no
 * shared live-day rows are deleted.
 */

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { completeOnboarding } from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

function uid(): string {
  return `e2e_departments_${Math.random().toString(36).slice(2, 10)}`;
}

test.beforeAll(async () => {
  await requireIsolatedTestDatabase("department workflow browser check");
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

async function signUp(page: Page, username: string): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.locator("#accessCode").fill(SIGNUP_CODE);
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  const welcome = page.getByRole("dialog", { name: /welcome to production run calculator/i });
  if (await welcome.isVisible().catch(() => false)) {
    await completeOnboarding(page, welcome);
  }
}

async function dismissOnboarding(page: Page): Promise<void> {
  const welcome = page.getByRole("dialog", { name: /welcome to production run calculator/i });
  if (!(await welcome.isVisible().catch(() => false))) return;
  await completeOnboarding(page, welcome);
}

async function promoteToManager(username: string): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const result = await db.query(
      `UPDATE user_roles
       SET role = 'manager', updated_at = NOW()
       WHERE user_id = (SELECT id FROM users WHERE username = $1)`,
      [username],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Could not promote isolated test user "${username}" to manager`);
    }
  } finally {
    await db.end().catch(() => {});
  }
}

async function seedPendingRun(page: Page): Promise<string> {
  const runId = uniqueTestId("department_run");
  await page.evaluate(() => {
    const keys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    );
    for (const key of keys) {
      if (key?.startsWith("run-calc-run-")) localStorage.removeItem(key);
    }
    localStorage.removeItem("run-calc-day");
  });
  await page.addInitScript((id: string) => {
    // Apply this only to the seed reload. Later reloads must preserve the
    // lifecycle written by Start Run and the department navigation checks.
    if (sessionStorage.getItem("department-pending-seed-applied") === "1") return;
    sessionStorage.setItem("department-pending-seed-applied", "1");
    localStorage.setItem(
      "run-calc-day",
      JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        runs: [{
          id,
          brand: "Department",
          flavor: "Navigation",
          casesNeeded: 1,
          seeded: false,
        }],
        currentIndex: 0,
        // Do not create a same-day reset boundary in the disposable fixture;
        // the app's normal reset scheduler owns that value.
        resetAt: 0,
      }),
    );
  }, runId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await expect
    .poll(
      () =>
        page.evaluate((id) => {
          try {
            const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}");
            const run = day.runs?.find((candidate: { id?: string }) => candidate.id === id);
            return {
              runId: run?.id ?? null,
              startedAt: run?.startedAt ?? null,
              endedAt: run?.endedAt ?? null,
            };
          } catch {
            return { runId: null, startedAt: null, endedAt: null };
          }
        }, runId),
      { timeout: 10_000 },
    )
    .toEqual({ runId, startedAt: null, endedAt: null });
  return runId;
}

async function openMore(page: Page): Promise<void> {
  const menu = page.getByRole("menu");
  if (await menu.isVisible().catch(() => false)) {
    await expect(menu).toBeHidden({ timeout: 5_000 });
  }
  await page.getByTitle("More").click();
  await expect(menu).toBeVisible();
  await page.waitForTimeout(300);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

test("production, warehouse, QC, and management remain connected after navigation", async ({
  page,
}, testInfo) => {
  const username = uid();
  testUsernames.add(username);
  await signUp(page, username);
  await promoteToManager(username);
  const runId = await seedPendingRun(page);

  await dismissOnboarding(page);
  await page.getByTestId("tab-run").click();
  await expect(page.getByTestId("button-start-run")).toBeVisible();
  await page.getByTestId("button-start-run").click();
  await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();
  await screenshot(page, testInfo, "01-production-running");

  // Warehouse is fed from the same active run and should identify this exact
  // run rather than showing an unrelated or empty day-state snapshot.
  await page.getByTestId("tab-warehouse").click();
  await expect(page.getByTestId(`warehouse-run-${runId}`)).toContainText(
    /Department[\s\S]*Navigation/,
  );
  await screenshot(page, testInfo, "02-warehouse-shared-run");

  // QC is manager/capability-gated. Reaching the real history surface proves
  // this signed-up manager retained permission through navigation.
  await openMore(page);
  await page.getByRole("menuitem", { name: "Quality history" }).click();
  await expect(page.getByTestId("quality-history-surface")).toBeVisible();
  await screenshot(page, testInfo, "03-qc-history");

  // Change an account-level manager setting through the actual management
  // menu, then verify it survives a full reload. This does not touch run or
  // shared factory data.
  await openMore(page);
  await page.getByRole("menuitem", { name: "Alerts & Floor Mode" }).click();
  const floorMode = page.getByTestId("switch-floor-mode");
  await expect(floorMode).toBeVisible();
  const before = await floorMode.isChecked();
  await floorMode.click();
  await expect(floorMode).toBeChecked({ checked: !before });
  await page.keyboard.press("Escape");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await expect(page.getByTestId("quality-history-surface")).toBeVisible();
  await openMore(page);
  await page.getByRole("menuitem", { name: "Alerts & Floor Mode" }).click();
  await expect(page.getByTestId("switch-floor-mode")).toBeChecked({ checked: !before });
  await screenshot(page, testInfo, "04-manager-setting-after-reload");

  // The live-run provider is still mounted and the same run remains active
  // after the department navigation and reload.
  await page.keyboard.press("Escape");
  await page.getByTestId("tab-run").click();
  await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();
  await screenshot(page, testInfo, "05-production-after-reload");
});