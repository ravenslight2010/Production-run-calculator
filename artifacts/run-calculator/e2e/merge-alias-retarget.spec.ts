import { expect, test, type Locator, type Page } from "@playwright/test";
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
): Promise<void> {
  const response = await page.request.post("/api/merge-aliases", {
    data: {
      category,
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

async function getAliases(page: Page, category: string) {
  const response = await page.request.get(
    `/api/merge-aliases?category=${encodeURIComponent(category)}`,
    { failOnStatusCode: true },
  );
  return (await response.json() as {
    aliases: Array<{ externalName: string; canonicalName: string }>;
  }).aliases;
}

async function expectPreviouslyMergedSuggestion(
  dialog: Locator,
  previousName: string,
  targetName: string,
): Promise<void> {
  await dialog.getByRole("button", { name: "Scan deterministic matches", exact: true }).click();
  await expect(
    dialog.getByText(`${previousName} → ${targetName}`, { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("Previously merged", { exact: true })).toBeVisible();
}

test.beforeEach(() => {
  requireIsolatedTestDatabase("merge alias retarget browser beforeEach");
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    if (testAliasNames.size > 0) {
      await db.query(
        `DELETE FROM merge_aliases
         WHERE scope = 'live'
           AND external_name = ANY($1::text[])`,
        [[...testAliasNames]],
      );
    }
    for (const [category, table] of [
      ["mixes", "mixes"],
      ["dough", "dough_recipes"],
      ["sauce", "sauce_recipes"],
      ["cheese", "cheese_recipes"],
    ] as const) {
      if (recipeFixtureIds[category].length === 0) continue;
      await db.query(
        `DELETE FROM ${table} WHERE scope = 'live' AND id = ANY($1::text[])`,
        [recipeFixtureIds[category]],
      );
    }
    if (testBrands.size > 0) {
      await db.query(
        "DELETE FROM merge_aliases WHERE scope = 'live' AND category = 'flavor' AND brand = ANY($1::text[])",
        [[...testBrands]],
      );
    }
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
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
      [otherBrand]: [sourceName, survivorName],
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
    await suggestionDialog.getByRole("button", { name: "Scan deterministic matches", exact: true }).click();
    await expect(
      suggestionDialog.getByText(`${previousName} → ${survivorName}`, { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(suggestionDialog.getByText("Previously merged", { exact: true })).toBeVisible();
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
  await expectPreviouslyMergedSuggestion(dialog, previousName, targetName);
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

  const dialog = await openMergeManager(page);
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
    await expectPreviouslyMergedSuggestion(dialog, previousName, targetName);

    await dialog.getByRole("button", { name: "Ingredients", exact: true }).click();
    await dialog.getByRole("button", { name: "Scan deterministic matches", exact: true }).click();
    await expect(
      dialog.getByText(`${previousName} → ${targetName}`, { exact: true }),
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
