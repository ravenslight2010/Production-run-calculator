/**
 * E2E: authenticated phone-sized smoke coverage for the live Sauce and Dough tabs.
 *
 * This intentionally exercises the rendered cards, not the timer/math helpers:
 * the passive barrel countdown, automatic staged-supply summary, correction
 * controls, plus the conditional Dough target-ball-weight readout are all
 * asserted through the browser.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  type E2ECapability,
} from "./isolation";
import type { FormValues } from "../src/types";

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const PASSWORD = "TestPass123!";
const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
let authorizedFixtures: AuthorizedBrowserFixtures;
let inventoryFixtureItems: Array<{ id: number; token: string }> = [];

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

test.afterEach(async ({ request }) => {
  for (const item of inventoryFixtureItems) {
    await request.delete(`/api/inventory/items/${item.id}`, {
      headers: { Cookie: `rc_auth=${item.token}` },
    });
  }
  inventoryFixtureItems = [];
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
  valueOverrides: Partial<FormValues> = {},
): Promise<{ token: string; brand: string; flavor: string; runId: string; startedAt: number }> {
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
    // Keep Sauce visible but outside this App-only fixture's clock window.
    // A bought-as-is sauce uses sauceBarrelLbs for cadence; recipe rows would
    // instead make the one-pound recipe sum due during this test.
    frontlineRecipeName: "Fixture Sauce",
    frontlineRecipe: [],
    sauceOzPerPizza: 2,
    sauceBarrelLbs: 100_000,
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
    ...valueOverrides,
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
  return { token: auth.token, brand, flavor, runId, startedAt: now };
}

async function runAuthoritativeAutoTrackTick(
  page: Page,
  nowMs: number,
  options: { rearm?: boolean } = {},
): Promise<{ accepted?: number; outcomes?: Record<string, number> }> {
  const response = await page.request.post("/api/sync/e2e/auto-track-tick", {
    data: { nowMs, ...(options.rearm ? { rearm: true } : {}) },
  });
  expect(
    response.ok(),
    `authoritative auto-track fixture tick failed: ${response.status()}`,
  ).toBe(true);
  return await response.json() as { accepted?: number; outcomes?: Record<string, number> };
}

async function seedInventoryItem(
  page: Page,
  token: string,
  name: string,
): Promise<void> {
  const response = await page.request.post("/api/inventory/items", {
    headers: { Cookie: `rc_auth=${token}` },
    data: {
      key: `ingredient:${name}:lbs`,
      category: "ingredient",
      name,
      unit: "lbs",
    },
  });
  expect(
    response.ok(),
    `inventory fixture creation failed: ${response.status()}`,
  ).toBe(true);
  const body = await response.json() as { id: number };
  inventoryFixtureItems.push({ id: body.id, token });
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
  await expect(sauceOutput.locator("xpath=..")).toContainText("On line 1");
  await expect(sauceOutput.locator("xpath=..")).toContainText("ready 1");
  await expect(sauceOutput.locator("xpath=..")).toContainText("being made 1");
  await expect(page.getByTestId("tickbar-fill")).toBeVisible();

  // Barrel depletion remains a passive countdown. The old manual-advance
  // prompt and dismiss control must never appear.
  await expect(page.getByText(/start new barrel soon|barrel exhausted/i)).toHaveCount(0);
  await expect(page.getByTestId("button-dismiss-barrel-alert")).toHaveCount(0);

  const before = await sauceOutput.textContent();
  await sauceOutput.locator("xpath=../..")
    .getByRole("button", { name: "Increase consumed batches correction" })
    .click();
  await expect(sauceOutput).not.toHaveText(before ?? "");
  await expect(page.getByTestId("tickbar-fill")).toBeVisible();

  await page.getByTestId("tab-dough").click();
  await expect(page.getByTestId("text-target-ball-weight")).toHaveText("10 oz");
});

test("Sauce automatic supply stays accurate after the final partial unit", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const username = uid();
  const sauceName = `Fixture Sauce ${username}`;
  const fixture = await createAuthorizedServerFixture(username, {
    // 10 × 32 oz plus the 30 lb buffer = 50 lb = 2.5 barrels. The short
    // cadence lets this browser fixture claim the final physical barrel while
    // the rendered demand remains fractional.
    casesNeeded: 10,
    crustsPerCycle: 1,
    cycleSpeed: 1,
    speedAdjustment: 1,
    freezerTime: 0,
    sauceOzPerPizza: 32,
    sauceBarrelLbs: 20,
    frontlineRecipeName: sauceName,
    sauceBarrelsMade: 2,
    sauceBarrelAnchorNetSec: 0,
    sauceBarrelCorrectionGeneration: 0,
  });
  await seedInventoryItem(page, fixture.token, sauceName);
  await page.context().addCookies([{
    name: "rc_auth",
    value: fixture.token,
    url: API_BASE,
  }]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible();
  await page.getByTestId("tab-sauce").click();

  const sauceOutput = page.getByTestId("output-sauce-batches");
  const sauceCard = sauceOutput.locator("xpath=../..");
  await expect(sauceOutput).toContainText("0.00 barrels still to make");
  await expect(sauceCard).toContainText("Total 2.50 · consumed 2.00");
  await expect(sauceCard).toContainText("On line 0.50 · ready 0.00 · being made 0.00");

  // With a 20 lb barrel, 32 oz/pizza, and 1 ppm, the authoritative Sauce
  // cadence is 600 net seconds. The fixture starts at two consumed barrels so
  // this claim is the final physical barrel and must clamp to the fractional
  // 2.5-barrel requirement rather than overshooting the displayed total.
  const tick = await runAuthoritativeAutoTrackTick(page, fixture.startedAt + 600_000);
  expect(tick.accepted, JSON.stringify(tick)).toBeGreaterThan(0);
  await page.waitForTimeout(250);

  const expectCompletedSauceCard = async () => {
    await expect(sauceOutput).toContainText("0.00 barrels still to make · done ✓");
    await expect(sauceCard).toContainText("Total 2.50 · consumed 2.50");
    await expect(sauceCard).toContainText("On line 0.00 · ready 0.00 · being made 0.00");
    await expect(page.getByText(/start new barrel soon|barrel exhausted/i)).toHaveCount(0);
    await expect(page.getByTestId("button-dismiss-barrel-alert")).toHaveCount(0);
  };

  await expectCompletedSauceCard();

  // Tabs unmount inactive content. The canonical progress must reconstruct the
  // same completed summary rather than relying on a tab-local barrel counter.
  await page.getByTestId("tab-dough").click();
  await page.getByTestId("tab-sauce").click();
  await expectCompletedSauceCard();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-sauce").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTestId("tab-sauce").click();
  await expectCompletedSauceCard();
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
}) => {
  test.setTimeout(60_000);
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
  // Production owns automatic progress on the server. Drive that same engine
  // explicitly rather than waiting for retired browser-side interval writes.
  await runAuthoritativeAutoTrackTick(page, fixture.startedAt + 2_500);
  await page.getByTestId("tab-sauce").click();
  await expect(page.getByTestId("output-sauce-batches")).toBeVisible();
  await page.getByTestId("tab-frontline").click();
  const appOutput = page.getByTestId("output-app1-batches");
  const consumedText = appOutput.locator("xpath=..").getByText(/Total .* consumed/i);
  await expect(consumedText).toBeVisible();
  await expect(appOutput.locator("xpath=..")).toContainText("On line");
  await expect(appOutput.locator("xpath=..")).toContainText("ready");
  const readConsumed = async () => {
    const match = ((await consumedText.textContent()) ?? "").match(/consumed\s+([\d.]+)/i);
    return Number(match?.[1] ?? 0);
  };
  const madeBeforeCorrection = await readConsumed();
  expect(madeBeforeCorrection).toBeGreaterThan(0);

  await appOutput.locator("xpath=../..")
    .getByRole("button", { name: "Increase consumed batches correction" })
    .click();
  await expect.poll(readConsumed).toBe(madeBeforeCorrection + 1);
  // Allow the debounced correction to reach the canonical row before changing
  // lifecycle state or asking the authoritative engine for its next event.
  await page.waitForTimeout(750);
  await expect.poll(readConsumed).toBe(madeBeforeCorrection + 1);

  await page.getByTestId("tab-run").click();
  await page.getByRole("button", { name: /pause.?run/i }).click();
  await expect(page.getByRole("button", { name: /resume.?run/i })).toBeVisible();
  await page.waitForTimeout(1_500);
  await page.getByRole("button", { name: /resume.?run/i }).click();
  await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible();

  // Once the shared correction fence has elapsed, the next authoritative event
  // resumes at the corrected anchor instead of replaying suppressed/paused time.
  await page.waitForTimeout(750);
  await runAuthoritativeAutoTrackTick(page, fixture.startedAt + 65_000, { rearm: true });
  await page.getByTestId("tab-frontline").click();
  await expect.poll(readConsumed, { timeout: 8_000 }).toBeGreaterThan(madeBeforeCorrection + 1);
  const madeAfterTick = await readConsumed();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-frontline").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTestId("tab-frontline").click();
  await expect(page.getByTestId("output-app1-batches").locator("xpath=..")
    .getByText(new RegExp(`consumed ${madeAfterTick}(?:\\.0+)?$`, "i")))
    .toBeVisible();
  await page.getByTestId("tab-packaging").click();
  await expect(page.getByTestId("tab-sauce")).toBeAttached();
  await expect(page.getByTestId("tab-dough")).toBeAttached();
  await expect(page.getByTestId("tab-packaging")).toBeAttached();
});