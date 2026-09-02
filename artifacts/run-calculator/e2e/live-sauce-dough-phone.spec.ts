/**
 * E2E: authenticated phone-sized smoke coverage for the live Sauce and Dough tabs.
 *
 * This intentionally exercises the rendered cards, not the timer/math helpers:
 * the barrel countdown, its dismissible alert and +1 reset, plus the conditional
 * Dough target-ball-weight readout are all asserted through the browser.
 */

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers, requireIsolatedTestDatabase } from "./isolation";
import {
  dismissOnboardingIfPresent,
  signUpAndHandleOnboarding,
} from "./onboarding";

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const PASSWORD = "TestPass123!";
const testUsernames = new Set<string>();

test.beforeEach(async () => {
  const url = requireIsolatedTestDatabase("live Sauce/Dough phone beforeEach");
  const db = new Client({ connectionString: url });
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date = $1", [
      new Date().toISOString().slice(0, 10),
    ]);
  } finally {
    await db.end().catch(() => {});
  }
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

function uid(): string {
  return `e2e_live_tabs_${Math.random().toString(36).slice(2, 9)}`;
}

async function signUpAndDismissOnboarding(page: Page, username: string): Promise<void> {
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    onboarding: {
      dialog: (currentPage) => currentPage.getByRole("dialog"),
      button: (dialog) =>
        dialog.getByRole("button", { name: /get started|close/i }).first(),
      actionLabel: "onboarding completion action",
      afterComplete: async (currentPage) => {
        await currentPage
          .locator('[data-state="open"][aria-hidden="true"]')
          .waitFor({ state: "detached", timeout: 5_000 })
          .catch(() => {});
      },
    },
  });
}

async function seedRunningValues(
  page: Page,
  valueOverrides: Record<string, number> = {},
): Promise<void> {
  await page.locator('[data-testid="tab-run"]').click();
  // The tab can be attached before the initial live-day snapshot has hydrated.
  // Wait for the same visible setup surface an operator uses to know the run is
  // ready, rather than racing the state transition or extending click timeout.
  await expect(page.getByTestId("input-casesNeeded")).toBeVisible();
  await expect(page.getByTestId("button-start-run")).toBeVisible();
  await page.getByTestId("button-start-run").click();
  await page.getByRole("button", { name: /stop.?run/i }).waitFor({ state: "visible" });

  await page.evaluate((overrides) => {
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
      ...overrides,
    }));
    if (Object.keys(overrides).length > 0) {
      const now = Date.now();
      day.runs = day.runs.map((candidate: { id?: string }) =>
        candidate.id === run.id
          ? { ...candidate, startedAt: now - 120_000, endedAt: undefined, pausedAt: undefined }
          : candidate,
      );
      localStorage.setItem("run-calc-day", JSON.stringify(day));
    }
  }, valueOverrides);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await dismissOnboardingIfPresent(page, {
    dialog: (currentPage) => currentPage.getByRole("dialog"),
    button: (dialog) =>
      dialog.getByRole("button", { name: /get started|close/i }).first(),
    actionLabel: "onboarding completion action",
    afterComplete: async (currentPage) => {
      await currentPage
        .locator('[data-state="open"][aria-hidden="true"]')
        .waitFor({ state: "detached", timeout: 5_000 })
        .catch(() => {});
    },
  });
  for (const field of [
    "casesNeeded",
    "pizzasPerCase",
    "casesPerSkid",
    "crustsPerCycle",
    "cycleSpeed",
    "speedAdjustment",
    "freezerTime",
  ]) {
    if (!(field in valueOverrides)) continue;
    const input = page.getByTestId(`input-${field}`);
    await input.evaluate((element, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, String(valueOverrides[field]));
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

test("Dough and Sauce phone quick checks share line-speed feedback across tab switches", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const username = uid();
  testUsernames.add(username);
  await signUpAndDismissOnboarding(page, username);
  await seedRunningValues(page, {
    casesNeeded: 100,
    casesPerSkid: 10,
    pizzasPerCase: 1,
    crustsPerCycle: 1,
    cycleSpeed: 1,
    speedAdjustment: 1,
    freezerTime: 0,
  });
  // The server-backed run snapshot can replace the local fixture's backdated
  // start time on reload. Let the real post-freezer eligibility window elapse
  // so this browser check exercises the suggestion, not its wait-state copy.
  await page.waitForTimeout(31_000);

  // Each quick check contributes one signed case correction. The provider
  // must retain the first correction while the Dough surface unmounts and
  // Sauce mounts, then expose the resulting suggestion on Packaging.
  await page.getByTestId("tab-dough").click();
  await expect(page.getByTestId("btn-inc-packCases")).toBeVisible();
  await page.getByTestId("btn-inc-packCases").click();

  await page.getByTestId("tab-sauce").click();
  await expect(page.getByTestId("btn-inc-packCases")).toBeVisible();
  await page.getByTestId("btn-inc-packCases").click();

  await page.getByTestId("tab-packaging").click();
  await expect(page.getByTestId("speed-nudge-card")).toBeVisible();
  await expect(page.getByTestId("speed-nudge-card")).toContainText("Line Speed Suggestion");
});