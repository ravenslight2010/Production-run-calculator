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
import { signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const ACTIVE_TAB_KEY = "run-calc-active-tab";
const testUsernames = new Set<string>();

function uid(): string {
  return `e2e_navigation_${Math.random().toString(36).slice(2, 10)}`;
}

test.beforeAll(async () => {
  await requireIsolatedTestDatabase();
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
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    onboarding: {
      dialog: (currentPage) => currentPage.getByRole("dialog"),
      button: (dialog) => dialog.getByRole("button", { name: "Close" }),
      actionLabel: "Close",
      visibilityTimeout: 5_000,
      afterComplete: async (currentPage) => {
        await currentPage
          .locator('[data-state="open"][aria-hidden="true"]')
          .waitFor({ state: "detached", timeout: 5_000 })
          .catch(() => {});
      },
    },
  });
}

async function expectSelected(page: Page, tab: string): Promise<void> {
  await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

async function expectNoLegacyDepartmentLabels(page: Page): Promise<void> {
  await expect(page.getByText("Stock", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Whse", { exact: true })).toHaveCount(0);
}

async function expectInventoryDestination(page: Page): Promise<void> {
  await expect(page.getByTestId("inventory-page-heading")).toContainText(
    "Inventory",
  );
  // "stock" is valid as sentence-level explanatory copy, but not as the
  // destination's heading or navigation label.
  await expect(
    page.getByText(
      "Review stock, lots, alerts, transfers, and substitutions.",
      { exact: true },
    ),
  ).toBeVisible();
  await expectNoLegacyDepartmentLabels(page);
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

    await page.getByTestId("tab-sauce").click();
    await expectSelected(page, "sauce");
    await page.getByTestId("tab-frontline").click();
    await expectSelected(page, "frontline");
    await page.getByTestId("tab-packaging").click();
    await expectSelected(page, "packaging");

    await pressBrowserBack(page);
    await expectSelected(page, "frontline");
    await pressBrowserBack(page);
    await expectSelected(page, "sauce");
    await pressBrowserBack(page);
    await expectSelected(page, "run");

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

  test("keeps the Warehouse label on its direct screen after hydration and reload", async ({
    page,
  }) => {
    const username = uid();
    testUsernames.add(username);
    await signUp(page, username);

    await page.goto("/?screen=warehouse", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("warehouse-screen-heading")).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByTestId("warehouse-screen-heading")).toContainText(
      "Warehouse",
    );
    await expect(page.getByText("Warehouse", { exact: true })).toBeVisible();
    await expectNoLegacyDepartmentLabels(page);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("warehouse-screen-heading")).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByTestId("warehouse-screen-heading")).toContainText(
      "Warehouse",
    );
    await expect(page.getByText("Warehouse", { exact: true })).toBeVisible();
    await expectNoLegacyDepartmentLabels(page);
  });

  test("keeps the Inventory label after its supported menu path and reload", async ({
    page,
  }) => {
    const username = uid();
    testUsernames.add(username);
    await signUp(page, username);

    await page.getByRole("button", { name: "More" }).click();
    const inventoryMenuItem = page.getByRole("menuitem", {
      name: "Inventory",
      exact: true,
    });
    await expect(inventoryMenuItem).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /^(Stock|Whse)$/ }),
    ).toHaveCount(0);
    // Radix positions the desktop menu after opening; wait for that transition
    // before selecting so this remains reliable in the full browser suite.
    await page.waitForTimeout(300);
    await inventoryMenuItem.click();
    await expect(page.getByRole("menu")).toBeHidden();
    await expectInventoryDestination(page);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("inventory-page-heading").waitFor({
      state: "visible",
      timeout: 25_000,
    });
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), ACTIVE_TAB_KEY))
      .toBe("inventory");
    await expectInventoryDestination(page);
    await page.getByRole("button", { name: "More" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Inventory", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /^(Stock|Whse)$/ }),
    ).toHaveCount(0);
  });
});