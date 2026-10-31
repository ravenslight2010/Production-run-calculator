/**
 * E2E: authenticated phone-sized smoke coverage for the live Sauce and Dough tabs.
 *
 * This intentionally exercises the rendered cards, not the timer/math helpers:
 * the passive barrel countdown, automatic staged-supply summary, correction
 * controls, plus the conditional Dough target-ball-weight readout are all
 * asserted through the browser.
 */

import { expect, test, type Page } from "@playwright/test";
import { selectCanonicalFixtureRun } from "./canonical-run-selection";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  type E2ECapability,
} from "./isolation";
import type { FormValues } from "../src/types";

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const PASSWORD = "TestPass123!";
const API_BASE =
  process.env.PLAYWRIGHT_API_BASE_URL ??
  process.env.PLAYWRIGHT_BASE_URL ??
  `https://${process.env.REPLIT_DEV_DOMAIN}`;
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
    app1StockLbs: 0,
    app1StockAnchorNetSec: 0,
    app1StockCorrectionGeneration: 0,
    app1StockConsumedLbs: 0,
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
  await authorizedFixtures.seedCanonicalTodaySnapshot({
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
        currentRunId: runId,
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
): Promise<{ builtClaims: number; accepted: number; outcomes: Record<string, number> }> {
  const today = new Date().toISOString().slice(0, 10);
  const response = await page.request.post(`/api/sync/e2e/auto-track-tick?today=${today}`, {
    data: { nowMs, ...(options.rearm ? { rearm: true } : {}) },
  });
  expect(
    response.ok(),
    `authoritative auto-track fixture tick failed: ${response.status()}`,
  ).toBe(true);
  const summary = await response.json() as {
    builtClaims: number;
    accepted: number;
    outcomes: Record<string, number>;
  };
  expect(Number.isInteger(summary.builtClaims), "tick response must report built claims").toBe(true);
  expect(Number.isInteger(summary.accepted), "tick response must report accepted events").toBe(true);
  expect(summary.outcomes, "tick response must report event outcomes").toBeDefined();
  return summary;
}

async function seedInventoryItem(
  page: Page,
  token: string,
  name: string,
  preparedSauce = false,
): Promise<void> {
  const key = preparedSauce ? "ingredient:Sauce:batches" : `ingredient:${name}:lbs`;
  if (preparedSauce) {
    // Prepared Sauce consumes the shared batch item, not a raw ingredient.
    // Never take ownership of (or later delete) an existing factory item.
    const existing = await page.request.get("/api/inventory", {
      headers: { Cookie: `rc_auth=${token}` },
    });
    expect(existing.ok(), "read inventory before owning a fixture item").toBe(true);
    const items = await existing.json() as Array<{ id: number; key: string }>;
    if (items.some((item) => item.key === key)) return;
  }
  const response = await page.request.post("/api/inventory/items", {
    headers: { Cookie: `rc_auth=${token}` },
    data: {
      key,
      category: "ingredient",
      name,
      unit: preparedSauce ? "batches" : "lbs",
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
  runId?: string,
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
  if (runId) await selectCanonicalFixtureRun(page, runId);
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
  const sauceName = `Fixture Sauce ${username}`;
  const fixture = await createAuthorizedServerFixture(username, {
    casesNeeded: 10,
    pizzasPerCase: 1,
    sauceOzPerPizza: 2,
    sauceBarrelLbs: 2,
    frontlineRecipeName: sauceName,
    frontlineRecipe: [{ ingredient: sauceName, lbs: 2 }],
  });
  await seedInventoryItem(page, fixture.token, sauceName);
  await page.context().addCookies([{
    name: "rc_auth",
    value: fixture.token,
    url: API_BASE,
  }]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await selectCanonicalFixtureRun(page, fixture.runId);
  await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible();

  await page.getByTestId("tab-sauce").click();
  const sauceOutput = page.getByTestId("output-sauce-batches");
  await expect(sauceOutput).toBeVisible();
  await expect(sauceOutput.locator("xpath=..")).toContainText(/Total .* consumed 0/);
  await expect(sauceOutput.locator("xpath=..")).toContainText("On line");
  await expect(sauceOutput.locator("xpath=..")).toContainText("ready");
  await expect(sauceOutput.locator("xpath=..")).toContainText("being made");
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

test("Sauce stock edits sync to a peer and persist after tab changes and reload", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const username = uid();
  const sauceName = `Fixture Sauce ${username}`;
  const fixture = await createAuthorizedServerFixture(username, {
    casesNeeded: 10,
    pizzasPerCase: 1,
    sauceOzPerPizza: 2,
    sauceBarrelLbs: 2,
    frontlineRecipeName: sauceName,
    frontlineRecipe: [{ ingredient: sauceName, lbs: 2 }],
  });
  await page.context().addCookies([{
    name: "rc_auth",
    value: fixture.token,
    url: API_BASE,
  }]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await selectCanonicalFixtureRun(page, fixture.runId);
  // This journey isolates manual stock synchronization; pause automatic
  // depletion so time spent opening the peer and reloading cannot consume it.
  await page.getByRole("button", { name: /pause.?run/i }).click();
  await expect(page.getByRole("button", { name: /resume.?run/i })).toBeVisible();
  const readCanonicalPausedAt = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await page.request.get(`/api/sync/today?today=${today}`);
    expect(response.ok(), `canonical pause read failed: ${response.status()}`).toBe(true);
    const sync = await response.json() as {
      dayState?: { runs?: Array<{ id: string; pausedAt?: number }> };
    };
    return Number(sync.dayState?.runs?.find((run) => run.id === fixture.runId)?.pausedAt) || 0;
  };
  await expect.poll(readCanonicalPausedAt, { timeout: 8_000 }).toBeGreaterThan(0);
  await page.getByTestId("tab-sauce").click();
  await expect(page.getByTestId("sauce-stock-on-hand"))
    .toContainText("2.0 / 2.0 barrels");
  const dailyNeeds = page.getByTestId("sauce-daily-needs");
  await expect(dailyNeeds).toContainText("Planned Sauce Demand — Today");
  await expect(dailyNeeds).toContainText("not remaining demand or on-line stock");
  await expect(dailyNeeds).toContainText(sauceName);

  await page.getByTestId("sauce-stock-decrease").click();
  await expect(page.getByTestId("sauce-stock-on-hand"))
    .toContainText("1.9 / 2.0 barrels");

  const peerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await peerContext.addCookies([{
      name: "rc_auth",
      value: fixture.token,
      url: API_BASE,
    }]);
    const peerPage = await peerContext.newPage();
    await peerPage.goto("/", { waitUntil: "domcontentloaded" });
    await peerPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await selectCanonicalFixtureRun(peerPage, fixture.runId);
    await peerPage.getByTestId("tab-sauce").click();
    await expect(peerPage.getByTestId("sauce-stock-on-hand"))
      .toContainText("1.9 / 2.0 barrels");

    await page.getByTestId("tab-run").click();
    await page.getByTestId("tab-sauce").click();
    await expect(page.getByTestId("sauce-stock-on-hand"))
      .toContainText("1.9 / 2.0 barrels");
    await peerPage.reload({ waitUntil: "domcontentloaded" });
    await peerPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await peerPage.getByTestId("tab-sauce").click();
    await expect(peerPage.getByTestId("sauce-stock-on-hand"))
      .toContainText("1.9 / 2.0 barrels");

    const today = new Date().toISOString().slice(0, 10);
    const response = await page.request.get(`/api/sync/today?today=${today}`);
    expect(response.ok(), `canonical sync read failed: ${response.status()}`).toBe(true);
    const sync = await response.json() as {
      runValues?: Record<string, {
        sauceStockBarrels?: number;
        sauceStockInitialized?: boolean;
      }>;
    };
    expect(sync.runValues?.[fixture.runId]?.sauceStockBarrels).toBe(1.9);
    expect(sync.runValues?.[fixture.runId]?.sauceStockInitialized).toBe(true);
  } finally {
    await peerContext.close();
  }
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
    frontlineRecipe: [{ ingredient: sauceName, lbs: 20 }],
    sauceBarrelsMade: 2,
    sauceBarrelAnchorNetSec: 0,
    sauceBarrelCorrectionGeneration: 0,
  });
  await seedInventoryItem(page, fixture.token, "Sauce", true);
  await page.context().addCookies([{
    name: "rc_auth",
    value: fixture.token,
    url: API_BASE,
  }]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await selectCanonicalFixtureRun(page, fixture.runId);
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
  expect(tick.outcomes.sauceConfigurationBlocked ?? 0, "prepared Sauce inventory must be configured").toBe(0);
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

test("Frontline App1 batch supply survives off-tab work, adjustment, pause, and reload", async ({
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
  await selectCanonicalFixtureRun(page, fixture.runId);
  await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible();

  const readCanonicalApp1Values = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await page.request.get(`/api/sync/today?today=${today}`);
    expect(response.ok(), `canonical stock read failed: ${response.status()}`).toBe(true);
    const sync = await response.json() as {
      runValues?: Record<string, {
        app1StockLbs?: number;
        app1BatchesMade?: number;
      }>;
    };
    const values = sync.runValues?.[fixture.runId];
    expect(Number.isFinite(values?.app1StockLbs), "canonical App 1 stock must be present").toBe(true);
    expect(Number.isFinite(values?.app1BatchesMade), "canonical App 1 batch count must be present").toBe(true);
    return values as { app1StockLbs: number; app1BatchesMade: number };
  };
  const readCanonicalStock = async () => (await readCanonicalApp1Values()).app1StockLbs;
  const readCanonicalApp1BatchesMade = async () =>
    (await readCanonicalApp1Values()).app1BatchesMade;
  const readCanonicalPausedAt = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await page.request.get(`/api/sync/today?today=${today}`);
    expect(response.ok(), `canonical pause read failed: ${response.status()}`).toBe(true);
    const sync = await response.json() as {
      dayState?: { runs?: Array<{ id: string; pausedAt?: number }> };
    };
    return Number(sync.dayState?.runs?.find((run) => run.id === fixture.runId)?.pausedAt) || 0;
  };
  const app1OnLine = page.getByTestId("output-app1-batches-on-line");
  const readApp1BatchesOnLine = async () =>
    Number.parseFloat((await app1OnLine.textContent()) ?? "");
  await page.getByTestId("tab-frontline").click();
  // The server snapshot can hydrate stock after the tab first renders. Wait for
  // the visible amount to agree with canonical stock before applying a refill,
  // so this assertion uses the real starting amount rather than a stale zero.
  await expect.poll(async () => {
    const [visible, canonical] = await Promise.all([
      readApp1BatchesOnLine(),
      readCanonicalStock(),
    ]);
    return Math.abs(visible - canonical);
  }, { timeout: 8_000 }).toBeLessThan(0.005);
  const stockBeforeRefill = await readCanonicalStock();
  // Frontline exposes App1 supply in whole batch units; the operator refill
  // must add exactly one batch to the synchronized starting amount.
  await page.getByRole("button", { name: "Increase app1 batches on line" }).click();
  const stockAfterRefill = stockBeforeRefill + 1;
  await expect.poll(readCanonicalStock, { timeout: 8_000 }).toBeCloseTo(stockAfterRefill, 2);
  await expect.poll(readApp1BatchesOnLine, { timeout: 8_000 }).toBeCloseTo(stockAfterRefill, 2);
  const batchesBeforeTick = await readCanonicalApp1BatchesMade();
  // Keep the client tracker from advancing on wall time while the test injects
  // a future server tick. Freeze Date without replacing timers or SSE callbacks.
  await page.evaluate(() => {
    const fixedNow = Date.now();
    const OriginalDate = window.Date;
    window.Date = new Proxy(OriginalDate, {
      construct(target, args) {
        return args.length === 0
          ? new target(fixedNow)
          : Reflect.construct(target, args);
      },
      apply(target, _this, args) {
        return args.length === 0
          ? new target(fixedNow).toString()
          : Reflect.apply(target, target, args);
      },
      get(target, property, receiver) {
        if (property === "now") return () => fixedNow;
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });

  // Automatic stock depletion is server-owned: App 1 updates while another
  // station is mounted, then the canonical value is visible on return.
  await page.getByTestId("tab-dough").click();
  await expect(page.getByTestId("text-target-ball-weight")).toHaveText("10 oz");
  const tick = await runAuthoritativeAutoTrackTick(page, fixture.startedAt + 60_000);
  expect(tick.accepted, JSON.stringify(tick)).toBeGreaterThan(0);
  await expect.poll(readCanonicalApp1BatchesMade, { timeout: 8_000 })
    .toBeGreaterThan(batchesBeforeTick);

  await expect.poll(readCanonicalStock, { timeout: 8_000 })
    .not.toBeCloseTo(stockAfterRefill, 2);
  const stockAfterTick = await readCanonicalStock();
  expect(stockAfterTick).toBeGreaterThan(0);

  await page.getByTestId("tab-sauce").click();
  await expect(page.getByTestId("output-sauce-batches")).toBeVisible();
  await page.getByTestId("tab-frontline").click();
  await expect.poll(async () => {
    const [visible, canonical] = await Promise.all([
      readApp1BatchesOnLine(),
      readCanonicalStock(),
    ]);
    return Math.abs(visible - canonical);
  }, { timeout: 8_000 }).toBeLessThan(0.005);

  // A manual correction removes one batch unit without changing the completed
  // run's production counters.
  const stockBeforeCorrection = await readCanonicalStock();
  await page.getByRole("button", { name: "Decrease app1 batches on line" }).click();
  const correctedStock = Math.max(0, stockBeforeCorrection - 1);
  await expect.poll(readCanonicalStock, { timeout: 8_000 }).toBeCloseTo(correctedStock, 2);

  await page.getByTestId("tab-run").click();
  await page.getByRole("button", { name: /pause.?run/i }).click();
  await expect(page.getByRole("button", { name: /resume.?run/i })).toBeVisible();
  await expect.poll(readCanonicalPausedAt, { timeout: 8_000 }).toBeGreaterThan(0);
  // An automatic claim already due while the run was still active may settle
  // before the pause acknowledgement. Compare the paused tick with the stock
  // at the acknowledged pause, not with the earlier manual correction value.
  const stockAtPause = await readCanonicalStock();
  await runAuthoritativeAutoTrackTick(page, fixture.startedAt + 65_000);
  await expect.poll(readCanonicalStock).toBeCloseTo(stockAtPause, 2);
  await page.getByRole("button", { name: /resume.?run/i }).click();
  await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-frontline").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTestId("tab-frontline").click();
  // Once resumed, normal automatic tracking may advance before the page
  // reloads. Verify hydration against the canonical value rather than freezing
  // a running counter at the earlier paused snapshot.
  await expect.poll(async () =>
    Math.abs((await readApp1BatchesOnLine()) - (await readCanonicalStock())),
    { timeout: 15_000 },
  ).toBeLessThan(0.005);
  await page.getByTestId("tab-packaging").click();
  await expect(page.getByTestId("tab-sauce")).toBeAttached();
  await expect(page.getByTestId("tab-dough")).toBeAttached();
  await expect(page.getByTestId("tab-packaging")).toBeAttached();
});