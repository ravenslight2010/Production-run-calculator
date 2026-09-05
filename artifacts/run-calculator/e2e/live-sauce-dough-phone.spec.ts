/**
 * E2E: authenticated phone-sized smoke coverage for the live Sauce and Dough tabs.
 *
 * This intentionally exercises the rendered cards, not the timer/math helpers:
 * the barrel countdown, its dismissible alert and +1 reset, plus the conditional
 * Dough target-ball-weight readout are all asserted through the browser.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  type E2ECapability,
} from "./isolation";

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const PASSWORD = "TestPass123!";
const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
let authorizedFixtures: AuthorizedBrowserFixtures;

test.beforeAll(async ({ playwright }) => {
  authorizedFixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    API_BASE,
    SIGNUP_CODE,
  );
});

test.beforeEach(async () => {
  await authorizedFixtures.removeTodaySync([
    new Date().toISOString().slice(0, 10),
  ]);
});

test.afterAll(async () => {
  await authorizedFixtures?.cleanup({
    syncDates: [new Date().toISOString().slice(0, 10)],
  });
});

function uid(): string {
  return `e2e_live_tabs_${Math.random().toString(36).slice(2, 9)}`;
}

async function createAuthorizedServerFixture(
  username: string,
): Promise<{ token: string; brand: string; flavor: string; runId: string }> {
  const auth = await authorizedFixtures.createAccount({
    username,
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });

  const brand = `Frontline ${uid()}`;
  const flavor = "Phone Fixture";
  const key = `${brand.toLowerCase()}__${flavor.toLowerCase()}`;
  const runId = `frontline-run-${uid()}`;
  const now = Date.now();
  const values = {
    casesNeeded: 500,
    pizzasPerCase: 1,
    casesPerSkid: 10,
    crustsPerCycle: 1,
    cycleSpeed: 60,
    speedAdjustment: 1,
    freezerTime: 0,
    frontlineRecipeName: "Fixture Sauce",
    frontlineRecipe: [{ ingredient: "Tomato Sauce", lbs: 1 }],
    sauceOzPerPizza: 2,
    sauceBarrelLbs: 20,
    doughRecipeName: "Fixture Dough",
    doughRecipe: [{ ingredient: "Flour", lbs: 10 }],
    targetDoughballWeight: 10,
    doughballsPerTray: 6,
    doughBatchYield: 100,
    app1Type: "Cheese",
    app1OzPerPizza: 16,
    app1BatchLbs: 1,
    app1CheeseRecipeName: "Fixture App Cheese",
    app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 1 }],
    app1BatchesMade: 0,
    app1BatchAnchorNetSec: 0,
    app1BatchCorrectionGeneration: 0,
  };
  await authorizedFixtures.seedBrandProfile(auth, {
    key,
    brand,
    flavor,
    values,
    updatedAt: now,
  });
  const date = new Date().toISOString().slice(0, 10);
  await authorizedFixtures.seedTodaySync({
    token: auth.token,
    senderId: `frontline-fixture-${username}`,
    date,
    payload: {
      dayState: {
        date,
        runs: [{
          id: runId,
          brand,
          flavor,
          startedAt: now,
          pausedAt: undefined,
          endedAt: undefined,
          metaUpdatedAt: now,
          seeded: false,
        }],
        currentIndex: 0,
        resetAt: 0,
        substitutions: [],
        substitutionLog: [],
        stagedItems: {},
      },
      runValues: { [runId]: values },
      runValuesUpdatedAt: { [runId]: now },
      packagingProgress: {},
    },
  });
  return { token: auth.token, brand, flavor, runId };
}

async function openAsAuthorizedFixture(
  page: Page,
  username: string,
  capabilities: readonly E2ECapability[] = [],
): Promise<void> {
  const account = await authorizedFixtures.createAccount({
    username,
    password: PASSWORD,
    capabilities,
  });
  await page.context().addCookies([{
    name: "rc_auth",
    value: account.token,
    url: API_BASE,
  }]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
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
  await openAsAuthorizedFixture(page, username);
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
  await openAsAuthorizedFixture(page, username);
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

test("Frontline App tracking survives off-tab work, corrections, pause, and reload", async ({
  page,
  request,
}) => {
  test.setTimeout(105_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const username = uid();
  const fixture = await createAuthorizedServerFixture(username);
  await page.context().addCookies([{
    name: "rc_auth",
    value: fixture.token,
    url: API_BASE,
  }]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible();

  // Frontline tracking is provider-owned: App 1 advances while another station
  // is mounted, then is visible when the operator returns to Frontline.
  await page.getByTestId("tab-dough").click();
  await expect(page.getByTestId("text-target-ball-weight")).toHaveText("10 oz");
  await page.waitForTimeout(2_500);
  await page.getByTestId("tab-sauce").click();
  await expect(page.getByTestId("output-sauce-batches")).toBeVisible();
  await page.getByTestId("tab-frontline").click();
  const appOutput = page.getByTestId("output-app1-batches");
  const madeText = appOutput.locator("xpath=..").getByText(/made so far/i);
  await expect(madeText).toBeVisible();
  const madeBeforeCorrection = Number.parseInt((await madeText.textContent()) ?? "0", 10);
  expect(madeBeforeCorrection).toBeGreaterThan(0);

  await appOutput.locator("xpath=../..")
    .getByRole("button", { name: "Increase batches made" })
    .click();
  await expect(madeText).toContainText(`${madeBeforeCorrection + 1} made so far`);
  await page.waitForTimeout(2_500);
  await expect(madeText).toContainText(`${madeBeforeCorrection + 1} made so far`);

  await page.getByTestId("tab-run").click();
  await page.getByRole("button", { name: /pause.?run/i }).click();
  await expect(page.getByRole("button", { name: /resume.?run/i })).toBeVisible();
  await page.waitForTimeout(1_500);
  await page.getByRole("button", { name: /resume.?run/i }).click();
  await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible();

  // The shared correction fence is intentionally one minute. Its expiry must
  // resume at the corrected anchor, not replay the suppressed or paused time.
  await page.waitForTimeout(56_000);
  await page.getByTestId("tab-frontline").click();
  await expect(madeText).toContainText(`${madeBeforeCorrection + 2} made so far`, {
    timeout: 8_000,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-frontline").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTestId("tab-frontline").click();
  await expect(page.getByTestId("output-app1-batches").locator("xpath=.."))
    .toContainText(`${madeBeforeCorrection + 2} made so far`);
  await page.getByTestId("tab-packaging").click();
  await expect(page.getByTestId("tab-sauce")).toBeAttached();
  await expect(page.getByTestId("tab-dough")).toBeAttached();
  await expect(page.getByTestId("tab-packaging")).toBeAttached();
});