/**
 * E2E: authenticated phone-sized smoke coverage for the live Sauce and Dough tabs.
 *
 * This intentionally exercises the rendered cards, not the timer/math helpers:
 * the barrel countdown, its dismissible alert and +1 reset, plus the conditional
 * Dough target-ball-weight readout are all asserted through the browser.
 */

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers } from "./isolation";

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const PASSWORD = "TestPass123!";
const testUsernames = new Set<string>();

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

function uid(): string {
  return `e2e_live_tabs_${Math.random().toString(36).slice(2, 9)}`;
}

async function signUpAndDismissOnboarding(page: Page, username: string): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.locator("#accessCode").fill(SIGNUP_CODE);
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
  const onboarding = page.getByRole("dialog");
  await onboarding.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole("button", { name: "Close" }).click();
    await page.locator('[data-state="open"][aria-hidden="true"]')
      .waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
  }
}

async function seedRunningValues(page: Page): Promise<void> {
  await page.locator('[data-testid="tab-run"]').click();
  await page.getByTestId("button-start-run").click();
  await page.getByRole("button", { name: /stop.?run/i }).waitFor({ state: "visible" });

  await page.evaluate(() => {
    const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}");
    const run = day.runs?.[day.currentIndex ?? 0];
    if (!run?.id) throw new Error("The new test run was not persisted locally");
    const key = `run-calc-run-${run.id}`;
    const values = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({
      ...values,
      casesNeeded: 10,
      pizzasPerCase: 1,
      casesPerLayer: 0,
      crustsPerCycle: 1,
      cycleSpeed: 60,
      sauceOzPerPizza: 2,
      sauceBarrelLbs: 2,
      frontlineRecipeName: "Test Sauce",
      frontlineRecipe: [],
      doughRecipeName: "Test Dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 10 }],
      targetDoughballWeight: 10,
      mixerLowSec: 30,
      mixerHighSec: 30,
      hopperSec: 30,
    }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const onboarding = page.getByRole("dialog");
  await onboarding.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole("button", { name: "Close" }).click();
    await page.locator('[data-state="open"][aria-hidden="true"]')
      .waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
  }
}

test("Sauce and Dough live cards work at a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const username = uid();
  testUsernames.add(username);
  await signUpAndDismissOnboarding(page, username);
  await seedRunningValues(page);

  await page.getByTestId("tab-sauce").click();
  const sauceOutput = page.getByTestId("output-sauce-batches");
  await expect(sauceOutput).toBeVisible();
  await expect(page.getByTestId("tickbar-fill")).toBeVisible();

  // The intentionally short seeded barrel cadence makes the real alert appear
  // without waiting through a production-length cycle.
  const barrelAlert = page.getByText(/start new barrel soon/i);
  await expect(barrelAlert).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("button-dismiss-barrel-alert").click();
  await expect(barrelAlert).toBeHidden();

  const before = await sauceOutput.textContent();
  await sauceOutput.locator("xpath=../..").getByRole("button", { name: "Increase batches made" }).click();
  await expect(sauceOutput).not.toHaveText(before ?? "");
  await expect(page.getByTestId("tickbar-fill")).toBeVisible();

  await page.getByTestId("tab-dough").click();
  await expect(page.getByTestId("text-target-ball-weight")).toHaveText("10 oz");
});