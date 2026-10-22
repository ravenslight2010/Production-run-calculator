import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "MergeAliasTest123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();
const testBrands = new Set<string>();
const testAliasNames = new Set<string>();
const testDeniedPairs: Array<{
  category: string;
  brand: string | null;
  nameA: string;
  nameB: string;
}> = [];
const recipeFixtureIds: Record<"mixes" | "dough" | "sauce" | "cheese", string[]> = {
  mixes: [],
  dough: [],
  sauce: [],
  cheese: [],
};

type FactoryRow = { key: string; value: unknown };

const FACTORY_BRANDS_KEY = "run-calc-brands";
const FACTORY_FLAVORS_KEY = "run-calc-brand-flavors";
const TEST_FACTORY_KEYS = [FACTORY_BRANDS_KEY, FACTORY_FLAVORS_KEY];
const RECIPE_NAME_CATEGORIES = [
  { category: "mixes", label: "Mix Recipes", key: "run-calc-mix-recipe-names" },
  { category: "dough", label: "Dough", key: "run-calc-dough-recipe-names" },
  { category: "sauce", label: "Sauce", key: "run-calc-frontline-recipe-names" },
  { category: "cheese", label: "Cheese mixes", key: "run-calc-cheese-recipe-names" },
] as const;
type RecipeNameCategory = (typeof RECIPE_NAME_CATEGORIES)[number]["category"];
const RECIPE_ISOLATION_TARGET: Record<RecipeNameCategory, RecipeNameCategory> = {
  mixes: "dough",
  dough: "sauce",
  sauce: "dough",
  cheese: "dough",
};

async function seedRecipeNamePool(
  page: Page,
  category: RecipeNameCategory,
  names: string[],
): Promise<void> {
  const ids = names.map(() => uniqueTestId(`mergeAlias${category}`));
  recipeFixtureIds[category].push(...ids);
  const items = names.map((name, index) => ({ id: ids[index], name }));
  const data = category === "mixes"
    ? {
        items: items.map((item) => ({
          ...item,
          brand: "",
          flavor: "",
          batchSize: 0,
          daysEarly: 0,
          notes: "",
          amountAlreadyMade: 0,
          components: [],
          enabled: true,
          isPrep: false,
        })),
      }
    : category === "cheese"
    ? {
        items: items.map((item) => ({
          ...item,
          brand: "",
          flavors: [],
          shredderSetting: "",
          cellulose: "",
          notes: "",
          components: [],
          enabled: true,
        })),
      }
    : {
        items: items.map((item) => ({
          ...item,
          notes: "",
          components: [],
          enabled: true,
          brand: "",
          flavors: [],
        })),
      };
  const route = category === "mixes"
    ? "/api/mixes"
    : category === "cheese"
    ? "/api/cheese-recipes"
    : `/api/${category}-recipes`;
  const response = await page.request.post(route, { data });
  expect(response.status(), `seed ${category} recipe-name fixtures`).toBe(200);
}

function trackAliasNames(...names: string[]): void {
  for (const name of names) testAliasNames.add(name);
}

function trackDeniedPair(category: string, brand: string | null, a: string, b: string): void {
  const [nameA, nameB] = [a.trim().toLowerCase(), b.trim().toLowerCase()].sort();
  testDeniedPairs.push({ category, brand, nameA, nameB });
}

async function signInAsManager(page: Page, username: string): Promise<void> {
  if (!SIGNUP_CODE) throw new Error("STAFF_SIGNUP_CODE must be configured for merge-alias browser tests.");
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
  });

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const user = await db.query("SELECT id FROM users WHERE username = $1", [username]);
    expect(user.rows).toHaveLength(1);
    await db.query(
      "UPDATE roles SET capabilities = $1::jsonb, updated_at = NOW() WHERE name = 'manager'",
      [JSON.stringify(DEFAULT_MANAGER_CAPABILITIES)],
    );
    await db.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager', updated_at = NOW()`,
      [user.rows[0].id],
    );
  } finally {
    await db.end().catch(() => {});
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const me = await page.request.get("/api/me", { failOnStatusCode: true });
  expect((await me.json() as { role?: string }).role).toBe("manager");
}

async function signInExistingManager(page: Page, username: string): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const me = await page.request.get("/api/me", { failOnStatusCode: true });
  expect((await me.json() as { role?: string }).role).toBe("manager");
}

async function seedLocalMergeUniverse(
  page: Page,
  input: {
    ingredientNames: string[];
    brands: string[];
    flavorsByBrand: Record<string, string[]>;
  },
): Promise<void> {
  await page.evaluate(({ ingredientNames, brands, flavorsByBrand }) => {
    localStorage.setItem("run-calc-ingredient-types", JSON.stringify(ingredientNames));
    localStorage.setItem("run-calc-brands", JSON.stringify(brands));
    localStorage.setItem("run-calc-brand-flavors", JSON.stringify(flavorsByBrand));
  }, input);
}

async function openMergeManager(page: Page) {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Tools", exact: true }).click();
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  return dialog;
}

async function openFlavorMerge(page: Page, brand: string) {
  const dialog = await openMergeManager(page);
  await dialog.getByRole("button", { name: "Brand/Flavor", exact: true }).click();
  await dialog.getByRole("button", { name: "Flavors", exact: true }).click();
  await dialog.locator("select").selectOption(brand);
  return dialog;
}

async function seedPreviousAlias(
  page: Page,
  category: string,
  previousName: string,
  sourceName: string,
  brand?: string,
): Promise<void> {
  const response = await page.request.post("/api/merge-aliases", {
    data: {
      category,
      ...(category === "flavor" && brand ? { brand } : {}),
      aliases: [{ externalName: previousName, canonicalName: sourceName }],
    },
  });
  expect(response.status()).toBe(200);
}

async function confirmMerge(
  page: Page,
  dialog: Locator,
  sourceName: string,
  targetName: string,
): Promise<void> {
  await dialog.getByRole("checkbox", { name: sourceName, exact: true }).check();
  await dialog.locator('input[list="merge-target-options"]').fill(targetName);
  await dialog.getByRole("button", { name: "Merge…", exact: true }).click();

  const aliasWritePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/merge-aliases"
      && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Confirm merge", exact: true }).click();
  expect((await aliasWritePromise).status()).toBe(200);
}

async function getAliases(page: Page, category: string, brand?: string) {
  const query = new URLSearchParams({ category });
  if (brand) query.set("brand", brand);
  const response = await page.request.get(
    `/api/merge-aliases?${query.toString()}`,
    { failOnStatusCode: true },
  );
  return (await response.json() as {
    aliases: Array<{ externalName: string; canonicalName: string }>;
  }).aliases;
}

async function reloadAndOpenMergeManager(page: Page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  return openMergeManager(page);
}

async function expectPreviouslyMergedSuggestion(
  dialog: Locator,
  previousName: string,
  targetName: string,
): Promise<void> {
  await dialog.getByRole("button", { name: "Scan deterministic matches", exact: true }).click();
  const suggestion = suggestionForAliasPair(dialog, previousName, targetName);
  await expect(suggestion).toHaveCount(1, { timeout: 15_000 });
  await expect(suggestion).toContainText("→");
  await expect(dialog.getByText("Previously merged", { exact: true })).toBeVisible();
}

function suggestionForAliasPair(
  dialog: Locator,
  previousName: string,
  targetName: string,
): Locator {
  return dialog
    .locator("p")
    .filter({ hasText: previousName })
    .filter({ hasText: targetName });
}

function ignoreSuggestionButton(
  dialog: Locator,
  sourceName: string,
  targetName: string,
): Locator {
  return dialog
    .getByText(`${sourceName} → ${targetName}`, { exact: true })
    .locator("xpath=../..")
    .getByRole("button", { name: "Ignore", exact: true });
}

async function scanDeterministicMatches(dialog: Locator): Promise<void> {
  const scan = dialog.getByRole("button", { name: "Scan deterministic matches", exact: true });
  await scan.click();
  await expect(scan).toBeEnabled({ timeout: 15_000 });
}

async function getDenials(page: Page, category: string, brand?: string) {
  const query = new URLSearchParams({ category });
  if (brand) query.set("brand", brand);
  const response = await page.request.get(`/api/denied-merges?${query.toString()}`, {
    failOnStatusCode: true,
  });
  return (await response.json() as {
    denied: Array<{ nameA: string; nameB: string }>;
  }).denied;
}

test.beforeEach(() => {
  requireIsolatedTestDatabase("merge alias retarget browser beforeEach");
});

async function cleanupFixtures(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const failures: unknown[] = [];
  const cleanup = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  };
  try {
    await db.connect();
    if (testAliasNames.size > 0) {
      await cleanup(() => db.query(
        `DELETE FROM merge_aliases
         WHERE scope = 'live'
           AND external_name = ANY($1::text[])`,
        [[...testAliasNames]],
      ));
    }
    for (const [category, table] of [
      ["mixes", "mixes"],
      ["dough", "dough_recipes"],
      ["sauce", "sauce_recipes"],
      ["cheese", "cheese_recipes"],
    ] as const) {
      if (recipeFixtureIds[category].length === 0) continue;
      await cleanup(() => db.query(
        `DELETE FROM ${table} WHERE scope = 'live' AND id = ANY($1::text[])`,
        [recipeFixtureIds[category]],
      ));
    }
    if (testBrands.size > 0) {
      await cleanup(() => db.query(
        "DELETE FROM merge_aliases WHERE scope = 'live' AND category = 'flavor' AND brand = ANY($1::text[])",
        [[...testBrands]],
      ));
    }
    for (const denied of testDeniedPairs) {
      await cleanup(() => db.query(
        `DELETE FROM denied_merges
         WHERE scope = 'live'
           AND category = $1
           AND brand IS NOT DISTINCT FROM $2
           AND name_a = $3
           AND name_b = $4`,
        [denied.category, denied.brand, denied.nameA, denied.nameB],
      ));
    }
    await cleanup(() => cleanupTestUsers(db, testUsernames));
    if (failures.length > 0) {
      throw new AggregateError(failures, "One or more merge-alias test fixtures could not be cleaned up.");
    }
    testUsernames.clear();
    testBrands.clear();
    testAliasNames.clear();
    testDeniedPairs.length = 0;
    for (const ids of Object.values(recipeFixtureIds)) ids.length = 0;
  } finally {
    await db.end().catch(() => {});
  }
}

test.afterEach(cleanupFixtures);
test.afterAll(cleanupFixtures);

test("ignoring a recipe-name match stays in its category after reload and preserves aliases", async ({ page }) => {
  const username = uniqueTestId("merge_ignore_recipe");
  const priorName = uniqueTestId("PriorDough");
  const sourceName = uniqueTestId("SourceDough");
  testUsernames.add(username);
  trackAliasNames(priorName, sourceName);
  trackDeniedPair("dough", null, priorName, sourceName);

  await signInAsManager(page, username);
  for (const category of ["dough", "sauce"] as const) {
    await seedRecipeNamePool(page, category, [priorName, sourceName]);
    await seedPreviousAlias(page, category, priorName, sourceName);
  }
  const doughAliases = await getAliases(page, "dough");
  const sauceAliases = await getAliases(page, "sauce");
  let dialog = await reloadAndOpenMergeManager(page);
  await dialog.getByRole("button", { name: "Dough", exact: true }).click();
  await expectPreviouslyMergedSuggestion(dialog, priorName, sourceName);

  const denyResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/denied-merges"
      && response.request().method() === "POST",
  );
  await ignoreSuggestionButton(dialog, priorName, sourceName).click();
  const denyResponse = await denyResponsePromise;
  expect(denyResponse.status()).toBe(200);
  expect(denyResponse.request().postDataJSON()).toEqual({
    pairs: [{ nameA: sourceName, nameB: priorName }],
    category: "dough",
  });
  const [nameA, nameB] = [priorName, sourceName].map((name) => name.toLowerCase()).sort();
  expect(await getDenials(page, "dough")).toContainEqual({ nameA, nameB });
  expect(await getDenials(page, "sauce")).not.toContainEqual({ nameA, nameB });
  await scanDeterministicMatches(dialog);
  await expect(dialog.getByText(`${priorName} → ${sourceName}`, { exact: true })).toHaveCount(0);

  dialog = await reloadAndOpenMergeManager(page);
  await dialog.getByRole("button", { name: "Dough", exact: true }).click();
  await scanDeterministicMatches(dialog);
  await expect(dialog.getByText(`${priorName} → ${sourceName}`, { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Sauce", exact: true }).click();
  await expectPreviouslyMergedSuggestion(dialog, priorName, sourceName);
  expect(await getDenials(page, "dough")).toContainEqual({ nameA, nameB });
  expect(await getDenials(page, "sauce")).not.toContainEqual({ nameA, nameB });
  expect(await getAliases(page, "dough")).toEqual(doughAliases);
  expect(await getAliases(page, "sauce")).toEqual(sauceAliases);
});

test("ignoring a flavor match stays in its brand after reload and preserves the other brand", async ({ page }) => {
  const username = uniqueTestId("merge_ignore_flavor");
  const brand = uniqueTestId("MergeIgnoreBrand");
  const otherBrand = uniqueTestId("MergeIgnoreOtherBrand");
  const priorName = uniqueTestId("PriorFlavor");
  const sourceName = uniqueTestId("SourceFlavor");
  testUsernames.add(username);
  testBrands.add(brand);
  testBrands.add(otherBrand);
  trackAliasNames(priorName);
  trackDeniedPair("flavor", brand, priorName, sourceName);

  await signInAsManager(page, username);
  const factoryDb = new Client({ connectionString: process.env.DATABASE_URL });
  await factoryDb.connect();
  let originalFactoryRows: FactoryRow[] = [];
  let factorySnapshotCaptured = false;
  try {
    const result = await factoryDb.query<FactoryRow>(
      "SELECT key, value FROM factory_kv WHERE scope = 'live' AND key = ANY($1::text[])",
      [TEST_FACTORY_KEYS],
    );
    originalFactoryRows = result.rows;
    factorySnapshotCaptured = true;
    const originalFactory = new Map(originalFactoryRows.map((row) => [row.key, row.value]));
    const originalBrands = (originalFactory.get(FACTORY_BRANDS_KEY) as string[] | undefined) ?? [];
    const originalFlavors =
      (originalFactory.get(FACTORY_FLAVORS_KEY) as Record<string, string[]> | undefined) ?? {};
    for (const [key, value] of [
      [FACTORY_BRANDS_KEY, [...new Set([...originalBrands, brand, otherBrand])]],
      [FACTORY_FLAVORS_KEY, {
        ...originalFlavors,
        [brand]: [priorName, sourceName],
        [otherBrand]: [priorName, sourceName],
      }],
    ] as const) {
      await factoryDb.query(
        `INSERT INTO factory_kv (scope, key, value, updated_at)
         VALUES ('live', $1, $2::jsonb, NOW())
         ON CONFLICT (scope, key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [key, JSON.stringify(value)],
      );
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    for (const scopedBrand of [brand, otherBrand]) {
      const response = await page.request.post("/api/merge-aliases", {
        data: {
          category: "flavor",
          brand: scopedBrand,
          aliases: [{ externalName: priorName, canonicalName: sourceName }],
        },
      });
      expect(response.status()).toBe(200);
    }
    const selectedAliases = await getAliases(page, "flavor", brand);
    const otherAliases = await getAliases(page, "flavor", otherBrand);
    let dialog = await openFlavorMerge(page, brand);
    await expectPreviouslyMergedSuggestion(dialog, priorName, sourceName);
    const denyResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/denied-merges"
        && response.request().method() === "POST",
    );
    await ignoreSuggestionButton(dialog, priorName, sourceName).click();
    const denyResponse = await denyResponsePromise;
    expect(denyResponse.status()).toBe(200);
    expect(denyResponse.request().postDataJSON()).toEqual({
      pairs: [{ nameA: sourceName, nameB: priorName }],
      category: "flavor",
      brand,
    });
    const [nameA, nameB] = [priorName, sourceName].map((name) => name.toLowerCase()).sort();
    expect(await getDenials(page, "flavor", brand)).toEqual([{ nameA, nameB }]);
    expect(await getDenials(page, "flavor", otherBrand)).toEqual([]);
    await scanDeterministicMatches(dialog);
    await expect(dialog.getByText(`${priorName} → ${sourceName}`, { exact: true })).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    dialog = await openFlavorMerge(page, brand);
    await scanDeterministicMatches(dialog);
    await expect(dialog.getByText(`${priorName} → ${sourceName}`, { exact: true })).toHaveCount(0);
    await dialog.locator("select").selectOption(otherBrand);
    await expectPreviouslyMergedSuggestion(dialog, priorName, sourceName);
    expect(await getDenials(page, "flavor", brand)).toEqual([{ nameA, nameB }]);
    expect(await getDenials(page, "flavor", otherBrand)).toEqual([]);
    expect(await getAliases(page, "flavor", brand)).toEqual(selectedAliases);
    expect(await getAliases(page, "flavor", otherBrand)).toEqual(otherAliases);
  } finally {
    try {
      if (factorySnapshotCaptured) {
        await factoryDb.query(
          "DELETE FROM factory_kv WHERE scope = 'live' AND key = ANY($1::text[])",
          [TEST_FACTORY_KEYS],
        );
        for (const row of originalFactoryRows) {
          await factoryDb.query(
            `INSERT INTO factory_kv (scope, key, value, updated_at)
             VALUES ('live', $1, $2::jsonb, NOW() + INTERVAL '5 minutes')
             ON CONFLICT (scope, key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
            [row.key, JSON.stringify(row.value)],
          );
        }
      }
    } finally {
      await factoryDb.end().catch(() => {});
    }
  }
});

test("confirmed flavor merge retargets scoped aliases and a later scan suggests the survivor", async ({ page }, testInfo) => {
  const username = uniqueTestId("merge_alias");
  const brand = uniqueTestId("MergeAliasBrand");
  const otherBrand = uniqueTestId("MergeAliasOtherBrand");
  const previousName = uniqueTestId("PreviousFlavor");
  const sourceName = uniqueTestId("SourceFlavor");
  const survivorName = uniqueTestId("SurvivorFlavor");
  testUsernames.add(username);
  testBrands.add(brand);
  testBrands.add(otherBrand);
  trackAliasNames(previousName, sourceName);

  await signInAsManager(page, username);

  const factoryDb = new Client({ connectionString: process.env.DATABASE_URL });
  await factoryDb.connect();
  let originalFactoryRows: FactoryRow[] = [];
  let factorySnapshotCaptured = false;

  try {
    const originalFactoryResult = await factoryDb.query<FactoryRow>(
      "SELECT key, value FROM factory_kv WHERE scope = 'live' AND key = ANY($1::text[])",
      [TEST_FACTORY_KEYS],
    );
    originalFactoryRows = originalFactoryResult.rows;
    factorySnapshotCaptured = true;
    const originalFactory = new Map(originalFactoryRows.map((row) => [row.key, row.value]));
    const originalBrands =
      (originalFactory.get(FACTORY_BRANDS_KEY) as string[] | undefined) ?? [];
    const originalFlavors =
      (originalFactory.get(FACTORY_FLAVORS_KEY) as Record<string, string[]> | undefined) ?? {};

    const seedFactoryValue = async (key: string, value: unknown) => {
      await factoryDb.query(
        `INSERT INTO factory_kv (scope, key, value, updated_at)
         VALUES ('live', $1, $2::jsonb, NOW())
         ON CONFLICT (scope, key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [key, JSON.stringify(value)],
      );
    };

    await seedFactoryValue(
      FACTORY_BRANDS_KEY,
      [...new Set([...originalBrands, brand, otherBrand])],
    );
    await seedFactoryValue(FACTORY_FLAVORS_KEY, {
      ...originalFlavors,
      [brand]: [sourceName, survivorName],
      [otherBrand]: [previousName, sourceName, survivorName],
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    const firstAliasWrite = await page.request.post("/api/merge-aliases", {
      data: {
        category: "flavor",
        brand,
        aliases: [{ externalName: previousName, canonicalName: sourceName }],
      },
    });
    expect(firstAliasWrite.status()).toBe(200);
    const otherBrandAliasWrite = await page.request.post("/api/merge-aliases", {
      data: {
        category: "flavor",
        brand: otherBrand,
        aliases: [{ externalName: previousName, canonicalName: sourceName }],
      },
    });
    expect(otherBrandAliasWrite.status()).toBe(200);

    const dialog = await openFlavorMerge(page, brand);
    await dialog.getByRole("checkbox", { name: sourceName, exact: true }).check();
    await dialog.locator('input[list="merge-target-options"]').fill(survivorName);
    await dialog.getByRole("button", { name: "Merge…", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("merge-before-confirm.jpg") });
    const aliasWritePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/merge-aliases"
        && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Confirm merge", exact: true }).click();
    const aliasWrite = await aliasWritePromise;
    expect(aliasWrite.status()).toBe(200);

    const selectedBrandAliasesResponse = await page.request.get(
      `/api/merge-aliases?category=flavor&brand=${encodeURIComponent(brand)}`,
      { failOnStatusCode: true },
    );
    const selectedBrandAliases = (await selectedBrandAliasesResponse.json() as {
      aliases: Array<{ externalName: string; canonicalName: string }>;
    }).aliases;
    expect(selectedBrandAliases).toContainEqual({
      externalName: previousName,
      canonicalName: survivorName,
    });
    expect(selectedBrandAliases).toContainEqual({
      externalName: sourceName,
      canonicalName: survivorName,
    });

    const otherBrandAliasesResponse = await page.request.get(
      `/api/merge-aliases?category=flavor&brand=${encodeURIComponent(otherBrand)}`,
      { failOnStatusCode: true },
    );
    expect((await otherBrandAliasesResponse.json() as {
      aliases: Array<{ externalName: string; canonicalName: string }>;
    }).aliases).toContainEqual({
      externalName: previousName,
      canonicalName: sourceName,
    });

    await page.evaluate(({ brandName, previousFlavor, survivor }) => {
      const key = "run-calc-brand-flavors";
      const current = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, string[]>;
      current[brandName] = [...new Set([...(current[brandName] ?? []), previousFlavor, survivor])];
      localStorage.setItem(key, JSON.stringify(current));
    }, { brandName: brand, previousFlavor: previousName, survivor: survivorName });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    const suggestionDialog = await openFlavorMerge(page, brand);
    expect(await getAliases(page, "flavor", brand)).toContainEqual({
      externalName: previousName,
      canonicalName: survivorName,
    });
    expect(await getAliases(page, "flavor", otherBrand)).toContainEqual({
      externalName: previousName,
      canonicalName: sourceName,
    });
    await suggestionDialog.getByRole("button", { name: "Scan deterministic matches", exact: true }).click();
    await expect(
      suggestionDialog.getByText(`${previousName} → ${survivorName}`, { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(suggestionDialog.getByText("Previously merged", { exact: true })).toBeVisible();

    await suggestionDialog.locator("select").selectOption(otherBrand);
    await suggestionDialog.getByRole("button", { name: "Scan deterministic matches", exact: true }).click();
    await expect(
      suggestionDialog.getByText(`${previousName} → ${sourceName}`, { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      suggestionDialog.getByText(`${previousName} → ${survivorName}`, { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("merge-follow-up-suggestion.jpg") });
  } finally {
    try {
      if (factorySnapshotCaptured) {
        await factoryDb.query(
          "DELETE FROM factory_kv WHERE scope = 'live' AND key = ANY($1::text[])",
          [TEST_FACTORY_KEYS],
        );
        for (const row of originalFactoryRows) {
          await factoryDb.query(
            `INSERT INTO factory_kv (scope, key, value, updated_at)
             VALUES ('live', $1, $2::jsonb, NOW() + INTERVAL '5 minutes')
             ON CONFLICT (scope, key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
            [row.key, JSON.stringify(row.value)],
          );
        }
      }
    } finally {
      await factoryDb.end().catch(() => {});
    }
  }
});

test("ingredient confirmation stores ingredient aliases and keeps later scans in scope", async ({ page }) => {
  const username = uniqueTestId("merge_alias_ingredient");
  const previousName = uniqueTestId("PriorIngredient");
  const sourceName = uniqueTestId("SourceIngredient");
  const targetName = uniqueTestId("TargetIngredient");
  testUsernames.add(username);
  trackAliasNames(previousName, sourceName);

  await signInAsManager(page, username);
  await page.evaluate(({ previous, source, target }) => {
    localStorage.setItem(
      "run-calc-ingredient-types",
      JSON.stringify([previous, source, target]),
    );
  }, { previous: previousName, source: sourceName, target: targetName });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await seedPreviousAlias(page, "ingredient", previousName, sourceName);

  const dialog = await openMergeManager(page);
  await dialog.getByRole("button", { name: "Ingredients", exact: true }).click();
  await confirmMerge(page, dialog, sourceName, targetName);

  const aliases = await getAliases(page, "ingredient");
  expect(aliases).toContainEqual({
    externalName: previousName,
    canonicalName: targetName,
  });
  expect(aliases).toContainEqual({
    externalName: sourceName,
    canonicalName: targetName,
  });
  expect(await getAliases(page, "dough")).not.toContainEqual({
    externalName: previousName,
    canonicalName: targetName,
  });

  const reloadedDialog = await reloadAndOpenMergeManager(page);
  await reloadedDialog.getByRole("button", { name: "Ingredients", exact: true }).click();
  expect(await getAliases(page, "ingredient")).toContainEqual({
    externalName: previousName,
    canonicalName: targetName,
  });
  await expectPreviouslyMergedSuggestion(reloadedDialog, previousName, targetName);
  // Recipe names are intentionally excluded from the Ingredients picker. Seed
  // the competing category only after verifying the ingredient reload journey,
  // rather than depending on selecting the ingredient before pools hydrate.
  await seedRecipeNamePool(page, "dough", [previousName, sourceName, targetName]);
  const bootstrapResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/master-data/bootstrap"
      && response.request().method() === "GET",
  );
  const doughDialog = await reloadAndOpenMergeManager(page);
  const bootstrapResponse = await bootstrapResponsePromise;
  expect(bootstrapResponse.status()).toBe(200);
  const bootstrap = await bootstrapResponse.json() as { doughRecipes: Array<{ name: string }> };
  expect(bootstrap.doughRecipes).toEqual(expect.arrayContaining(
    [previousName, sourceName, targetName].map((name) => expect.objectContaining({ name })),
  ));
  await doughDialog.getByRole("button", { name: "Dough", exact: true }).click();
  await expect(doughDialog.getByRole("checkbox", { name: previousName, exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(doughDialog.getByRole("checkbox", { name: targetName, exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expect(await getAliases(page, "dough")).not.toContainEqual({
    externalName: previousName,
    canonicalName: targetName,
  });
  await scanDeterministicMatches(doughDialog);
  await expect(
    doughDialog.getByText(`${previousName} → ${targetName}`, { exact: true }),
  ).toHaveCount(0);
});

test("recipe-name confirmations keep learned aliases isolated to each recipe category", async ({ page }) => {
  const username = uniqueTestId("merge_alias_recipe");
  testUsernames.add(username);
  const nameSets = RECIPE_NAME_CATEGORIES.map(({ category }) => ({
    category,
    previousName: uniqueTestId(`Prior${category}`),
    sourceName: uniqueTestId(`Source${category}`),
    targetName: uniqueTestId(`Target${category}`),
  }));
  for (const names of nameSets) {
    trackAliasNames(names.previousName, names.sourceName);
  }

  await signInAsManager(page, username);
  for (let index = 0; index < RECIPE_NAME_CATEGORIES.length; index += 1) {
    const { category } = RECIPE_NAME_CATEGORIES[index];
    const names = nameSets[index];
    const categoryNames = [names.previousName, names.sourceName, names.targetName];
    await seedRecipeNamePool(page, category, categoryNames);
    await seedRecipeNamePool(
      page,
      RECIPE_ISOLATION_TARGET[category],
      categoryNames,
    );
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  let dialog = await openMergeManager(page);
  for (let index = 0; index < RECIPE_NAME_CATEGORIES.length; index += 1) {
    const scope = RECIPE_NAME_CATEGORIES[index];
    const names = nameSets[index];
    await seedPreviousAlias(page, scope.category, names.previousName, names.sourceName);
    await dialog.getByRole("button", { name: scope.label, exact: true }).click();
    await confirmMerge(page, dialog, names.sourceName, names.targetName);

    const aliases = await getAliases(page, scope.category);
    expect(aliases).toContainEqual({
      externalName: names.previousName,
      canonicalName: names.targetName,
    });
    expect(aliases).toContainEqual({
      externalName: names.sourceName,
      canonicalName: names.targetName,
    });

    const unrelatedScope = RECIPE_NAME_CATEGORIES.find(
      (item) => item.category === RECIPE_ISOLATION_TARGET[scope.category],
    )!;
    expect(await getAliases(page, unrelatedScope.category)).not.toContainEqual({
      externalName: names.previousName,
      canonicalName: names.targetName,
    });
    dialog = await reloadAndOpenMergeManager(page);
    await dialog.getByRole("button", { name: scope.label, exact: true }).click();
    expect(await getAliases(page, scope.category)).toContainEqual({
      externalName: names.previousName,
      canonicalName: names.targetName,
    });
    await expectPreviouslyMergedSuggestion(dialog, names.previousName, names.targetName);
    for (const otherNames of nameSets.filter((candidate) => candidate !== names)) {
      await expect(
        dialog.getByText(`${otherNames.previousName} → ${otherNames.targetName}`, { exact: true }),
      ).toHaveCount(0);
    }

    await dialog.getByRole("button", { name: unrelatedScope.label, exact: true }).click();
    await dialog.getByRole("button", { name: "Scan deterministic matches", exact: true }).click();
    await expect(
      dialog.getByText(`${names.previousName} → ${names.targetName}`, { exact: true }),
    ).toHaveCount(0);
  }
});

test("brand confirmation saves brand aliases without leaking them into ingredient suggestions", async ({ page }) => {
  const username = uniqueTestId("merge_alias_brand");
  const previousName = uniqueTestId("PriorBrand");
  const sourceName = uniqueTestId("SourceBrand");
  const targetName = uniqueTestId("TargetBrand");
  testUsernames.add(username);
  testBrands.add(previousName);
  testBrands.add(sourceName);
  testBrands.add(targetName);
  trackAliasNames(previousName, sourceName);

  await signInAsManager(page, username);
  const factoryDb = new Client({ connectionString: process.env.DATABASE_URL });
  await factoryDb.connect();
  let originalFactoryRows: FactoryRow[] = [];
  let factorySnapshotCaptured = false;

  try {
    const originalFactoryResult = await factoryDb.query<FactoryRow>(
      "SELECT key, value FROM factory_kv WHERE scope = 'live' AND key = ANY($1::text[])",
      [TEST_FACTORY_KEYS],
    );
    originalFactoryRows = originalFactoryResult.rows;
    factorySnapshotCaptured = true;
    const originalFactory = new Map(originalFactoryRows.map((row) => [row.key, row.value]));
    const originalBrands =
      (originalFactory.get(FACTORY_BRANDS_KEY) as string[] | undefined) ?? [];
    const originalFlavors =
      (originalFactory.get(FACTORY_FLAVORS_KEY) as Record<string, string[]> | undefined) ?? {};
    const seedFactoryValue = async (key: string, value: unknown) => {
      await factoryDb.query(
        `INSERT INTO factory_kv (scope, key, value, updated_at)
         VALUES ('live', $1, $2::jsonb, NOW())
         ON CONFLICT (scope, key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [key, JSON.stringify(value)],
      );
    };

    await seedFactoryValue(
      FACTORY_BRANDS_KEY,
      [...new Set([...originalBrands, previousName, sourceName, targetName])],
    );
    await seedFactoryValue(FACTORY_FLAVORS_KEY, {
      ...originalFlavors,
      [previousName]: [],
      [sourceName]: [],
      [targetName]: [],
    });
    await page.evaluate(({ previous, source, target }) => {
      localStorage.setItem(
        "run-calc-ingredient-types",
        JSON.stringify([previous, source, target]),
      );
    }, { previous: previousName, source: sourceName, target: targetName });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await seedPreviousAlias(page, "brand", previousName, sourceName);

    const dialog = await openMergeManager(page);
    await dialog.getByRole("button", { name: "Brand/Flavor", exact: true }).click();
    await dialog.getByRole("button", { name: "Brands", exact: true }).click();
    await confirmMerge(page, dialog, sourceName, targetName);

    const aliases = await getAliases(page, "brand");
    expect(aliases).toContainEqual({
      externalName: previousName,
      canonicalName: targetName,
    });
    expect(aliases).toContainEqual({
      externalName: sourceName,
      canonicalName: targetName,
    });
    expect(await getAliases(page, "ingredient")).not.toContainEqual({
      externalName: previousName,
      canonicalName: targetName,
    });
    const reloadedDialog = await reloadAndOpenMergeManager(page);
    expect(await getAliases(page, "brand")).toContainEqual({
      externalName: previousName,
      canonicalName: targetName,
    });
    expect(await getAliases(page, "brand")).toContainEqual({
      externalName: sourceName,
      canonicalName: targetName,
    });
    await reloadedDialog.getByRole("button", { name: "Brand/Flavor", exact: true }).click();
    await reloadedDialog.getByRole("button", { name: "Brands", exact: true }).click();
    await expectPreviouslyMergedSuggestion(reloadedDialog, previousName, targetName);

    await reloadedDialog.getByRole("button", { name: "Ingredients", exact: true }).click();
    await reloadedDialog.getByRole("button", { name: "Scan deterministic matches", exact: true }).click();
    await expect(
      reloadedDialog.getByText(`${previousName} → ${targetName}`, { exact: true }),
    ).toHaveCount(0);
  } finally {
    try {
      if (factorySnapshotCaptured) {
        await factoryDb.query(
          "DELETE FROM factory_kv WHERE scope = 'live' AND key = ANY($1::text[])",
          [TEST_FACTORY_KEYS],
        );
        for (const row of originalFactoryRows) {
          await factoryDb.query(
            `INSERT INTO factory_kv (scope, key, value, updated_at)
             VALUES ('live', $1, $2::jsonb, NOW() + INTERVAL '5 minutes')
             ON CONFLICT (scope, key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
            [row.key, JSON.stringify(row.value)],
          );
        }
      }
    } finally {
      await factoryDb.end().catch(() => {});
    }
  }
});

test("learned aliases are available to a different manager after sign-in", async ({ page, browser }) => {
  const managerA = uniqueTestId("merge_alias_writer");
  const managerB = uniqueTestId("merge_alias_reader");
  const ingredient = {
    previous: uniqueTestId("PriorIngredient"),
    source: uniqueTestId("SourceIngredient"),
    target: uniqueTestId("TargetIngredient"),
  };
  const recipe = {
    previous: uniqueTestId("PriorDough"),
    source: uniqueTestId("SourceDough"),
    target: uniqueTestId("TargetDough"),
  };
  const flavor = {
    previous: uniqueTestId("PriorFlavor"),
    source: uniqueTestId("SourceFlavor"),
    target: uniqueTestId("TargetFlavor"),
  };
  const brand = uniqueTestId("MergeAliasBrand");
  const otherBrand = uniqueTestId("MergeAliasOtherBrand");

  testUsernames.add(managerA);
  testUsernames.add(managerB);
  testBrands.add(brand);
  testBrands.add(otherBrand);
  trackAliasNames(
    ingredient.previous,
    ingredient.source,
    recipe.previous,
    recipe.source,
    flavor.previous,
    flavor.source,
  );

  let managerBSetupContext: BrowserContext | undefined;
  let managerBContext: BrowserContext | undefined;
  try {
    await signInAsManager(page, managerA);
    await seedRecipeNamePool(page, "dough", [
      recipe.previous,
      recipe.source,
      recipe.target,
    ]);
    await seedPreviousAlias(page, "ingredient", ingredient.previous, ingredient.source);
    await seedPreviousAlias(page, "dough", recipe.previous, recipe.source);
    await seedPreviousAlias(page, "flavor", flavor.previous, flavor.source, brand);
    await seedLocalMergeUniverse(page, {
      ingredientNames: [ingredient.previous, ingredient.source, ingredient.target],
      brands: [brand, otherBrand],
      flavorsByBrand: {
        [brand]: [flavor.previous, flavor.source, flavor.target],
        [otherBrand]: [flavor.previous, flavor.source, flavor.target],
      },
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    let managerADialog = await openMergeManager(page);
    await managerADialog.getByRole("button", { name: "Ingredients", exact: true }).click();
    await confirmMerge(page, managerADialog, ingredient.source, ingredient.target);
    expect(await getAliases(page, "ingredient")).toContainEqual({
      externalName: ingredient.previous,
      canonicalName: ingredient.target,
    });

    managerADialog = await reloadAndOpenMergeManager(page);
    await managerADialog.getByRole("button", { name: "Dough", exact: true }).click();
    await confirmMerge(page, managerADialog, recipe.source, recipe.target);
    expect(await getAliases(page, "dough")).toContainEqual({
      externalName: recipe.previous,
      canonicalName: recipe.target,
    });

    managerADialog = await reloadAndOpenMergeManager(page);
    await managerADialog.getByRole("button", { name: "Brand/Flavor", exact: true }).click();
    await managerADialog.getByRole("button", { name: "Flavors", exact: true }).click();
    await managerADialog.locator("select").selectOption(brand);
    await confirmMerge(page, managerADialog, flavor.source, flavor.target);
    expect(await getAliases(page, "flavor", brand)).toContainEqual({
      externalName: flavor.previous,
      canonicalName: flavor.target,
    });
    expect(await getAliases(page, "flavor", otherBrand)).not.toContainEqual({
      externalName: flavor.previous,
      canonicalName: flavor.target,
    });

    // Provision manager B in a setup context, then discard it. The reader signs
    // in from an independent context with no access to manager A's localStorage.
    managerBSetupContext = await browser.newContext();
    const setupPage = await managerBSetupContext.newPage();
    await signInAsManager(setupPage, managerB);
    await managerBSetupContext.close();
    managerBSetupContext = undefined;

    managerBContext = await browser.newContext();
    const readerPage = await managerBContext.newPage();
    await readerPage.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await seedLocalMergeUniverse(readerPage, {
      // The merged-away names are intentionally absent, while the older alias
      // names remain. This verifies that the retargeted aliases are usable
      // after the direct merge source has left the manager's name universe.
      ingredientNames: [ingredient.previous, ingredient.target],
      brands: [brand, otherBrand],
      flavorsByBrand: {
        [brand]: [flavor.previous, flavor.target],
        [otherBrand]: [flavor.previous, flavor.target],
      },
    });
    await signInExistingManager(readerPage, managerB);

    // The aliases are read by manager B from the authenticated server endpoint;
    // other categories and the other flavor brand must remain isolated.
    expect(await getAliases(readerPage, "ingredient")).toContainEqual({
      externalName: ingredient.previous,
      canonicalName: ingredient.target,
    });
    expect(await getAliases(readerPage, "ingredient")).toContainEqual({
      externalName: ingredient.source,
      canonicalName: ingredient.target,
    });
    expect(await getAliases(readerPage, "dough")).toContainEqual({
      externalName: recipe.previous,
      canonicalName: recipe.target,
    });
    expect(await getAliases(readerPage, "dough")).toContainEqual({
      externalName: recipe.source,
      canonicalName: recipe.target,
    });
    expect(await getAliases(readerPage, "flavor", brand)).toContainEqual({
      externalName: flavor.previous,
      canonicalName: flavor.target,
    });
    expect(await getAliases(readerPage, "flavor", brand)).toContainEqual({
      externalName: flavor.source,
      canonicalName: flavor.target,
    });
    expect(await getAliases(readerPage, "dough")).not.toContainEqual({
      externalName: ingredient.previous,
      canonicalName: ingredient.target,
    });
    expect(await getAliases(readerPage, "ingredient")).not.toContainEqual({
      externalName: recipe.previous,
      canonicalName: recipe.target,
    });
    expect(await getAliases(readerPage, "flavor", otherBrand)).not.toContainEqual({
      externalName: flavor.previous,
      canonicalName: flavor.target,
    });

    let readerDialog = await openMergeManager(readerPage);
    await readerDialog.getByRole("button", { name: "Ingredients", exact: true }).click();
    await expectPreviouslyMergedSuggestion(
      readerDialog,
      ingredient.previous,
      ingredient.target,
    );

    // Put each alias pair into a different recipe category as well. This makes
    // the UI's negative assertions prove scope filtering, not just missing names.
    await seedRecipeNamePool(readerPage, "dough", [ingredient.previous, ingredient.target]);
    await seedRecipeNamePool(readerPage, "sauce", [recipe.previous, recipe.target]);
    readerDialog = await reloadAndOpenMergeManager(readerPage);
    await readerDialog.getByRole("button", { name: "Dough", exact: true }).click();
    await expectPreviouslyMergedSuggestion(readerDialog, recipe.previous, recipe.target);
    await scanDeterministicMatches(readerDialog);
    await expect(suggestionForAliasPair(
      readerDialog,
      ingredient.previous,
      ingredient.target,
    )).toHaveCount(0);

    await readerDialog.getByRole("button", { name: "Sauce", exact: true }).click();
    await scanDeterministicMatches(readerDialog);
    await expect(suggestionForAliasPair(
      readerDialog,
      recipe.previous,
      recipe.target,
    )).toHaveCount(0);

    await readerDialog.getByRole("button", { name: "Brand/Flavor", exact: true }).click();
    await readerDialog.getByRole("button", { name: "Flavors", exact: true }).click();
    await readerDialog.locator("select").selectOption(brand);
    await expectPreviouslyMergedSuggestion(readerDialog, flavor.previous, flavor.target);
    await readerDialog.locator("select").selectOption(otherBrand);
    await scanDeterministicMatches(readerDialog);
    await expect(suggestionForAliasPair(
      readerDialog,
      flavor.previous,
      flavor.target,
    )).toHaveCount(0);
  } finally {
    await managerBContext?.close().catch(() => {});
    await managerBSetupContext?.close().catch(() => {});
  }
});
