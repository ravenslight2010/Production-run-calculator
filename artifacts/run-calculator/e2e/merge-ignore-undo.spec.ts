import { expect, test, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "MergeIgnoreUndoTest123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const usernames = new Set<string>();
const brands = new Set<string>();
const aliasNames = new Set<string>();
const deniedPairs: Array<{
  category: string;
  brand: string | null;
  nameA: string;
  nameB: string;
}> = [];

const BRANDS_KEY = "run-calc-brands";
const FLAVORS_KEY = "run-calc-brand-flavors";

async function signInAsManager(page: Page, username: string): Promise<void> {
  if (!SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for merge-ignore-undo browser tests.");
  }
  await signUpAndHandleOnboarding(page, username, PASSWORD, { signupCode: SIGNUP_CODE });

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

async function openFlavorMerge(page: Page, brand: string): Promise<Locator> {
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

async function scanMatches(dialog: Locator): Promise<void> {
  const scan = dialog.getByRole("button", { name: "Scan deterministic matches", exact: true });
  await scan.click();
  await expect(scan).toBeEnabled({ timeout: 15_000 });
}

function canonicalPair(a: string, b: string) {
  const [nameA, nameB] = [a.trim().toLowerCase(), b.trim().toLowerCase()].sort();
  return { nameA, nameB };
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

async function getAliases(page: Page, brand: string) {
  const query = new URLSearchParams({ category: "flavor", brand });
  const response = await page.request.get(`/api/merge-aliases?${query.toString()}`, {
    failOnStatusCode: true,
  });
  return (await response.json() as {
    aliases: Array<{ externalName: string; canonicalName: string }>;
  }).aliases;
}

async function cleanupFixtures(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    if (aliasNames.size > 0) {
      await db.query(
        `DELETE FROM merge_aliases
         WHERE scope = 'live'
           AND category = 'flavor'
           AND external_name = ANY($1::text[])`,
        [[...aliasNames]],
      );
    }
    for (const pair of deniedPairs) {
      await db.query(
        `DELETE FROM denied_merges
         WHERE scope = 'live'
           AND category = $1
           AND brand IS NOT DISTINCT FROM $2
           AND name_a = $3
           AND name_b = $4`,
        [pair.category, pair.brand, pair.nameA, pair.nameB],
      );
    }
    await cleanupTestUsers(db, usernames);
    usernames.clear();
    brands.clear();
    aliasNames.clear();
    deniedPairs.length = 0;
  } finally {
    await db.end().catch(() => {});
  }
}

test.beforeEach(() => {
  requireIsolatedTestDatabase("merge ignore undo browser beforeEach");
});
test.afterEach(cleanupFixtures);
test.afterAll(cleanupFixtures);

test("manager can undo a flavor ignore without changing other scopes or aliases", async ({ page }) => {
  const username = uniqueTestId("merge_ignore_undo");
  const brand = uniqueTestId("MergeUndoBrand");
  const otherBrand = uniqueTestId("MergeUndoOtherBrand");
  const previousName = uniqueTestId("PriorFlavor");
  const sourceName = uniqueTestId("SourceFlavor");
  const pair = canonicalPair(previousName, sourceName);
  usernames.add(username);
  brands.add(brand);
  brands.add(otherBrand);
  aliasNames.add(previousName);
  deniedPairs.push(
    { category: "flavor", brand, ...pair },
    { category: "flavor", brand: otherBrand, ...pair },
    { category: "dough", brand: null, ...pair },
  );

  await signInAsManager(page, username);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  let originalFactoryRows: Array<{ key: string; value: unknown }> = [];
  let factorySnapshotCaptured = false;
  try {
    await db.connect();
    const original = await db.query<{ key: string; value: unknown }>(
      "SELECT key, value FROM factory_kv WHERE scope = 'live' AND key = ANY($1::text[])",
      [[BRANDS_KEY, FLAVORS_KEY]],
    );
    originalFactoryRows = original.rows;
    factorySnapshotCaptured = true;
    const values = new Map(original.rows.map((row) => [row.key, row.value]));
    const currentBrands = (values.get(BRANDS_KEY) as string[] | undefined) ?? [];
    const currentFlavors =
      (values.get(FLAVORS_KEY) as Record<string, string[]> | undefined) ?? {};
    const seed = async (key: string, value: unknown) => {
      await db.query(
        `INSERT INTO factory_kv (scope, key, value, updated_at)
         VALUES ('live', $1, $2::jsonb, NOW())
         ON CONFLICT (scope, key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [key, JSON.stringify(value)],
      );
    };
    await seed(BRANDS_KEY, [...new Set([...currentBrands, brand, otherBrand])]);
    await seed(FLAVORS_KEY, {
      ...currentFlavors,
      [brand]: [previousName, sourceName],
      [otherBrand]: [previousName, sourceName],
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    for (const scopedBrand of [brand, otherBrand]) {
      const response = await page.request.post("/api/merge-aliases", {
        data: {
          category: "flavor",
          brand: scopedBrand,
          aliases: [{ externalName: previousName, canonicalName: sourceName }],
        },
      });
      expect(response.status()).toBe(200);
    }
    for (const [category, scopedBrand] of [
      ["flavor", otherBrand],
      ["dough", undefined],
    ] as const) {
      const response = await page.request.post("/api/denied-merges", {
        data: { pairs: [pair], category, ...(scopedBrand ? { brand: scopedBrand } : {}) },
      });
      expect(response.status()).toBe(200);
    }

    const dialog = await openFlavorMerge(page, brand);
    await scanMatches(dialog);
    await expect(dialog.getByText(`${previousName} → ${sourceName}`, { exact: true })).toBeVisible();

    const ignoreResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/denied-merges"
        && response.request().method() === "POST",
    );
    await dialog
      .getByText(`${previousName} → ${sourceName}`, { exact: true })
      .locator("xpath=../..")
      .getByRole("button", { name: "Ignore", exact: true })
      .click();
    const ignoreResponse = await ignoreResponsePromise;
    expect(ignoreResponse.status()).toBe(200);
    expect(ignoreResponse.request().postDataJSON()).toEqual({
      pairs: [{ nameA: sourceName, nameB: previousName }],
      category: "flavor",
      brand,
    });

    const undoButton = dialog.getByRole("button", {
      name: `Undo ignore ${sourceName} and ${previousName}`,
      exact: true,
    });
    await expect(undoButton).toBeVisible();
    let rejectUndoOnce = true;
    await page.route("**/api/denied-merges", async (route) => {
      if (route.request().method() === "DELETE" && rejectUndoOnce) {
        rejectUndoOnce = false;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Test restore failure" }),
        });
        return;
      }
      await route.continue();
    });
    const undoResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/denied-merges"
        && response.request().method() === "DELETE",
    );
    await undoButton.click();
    expect((await undoResponsePromise).status()).toBe(500);
    await expect(dialog.getByRole("alert")).toContainText("Couldn't undo this ignore. Please retry.");
    await expect(undoButton).toBeEnabled();
    const retryUndoResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/denied-merges"
        && response.request().method() === "DELETE",
    );
    await undoButton.click();
    const undoResponse = await retryUndoResponsePromise;
    expect(undoResponse.status()).toBe(200);
    expect(undoResponse.request().postDataJSON()).toEqual({
      pairs: [{ nameA: sourceName, nameB: previousName }],
      category: "flavor",
      brand,
    });
    await expect(dialog.getByText(
      "Ignore undone. Scan again to see this match in suggestions.",
      { exact: true },
    )).toBeVisible();

    expect(await getDenials(page, "flavor", brand)).not.toContainEqual(pair);
    expect(await getDenials(page, "flavor", otherBrand)).toContainEqual(pair);
    expect(await getDenials(page, "dough")).toContainEqual(pair);
    expect(await getAliases(page, brand)).toContainEqual({
      externalName: previousName,
      canonicalName: sourceName,
    });
    expect(await getAliases(page, otherBrand)).toContainEqual({
      externalName: previousName,
      canonicalName: sourceName,
    });

    await scanMatches(dialog);
    await expect(dialog.getByText(`${previousName} → ${sourceName}`, { exact: true })).toBeVisible();
    await dialog.locator("select").selectOption(otherBrand);
    await scanMatches(dialog);
    await expect(dialog.getByText(`${previousName} → ${sourceName}`, { exact: true })).toHaveCount(0);

    await dialog.locator("select").selectOption(brand);
    await scanMatches(dialog);
    await expect(dialog.getByText(`${previousName} → ${sourceName}`, { exact: true })).toBeVisible();
    let rejectIgnoreOnce = true;
    await page.route("**/api/denied-merges", async (route) => {
      if (route.request().method() === "POST" && rejectIgnoreOnce) {
        rejectIgnoreOnce = false;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Test ignore failure" }),
        });
        return;
      }
      await route.continue();
    });
    const ignoreFailurePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/denied-merges"
        && response.request().method() === "POST",
    );
    await dialog
      .getByText(`${previousName} → ${sourceName}`, { exact: true })
      .locator("xpath=../..")
      .getByRole("button", { name: "Ignore", exact: true })
      .click();
    expect((await ignoreFailurePromise).status()).toBe(500);
    await expect(dialog.getByRole("alert")).toContainText(
      "Couldn't save this ignore. It may appear again on a later scan.",
    );
    await expect(dialog.getByRole("button", { name: /^Undo ignore/ })).toHaveCount(0);
    await scanMatches(dialog);
    await expect(dialog.getByText(`${previousName} → ${sourceName}`, { exact: true })).toBeVisible();
  } finally {
    try {
      if (factorySnapshotCaptured) {
        await db.query(
          "DELETE FROM factory_kv WHERE scope = 'live' AND key = ANY($1::text[])",
          [[BRANDS_KEY, FLAVORS_KEY]],
        );
        for (const row of originalFactoryRows) {
          await db.query(
            `INSERT INTO factory_kv (scope, key, value, updated_at)
             VALUES ('live', $1, $2::jsonb, NOW() + INTERVAL '5 minutes')
             ON CONFLICT (scope, key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
            [row.key, JSON.stringify(row.value)],
          );
        }
      }
    } finally {
      await db.end().catch(() => {});
    }
  }
});
