import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  uniqueTestId,
} from "./isolation";

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const PASSWORD = "TestPass123!";
const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
const TODAY = new Date().toISOString().slice(0, 10);
const TOMORROW = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 86_400_000)
  .toISOString()
  .slice(0, 10);

let fixtures: AuthorizedBrowserFixtures;

test.beforeAll(async ({ playwright }) => {
  fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
});

test.beforeEach(async () => {
  await fixtures.removeTodaySync([TODAY, TOMORROW]);
});

test.afterAll(async () => {
  await fixtures?.cleanup({ syncDates: [TODAY, TOMORROW] });
});

async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Recipes", exact: true }).click();
  return dialog;
}

async function openIngredientWeights(page: Page, ingredientName: string): Promise<Locator> {
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: "Lists", exact: true }).click();
  await dialog.getByRole("button", { name: "Applicator Types", exact: true }).click();
  const addInput = dialog.getByPlaceholder("Add to Applicator Types…");
  if (!(await dialog.getByText(ingredientName, { exact: true }).count())) {
    await addInput.fill(ingredientName);
    await addInput.press("Enter");
    await expect(dialog.getByText(ingredientName, { exact: true })).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Ingredient Weights", exact: true }).click();
  await expect(dialog.getByText(ingredientName, { exact: true })).toBeVisible();
  return dialog;
}
async function openRecipeSettings(
  page: Page,
  kind: "dough" | "sauce" | "mixes" | "cheese",
): Promise<Locator> {
  const dialog = await openSettings(page);
  const label = kind === "mixes"
    ? "Mix Recipes"
    : kind === "cheese"
      ? "Cheese"
      : kind[0].toUpperCase() + kind.slice(1);
  await dialog.getByRole("button", { name: label, exact: true }).click();
  return dialog;
}

async function openSummary(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
}

async function setRecipeBatchLbs(
  page: Page,
  recipeName: string,
  lbs: string,
): Promise<void> {
  const dialog = await openRecipeSettings(page, "cheese");
  const search = dialog.getByPlaceholder("Search cheese recipes by name, customer, or flavor…");
  await search.fill(recipeName);
  await dialog.getByRole("button", { name: new RegExp(recipeName) }).click();
  const input = dialog.getByRole("textbox", { name: "lbs per batch" });
  const saved = page.waitForResponse((response) =>
    response.url().includes("/api/cheese-recipes")
      && response.request().method() === "POST"
      && response.status() === 200,
  );
  await input.fill(lbs);
  await input.blur();
  await saved;
  await dialog.getByRole("button", { name: "Close settings" }).click();
}

async function holdNextDelayedCompletion(
  page: Page,
  requestPath: string,
  requestMethod = "GET",
): Promise<{
  observed: Promise<void>;
  release: () => Promise<void>;
}> {
  let observedResolve!: () => void;
  let releaseResolve!: () => void;
  let completedResolve!: () => void;
  let held = false;
  let released = false;
  const observed = new Promise<void>((resolve) => {
    observedResolve = resolve;
  });
  const releaseGate = new Promise<void>((resolve) => {
    releaseResolve = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    completedResolve = resolve;
  });
  const handler = async (route: Route): Promise<void> => {
    if (
      !held
      && route.request().method() === requestMethod
      && route.request().url().includes(requestPath)
    ) {
      held = true;
      observedResolve();
      await releaseGate;
      await route.continue();
      completedResolve();
      return;
    }
    await route.continue();
  };

  await page.route("**/api/**", handler);

  return {
    observed,
    release: async () => {
      if (released) return;
      released = true;
      releaseResolve();
      if (!held) {
        await page.unroute("**/api/**", handler).catch(() => {});
        return;
      }
      await completed;
      await page.unroute("**/api/**", handler).catch(() => {});
    },
  };
}
async function setNamedRecipeLbs(
  page: Page,
  kind: "dough" | "sauce",
  recipeName: string,
  lbs: string,
  waitForSave = true,
): Promise<void> {
  const dialog = await openRecipeSettings(page, kind);
  const label = kind === "dough" ? "dough" : "sauce";
  const search = dialog.getByPlaceholder(
    `Search ${label} recipes by name or ingredient…`,
  );
  await search.fill(recipeName);
  await dialog.getByRole("button", { name: new RegExp(recipeName) }).click();
  const editor = dialog.getByTestId(`${kind}-recipe-editor`);
  const input = editor.locator('input[type="number"]').first();
  const saved = waitForSave
    ? page.waitForResponse((response) =>
        response.url().includes(`/api/${kind}-recipes`)
          && response.request().method() === "POST"
          && response.status() === 200,
      )
    : undefined;
  await input.fill(lbs);
  await input.blur();
  if (waitForSave) await saved;
  await dialog.getByRole("button", { name: "Close settings" }).click();
}

async function setMixPerPizza(
  page: Page,
  recipeName: string,
  perPizza: string,
  waitForSave = true,
): Promise<void> {
  const dialog = await openRecipeSettings(page, "mixes");
  const search = dialog.getByPlaceholder("Search mixes by name, brand, or flavor…");
  await search.fill(recipeName);
  await dialog.getByRole("button", { name: new RegExp(recipeName) }).click();
  // The filtered manager contains only this fixture mix. Target the component
  // field by its distinctive step rather than relying on the editor's other
  // numeric fields (batch size, days early, and lbs/batch).
  const input = dialog.locator('input[type="number"][step="0.001"]').first();
  const saved = waitForSave
    ? page.waitForResponse((response) =>
        response.url().endsWith("/api/mixes")
          && response.request().method() === "POST"
          && response.status() === 200,
      )
    : undefined;
  await input.fill(perPizza);
  await input.blur();
  if (waitForSave) await saved;
  await dialog.getByRole("button", { name: "Close settings" }).click();
}

async function readIngredientDetail(page: Page, runId: string): Promise<string> {
  await openSummary(page);
  const card = page.getByTestId(`run-summary-${runId}`);
  await card.getByRole("button", { name: "Ingredient Detail" }).click();
  const detail = page.getByRole("dialog", { name: /Ingredient Detail/ });
  await expect(detail).toBeVisible();
  const text = (await detail.textContent()) ?? "";
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  return text;
}

async function expectIngredientDetailChanged(
  page: Page,
  runId: string,
  previous: string,
): Promise<string> {
  await openSummary(page);
  const card = page.getByTestId(`run-summary-${runId}`);
  await card.getByRole("button", { name: "Ingredient Detail" }).click();
  const detail = page.getByRole("dialog", { name: /Ingredient Detail/ });
  await expect(detail).toBeVisible();
  await expect.poll(
    async () => (await detail.textContent()) ?? "",
    { timeout: 20_000 },
  ).not.toBe(previous);
  const text = (await detail.textContent()) ?? "";
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  return text;
}

async function expectIngredientDetailStable(
  page: Page,
  runId: string,
  expected: string,
): Promise<void> {
  await openSummary(page);
  const card = page.getByTestId(`run-summary-${runId}`);
  await card.getByRole("button", { name: "Ingredient Detail" }).click();
  const detail = page.getByRole("dialog", { name: /Ingredient Detail/ });
  await expect(detail).toBeVisible();
  await expect.poll(
    async () => (await detail.textContent()) ?? "",
    { timeout: 20_000 },
  ).toBe(expected);
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
}

async function expectReloadedRecipeSnapshotsStable(
  page: Page,
  pendingRunId: string,
  pendingSnapshot: string,
  startedRunId: string,
  startedSnapshot: string,
): Promise<void> {
  await expectIngredientDetailStable(page, pendingRunId, pendingSnapshot);
  await expectIngredientDetailStable(page, startedRunId, startedSnapshot);
}

async function readServerRunValue(page: Page, runId: string): Promise<string> {
  const response = await page.request.get(`/api/sync/today?today=${TODAY}`, {
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok()) {
    throw new Error(`Read canonical run value failed (${response.status()})`);
  }
  const payload = await response.json() as {
    runValues?: Record<string, unknown>;
  };
  return JSON.stringify(payload.runValues?.[runId] ?? null);
}

async function readServerRunField(
  page: Page,
  runId: string,
  field: string,
): Promise<unknown> {
  const response = await page.request.get(`/api/sync/today?today=${TODAY}`, {
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok()) {
    throw new Error(`Read canonical run field failed (${response.status()})`);
  }
  const payload = await response.json() as {
    runValues?: Record<string, Record<string, unknown>>;
  };
  return payload.runValues?.[runId]?.[field];
}

async function readServerProfileValues(
  page: Page,
  key: string,
): Promise<Record<string, unknown> | undefined> {
  const response = await page.request.get("/api/brand-profiles", {
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok()) {
    throw new Error(`Read canonical profile failed (${response.status()})`);
  }
  const payload = await response.json() as {
    items?: { key: string; values?: Record<string, unknown> }[];
  };
  return payload.items?.find((item) => item.key === key)?.values;
}

async function expectServerRunValueChanged(
  page: Page,
  runId: string,
  previous: string,
): Promise<string> {
  await expect.poll(
    () => readServerRunValue(page, runId),
    { timeout: 25_000 },
  ).not.toBe(previous);
  return readServerRunValue(page, runId);
}

async function readScheduledRunValues(
  page: Page,
  date: string,
  runId: string,
): Promise<Record<string, unknown> | undefined> {
  const response = await page.request.get(
    `/api/sync/${date}?today=${TODAY}`,
    { failOnStatusCode: true },
  );
  const payload = await response.json() as {
    runValues?: Record<string, Record<string, unknown>>;
  };
  return payload.runValues?.[runId];
}

test("remembered plain ingredient batch weights rehydrate in a peer without changing the active run", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });

    const username = uniqueTestId(`e2e_${scenario.label}_switch`);

  const activeBrand = `Batch Weight Active ${uniqueTestId("brand")}`;
    const brand = `Recipe Refresh ${uniqueTestId("brand")}`;
    const flavor = `${scenario.label} Fixture`;
    const recipeId = uniqueTestId(`${scenario.label}-recipe`);
    const recipeName = `Shared ${scenario.label} ${uniqueTestId("recipe")}`;
    const currentRunId = uniqueTestId("current-run");
    const upcomingRunId = uniqueTestId("upcoming-run");
  const scheduledRunId = uniqueTestId("scheduled-run");
    const now = Date.now();
    const account = await fixtures.createAccount({
      username,
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
    });

  const baseValues = {
    casesNeeded: 100,
    pizzasPerCase: 1,
    casesPerSkid: 10,
    casesPerLayer: 0,
    crustsPerCycle: 1,
    cycleSpeed: 1,
    speedAdjustment: 1,
    freezerTime: 0,
    app1OzPerPizza: 1,
  };

  await fixtures.seedCheeseRecipe(account, {
    id: recipeId,
    name: recipeName,
    brand,
    components: [{ ingredient: "Cheese", lbs: 0 }],
  });

    const values = scenario.values(recipeName);
  await fixtures.seedBrandProfile(account, {
    brand,
    flavor,
    values,
    updatedAt: now,
  });
  await fixtures.seedTodaySync({
    token: account.token,
    senderId: `recipe-freeze-${username}`,
    date: TODAY,
    payload: {
      dayState: {
        date: TODAY,
        runs: [
          { id: currentRunId, brand, flavor, metaUpdatedAt: now, seeded: false },
          { id: upcomingRunId, brand, flavor, metaUpdatedAt: now, seeded: false },
        ],
        currentIndex: 0,
        resetAt: 0,
        substitutions: [],
        substitutionLog: [],
        stagedItems: {},
      },
      runValues: {
        [currentRunId]: values,
        [upcomingRunId]: values,
      },
      runValuesUpdatedAt: {
        [currentRunId]: now,
        [upcomingRunId]: now,
      },
      packagingProgress: {},
    },
  });
  await fixtures.seedScheduledSync({
    token: account.token,
    date: TOMORROW,
    today: TODAY,
    payload: {
      dayState: {
        date: TOMORROW,
        runs: [
          { id: scheduledRunId, brand, flavor, metaUpdatedAt: now, seeded: false },
        ],
        currentIndex: 0,
        resetAt: 0,
        substitutions: [],
        substitutionLog: [],
        stagedItems: {},
      },
      runValues: {
        [scheduledRunId]: values,
      },
      runValuesUpdatedAt: {
        [scheduledRunId]: now,
      },
      packagingProgress: {},
    },
  });

  await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTestId("tab-frontline").click();
  await expect(page.getByTestId("output-app1-batches")).toHaveText("120.0 lbs");

  await openSummary(page);
  const upcoming = page.getByTestId(`run-summary-${upcomingRunId}`);
  await expect(upcoming).toContainText("120.0 lbs");

  await setRecipeBatchLbs(page, recipeName, "20");
  await expect(upcoming).toContainText("6.00 batches");
  await expect.poll(
    async () => {
      const scheduled = await readScheduledRunValues(page, TOMORROW, scheduledRunId);
      return scheduled?.app1CheeseRecipe;
    },
    { timeout: 20_000 },
  ).toEqual([{ ingredient: "Cheese", lbs: 20 }]);
  await page.getByTestId("tab-frontline").click();
  await expect(page.getByTestId("output-app1-batches")).toContainText("6.00");

  await page.getByTestId("tab-run").click();
  await page.getByTestId("button-start-run").click();
  await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible();

  const serverBeforeSecondEdit = await readServerRunValue(page, upcomingRunId);
  await setRecipeBatchLbs(page, recipeName, "40");
  await openSummary(page);
  await expect(upcoming).toContainText("3.00 batches");
  await expect.poll(
    async () => {
      const scheduled = await readScheduledRunValues(page, TOMORROW, scheduledRunId);
      return scheduled?.app1CheeseRecipe;
    },
    { timeout: 20_000 },
  ).toEqual([{ ingredient: "Cheese", lbs: 40 }]);
  await expectServerRunValueChanged(page, upcomingRunId, serverBeforeSecondEdit);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-frontline").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTestId("tab-frontline").click();
  await expect(page.getByTestId("output-app1-batches")).toContainText("6.00");
  await openSummary(page);
  await expect(page.getByTestId(`run-summary-${upcomingRunId}`)).toContainText(
    "3.00 batches",
    { timeout: 20_000 },
  );
});

test("a delayed shared recipe refresh stays with its original run after a rapid switch", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

    const username = uniqueTestId(`e2e_${scenario.label}_switch`);

  const activeBrand = `Batch Weight Active ${uniqueTestId("brand")}`;
    const originalBrand = `Original ${scenario.label} ${uniqueTestId("brand")}`;
    const originalFlavor = "Profile-backed";
    const recipeId = uniqueTestId(`${scenario.label}-recipe`);
    const recipeName = `Shared ${scenario.label} ${uniqueTestId("recipe")}`;
    const originalRunId = uniqueTestId("original-run");
    const switchedRunId = uniqueTestId("switched-run");
    const now = Date.now();
    const account = await fixtures.createAccount({
      username,
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
    });

  const baseValues = {
    casesNeeded: 100,
    pizzasPerCase: 1,
    casesPerSkid: 10,
    casesPerLayer: 0,
    crustsPerCycle: 1,
    cycleSpeed: 1,
    speedAdjustment: 1,
    freezerTime: 0,
    app1OzPerPizza: 1,
  };
    const originalValues = scenario.values(recipeName);
    const switchedValues = {
      ...originalValues,
      ...(scenario.kind === "dough"
        ? { doughRecipe: [{ ingredient: "Dough Flour", lbs: 7 }] }
        : scenario.kind === "sauce"
          ? { frontlineRecipe: [{ ingredient: "Sauce Tomatoes", lbs: 7 }] }
          : {
              app1OzPerPizza: 1.4,
              app1CheeseRecipe: [
                { ingredient: "Mix Ingredient A", lbs: 0.7 },
                { ingredient: "Mix Ingredient B", lbs: 0.7 },
              ],
            }),
    };

    await scenario.seed(fixtures, account, recipeName, recipeId, originalBrand, originalFlavor);
    await fixtures.seedBrandProfile(account, {
      brand: originalBrand,
      flavor: originalFlavor,
      values: originalValues,
      updatedAt: now,
    });
    await fixtures.seedTodaySync({
      token: account.token,
      senderId: `${scenario.label}-recipe-switch-${username}`,
      date: TODAY,
      payload: {
        dayState: {
          date: TODAY,
          runs: [
            {
              id: originalRunId,
              brand: originalBrand,
              flavor: originalFlavor,
              metaUpdatedAt: now,
              seeded: false,
            },
            {
              id: switchedRunId,
              brand: "",
              flavor: "",
              metaUpdatedAt: now,
              seeded: false,
            },
          ],
          currentIndex: 0,
          resetAt: 0,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        },
        runValues: {
          [originalRunId]: originalValues,
          [switchedRunId]: switchedValues,
        },
        runValuesUpdatedAt: {
          [originalRunId]: now,
          [switchedRunId]: now,
        },
        packagingProgress: {},
      },
    });

    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    const originalBefore = await readIngredientDetail(page, originalRunId);
    const switchedBefore = await readIngredientDetail(page, switchedRunId);
    let refreshGate:
      | { observed: Promise<void>; release: () => Promise<void> }
      | undefined;

  try {
    await setRecipeBatchLbs(page, recipeName, "20");
    await refreshGate.observed;

    await page.getByTestId("tab-run").click();
    await page.getByRole("button", { name: "Select run 2" }).click();
    await expect(page.getByText("Run 2 of 2", { exact: true })).toBeVisible();

    await refreshGate.release();

    await expectIngredientDetailChanged(page, originalRunId, originalBefore);
    await expectIngredientDetailStable(page, switchedRunId, switchedBefore);
  } finally {
    await refreshGate.release();
  }
});

test("a delayed learned batch weight updates profiles and pending runs without crossing the open run", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const username = uniqueTestId("e2e_batch_weight_switch");
  const ingredient = `Plain Topping ${uniqueTestId("ingredient")}`;
  const originalBrand = `Original Weight ${uniqueTestId("brand")}`;
  const originalFlavor = "Profile-backed";
  const switchedBrand = `Switched Weight ${uniqueTestId("brand")}`;
  const switchedFlavor = "Pending";
  const originalRunId = uniqueTestId("original-run");
  const switchedRunId = uniqueTestId("switched-run");
  const pendingRunId = uniqueTestId("pending-run");
  const now = Date.now();
  const originalProfileKey = `${originalBrand.toLowerCase()}__${originalFlavor.toLowerCase()}`;
  const switchedProfileKey = `${switchedBrand.toLowerCase()}__${switchedFlavor.toLowerCase()}`;
  const account = await fixtures.createAccount({
    username,
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });

  const values = (batchLbs: number) => ({
    casesNeeded: 100,
    pizzasPerCase: 1,
    casesPerSkid: 10,
    casesPerLayer: 0,
    crustsPerCycle: 1,
    cycleSpeed: 1,
    speedAdjustment: 1,
    freezerTime: 0,
    app1Type: ingredient,
    app1OzPerPizza: 1,
    app1BatchLbs: batchLbs,
    app1CheeseRecipe: [],
  });
  const originalValues = values(5);
  const switchedValues = values(7);

  await fixtures.seedBrandProfile(account, {
    brand: originalBrand,
    flavor: originalFlavor,
    values: originalValues,
    updatedAt: now,
  });
  await fixtures.seedBrandProfile(account, {
    brand: switchedBrand,
    flavor: switchedFlavor,
    values: switchedValues,
    updatedAt: now,
  });
  await fixtures.seedTodaySync({
    token: account.token,
    senderId: `batch-weight-switch-${username}`,
    date: TODAY,
    payload: {
      dayState: {
        date: TODAY,
        runs: [
          {
            id: originalRunId,
            brand: originalBrand,
            flavor: originalFlavor,
            metaUpdatedAt: now,
            seeded: false,
          },
          {
            id: switchedRunId,
            brand: switchedBrand,
            flavor: switchedFlavor,
            metaUpdatedAt: now,
            seeded: false,
          },
          {
            id: pendingRunId,
            brand: switchedBrand,
            flavor: switchedFlavor,
            metaUpdatedAt: now,
            seeded: false,
          },
        ],
        currentIndex: 0,
        resetAt: 0,
        substitutions: [],
        substitutionLog: [],
        stagedItems: {},
      },
      runValues: {
        [originalRunId]: originalValues,
        [switchedRunId]: switchedValues,
        [pendingRunId]: switchedValues,
      },
      runValuesUpdatedAt: {
        [originalRunId]: now,
        [switchedRunId]: now,
        [pendingRunId]: now,
      },
      packagingProgress: {},
    },
  });

  await page.addInitScript(({ ingredientName }) => {
    localStorage.setItem("run-calc-ingredient-types", JSON.stringify([ingredientName]));
  }, { ingredientName: ingredient });
  await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Setup", exact: true }).click();
  await page.getByRole("button", { name: "Sauce & Applicator Weights" }).click();
  const batchWeight = page.getByTestId("input-app1BatchLbs");
  await expect(batchWeight).toHaveValue("5");

  const refreshGate = await holdNextProfileRefresh(page);
  try {
    const savedWeight = page.waitForResponse((response) =>
      response.url().includes("/api/ingredient-batch-weights")
        && response.request().method() === "POST"
        && response.status() === 200,
    );
    await batchWeight.fill("12");
    await batchWeight.blur();
    await savedWeight;
    await refreshGate.observed;

    await page.getByTestId("tab-run").click();
    await page.getByRole("button", { name: "Select run 2" }).click();
    await expect(page.getByText("Run 2 of 3", { exact: true })).toBeVisible();

    await refreshGate.release();

    await expect(page.getByRole("button", { name: /^More/ })).toBeVisible();
    await expect.poll(
      async () => (await readServerProfileValues(page, originalProfileKey))?.app1BatchLbs,
      { timeout: 25_000 },
    ).toBe(12);
    await expect.poll(
      async () => (await readServerProfileValues(page, switchedProfileKey))?.app1BatchLbs,
      { timeout: 25_000 },
    ).toBe(12);
    await expect.poll(
      () => readServerRunField(page, originalRunId, "app1BatchLbs"),
      { timeout: 25_000 },
    ).toBe(12);
    await expect.poll(
      () => readServerRunField(page, pendingRunId, "app1BatchLbs"),
      { timeout: 25_000 },
    ).toBe(12);
    await expect.poll(
      () => readServerRunField(page, switchedRunId, "app1BatchLbs"),
      { timeout: 25_000 },
    ).toBe(7);

    await page.getByRole("button", { name: "Select run 1" }).click();
    await expect(page.getByText("Run 1 of 3", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: "Setup", exact: true }).click();
    await expect(page.getByTestId("input-app1BatchLbs")).toHaveValue("12");

    await page.getByTestId("tab-run").click();
    await page.getByRole("button", { name: "Select run 2" }).click();
    await expect(page.getByText("Run 2 of 3", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: "Setup", exact: true }).click();
    await expect(page.getByTestId("input-app1BatchLbs")).toHaveValue("7");
  } finally {
    await refreshGate.release();
  }
});

type SharedRecipeFreezeScenario = {
  label: string;
  kind: "dough" | "sauce" | "mixes" | "cheese";
  firstLbs: string;
  secondLbs: string;
  seed: (
    fixtures: AuthorizedBrowserFixtures,
    account: { token: string },
    recipeName: string,
    recipeId: string,
    brand: string,
    flavor: string,
  ) => Promise<string>;
  values: (recipeName: string) => Record<string, unknown>;
  edit: (page: Page, recipeName: string, value: string) => Promise<void>;
};

const sharedRecipeFreezeScenarios: SharedRecipeFreezeScenario[] = [
  {
    label: "dough",
    kind: "dough" as const,
    firstLbs: "20",
    secondLbs: "40",
    seed: (fixtures: AuthorizedBrowserFixtures, account: { token: string }, recipeName: string, recipeId: string) =>
      fixtures.seedNamedRecipe("dough", account, {
        id: recipeId,
        name: recipeName,
        components: [{ ingredient: "Dough Flour", lbs: 10 }],
        doughballWeightOz: 16,
      }),
    values: (recipeName: string) => ({
      casesNeeded: 100,
      pizzasPerCase: 1,
      casesPerSkid: 10,
      casesPerLayer: 0,
      crustsPerCycle: 1,
      cycleSpeed: 1,
      speedAdjustment: 1,
      freezerTime: 0,
      doughRecipeName: recipeName,
      doughRecipe: [{ ingredient: "Dough Flour", lbs: 10 }],
      targetDoughballWeight: 16,
    }),
    edit: (page, recipeName, lbs) => setNamedRecipeLbs(page, "dough", recipeName, lbs),
  },
  {
    label: "sauce",
    kind: "sauce" as const,
    firstLbs: "20",
    secondLbs: "40",
    seed: (fixtures: AuthorizedBrowserFixtures, account: { token: string }, recipeName: string, recipeId: string) =>
      fixtures.seedNamedRecipe("sauce", account, {
        id: recipeId,
        name: recipeName,
        components: [{ ingredient: "Sauce Tomatoes", lbs: 10 }],
      }),
    values: (recipeName: string) => ({
      casesNeeded: 100,
      pizzasPerCase: 1,
      casesPerSkid: 10,
      casesPerLayer: 0,
      crustsPerCycle: 1,
      cycleSpeed: 1,
      speedAdjustment: 1,
      freezerTime: 0,
      frontlineRecipeName: recipeName,
      frontlineRecipe: [{ ingredient: "Sauce Tomatoes", lbs: 10 }],
      sauceOzPerPizza: 16,
    }),
    edit: (page, recipeName, lbs) => setNamedRecipeLbs(page, "sauce", recipeName, lbs),
  },
  {
    label: "mix",
    kind: "mixes" as const,
    firstLbs: "2",
    secondLbs: "4",
    seed: (fixtures: AuthorizedBrowserFixtures, account: { token: string }, recipeName: string, recipeId: string, brand: string, flavor: string) =>
      fixtures.seedMix(account, {
        id: recipeId,
        name: recipeName,
        brand,
        flavor,
        components: [
          { ingredient: "Mix Ingredient A", perPizza: 1 },
          { ingredient: "Mix Ingredient B", perPizza: 1 },
        ],
      }),
    values: (recipeName: string) => ({
      casesNeeded: 100,
      pizzasPerCase: 1,
      casesPerSkid: 10,
      casesPerLayer: 0,
      crustsPerCycle: 1,
      cycleSpeed: 1,
      speedAdjustment: 1,
      freezerTime: 0,
      app1Type: "Mix",
      app1OzPerPizza: 1,
      app1BatchLbs: 0,
      app1CheeseRecipeName: recipeName,
      app1CheeseRecipe: [
        { ingredient: "Mix Ingredient A", lbs: 1 },
        { ingredient: "Mix Ingredient B", lbs: 1 },
      ],
    }),
    edit: setMixPerPizza,
  },
  {
    label: "cheese",
    kind: "cheese" as const,
    firstLbs: "20",
    secondLbs: "40",
    seed: (
      fixtures: AuthorizedBrowserFixtures,
      account: { token: string },
      recipeName: string,
      recipeId: string,
      brand: string,
    ) => fixtures.seedCheeseRecipe(account, {
      id: recipeId,
      name: recipeName,
      brand,
      components: [{ ingredient: "Cheese", lbs: 10 }],
    }),
    values: (recipeName: string) => ({
      casesNeeded: 100,
      pizzasPerCase: 1,
      casesPerSkid: 10,
      casesPerLayer: 0,
      crustsPerCycle: 1,
      cycleSpeed: 1,
      speedAdjustment: 1,
      freezerTime: 0,
      app1Type: "Cheese",
      app1OzPerPizza: 16,
      app1BatchLbs: 0,
      app1CheeseRecipeName: recipeName,
      app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10 }],
    }),
    edit: setRecipeBatchLbs,
  },
] as const;
for (const scenario of sharedRecipeFreezeScenarios) {
  test(`${scenario.label} recipe edits refresh pending runs across browsers but freeze after Start`, async ({
    browser,
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });

    const username = uniqueTestId(`e2e_${scenario.label}_switch`);

  const activeBrand = `Batch Weight Active ${uniqueTestId("brand")}`;
    const brand = `Recipe Refresh ${uniqueTestId("brand")}`;
    const flavor = `${scenario.label} Fixture`;
    const recipeId = uniqueTestId(`${scenario.label}-recipe`);
    const recipeName = `Shared ${scenario.label} ${uniqueTestId("recipe")}`;
    const currentRunId = uniqueTestId("current-run");
    const upcomingRunId = uniqueTestId("upcoming-run");
    const now = Date.now();
    const account = await fixtures.createAccount({
      username,
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
    });

  const baseValues = {
    casesNeeded: 100,
    pizzasPerCase: 1,
    casesPerSkid: 10,
    casesPerLayer: 0,
    crustsPerCycle: 1,
    cycleSpeed: 1,
    speedAdjustment: 1,
    freezerTime: 0,
    app1OzPerPizza: 1,
  };
    const values = scenario.values(recipeName);

    await scenario.seed(fixtures, account, recipeName, recipeId, brand, flavor);
    await fixtures.seedBrandProfile(account, {
      brand,
      flavor,
      values,
      updatedAt: now,
    });
    await fixtures.seedTodaySync({
      token: account.token,
      senderId: `${scenario.label}-recipe-freeze-${username}`,
      date: TODAY,
      payload: {
        dayState: {
          date: TODAY,
          runs: [
            { id: currentRunId, brand, flavor, metaUpdatedAt: now, seeded: false },
            { id: upcomingRunId, brand, flavor, metaUpdatedAt: now, seeded: false },
          ],
          currentIndex: 0,
          resetAt: 0,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        },
        runValues: {
          [currentRunId]: values,
          [upcomingRunId]: values,
        },
        runValuesUpdatedAt: {
          [currentRunId]: now,
          [upcomingRunId]: now,
        },
        packagingProgress: {},
      },
    });

    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    const peerContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await peerContext.addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    const peer = await peerContext.newPage();

    const activeRunBefore = await readServerRunValue(page, activeRunId);

    try {
      await Promise.all([
        page.goto("/", { waitUntil: "domcontentloaded" }),
        peer.goto("/", { waitUntil: "domcontentloaded" }),
      ]);
      await Promise.all([
        page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 }),
        peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 }),
      ]);

      const [pendingBefore, peerPendingBefore] = await Promise.all([
        readIngredientDetail(page, upcomingRunId),
        readIngredientDetail(peer, upcomingRunId),
      ]);
      expect(peerPendingBefore).toBe(pendingBefore);

      const serverBeforeFirstEdit = await readServerRunValue(page, upcomingRunId);
      await scenario.edit(page, recipeName, scenario.firstLbs);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      const serverAfterFirstEdit = await expectServerRunValueChanged(
        page,
        upcomingRunId,
        serverBeforeFirstEdit,
      );
      await peer.reload({ waitUntil: "domcontentloaded" });
      await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      const [pendingAfterFirstEdit, peerPendingAfterFirstEdit] = await Promise.all([
        expectIngredientDetailChanged(page, upcomingRunId, pendingBefore),
        expectIngredientDetailChanged(peer, upcomingRunId, peerPendingBefore),
      ]);
      expect(peerPendingAfterFirstEdit).toBe(pendingAfterFirstEdit);

      await page.getByTestId("tab-run").click();
      await page.getByTestId("button-start-run").click();
      await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible();
      await peer.getByTestId("tab-run").click();
      await expect(peer.getByRole("button", { name: /pause.?run/i })).toBeVisible({
        timeout: 20_000,
      });
      const [startedSnapshot, peerStartedSnapshot] = await Promise.all([
        readIngredientDetail(page, currentRunId),
        readIngredientDetail(peer, currentRunId),
      ]);
      expect(peerStartedSnapshot).toBe(startedSnapshot);

      await scenario.edit(peer, recipeName, scenario.secondLbs);
      await peer.reload({ waitUntil: "domcontentloaded" });
      await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      await expectServerRunValueChanged(
        peer,
        upcomingRunId,
        serverAfterFirstEdit,
      );
      await Promise.all([
        page.reload({ waitUntil: "domcontentloaded" }),
        peer.reload({ waitUntil: "domcontentloaded" }),
      ]);
      await Promise.all([
        page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 }),
        peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 }),
      ]);
      const [pendingAfterSecondEdit, peerPendingAfterSecondEdit] = await Promise.all([
        expectIngredientDetailChanged(page, upcomingRunId, pendingAfterFirstEdit),
        expectIngredientDetailChanged(peer, upcomingRunId, peerPendingAfterFirstEdit),
      ]);
      expect(peerPendingAfterSecondEdit).toBe(pendingAfterSecondEdit);
      await Promise.all([
        expectIngredientDetailStable(page, currentRunId, startedSnapshot),
        expectIngredientDetailStable(peer, currentRunId, peerStartedSnapshot),
      ]);

      // Reload both contexts once more so neither browser can reintroduce its
      // older pending snapshot after the peer's acknowledged sync write.
      await Promise.all([
        page.reload({ waitUntil: "domcontentloaded" }),
        peer.reload({ waitUntil: "domcontentloaded" }),
      ]);
      await Promise.all([
        page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 }),
        peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 }),
      ]);
      await Promise.all([
        expectReloadedRecipeSnapshotsStable(
          page,
          upcomingRunId,
          pendingAfterSecondEdit,
          currentRunId,
          startedSnapshot,
        ),
        expectReloadedRecipeSnapshotsStable(
          peer,
          upcomingRunId,
          peerPendingAfterSecondEdit,
          currentRunId,
          peerStartedSnapshot,
        ),
      ]);
    } finally {
      await peerContext.close();
    }
  });
}

for (const scenario of sharedRecipeFreezeScenarios) {
  if (scenario.kind === "cheese") continue;

  test(`${scenario.label} recipe refresh stays with its original run after a rapid switch`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });

    const username = uniqueTestId(`e2e_${scenario.label}_switch`);

  const activeBrand = `Batch Weight Active ${uniqueTestId("brand")}`;
    const originalBrand = `Original ${scenario.label} ${uniqueTestId("brand")}`;
    const originalFlavor = "Profile-backed";
    const recipeId = uniqueTestId(`${scenario.label}-recipe`);
    const recipeName = `Shared ${scenario.label} ${uniqueTestId("recipe")}`;
    const originalRunId = uniqueTestId("original-run");
    const switchedRunId = uniqueTestId("switched-run");
    const now = Date.now();
    const account = await fixtures.createAccount({
      username,
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
    });

  const baseValues = {
    casesNeeded: 100,
    pizzasPerCase: 1,
    casesPerSkid: 10,
    casesPerLayer: 0,
    crustsPerCycle: 1,
    cycleSpeed: 1,
    speedAdjustment: 1,
    freezerTime: 0,
    app1OzPerPizza: 1,
  };
    const originalValues = scenario.values(recipeName);
    const switchedValues = {
      ...originalValues,
      ...(scenario.kind === "dough"
        ? { doughRecipe: [{ ingredient: "Dough Flour", lbs: 7 }] }
        : scenario.kind === "sauce"
          ? { frontlineRecipe: [{ ingredient: "Sauce Tomatoes", lbs: 7 }] }
          : {
              app1OzPerPizza: 1.4,
              app1CheeseRecipe: [
                { ingredient: "Mix Ingredient A", lbs: 0.7 },
                { ingredient: "Mix Ingredient B", lbs: 0.7 },
              ],
            }),
    };

    await scenario.seed(fixtures, account, recipeName, recipeId, originalBrand, originalFlavor);
    await fixtures.seedBrandProfile(account, {
      brand: originalBrand,
      flavor: originalFlavor,
      values: originalValues,
      updatedAt: now,
    });
    await fixtures.seedTodaySync({
      token: account.token,
      senderId: `${scenario.label}-recipe-switch-${username}`,
      date: TODAY,
      payload: {
        dayState: {
          date: TODAY,
          runs: [
            {
              id: originalRunId,
              brand: originalBrand,
              flavor: originalFlavor,
              metaUpdatedAt: now,
              seeded: false,
            },
            {
              id: switchedRunId,
              brand: "",
              flavor: "",
              metaUpdatedAt: now,
              seeded: false,
            },
          ],
          currentIndex: 0,
          resetAt: 0,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        },
        runValues: {
          [originalRunId]: originalValues,
          [switchedRunId]: switchedValues,
        },
        runValuesUpdatedAt: {
          [originalRunId]: now,
          [switchedRunId]: now,
        },
        packagingProgress: {},
      },
    });

    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    const originalBefore = await readIngredientDetail(page, originalRunId);
    const switchedBefore = await readIngredientDetail(page, switchedRunId);
    let saveGate:
      | { observed: Promise<void>; release: () => Promise<void> }
      | undefined;
    let refreshGate:
      | { observed: Promise<void>; release: () => Promise<void> }
      | undefined;

    try {
      let edit: Promise<void>;
      if (scenario.kind === "mixes") {
        saveGate = await holdNextDelayedCompletion(page, "/api/mixes", "POST");
        edit = setMixPerPizza(page, recipeName, scenario.firstLbs, false);
      } else {
        saveGate = await holdNextDelayedCompletion(
          page,
          `/api/${scenario.kind}-recipes`,
          "POST",
        );
        edit = setNamedRecipeLbs(
          page,
          scenario.kind,
          recipeName,
          scenario.firstLbs,
          false,
        );
      }
      await saveGate.observed;
      refreshGate = await holdNextDelayedCompletion(page, "/api/brand-profiles", "POST");
      await saveGate.release();
      await refreshGate.observed;

      await page.getByTestId("tab-run").click();
      await page.getByRole("button", { name: "Select run 2" }).click();
      await expect(page.getByText("Run 2 of 2", { exact: true })).toBeVisible();

      await refreshGate.release();
      await edit;

      await expectIngredientDetailChanged(page, originalRunId, originalBefore);
      await expectIngredientDetailStable(page, switchedRunId, switchedBefore);
    } finally {
      await refreshGate?.release();
      await saveGate?.release();
    }
  });
}

  const rememberedIngredient = `Remembered Ingredient ${uniqueTestId("ingredient")}`;

  const pendingValues = {
    ...baseValues,
    app1Type: rememberedIngredient,
    app1BatchLbs: 0,
  };

    const peerWeights = await openIngredientWeights(peer, rememberedIngredient);

  const pendingBrand = `Batch Weight Pending ${uniqueTestId("brand")}`;

  const activeFlavor = "Active Snapshot";

async function saveIngredientBatchWeight(
  page: Page,
  ingredientName: string,
  lbs: string,
): Promise<void> {
  const dialog = await openIngredientWeights(page, ingredientName);
  const input = dialog
    .getByText(ingredientName, { exact: true })
    .locator("..")
    .getByRole("spinbutton");
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/api/ingredient-batch-weights")
      && response.request().method() === "POST"
      && response.status() === 200,
  );
  await input.fill(lbs);
  await input.blur();
  await saved;
  await expect(input).toHaveValue(lbs);
  await dialog.getByRole("button", { name: "Close settings" }).click();
}

async function readServerProfileValue(
  page: Page,
  brand: string,
  flavor: string,
): Promise<Record<string, unknown> | null> {
  const response = await page.request.get("/api/brand-profiles", {
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok()) {
    throw new Error(`Read canonical profile failed (${response.status()})`);
  }
  const payload = await response.json() as {
    items?: Array<{
      brand?: string;
      flavor?: string;
      values?: Record<string, unknown>;
    }>;
  };
  const brandKey = brand.trim().toLowerCase();
  const flavorKey = flavor.trim().toLowerCase();
  const profile = payload.items?.find((item) =>
    item.brand?.trim().toLowerCase() === brandKey
      && item.flavor?.trim().toLowerCase() === flavorKey,
  );
  return profile?.values ?? null;
}

  const pendingFlavor = "Pending Snapshot";

  const pendingRunId = uniqueTestId("pending-run");

  const activeValues = {
    ...baseValues,
    app1Type: activeIngredient,
    app1BatchLbs: 5,
  };

  const activeIngredient = `Active Ingredient ${uniqueTestId("ingredient")}`;

    const activeProfileBefore = await readServerProfileValue(
      page,
      activeBrand,
      activeFlavor,
    );

  const activeRunId = uniqueTestId("active-run");

    const peerWeightInput = peerWeights
      .getByText(rememberedIngredient, { exact: true })
      .locator("..")
      .getByRole("spinbutton");
