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

function ingredientWeightInput(dialog: Locator, ingredientName: string): Locator {
  return dialog
    .getByText(ingredientName, { exact: true })
    .locator("..")
    .getByRole("spinbutton");
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

function responseContainsRecipeValue(
  response: import("@playwright/test").Response,
  endpoint: string,
  recipeName: string,
  value: string,
): boolean {
  if (
    !response.url().includes(endpoint)
    || response.request().method() !== "POST"
    || response.status() !== 200
  ) {
    return false;
  }
  try {
    const body = response.request().postDataJSON() as {
      items?: Array<{
        name?: string;
        perPizza?: number;
        batchSize?: number;
        components?: Array<{ lbs?: number; perPizza?: number }>;
      }>;
    };
    const expected = Number(value);
    return body.items?.some((item) =>
      item.name === recipeName
      && (
        Number(item.perPizza) === expected
        || Number(item.batchSize) === expected
        || item.components?.some((row) =>
          Number(row.lbs) === expected || Number(row.perPizza) === expected
        )
      )
    ) ?? false;
  } catch {
    return false;
  }
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
    responseContainsRecipeValue(
      response,
      "/api/cheese-recipes",
      recipeName,
      lbs,
    ),
  );
  await input.fill(lbs);
  await input.blur();
  await saved;
  await expect(input).toBeEnabled({ timeout: 45_000 });
  const closeSettings = dialog.getByRole("button", { name: "Close settings" });
  // Acknowledged recipe saves can trigger the settings surface to close while
  // the profile refresh is being applied. Closing an already-dismissed dialog
  // is a no-op; otherwise use the normal user-facing close control.
  if (await closeSettings.isVisible().catch(() => false)) {
    await closeSettings.click({ force: true });
  }
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

async function holdNextProfileRefresh(page: Page): Promise<{
  observed: Promise<void>;
  release: () => Promise<void>;
}> {
  return holdNextDelayedCompletion(page, "/api/brand-profiles", "GET");
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
}

async function readServerProfileValue(
  page: Page,
  brand: string,
  flavor: string,
): Promise<Record<string, unknown> | null> {
  const key = `${brand.trim().toLowerCase()}__${flavor.trim().toLowerCase()}`;
  return (await readServerProfileValues(page, key)) ?? null;
}

async function readServerIngredientBatchWeight(
  page: Page,
  ingredient: string,
): Promise<number | null> {
  const response = await page.request.get("/api/ingredient-batch-weights", {
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok()) {
    throw new Error(`Read canonical ingredient batch weight failed (${response.status()})`);
  }
  const payload = await response.json() as {
    weights?: Array<{ name?: string; lbs?: number }>;
  };
  const match = payload.weights?.find(
    (row) => row.name?.trim().toLowerCase() === ingredient.trim().toLowerCase(),
  );
  return match?.lbs ?? null;
}

function waitForBatchWeightWrite(
  page: Page,
  ingredient: string,
  lbs: number,
) {
  const key = ingredient.trim().toLowerCase();
  return page.waitForResponse((response) => {
    if (
      !response.url().endsWith("/api/ingredient-batch-weights")
      || response.request().method() !== "POST"
      || response.status() !== 200
    ) {
      return false;
    }
    const payload = response.request().postDataJSON() as {
      weights?: Array<{ name?: string; lbs?: number }>;
    };
    return payload.weights?.some(
      (row) => row.name?.trim().toLowerCase() === key && Number(row.lbs) === lbs,
    ) ?? false;
  });
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
        responseContainsRecipeValue(
          response,
          `/api/${kind}-recipes`,
          recipeName,
          lbs,
        ),
      )
    : undefined;
  await input.fill(lbs);
  await input.blur();
  if (waitForSave) await saved;
  if (waitForSave) {
    await expect(input).toBeEnabled({ timeout: 45_000 });
  }
  await dialog.getByRole("button", { name: "Close settings" }).click({ force: true });
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
        responseContainsRecipeValue(
          response,
          "/api/mixes",
          recipeName,
          perPizza,
        ),
      )
    : undefined;
  await input.fill(perPizza);
  await input.blur();
  if (waitForSave) await saved;
  if (waitForSave) {
    await expect(input).toBeEnabled({ timeout: 45_000 });
  }
  await dialog.getByRole("button", { name: "Close settings" }).click({ force: true });
}

async function primeRecipeSettings(
  page: Page,
  kind: SharedRecipeFreezeScenario["kind"],
  recipeName: string,
): Promise<void> {
  const dialog = await openRecipeSettings(page, kind);
  const placeholder = kind === "cheese"
    ? "Search cheese recipes by name, customer, or flavor…"
    : kind === "mixes"
      ? "Search mixes by name, brand, or flavor…"
      : `Search ${kind} recipes by name or ingredient…`;
  await dialog.getByPlaceholder(placeholder).fill(recipeName);
  await expect(dialog.getByRole("button", { name: new RegExp(recipeName) })).toBeVisible({
    timeout: 15_000,
  });
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

async function reloadAfterMasterBootstrap(page: Page): Promise<void> {
  const masterReady = page.waitForResponse(
    (response) =>
      response.url().includes("/api/master-data/bootstrap") && response.ok(),
    { timeout: 25_000 },
  );
  await Promise.all([
    page.reload({ waitUntil: "domcontentloaded" }),
    masterReady,
  ]);
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
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

async function serverRunHasStarted(page: Page, runId: string): Promise<boolean> {
  const response = await page.request.get(`/api/sync/today?today=${TODAY}`, {
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok()) return false;
  const payload = await response.json() as {
    dayState?: { runs?: Array<{ id?: string; startedAt?: number }> };
  };
  return Boolean(
    payload.dayState?.runs?.some((run) => run.id === runId && Number(run.startedAt) > 0),
  );
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
  timeout = 45_000,
): Promise<string> {
  await expect.poll(
    () => readServerRunValue(page, runId),
    { timeout },
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

test.skip("remembered plain ingredient batch weights rehydrate in a peer without changing the active run", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const username = uniqueTestId("e2e_batch_weight_sign_in");

  const brand = `Weight Sync ${uniqueTestId("brand")}`;
  const flavor = "Manager Journey";

  const otherBrand = `Other Weight ${uniqueTestId("brand")}`;
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

    const values = scenario.values(recipeName);

  await fixtures.seedCheeseRecipe(account, {
    id: recipeId,
    name: recipeName,
    brand,
    components: [{ ingredient: "Cheese", lbs: 10 }],
  });

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
  await expect(page.getByTestId("output-app1-batches")).toHaveText("12.00 batches");

  await openSummary(page);
  const upcoming = page.getByTestId(`run-summary-${upcomingRunId}`);
  await expect(upcoming).toContainText("12.00 batches");

  await setRecipeBatchLbs(page, recipeName, "20");
  await expect(upcoming).toContainText("6.00 batches");
  await expect.poll(
    async () => {
      const scheduled = await readScheduledRunValues(page, TOMORROW, scheduledRunId);
      return scheduled?.app1CheeseRecipe;
    },
    { timeout: 20_000 },
  ).toEqual([expect.objectContaining({ ingredient: "Cheese", lbs: 20 })]);
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
  ).toEqual([expect.objectContaining({ ingredient: "Cheese", lbs: 40 })]);
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

/*
test("a delayed shared recipe refresh stays with its original run after a rapid switch", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const username = uniqueTestId("e2e_batch_weight_sign_in");

    const originalBrand = `Original ${scenario.label} ${uniqueTestId("brand")}`;
    const originalFlavor = "Profile-backed";
    const recipeId = uniqueTestId(`${scenario.label}-recipe`);
    const recipeName = `Shared ${scenario.label} ${uniqueTestId("recipe")}`;
    const originalRunId = uniqueTestId("original-run");
    const switchedRunId = uniqueTestId("switched-run");
  const now = Date.now();
  const account = await fixtures.createAccount({
    username: uniqueTestId("e2e_weight_sync"),
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });

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

  const startedValues = values(7);

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
          currentRunId: originalRunId,
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
*/
test.skip("a delayed shared recipe refresh stays with its original run after a rapid switch", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const username = uniqueTestId(`e2e_${scenario.label}_switch`);
  const originalBrand = `Original ${scenario.label} ${uniqueTestId("brand")}`;
  const originalFlavor = "Profile-backed";
  const recipeId = uniqueTestId(`${scenario.label}-recipe`);
  const recipeName = `Shared ${scenario.label} ${uniqueTestId("recipe")}`;
  const originalRunId = uniqueTestId("original-run");
  const switchedRunId = uniqueTestId("switched-run");
  const now = Date.now();
  const account = await fixtures.createAccount({
    username: uniqueTestId("e2e_pep_batch"),
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });
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
        currentRunId,
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

test("a delayed learned batch weight reaches future pending runs but preserves started and paused snapshots", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const username = uniqueTestId("e2e_batch_weight_future");
  const ingredient = `Future Topping ${uniqueTestId("ingredient")}`;
  const brand = `Future Weight ${uniqueTestId("brand")}`;
  const flavor = "Scheduled Snapshot";
  const otherBrand = `Other Weight ${uniqueTestId("brand")}`;
  const otherFlavor = "Switch Target";
  const activeRunId = uniqueTestId("active-run");
  const switchedRunId = uniqueTestId("switched-run");
  const futurePendingRunId = uniqueTestId("future-pending-run");
  const futureStartedRunId = uniqueTestId("future-started-run");
  const futurePausedRunId = uniqueTestId("future-paused-run");
  const futureHistoryRunId = uniqueTestId("future-history-run");
  const now = Date.now();
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
  const activeValues = values(5);
  const switchedValues = values(7);
  const startedValues = values(7);
  const pausedValues = values(11);
  const historyValues = values(9);

  await fixtures.seedBrandProfile(account, {
    brand,
    flavor,
    values: activeValues,
    updatedAt: now,
  });
  await fixtures.seedTodaySync({
    token: account.token,
    senderId: `batch-weight-future-${username}`,
    date: TODAY,
    payload: {
      dayState: {
        date: TODAY,
        runs: [
          { id: activeRunId, brand, flavor, metaUpdatedAt: now, seeded: false },
          {
            id: switchedRunId,
            brand: otherBrand,
            flavor: otherFlavor,
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
        [activeRunId]: activeValues,
        [switchedRunId]: switchedValues,
      },
      runValuesUpdatedAt: {
        [activeRunId]: now,
        [switchedRunId]: now,
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
          { id: futurePendingRunId, brand, flavor, metaUpdatedAt: now, seeded: false },
          {
            id: futureStartedRunId,
            brand,
            flavor,
            metaUpdatedAt: now,
            startedAt: now - 120_000,
            seeded: false,
          },
          {
            id: futurePausedRunId,
            brand,
            flavor,
            metaUpdatedAt: now,
            startedAt: now - 180_000,
            pausedAt: now - 60_000,
            seeded: false,
          },
          {
            id: futureHistoryRunId,
            brand,
            flavor,
            metaUpdatedAt: now,
            startedAt: now - 240_000,
            endedAt: now - 180_000,
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
        [futurePendingRunId]: activeValues,
        [futureStartedRunId]: startedValues,
        [futurePausedRunId]: pausedValues,
        [futureHistoryRunId]: historyValues,
      },
      runValuesUpdatedAt: {
        [futurePendingRunId]: now,
        [futureStartedRunId]: now,
        [futurePausedRunId]: now,
        [futureHistoryRunId]: now,
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
    await expect(page.getByText("Run 2 of 2", { exact: true })).toBeVisible();

    await refreshGate.release();

    await expect.poll(
      async () => (await readScheduledRunValues(page, TOMORROW, futurePendingRunId))?.app1BatchLbs,
      { timeout: 25_000 },
    ).toBe(12);
    await expect.poll(
      async () => (await readScheduledRunValues(page, TOMORROW, futureStartedRunId))?.app1BatchLbs,
      { timeout: 25_000 },
    ).toBe(7);
    await expect.poll(
      async () => (await readScheduledRunValues(page, TOMORROW, futurePausedRunId))?.app1BatchLbs,
      { timeout: 25_000 },
    ).toBe(11);
    await expect.poll(
      async () => (await readScheduledRunValues(page, TOMORROW, futureHistoryRunId))?.app1BatchLbs,
      { timeout: 25_000 },
    ).toBe(9);
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
    seed: (
      fixtures: AuthorizedBrowserFixtures,
      account: { token: string },
      recipeName: string,
      recipeId: string,
      brand: string,
      flavor: string,
    ) =>
      fixtures.seedNamedRecipe("sauce", account, {
        id: recipeId,
        name: recipeName,
        brand,
        flavors: [flavor],
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
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });

  const username = uniqueTestId("e2e_batch_weight_sign_in");

  const brand = `Weight Sync ${uniqueTestId("brand")}`;
  const flavor = "Manager Journey";

  const otherBrand = `Other Weight ${uniqueTestId("brand")}`;
    const recipeId = uniqueTestId(`${scenario.label}-recipe`);
    const recipeName = `Shared ${scenario.label} ${uniqueTestId("recipe")}`;
    const currentRunId = uniqueTestId("current-run");
    const upcomingRunId = uniqueTestId("upcoming-run");
  const now = Date.now();
  const account = await fixtures.createAccount({
    username: uniqueTestId("e2e_weight_sync"),
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
          currentRunId,
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
  const peerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await peerContext.addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  const peer = await peerContext.newPage();

      const sourceEventsReady = page.waitForRequest(
        (request) => request.url().includes("/api/sync/events"),
        { timeout: 25_000 },
      );
      const peerEventsReady = peer.waitForRequest(
        (request) => request.url().includes("/api/sync/events"),
        { timeout: 25_000 },
      );
      const sourceMasterReady = page.waitForResponse(
        (response) =>
          response.url().includes("/api/master-data/bootstrap") && response.ok(),
        { timeout: 25_000 },
      );
      const peerMasterReady = peer.waitForResponse(
        (response) =>
          response.url().includes("/api/master-data/bootstrap") && response.ok(),
        { timeout: 25_000 },
      );

    try {
      await Promise.all([
        page.goto("/", { waitUntil: "domcontentloaded" }),
        peer.goto("/", { waitUntil: "domcontentloaded" }),
        sourceEventsReady,
        peerEventsReady,
        sourceMasterReady,
        peerMasterReady,
      ]);
      await Promise.all([
        page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 }),
        peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 }),
      ]);
      await Promise.all([
        primeRecipeSettings(page, scenario.kind, recipeName),
        primeRecipeSettings(peer, scenario.kind, recipeName),
      ]);
      const [pendingBefore, peerPendingBefore] = await Promise.all([
        readIngredientDetail(page, upcomingRunId),
        readIngredientDetail(peer, upcomingRunId),
      ]);
      expect(peerPendingBefore).toBe(pendingBefore);

      const serverBeforeFirstEdit = await readServerRunValue(page, upcomingRunId);
      await scenario.edit(page, recipeName, scenario.firstLbs);
      const serverAfterFirstEdit = await expectServerRunValueChanged(
        page,
        upcomingRunId,
        serverBeforeFirstEdit,
      );
      const [pendingAfterFirstEdit, peerPendingAfterFirstEdit] = await Promise.all([
        expectIngredientDetailChanged(page, upcomingRunId, pendingBefore),
        expectIngredientDetailChanged(peer, upcomingRunId, peerPendingBefore),
      ]);
      expect(peerPendingAfterFirstEdit).toBe(pendingAfterFirstEdit);

      await page.getByTestId("tab-run").click();
      const startRun = page.getByTestId("button-start-run");
      await startRun.click();
      await expect(startRun).toBeHidden({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible({
        timeout: 20_000,
      });
      await expect.poll(
        () => serverRunHasStarted(page, currentRunId),
        { timeout: 20_000, message: "Start did not reach canonical sync state" },
      ).toBe(true);
      await reloadAfterMasterBootstrap(page);
      await page.getByTestId("tab-run").click();
      await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible({
        timeout: 20_000,
      });
      await page.waitForTimeout(1_500);
      const startedSnapshot = await readIngredientDetail(page, currentRunId);
      const peerStartedSnapshot = await readIngredientDetail(peer, currentRunId);

      await scenario.edit(page, recipeName, scenario.secondLbs);
      const serverAfterSecondEdit = await expectServerRunValueChanged(
        page,
        upcomingRunId,
        serverAfterFirstEdit,
      );
      const [pendingAfterSecondEdit, peerPendingAfterSecondEdit] = await Promise.all([
        expectIngredientDetailChanged(page, upcomingRunId, pendingAfterFirstEdit),
        expectIngredientDetailChanged(peer, upcomingRunId, peerPendingAfterFirstEdit),
      ]);
      expect(peerPendingAfterSecondEdit).toBe(pendingAfterSecondEdit);
      await expect.poll(
        () => readServerRunValue(page, upcomingRunId),
        { timeout: 20_000 },
      ).toBe(serverAfterSecondEdit);
      await reloadAfterMasterBootstrap(peer);
      await expectIngredientDetailStable(peer, upcomingRunId, peerPendingAfterSecondEdit);
      await expectIngredientDetailStable(peer, currentRunId, peerStartedSnapshot);
      await reloadAfterMasterBootstrap(page);
      await expectIngredientDetailStable(page, upcomingRunId, pendingAfterSecondEdit);
      await expectIngredientDetailStable(page, currentRunId, startedSnapshot);

      // Reload both contexts once more so neither browser can reintroduce its
      // older pending snapshot after the peer's acknowledged sync write.
      await reloadAfterMasterBootstrap(peer);
      await reloadAfterMasterBootstrap(page);
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

  const username = uniqueTestId("e2e_batch_weight_sign_in");

    const originalBrand = `Original ${scenario.label} ${uniqueTestId("brand")}`;
    const originalFlavor = "Profile-backed";
    const recipeId = uniqueTestId(`${scenario.label}-recipe`);
    const recipeName = `Shared ${scenario.label} ${uniqueTestId("recipe")}`;
    const originalRunId = uniqueTestId("original-run");
    const switchedRunId = uniqueTestId("switched-run");
  const now = Date.now();
  const account = await fixtures.createAccount({
    username: uniqueTestId("e2e_weight_sync"),
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });
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
          currentRunId: originalRunId,
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
      } else if (scenario.kind === "dough" || scenario.kind === "sauce") {
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
      } else {
        throw new Error(`Unsupported recipe kind: ${scenario.kind}`);
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

test("remembered non-default pepperoni batch weights rehydrate in a peer without changing default sticks", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const nonDefaultPep = `Turkey Pep ${uniqueTestId("pep")}`;
  const defaultPep = "Pepperoni Stick";
  const activeBrand = `Batch Weight Active ${uniqueTestId("brand")}`;
  const pendingBrand = `Batch Weight Pending ${uniqueTestId("brand")}`;
  const activeFlavor = "Active Snapshot";
  const pendingFlavor = "Pending Snapshot";
  const activeRunId = uniqueTestId("started-run");
  const pendingRunId = uniqueTestId("pending-run");
  const now = Date.now();
  const baseValues = {
    casesNeeded: 100,
    pizzasPerCase: 1,
    casesPerSkid: 10,
    casesPerLayer: 0,
    crustsPerCycle: 1,
    cycleSpeed: 1,
    speedAdjustment: 1,
    freezerTime: 0,
    pep1Type: defaultPep,
    pep1Sticks: 8,
    pep1OzPerPizza: 1.2,
    pep1BatchLbs: 0,
    pep1Combined: true,
  };
  const activeValues = {
    ...baseValues,
    pep1Type: defaultPep,
  };
  const pendingValues = {
    ...baseValues,
    pep1Type: nonDefaultPep,
    pep1Sticks: 0,
    pep1OzPerPizza: 1.5,
  };
  const account = await fixtures.createAccount({
    username: uniqueTestId("e2e_weight_sync"),
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });

  await fixtures.seedBrandProfile(account, {
    brand: activeBrand,
    flavor: activeFlavor,
    values: activeValues,
    updatedAt: now,
  });
  await fixtures.seedBrandProfile(account, {
    brand: pendingBrand,
    flavor: pendingFlavor,
    values: pendingValues,
    updatedAt: now,
  });
  await fixtures.seedTodaySync({
    token: account.token,
    senderId: `pep-batch-${account.username}`,
    date: TODAY,
    payload: {
      dayState: {
        date: TODAY,
        runs: [
          { id: activeRunId, brand: activeBrand, flavor: activeFlavor, metaUpdatedAt: now, seeded: false },
          { id: pendingRunId, brand: pendingBrand, flavor: pendingFlavor, metaUpdatedAt: now, seeded: false },
        ],
        currentIndex: 0,
        resetAt: 0,
        substitutions: [],
        substitutionLog: [],
        stagedItems: {},
      },
      runValues: {
        [activeRunId]: activeValues,
        [pendingRunId]: pendingValues,
      },
      runValuesUpdatedAt: {
        [activeRunId]: now,
        [pendingRunId]: now,
      },
      packagingProgress: {},
    },
  });

  const setPepTypes = (context: { addInitScript: Page["addInitScript"] }) =>
    context.addInitScript(({ defaultPepName, nonDefaultPepName }) => {
      localStorage.setItem(
        "run-calc-pep-types",
        JSON.stringify([defaultPepName, nonDefaultPepName]),
      );
    }, { defaultPepName: defaultPep, nonDefaultPepName: nonDefaultPep });
  await setPepTypes(page.context());
  await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  const peerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await setPepTypes(peerContext);
  await peerContext.addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  const peer = await peerContext.newPage();

      const sourceEventsReady = page.waitForRequest(
        (request) => request.url().includes("/api/sync/events"),
        { timeout: 25_000 },
      );

  const activeFreezeSignature = (raw: string) => {
    const values = JSON.parse(raw) as Record<string, unknown>;
    return JSON.stringify({
      pep1Type: values.pep1Type,
      pep1Sticks: values.pep1Sticks,
      pep1OzPerPizza: values.pep1OzPerPizza,
      pep1BatchLbs: values.pep1BatchLbs,
      pep1Combined: values.pep1Combined,
    });
  };
  const activeBefore = activeFreezeSignature(await readServerRunValue(page, activeRunId));
  try {
    await Promise.all([
      page.goto("/", { waitUntil: "domcontentloaded" }),
      peer.goto("/", { waitUntil: "domcontentloaded" }),
    ]);
    await Promise.all([
      page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 }),
      peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 }),
    ]);

    await page.getByRole("button", { name: "Select run 2" }).click();
    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: "Setup", exact: true }).click();
    await ensureSauceWeightsOpen(page, "input-pep1BatchLbs");
  const batchWeight = page.getByTestId("input-pep1BatchLbs");
  await expect(batchWeight).toHaveValue("0");
  const savedWeight = page.waitForResponse((response) =>
    response.url().includes("/api/brand-profiles")
      && response.request().method() === "POST"
      && response.ok(),
  );
    await batchWeight.fill("14");
    await batchWeight.blur();
    await savedWeight;

    await expect.poll(
      () => readServerRunField(page, pendingRunId, "pep1BatchLbs"),
      { timeout: 25_000 },
    ).toBe(14);
    await expect.poll(
      async () => activeFreezeSignature(await readServerRunValue(page, activeRunId)),
      { timeout: 25_000 },
    ).toBe(activeBefore);

    await peer.reload({ waitUntil: "domcontentloaded" });
    await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await peer.getByTestId("tab-run").click();
    await peer.getByRole("button", { name: "Select run 2" }).click();
    await peer.getByRole("button", { name: /^More/ }).click();
    await peer.getByRole("menuitem", { name: "Setup", exact: true }).click();
    await ensureSauceWeightsOpen(peer, "input-pep1BatchLbs");
    await expect(peer.getByTestId("input-pep1BatchLbs")).toHaveValue("14");

    await peer.getByTestId("tab-run").click();
    await peer.getByRole("button", { name: "Select run 1" }).click();
    await peer.getByRole("button", { name: /^More/ }).click();
    await peer.getByRole("menuitem", { name: "Setup", exact: true }).click();
    await ensureSauceWeightsOpen(peer, "input-pep1Sticks");
    await expect(peer.getByTestId("input-pep1Sticks")).toHaveValue("8");
    await expect(peer.getByTestId("input-pep1OzPerPizza")).toHaveValue("1.2");
    await expect(peer.getByTestId("input-pep1BatchLbs")).toHaveValue("0");
    await expect.poll(
      async () => activeFreezeSignature(await readServerRunValue(peer, activeRunId)),
      { timeout: 25_000 },
    ).toBe(activeBefore);
  } finally {
    await peerContext.close();
  }
});

test("remembered plain ingredient batch weights survive a fresh sign-in", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const username = uniqueTestId("e2e_batch_weight_sign_in");
  const rememberedIngredient = `Remembered Ingredient ${uniqueTestId("ingredient")}`;
  const activeIngredient = `Active Ingredient ${uniqueTestId("ingredient")}`;
  const activeBrand = `Batch Weight Active ${uniqueTestId("brand")}`;
  const pendingBrand = `Batch Weight Pending ${uniqueTestId("brand")}`;
  const activeFlavor = "Active Snapshot";
  const pendingFlavor = "Pending Snapshot";
  const activeRunId = uniqueTestId("started-run");
  const pendingRunId = uniqueTestId("pending-run");
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
    app1Type: activeIngredient,
    app1OzPerPizza: 1,
    app1BatchLbs: 5,
    app1CheeseRecipe: [],
  };
  const activeValues = {
    ...baseValues,
    app1Type: activeIngredient,
    app1BatchLbs: 5,
  };
  const pendingValues = {
    ...baseValues,
    app1Type: rememberedIngredient,
    app1BatchLbs: 0,
  };

  await fixtures.seedBrandProfile(account, {
    brand: activeBrand,
    flavor: activeFlavor,
    values: activeValues,
    updatedAt: now,
  });
  await fixtures.seedBrandProfile(account, {
    brand: pendingBrand,
    flavor: pendingFlavor,
    values: pendingValues,
    updatedAt: now,
  });
  await fixtures.seedTodaySync({
    token: account.token,
    senderId: `batch-weight-sign-in-${username}`,
    date: TODAY,
    payload: {
      dayState: {
        date: TODAY,
        runs: [
          {
            id: activeRunId,
            brand: activeBrand,
            flavor: activeFlavor,
            metaUpdatedAt: now,
            seeded: false,
          },
          {
            id: pendingRunId,
            brand: pendingBrand,
            flavor: pendingFlavor,
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
        [activeRunId]: activeValues,
        [pendingRunId]: pendingValues,
      },
      runValuesUpdatedAt: {
        [activeRunId]: now,
        [pendingRunId]: now,
      },
      packagingProgress: {},
    },
  });

  await page.addInitScript(({ ingredients }) => {
    localStorage.setItem("run-calc-ingredient-types", JSON.stringify(ingredients));
  }, { ingredients: [activeIngredient, rememberedIngredient] });
  await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Setup", exact: true }).click();
  await page.getByRole("button", { name: "Sauce & Applicator Weights" }).click();
  await expect(page.getByTestId("input-app1BatchLbs")).toHaveValue("5");
  await page.getByTestId("tab-run").click();
  await page.getByTestId("button-start-run").click();
  await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible();

  await page.getByRole("button", { name: "Select run 2" }).click();
  await expect(page.getByText("Run 2 of 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Setup", exact: true }).click();
  const batchWeight = page.getByTestId("input-app1BatchLbs");
  await expect(batchWeight).toHaveValue("0");
   const savedWeight = waitForBatchWeightWrite(page, rememberedIngredient, 12);
  await batchWeight.fill("12");
  await batchWeight.blur();
  await savedWeight;
  await expect(batchWeight).toHaveValue("12");
  await page.getByTestId("tab-run").click();

  await expect.poll(
    () => readServerIngredientBatchWeight(page, rememberedIngredient),
    { timeout: 25_000 },
  ).toBe(12);
  await expect.poll(
    async () => (await readServerProfileValue(page, pendingBrand, pendingFlavor))?.app1BatchLbs,
    { timeout: 25_000 },
  ).toBe(12);
  await expect.poll(
    () => readServerRunField(page, pendingRunId, "app1BatchLbs"),
    { timeout: 25_000 },
  ).toBe(12);
  await expect.poll(
    () => readServerRunField(page, activeRunId, "app1BatchLbs"),
    { timeout: 25_000 },
  ).toBe(5);
  await expect.poll(
    async () => (await readServerProfileValue(page, activeBrand, activeFlavor))?.app1BatchLbs,
    { timeout: 25_000 },
  ).toBe(5);

  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByText("Sign out", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

  const freshContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const freshPage = await freshContext.newPage();
  try {
    await signIn(freshPage, username);
    await freshPage.getByTestId("tab-run").click();
    await freshPage.getByRole("button", { name: "Select run 1" }).click();
    await expect(freshPage.getByText("Run 1 of 2", { exact: true })).toBeVisible();
    await freshPage.getByRole("button", { name: /^More/ }).click();
    await freshPage.getByRole("menuitem", { name: "Setup", exact: true }).click();
    await ensureSauceWeightsOpen(freshPage, "input-app1BatchLbs");
    await expect(freshPage.getByTestId("input-app1BatchLbs")).toHaveValue("5");
    await freshPage.getByTestId("tab-run").click();

    await freshPage.getByRole("button", { name: "Select run 2" }).click();
    await expect(freshPage.getByText("Run 2 of 2", { exact: true })).toBeVisible();
    await freshPage.getByRole("button", { name: /^More/ }).click();
    await freshPage.getByRole("menuitem", { name: "Setup", exact: true }).click();
    await ensureSauceWeightsOpen(freshPage, "input-app1BatchLbs");
    await expect(freshPage.getByTestId("input-app1BatchLbs")).toHaveValue("12");

    await expect.poll(
      () => readServerIngredientBatchWeight(freshPage, rememberedIngredient),
      { timeout: 25_000 },
    ).toBe(12);
    await expect.poll(
      () => readServerRunField(freshPage, activeRunId, "app1BatchLbs"),
      { timeout: 25_000 },
    ).toBe(5);
    await expect.poll(
      () => readServerRunField(freshPage, pendingRunId, "app1BatchLbs"),
      { timeout: 25_000 },
    ).toBe(12);
  } finally {
    await freshContext.close();
  }
});

test("manager weight edits acknowledge, propagate, clear, and remain retryable across devices", async ({
  browser,
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const ingredient = `Sync Topping ${uniqueTestId("ingredient")}`;
  const brand = `Weight Sync ${uniqueTestId("brand")}`;
  const flavor = "Manager Journey";

  const otherBrand = `Other Weight ${uniqueTestId("brand")}`;
  const activeRunId = uniqueTestId("started-run");
  const pendingRunId = uniqueTestId("pending-run");
  const futurePendingRunId = uniqueTestId("future-pending-run");
  const futureStartedRunId = uniqueTestId("future-started-run");

  const futurePausedRunId = uniqueTestId("future-paused-run");
  const futureEndedRunId = uniqueTestId("future-ended-run");
  const now = Date.now();
  const baseValues = {
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
    app1BatchLbs: 5,
    app1CheeseRecipe: [],
  };
  const account = await fixtures.createAccount({
    username: uniqueTestId("e2e_weight_sync"),
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });

  await fixtures.seedBrandProfile(account, {
    brand,
    flavor,
    values: baseValues,
    updatedAt: now,
  });
  await fixtures.seedTodaySync({
    token: account.token,
    senderId: `weight-sync-${account.username}`,
    date: TODAY,
    payload: {
      dayState: {
        date: TODAY,
        runs: [
          {
            id: activeRunId,
            brand,
            flavor,
            startedAt: now - 60_000,
            pausedAt: now - 30_000,
            metaUpdatedAt: now,
            seeded: false,
          },
          {
            id: pendingRunId,
            brand,
            flavor,
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
        [activeRunId]: baseValues,
        [pendingRunId]: baseValues,
      },
      runValuesUpdatedAt: {
        [activeRunId]: now,
        [pendingRunId]: now,
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
          {
            id: futurePendingRunId,
            brand,
            flavor,
            metaUpdatedAt: now,
            seeded: false,
          },
          {
            id: futureStartedRunId,
            brand,
            flavor,
            startedAt: now - 120_000,
            metaUpdatedAt: now,
            seeded: false,
          },
          {
            id: futureEndedRunId,
            brand,
            flavor,
            startedAt: now - 180_000,
            endedAt: now - 120_000,
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
        [futurePendingRunId]: baseValues,
        [futureStartedRunId]: baseValues,
        [futureEndedRunId]: baseValues,
      },
      runValuesUpdatedAt: {
        [futurePendingRunId]: now,
        [futureStartedRunId]: now,
        [futureEndedRunId]: now,
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

  const activeBefore = await readServerRunValue(page, activeRunId);
  const futureStartedBefore = await readScheduledRunValues(page, TOMORROW, futureStartedRunId);
  const futureEndedBefore = await readScheduledRunValues(page, TOMORROW, futureEndedRunId);

  const dialog = await openIngredientWeights(page, ingredient);
  const weightInput = ingredientWeightInput(dialog, ingredient);
  const savedWeight = waitForBatchWeightWrite(page, ingredient, 12);
  await weightInput.fill("12");
  await weightInput.blur();
  await savedWeight;
  await expect(weightInput).toHaveValue("12");
  await dialog.getByRole("button", { name: "Close settings", exact: true }).click();

  await expect.poll(
    () => readServerIngredientBatchWeight(page, ingredient),
    { timeout: 25_000 },
  ).toBe(12);
  await expect.poll(
    () => readServerRunField(page, pendingRunId, "app1BatchLbs"),
    { timeout: 25_000 },
  ).toBe(12);
  await expect.poll(
    async () => (await readScheduledRunValues(page, TOMORROW, futurePendingRunId))?.app1BatchLbs,
    { timeout: 25_000 },
  ).toBe(12);
  await expect.poll(() => readServerRunValue(page, activeRunId), { timeout: 25_000 }).toBe(activeBefore);
  await expect.poll(
    async () => (await readScheduledRunValues(page, TOMORROW, futureStartedRunId))?.app1BatchLbs,
    { timeout: 25_000 },
  ).toBe(futureStartedBefore?.app1BatchLbs);
  await expect.poll(
    async () => (await readScheduledRunValues(page, TOMORROW, futureEndedRunId))?.app1BatchLbs,
    { timeout: 25_000 },
  ).toBe(futureEndedBefore?.app1BatchLbs);

  const peerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const peer = await peerContext.newPage();

  await peer.addInitScript(({ ingredientName }) => {
    localStorage.setItem("run-calc-ingredient-types", JSON.stringify([ingredientName]));
  }, { ingredientName: ingredient });
  await peer.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  try {
    await peer.goto("/", { waitUntil: "domcontentloaded" });
    await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    const peerDialog = await openIngredientWeights(peer, ingredient);
    await expect(ingredientWeightInput(peerDialog, ingredient)).toHaveValue("12");
    await peerDialog.getByRole("button", { name: "Close settings", exact: true }).click();
  } finally {
    await peerContext.close();
  }

  const failingDialog = await openIngredientWeights(page, ingredient);
  await page.route("**/api/ingredient-batch-weights", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporary test rejection" }),
      });
      return;
    }
    await route.continue();
  });
  const failingInput = ingredientWeightInput(failingDialog, ingredient);
  await failingInput.fill("13");
  await failingInput.blur();
  await expect(page.getByText("Batch weight was not saved", { exact: true })).toBeVisible();
  await page.unroute("**/api/ingredient-batch-weights");

  const retrySaved = waitForBatchWeightWrite(page, ingredient, 14);
  await failingInput.fill("14");
  await failingInput.blur();
  await retrySaved;
  await failingDialog.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect.poll(
    () => readServerIngredientBatchWeight(page, ingredient),
    { timeout: 25_000 },
  ).toBe(14);
  await expect.poll(
    async () => (await readServerProfileValue(page, brand, flavor))?.app1BatchLbs,
    { timeout: 25_000 },
  ).toBe(14);
  await expect.poll(
    () => readServerRunField(page, pendingRunId, "app1BatchLbs"),
    { timeout: 25_000 },
  ).toBe(14);

  const profileDialog = await openSettings(page);
  await profileDialog.getByRole("button", { name: "Tools", exact: true }).click();
  await profileDialog.getByRole("button", { name: "Setup Profiles", exact: true }).click();
  await profileDialog.getByRole("button", {
    name: "Open Setup Profiles Editor",
    exact: true,
  }).click();
  const setupDialog = page.getByRole("dialog", { name: "Setup Profiles" });
  await expect(setupDialog).toBeVisible();
  await setupDialog.getByRole("button", { name: /Pick or add a brand/ }).click();
  await page.getByPlaceholder("Search or add…").fill(brand);

  const existingBrand = page.getByRole("button", { name: brand, exact: true });
  if (await existingBrand.count()) {
    await existingBrand.last().click();
  } else {
    await page.getByRole("button", { name: `Add "${brand}"`, exact: true }).click();
  }
  await setupDialog.getByRole("button", { name: /Pick or add a flavor/ }).click();
  await page.getByPlaceholder("Search or add…").fill(flavor);
  const existingFlavor = page.getByRole("button", { name: flavor, exact: true });
  if (await existingFlavor.count()) {
    await existingFlavor.last().click();
  } else {
    await page.getByRole("button", { name: `Add "${flavor}"`, exact: true }).click();
  }

  const profileWeight = setupDialog.getByTestId("input-app1BatchLbs");
  await expect(profileWeight).toHaveValue("14");
  const savedProfile = page.waitForResponse((response) =>
    response.url().includes("/api/brand-profiles")
      && response.request().method() === "POST"
      && response.status() === 200,
  );
  await profileWeight.fill("16");
  await profileWeight.blur();
  await setupDialog.getByRole("button", { name: "Save Setup", exact: true }).click();
  await savedProfile;
  await expect(page.getByText(`Saved setup for ${brand} — ${flavor}`, { exact: true })).toBeVisible();
  await expect.poll(
    () => readServerIngredientBatchWeight(page, ingredient),
    { timeout: 25_000 },
  ).toBe(16);
  await expect.poll(
    () => readServerRunField(page, pendingRunId, "app1BatchLbs"),
    { timeout: 25_000 },
  ).toBe(16);
  await expect.poll(
    () => readServerRunValue(page, activeRunId),
    { timeout: 25_000 },
  ).toBe(activeBefore);

  await setupDialog.getByRole("button", { name: "Close", exact: true }).click();
  const clearDialog = await openIngredientWeights(page, ingredient);
  const clearInput = ingredientWeightInput(clearDialog, ingredient);
  const clearedWeight = waitForBatchWeightWrite(page, ingredient, 0);
  await clearInput.fill("");
  await clearInput.blur();
  await clearedWeight;
  await clearDialog.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect.poll(
    () => readServerIngredientBatchWeight(page, ingredient),
    { timeout: 25_000 },
  ).toBeNull();
  await expect.poll(
    async () => (await readServerProfileValue(page, brand, flavor))?.app1BatchLbs,
    { timeout: 25_000 },
  ).toBe(16);
});

async function ensureSauceWeightsOpen(page: Page, inputTestId: string): Promise<void> {
  const input = page.getByTestId(inputTestId);
  if (!(await input.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Sauce & Applicator Weights" }).click();
  }
  await expect(input).toBeVisible();
}
