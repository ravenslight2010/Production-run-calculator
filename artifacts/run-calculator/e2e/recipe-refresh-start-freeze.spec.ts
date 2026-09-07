import { expect, test, type Locator, type Page } from "@playwright/test";
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

async function setNamedRecipeLbs(
  page: Page,
  kind: "dough" | "sauce",
  recipeName: string,
  lbs: string,
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
  const saved = page.waitForResponse((response) =>
    response.url().includes(`/api/${kind}-recipes`)
      && response.request().method() === "POST"
      && response.status() === 200,
  );
  await input.fill(lbs);
  await input.blur();
  await saved;
  await dialog.getByRole("button", { name: "Close settings" }).click();
}

async function setMixPerPizza(
  page: Page,
  recipeName: string,
  perPizza: string,
): Promise<void> {
  const dialog = await openRecipeSettings(page, "mixes");
  const search = dialog.getByPlaceholder("Search mixes by name, brand, or flavor…");
  await search.fill(recipeName);
  await dialog.getByRole("button", { name: new RegExp(recipeName) }).click();
  // The filtered manager contains only this fixture mix. Target the component
  // field by its distinctive step rather than relying on the editor's other
  // numeric fields (batch size, days early, and lbs/batch).
  const input = dialog.locator('input[type="number"][step="0.001"]').first();
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/api/mixes")
      && response.request().method() === "POST"
      && response.status() === 200,
  );
  await input.fill(perPizza);
  await input.blur();
  await saved;
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

test("pending recipes refresh while Start freezes the running snapshot", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const username = uniqueTestId("e2e_recipe_freeze");
  const brand = `Recipe Refresh ${uniqueTestId("brand")}`;
  const flavor = "Phone Fixture";
  const recipeId = uniqueTestId("cheese-recipe");
  const recipeName = `Shared Cheese ${uniqueTestId("recipe")}`;
  const currentRunId = uniqueTestId("current-run");
  const upcomingRunId = uniqueTestId("upcoming-run");
  const scheduledRunId = uniqueTestId("scheduled-run");
  const now = Date.now();
  const account = await fixtures.createAccount({
    username,
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });

  await fixtures.seedCheeseRecipe(account, {
    id: recipeId,
    name: recipeName,
    brand,
    components: [{ ingredient: "Cheese", lbs: 0 }],
  });

  const values = {
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
    app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 0 }],
  };
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
  // The future-day propagation writes immediately, while today's pending
  // snapshot follows the normal debounced live-day save.
  await page.waitForTimeout(1_000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-frontline").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTestId("tab-frontline").click();
  await expect(page.getByTestId("output-app1-batches")).toContainText("6.00");
  await openSummary(page);
  await expect(page.getByTestId(`run-summary-${upcomingRunId}`)).toContainText("3.00 batches");
});

type SharedRecipeFreezeScenario = {
  label: string;
  kind: "dough" | "sauce" | "mixes";
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
] as const;

for (const scenario of sharedRecipeFreezeScenarios) {
  test(`${scenario.label} recipe edits refresh pending runs but freeze after Start`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });

    const username = uniqueTestId(`e2e_${scenario.label}_freeze`);
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
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    const pendingBefore = await readIngredientDetail(page, upcomingRunId);
    await scenario.edit(page, recipeName, scenario.firstLbs);
    const pendingAfterFirstEdit = await expectIngredientDetailChanged(
      page,
      upcomingRunId,
      pendingBefore,
    );

    await page.getByTestId("tab-run").click();
    await page.getByTestId("button-start-run").click();
    await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible();
    const startedSnapshot = await readIngredientDetail(page, currentRunId);

    await scenario.edit(page, recipeName, scenario.secondLbs);
    await expectIngredientDetailChanged(page, upcomingRunId, pendingAfterFirstEdit);
    await expectIngredientDetailStable(page, currentRunId, startedSnapshot);
    // Profile propagation is local-first and the debounced day-state save
    // follows it. Give that save a turn to reach the server before checking
    // the reload boundary.
    await page.waitForTimeout(1_000);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await expectIngredientDetailStable(page, currentRunId, startedSnapshot);
  });
}
