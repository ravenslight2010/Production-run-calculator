import { expect, test, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "IgnoredMatchFilterTest123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();
const testBrands = new Set<string>();
const testAliasNames = new Set<string>();
const testRecipeIds = new Set<string>();
const testDeniedPairs: Array<{
  category: string;
  brand: string | null;
  nameA: string;
  nameB: string;
}> = [];

const FACTORY_BRANDS_KEY = "run-calc-brands";
const FACTORY_FLAVORS_KEY = "run-calc-brand-flavors";
const FACTORY_KEYS = [FACTORY_BRANDS_KEY, FACTORY_FLAVORS_KEY];

type FactoryRow = { key: string; value: unknown };

function canonicalPair(a: string, b: string) {
  const [nameA, nameB] = [a.trim().toLowerCase(), b.trim().toLowerCase()].sort();
  return { nameA, nameB };
}

function ignoredPairRow(panel: Locator, firstName: string, secondName: string): Locator {
  const { nameA, nameB } = canonicalPair(firstName, secondName);
  return panel.getByRole("listitem").filter({
    hasText: `${nameA} ↔ ${nameB}`,
  });
}

function trackDeniedPair(category: string, brand: string | null, a: string, b: string): void {
  const { nameA, nameB } = canonicalPair(a, b);
  testDeniedPairs.push({ category, brand, nameA, nameB });
}

async function signInAsManager(page: Page, username: string): Promise<void> {
  if (!SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for ignored-match browser tests.");
  }
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

async function seedDoughNames(page: Page, names: string[]): Promise<void> {
  const items = names.map((name) => {
    const id = uniqueTestId("ignoredFilterDough");
    testRecipeIds.add(id);
    return { id, name, notes: "", components: [], enabled: true, brand: "", flavors: [] };
  });
  const response = await page.request.post("/api/dough-recipes", { data: { items } });
  expect(response.status(), "seed disposable dough recipe names").toBe(200);
}

async function seedAliases(
  page: Page,
  category: string,
  firstName: string,
  secondName: string,
  brand?: string,
): Promise<void> {
  testAliasNames.add(firstName);
  const response = await page.request.post("/api/merge-aliases", {
    data: {
      category,
      ...(category === "flavor" && brand ? { brand } : {}),
      aliases: [{ externalName: firstName, canonicalName: secondName }],
    },
  });
  expect(response.status(), `seed ${category} alias`).toBe(200);
}

async function seedDenials(
  page: Page,
  category: string,
  pairs: Array<{ nameA: string; nameB: string }>,
  brand?: string,
): Promise<void> {
  for (const pair of pairs) {
    trackDeniedPair(category, brand ?? null, pair.nameA, pair.nameB);
  }
  const response = await page.request.post("/api/denied-merges", {
    data: { pairs, category, ...(category === "flavor" && brand ? { brand } : {}) },
  });
  expect(response.status(), `seed ${category} ignored matches`).toBe(200);
}

async function openMergeManager(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Tools", exact: true }).click();
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  return dialog;
}

async function openIgnoredPanel(dialog: Locator): Promise<Locator> {
  const panel = dialog.getByTestId("ignored-merge-matches");
  const toggle = panel.getByRole("button", { name: /^Previously ignored matches/ });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  return panel;
}

async function restoreIgnoredMatch(
  page: Page,
  panel: Locator,
  firstName: string,
  secondName: string,
  category: string,
  brand?: string,
): Promise<void> {
  const { nameA, nameB } = canonicalPair(firstName, secondName);
  const row = panel.getByRole("listitem").filter({
    hasText: `${nameA} ↔ ${nameB}`,
  });
  await expect(row).toBeVisible();
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/denied-merges"
      && response.request().method() === "DELETE",
  );
  await row.getByRole("button", {
    name: `Restore ignored match ${nameA} and ${nameB}`,
    exact: true,
  }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({
    pairs: [{ nameA, nameB }],
    category,
    ...(category === "flavor" && brand ? { brand } : {}),
  });
  await expect(row).toHaveCount(0);
}

test.beforeEach(() => {
  requireIsolatedTestDatabase("ignored-match filter browser beforeEach");
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
         WHERE scope = 'live' AND external_name = ANY($1::text[])`,
        [[...testAliasNames]],
      ));
    }
    if (testRecipeIds.size > 0) {
      await cleanup(() => db.query(
        "DELETE FROM dough_recipes WHERE scope = 'live' AND id = ANY($1::text[])",
        [[...testRecipeIds]],
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
         WHERE scope = 'live' AND category = $1
           AND brand IS NOT DISTINCT FROM $2
           AND name_a = $3 AND name_b = $4`,
        [denied.category, denied.brand, denied.nameA, denied.nameB],
      ));
    }
    await cleanup(() => cleanupTestUsers(db, testUsernames));
    if (failures.length > 0) {
      throw new AggregateError(failures, "Ignored-match fixtures could not all be cleaned up.");
    }
    testUsernames.clear();
    testBrands.clear();
    testAliasNames.clear();
    testRecipeIds.clear();
    testDeniedPairs.length = 0;
  } finally {
    await db.end().catch(() => {});
  }
}

test.afterEach(cleanupFixtures);
test.afterAll(cleanupFixtures);

test("ignored-match search stays within category and brand and restores a filtered pair", async ({ page }) => {
  const username = uniqueTestId("ignored_filter_manager");
  const brand = uniqueTestId("IgnoredFilterBrand");
  const otherBrand = uniqueTestId("IgnoredFilterOtherBrand");
  const firstDough = uniqueTestId("FirstDoughSearch");
  const secondDough = uniqueTestId("SecondDoughSearch");
  const otherDoughFirst = uniqueTestId("OtherDoughSearch");
  const otherDoughSecond = uniqueTestId("OtherDoughMatch");
  const sauceFirst = uniqueTestId("SauceOnlySearch");
  const sauceSecond = uniqueTestId("SauceOnlyMatch");
  const firstFlavor = uniqueTestId("FlavorSearchFirst");
  const secondFlavor = uniqueTestId("FlavorSearchSecond");
  const otherFlavorFirst = uniqueTestId("OtherFlavorSearch");
  const otherFlavorSecond = uniqueTestId("OtherFlavorMatch");
  const brandOnlyFirst = uniqueTestId("BrandOnlySearch");
  const brandOnlySecond = uniqueTestId("BrandOnlyMatch");

  testUsernames.add(username);
  testBrands.add(brand);
  testBrands.add(otherBrand);

  const factoryDb = new Client({ connectionString: process.env.DATABASE_URL });
  await factoryDb.connect();
  let factorySnapshot: FactoryRow[] = [];
  let factorySnapshotCaptured = false;

  try {
    const original = await factoryDb.query<FactoryRow>(
      "SELECT key, value FROM factory_kv WHERE scope = 'live' AND key = ANY($1::text[])",
      [FACTORY_KEYS],
    );
    factorySnapshot = original.rows;
    factorySnapshotCaptured = true;
    const originalValues = new Map(factorySnapshot.map((row) => [row.key, row.value]));
    const brands = (originalValues.get(FACTORY_BRANDS_KEY) as string[] | undefined) ?? [];
    const flavors = (originalValues.get(FACTORY_FLAVORS_KEY) as Record<string, string[]> | undefined) ?? {};
    for (const [key, value] of [
      [FACTORY_BRANDS_KEY, [...new Set([...brands, brand, otherBrand])]],
      [FACTORY_FLAVORS_KEY, {
        ...flavors,
        [brand]: [firstFlavor, secondFlavor, brandOnlyFirst, brandOnlySecond],
        [otherBrand]: [firstFlavor, secondFlavor, otherFlavorFirst, otherFlavorSecond],
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

    await signInAsManager(page, username);
    await seedDoughNames(page, [firstDough, secondDough, otherDoughFirst, otherDoughSecond]);
    await seedAliases(page, "dough", firstDough, secondDough);
    await seedDenials(page, "dough", [
      { nameA: firstDough, nameB: secondDough },
      { nameA: otherDoughFirst, nameB: otherDoughSecond },
    ]);
    await seedDenials(page, "sauce", [
      { nameA: sauceFirst, nameB: sauceSecond },
    ]);
    await seedDenials(page, "flavor", [
      { nameA: firstFlavor, nameB: secondFlavor },
      { nameA: brandOnlyFirst, nameB: brandOnlySecond },
    ], brand);
    await seedDenials(page, "flavor", [
      { nameA: firstFlavor, nameB: secondFlavor },
      { nameA: otherFlavorFirst, nameB: otherFlavorSecond },
    ], otherBrand);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    const dialog = await openMergeManager(page);
    await dialog.getByRole("button", { name: "Dough", exact: true }).click();
    const panel = await openIgnoredPanel(dialog);
    const search = panel.getByRole("searchbox", {
      name: "Filter ignored matches by recipe name",
    });
    await expect(search).toBeVisible();

    const firstSearchFragment = firstDough.slice(0, 8).toUpperCase();
    await search.fill(firstSearchFragment);
    await expect(panel.getByRole("listitem")).toHaveCount(1);
    await expect(ignoredPairRow(panel, firstDough, secondDough)).toBeVisible();
    await expect(ignoredPairRow(panel, otherDoughFirst, otherDoughSecond)).toHaveCount(0);

    await panel.getByRole("button", { name: "Clear filter", exact: true }).click();
    await expect(panel.getByRole("listitem")).toHaveCount(2);
    await search.fill(secondDough.slice(0, 9).toUpperCase());
    await expect(panel.getByRole("listitem")).toHaveCount(1);
    await expect(ignoredPairRow(panel, firstDough, secondDough)).toBeVisible();

    await search.fill("no-match");
    await expect(panel.getByText(/No ignored matches contain/)).toBeVisible();
    await expect(panel.getByRole("listitem")).toHaveCount(0);
    await panel.getByRole("button", { name: "Clear filter", exact: true }).click();
    await expect(panel.getByRole("listitem")).toHaveCount(2);

    await dialog.getByRole("button", { name: "Sauce", exact: true }).click();
    await expect(panel.getByRole("listitem")).toHaveCount(1);
    await expect(ignoredPairRow(panel, sauceFirst, sauceSecond)).toBeVisible();
    await expect(ignoredPairRow(panel, firstDough, secondDough)).toHaveCount(0);
    await expect(search).toHaveValue("");

    await dialog.getByRole("button", { name: "Dough", exact: true }).click();
    await expect(panel.getByRole("listitem")).toHaveCount(2);
    await search.fill(firstSearchFragment);
    await restoreIgnoredMatch(page, panel, firstDough, secondDough, "dough");
    await expect(panel.getByText(/No ignored matches contain/)).toBeVisible();
    await panel.getByRole("button", { name: "Clear filter", exact: true }).click();
    await expect(panel.getByRole("listitem")).toHaveCount(1);
    await expect(ignoredPairRow(panel, otherDoughFirst, otherDoughSecond)).toBeVisible();

    await dialog.getByRole("button", { name: "Scan deterministic matches", exact: true }).click();
    await expect(dialog.getByText(`${firstDough} → ${secondDough}`, { exact: true }))
      .toBeVisible({ timeout: 15_000 });

    await dialog.getByRole("button", { name: "Brand/Flavor", exact: true }).click();
    await dialog.getByRole("button", { name: "Flavors", exact: true }).click();
    const brandSelect = dialog.locator("select");
    await brandSelect.selectOption(brand);
    await expect(panel.getByRole("listitem")).toHaveCount(2);
    await expect(ignoredPairRow(panel, firstFlavor, secondFlavor)).toBeVisible();
    await expect(ignoredPairRow(panel, brandOnlyFirst, brandOnlySecond)).toBeVisible();
    await expect(ignoredPairRow(panel, otherFlavorFirst, otherFlavorSecond)).toHaveCount(0);
    await search.fill(firstFlavor.slice(0, 8).toUpperCase());
    await expect(panel.getByRole("listitem")).toHaveCount(1);
    await expect(ignoredPairRow(panel, firstFlavor, secondFlavor)).toBeVisible();

    await brandSelect.selectOption(otherBrand);
    await expect(panel.getByRole("listitem")).toHaveCount(2);
    await expect(ignoredPairRow(panel, firstFlavor, secondFlavor)).toBeVisible();
    await expect(ignoredPairRow(panel, otherFlavorFirst, otherFlavorSecond)).toBeVisible();
    await expect(ignoredPairRow(panel, brandOnlyFirst, brandOnlySecond)).toHaveCount(0);
    await expect(search).toHaveValue("");
  } finally {
    try {
      if (factorySnapshotCaptured) {
        await factoryDb.query(
          "DELETE FROM factory_kv WHERE scope = 'live' AND key = ANY($1::text[])",
          [FACTORY_KEYS],
        );
        for (const row of factorySnapshot) {
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

