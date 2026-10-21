import { expect, test, type Page } from "@playwright/test";
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

type FactoryRow = { key: string; value: unknown };

const FACTORY_BRANDS_KEY = "run-calc-brands";
const FACTORY_FLAVORS_KEY = "run-calc-brand-flavors";
const TEST_FACTORY_KEYS = [FACTORY_BRANDS_KEY, FACTORY_FLAVORS_KEY];

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

async function openFlavorMerge(page: Page, brand: string) {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Tools", exact: true }).click();
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  await dialog.getByRole("button", { name: "Brand/Flavor", exact: true }).click();
  await dialog.getByRole("button", { name: "Flavors", exact: true }).click();
  await dialog.locator("select").selectOption(brand);
  return dialog;
}

test.beforeEach(() => {
  requireIsolatedTestDatabase("merge alias retarget browser beforeEach");
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
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
