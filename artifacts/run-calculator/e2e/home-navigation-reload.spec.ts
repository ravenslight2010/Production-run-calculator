/**
 * E2E: Home tab selection and browser-back navigation survive reloads.
 *
 * This protects the navigation boundary owned by useHomeNavigation and
 * useBackButtonTrap:
 *   - the selected non-Run tab is restored after a reload;
 *   - browser back unwinds tab history before reaching the Run tab;
 *   - invalid persisted tabs safely fall back to Run.
 */

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers, requireIsolatedTestDatabase } from "./isolation";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const ACTIVE_TAB_KEY = "run-calc-active-tab";
const testUsernames = new Set<string>();

function uid(): string {
  return `e2e_navigation_${Math.random().toString(36).slice(2, 10)}`;
}

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
  const getStarted = page.getByRole("button", { name: /^get.?started$/i });
  if (await getStarted.isVisible().catch(() => false)) {
    await getStarted.click();
    await page
      .locator('[data-state="open"][aria-hidden="true"]')
      .waitFor({ state: "detached", timeout: 5_000 })
      .catch(() => {});
  }
}

async function expectSelected(page: Page, tab: string): Promise<void> {
  await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

async function pressBrowserBack(page: Page): Promise<void> {
  await page.evaluate(() => history.back());
}

test.describe("Home navigation persistence", () => {
  test("restores a non-Run tab after reload", async ({ page }) => {
    const username = uid();
    testUsernames.add(username);
    await signUp(page, username);

    await page.getByTestId("tab-dough").click();
    await expectSelected(page, "dough");
    await expect(page).toHaveURL(/\/$/);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await expectSelected(page, "dough");
  });

  test("unwinds tab history on browser back before leaving the app", async ({
    page,
  }) => {
    const username = uid();
    testUsernames.add(username);
    await signUp(page, username);

    // Each transition is recorded in the bounded tab history.
    await page.getByTestId("tab-sauce").click();
    await expectSelected(page, "sauce");
    await page.getByTestId("tab-frontline").click();
    await expectSelected(page, "frontline");
    await page.getByTestId("tab-packaging").click();
    await expectSelected(page, "packaging");

    // Browser back is intercepted by Home and consumes tab history first.
    await pressBrowserBack(page);
    await expectSelected(page, "frontline");
    await pressBrowserBack(page);
    await expectSelected(page, "sauce");
    await pressBrowserBack(page);
    await expectSelected(page, "run");

    // With no tab history left, another back press stays inside the app.
    const urlBeforeFinalBack = page.url();
    await pressBrowserBack(page);
    await expectSelected(page, "run");
    expect(page.url()).toBe(urlBeforeFinalBack);
  });

  test("falls back to Run when the stored tab is invalid", async ({ page }) => {
    const username = uid();
    testUsernames.add(username);
    await signUp(page, username);

    await page.evaluate((key) => {
      localStorage.setItem(key, "not-a-home-tab");
    }, ACTIVE_TAB_KEY);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await expectSelected(page, "run");
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), ACTIVE_TAB_KEY))
      .toBe("run");
  });
});