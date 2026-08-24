/**
 * Browser regression: photographed spec pages use the same safe two-step review
 * as workbook imports. The vision and workbook-parser responses are deliberately
 * intercepted so this covers the real selection, review, and cancellation UI
 * without making a paid or nondeterministic AI call.
 */

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers, requireIsolatedTestDatabase, uniqueTestId } from "./isolation";

const PASSWORD = "PhotoSpecImport123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

// Keep each browser invocation isolated from master data left by an earlier
// local run. Both tests share this fixture so the cancel and apply journeys
// exercise the same parser output without colliding with prior runs.
const FIXTURE_SUFFIX = uniqueTestId("fixture");
const RAW_BRAND = `Photo Import Bakery ${FIXTURE_SUFFIX}`;
const RAW_FLAVOR = `Three Cheese ${FIXTURE_SUFFIX}`;
const EDITED_BRAND = `Photo Import Bakery Reviewed ${FIXTURE_SUFFIX}`;
const RAW_RECIPE = `ZZZ${FIXTURE_SUFFIX}Recipe`;
const EDITED_RECIPE = `ZZZ${FIXTURE_SUFFIX}RecipeReviewed`;
const RAW_MULTI_DOUGH_RECIPE = `ZZZ${FIXTURE_SUFFIX}MultiDough`;
const EDITED_MULTI_DOUGH_RECIPE = `ZZZ${FIXTURE_SUFFIX}MultiDoughReviewed`;
const RAW_SAUCE_RECIPE = `ZZZ${FIXTURE_SUFFIX}Sauce`;
const EDITED_SAUCE_RECIPE = `ZZZ${FIXTURE_SUFFIX}SauceReviewed`;

// A tiny valid PNG is enough to exercise browser image preparation before the
// intercepted vision request. The source files get distinct names so thumbnail
// add/remove/retake behavior stays visible to the user.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ0QAAAABJRU5ErkJggg==",
  "base64",
);

type MasterDataSnapshot = Record<string, unknown>;

async function dismissWelcome(page: Page): Promise<void> {
  const welcome = page.getByRole("dialog", {
    name: /welcome to production run calculator/i,
  });
  if (!await welcome.isVisible({ timeout: 5_000 }).catch(() => false)) return;

  const seen = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/me/onboarding-seen") &&
      response.request().method() === "POST",
  );
  await welcome.getByRole("button", { name: "Get started", exact: true }).click();
  await expect((await seen).status()).toBe(200);
  await expect(welcome).toBeHidden({ timeout: 10_000 });
}

async function signUp(page: Page, username: string): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.locator("#accessCode").fill(SIGNUP_CODE);
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await dismissWelcome(page);
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await dismissWelcome(page);
}

async function promoteToManager(username: string): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const user = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE username = $1",
      [username],
    );
    expect(user.rows[0]?.id, "sign-up did not create a database user").toBeTruthy();
    await db.query(
      "INSERT INTO user_roles (user_id, role) VALUES ($1, 'manager') " +
        "ON CONFLICT (user_id) DO UPDATE SET role = 'manager'",
      [user.rows[0]!.id],
    );
    // Keep this fixture compatible with databases created before the manager
    // capability seed included the import permissions.
    await db.query(
      "UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'",
      [JSON.stringify([
        "manage-inventory",
        "manage-profiles",
        "use-ai-tools",
        "manage-factory-settings",
      ])],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

async function masterDataSnapshot(page: Page): Promise<MasterDataSnapshot> {
  return page.evaluate(async () => {
    const endpoints = [
      "/api/brand-profiles",
      "/api/dough-recipes",
      "/api/sauce-recipes",
      "/api/cheese-recipes",
      "/api/mixes",
    ];
    const entries = await Promise.all(
      endpoints.map(async (endpoint) => {
        const response = await fetch(endpoint);
        if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
        return [endpoint, await response.json()] as const;
      }),
    );
    return Object.fromEntries(entries);
  });
}

async function openPhotoImport(page: Page): Promise<void> {
  await page.getByRole("button", { name: /more/i }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog").filter({ hasText: "Manage Lists" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Tools", exact: true }).click();
  await settings.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("spec-photo-import")).toBeVisible();
}

test.beforeAll(async () => {
  await requireIsolatedTestDatabase("photo spec import browser regression");
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

test("keeps photographed pages editable and canceling review leaves master data unchanged", async ({
  page,
}) => {
  const username = uniqueTestId("e2e_photo_spec");
  testUsernames.add(username);

  await signUp(page, username);
  await promoteToManager(username);
  await page.evaluate(() => fetch("/api/auth/sign-out", { method: "POST" }));
  await signIn(page, username);

  const before = await masterDataSnapshot(page);
  let imageRequestCount = 0;
  let transcriptionImageCount = 0;
  let structuredParseCount = 0;

  await page.route("**/api/ai/parse-spec-images", async (route) => {
    imageRequestCount += 1;
    const body = route.request().postDataJSON() as {
      images?: Array<{ imageBase64?: string; mimeType?: string }>;
    };
    transcriptionImageCount = body.images?.length ?? 0;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        // Keep the deterministic downstream workbook in one grid/chunk. The
        // photo count is exercised by this request; chunk fan-out and pacing
        // belong to the workbook-import tests.
        workbookText: `${RAW_BRAND}\t${RAW_FLAVOR}\t${RAW_RECIPE}`,
        generatedAt: Date.now(),
        note: "Two photographed pages transcribed for review.",
      }),
    });
  });
  await page.route("**/api/ai/parse-spec-sheet", async (route) => {
    structuredParseCount += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        profiles: [
          {
            brand: RAW_BRAND,
            flavor: RAW_FLAVOR,
            dieType: "12 inch",
            pizzasPerCase: 12,
            applicators: [],
            pepperonis: [],
          },
        ],
        recipes: [
          {
            kind: "dough",
            name: RAW_RECIPE,
            rows: [{ ingredient: "Flour", lbs: 50 }],
          },
        ],
        generatedAt: Date.now(),
      }),
    });
  });
  // Matching is advisory and its production request can take two minutes when
  // an AI provider is cold. Keep it deterministic so this test stays focused on
  // the photographed-page journey; an empty result exercises the documented
  // no-suggestion path without changing the parsed review items.
  await page.route("**/api/ai/match-import", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        brandMatches: [],
        flavorMatches: [],
        ingredientMatches: [],
        appTypeMatches: [],
        pepTypeMatches: [],
        generatedAt: Date.now(),
      }),
    });
  });

  await openPhotoImport(page);
  const photoImport = page.getByTestId("spec-photo-import");
  const uploadInput = photoImport.locator('input[type="file"]').last();

  await uploadInput.setInputFiles([
    { name: "page-one.png", mimeType: "image/png", buffer: PNG },
    { name: "page-two.png", mimeType: "image/png", buffer: PNG },
    { name: "page-three.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(photoImport.getByRole("img", { name: "Selected spec page 1" })).toBeVisible();
  await expect(photoImport.getByRole("img", { name: "Selected spec page 3" })).toBeVisible();

  await photoImport.getByRole("button", { name: "Remove photo 2" }).click();
  await expect(photoImport.getByRole("img", { name: "Selected spec page 2" })).toBeVisible();
  await expect(photoImport.getByRole("img", { name: "Selected spec page 3" })).toHaveCount(0);

  await photoImport.getByTitle("Retake page 1").click();
  await expect(photoImport.getByRole("status")).toContainText("replace page 1");
  await uploadInput.setInputFiles({
    name: "page-one-retaken.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(photoImport.getByRole("status")).toHaveCount(0);
  await expect(photoImport.getByRole("img", { name: "Selected spec page 1" })).toBeVisible();
  await expect(photoImport.getByRole("img", { name: "Selected spec page 2" })).toBeVisible();

  await photoImport.getByRole("button", { name: "Read 2 photos", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(review).toContainText("Step 1 of 2 — products");
  await expect(review.getByLabel(`Brand for ${RAW_BRAND} ${RAW_FLAVOR}`)).toBeVisible();

  // Step 1 edits product identity; it must survive into the second, recipe/die
  // review rather than applying early.
  await review.getByLabel(`Brand for ${RAW_BRAND} ${RAW_FLAVOR}`).fill(EDITED_BRAND);
  await review.getByRole("button", { name: "Next", exact: true }).click();
  await expect(review).toContainText(`${EDITED_BRAND} — ${RAW_FLAVOR}`);
  await expect(review.getByLabel(`Name for recipe ${RAW_RECIPE}`)).toBeVisible();

  // Step 2 edits recipe metadata. Cancel is the persistence boundary: neither
  // the edited profile nor recipe can reach any master-data endpoint.
  await review.getByLabel(`Name for recipe ${RAW_RECIPE}`).fill(EDITED_RECIPE);
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review).toBeHidden();

  expect(imageRequestCount).toBe(1);
  expect(transcriptionImageCount).toBe(2);
  expect(structuredParseCount).toBeGreaterThanOrEqual(1);
  await expect.poll(() => masterDataSnapshot(page)).toEqual(before);
});

test("applies photographed review edits to the authenticated profile and recipe pools", async ({
  page,
}) => {
  const username = uniqueTestId("e2e_photo_spec_apply");
  testUsernames.add(username);

  await signUp(page, username);
  await promoteToManager(username);
  await page.evaluate(() => fetch("/api/auth/sign-out", { method: "POST" }));
  await signIn(page, username);

  let imageRequestCount = 0;
  let transcriptionImageCount = 0;
  let structuredParseCount = 0;
  let masterDataClientId = "";
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (request.url().endsWith("/api/brand-profiles") ||
        request.url().endsWith("/api/dough-recipes"))
    ) {
      masterDataClientId = request.headers()["x-client-id"] ?? masterDataClientId;
    }
  });
  await page.route("**/api/ai/parse-spec-images", async (route) => {
    imageRequestCount += 1;
    const body = route.request().postDataJSON() as {
      images?: Array<{ imageBase64?: string; mimeType?: string }>;
    };
    transcriptionImageCount = body.images?.length ?? 0;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        workbookText: `${RAW_BRAND}\t${RAW_FLAVOR}\t${RAW_RECIPE}`,
        generatedAt: Date.now(),
        note: "Two photographed pages transcribed for review.",
      }),
    });
  });
  await page.route("**/api/ai/parse-spec-sheet", async (route) => {
    structuredParseCount += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        profiles: [
          {
            brand: RAW_BRAND,
            flavor: RAW_FLAVOR,
            dieType: "12 inch",
            pizzasPerCase: 12,
            applicators: [],
            pepperonis: [],
          },
        ],
        recipes: [
          {
            kind: "dough",
            name: RAW_RECIPE,
            rows: [{ ingredient: "Flour", lbs: 50 }],
          },
        ],
        generatedAt: Date.now(),
      }),
    });
  });
  await page.route("**/api/ai/match-import", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        brandMatches: [],
        flavorMatches: [],
        ingredientMatches: [],
        appTypeMatches: [],
        pepTypeMatches: [],
        generatedAt: Date.now(),
      }),
    });
  });

  await openPhotoImport(page);
  const photoImport = page.getByTestId("spec-photo-import");
  const uploadInput = photoImport.locator('input[type="file"]').last();
  await uploadInput.setInputFiles([
    { name: `${FIXTURE_SUFFIX}-apply-page-one.png`, mimeType: "image/png", buffer: PNG },
    { name: `${FIXTURE_SUFFIX}-apply-page-two.png`, mimeType: "image/png", buffer: PNG },
  ]);
  await expect(photoImport.getByRole("img", { name: "Selected spec page 1" })).toBeVisible();
  await expect(photoImport.getByRole("img", { name: "Selected spec page 2" })).toBeVisible();
  await photoImport.getByRole("button", { name: "Read 2 photos", exact: true }).click();

  const review = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(review).toContainText("Step 1 of 2 — products");
  await review.getByLabel(`Brand for ${RAW_BRAND} ${RAW_FLAVOR}`).fill(EDITED_BRAND);
  await review.getByRole("button", { name: "Next", exact: true }).click();
  await expect(review).toContainText(`${EDITED_BRAND} — ${RAW_FLAVOR}`);
  await review.getByLabel(`Name for recipe ${RAW_RECIPE}`).fill(EDITED_RECIPE);

  await review.getByRole("button", { name: /^Apply \d+ items?$/ }).click();
  // The commit path recomputes the authoritative diff. If another master-data
  // refresh changes that diff while the dialog is open, the safe behavior is to
  // reopen step 1 and require the manager to review it again rather than apply
  // stale decisions. Complete that deliberate re-confirmation when exercised.
  await expect.poll(async () => {
    if (!await review.isVisible().catch(() => false)) return "hidden";
    return (await review.textContent()) ?? "";
  }, { timeout: 20_000 }).toMatch(/Step 1 of 2 — products|hidden/);
  if (
    await review.isVisible().catch(() => false) &&
    await review.getByRole("button", { name: "Next", exact: true }).isVisible().catch(() => false)
  ) {
    await review.getByLabel(`Brand for ${RAW_BRAND} ${RAW_FLAVOR}`).fill(EDITED_BRAND);
    await review.getByRole("button", { name: "Next", exact: true }).click();
    await review.getByLabel(`Name for recipe ${RAW_RECIPE}`).fill(EDITED_RECIPE);
    const destructiveConfirmation = review.getByTestId("spec-import-destructive-confirmation");
    if (await destructiveConfirmation.isVisible().catch(() => false)) {
      await destructiveConfirmation.check();
    }
    await review.getByRole("button", { name: /^Apply \d+ items?$/ }).click();
  }
  await expect(review).toBeHidden({ timeout: 20_000 });

  expect(imageRequestCount).toBe(1);
  expect(transcriptionImageCount).toBe(2);
  expect(structuredParseCount).toBeGreaterThanOrEqual(1);

  await expect.poll(async () => {
    const response = await page.evaluate(async ({ clientId }) => {
      const headers = clientId ? { "x-client-id": clientId } : undefined;
      const [profilesResponse, recipesResponse] = await Promise.all([
        fetch("/api/brand-profiles", { headers }),
        fetch("/api/dough-recipes", { headers }),
      ]);
      if (!profilesResponse.ok || !recipesResponse.ok) {
        throw new Error(
          `master-data endpoints returned ${profilesResponse.status}/${recipesResponse.status}`,
        );
      }
      return {
        profiles: await profilesResponse.json() as {
          items?: Array<{ brand?: string; flavor?: string }>;
        },
        recipes: await recipesResponse.json() as {
          items?: Array<{ name?: string }>;
        },
      };
    }, { clientId: masterDataClientId });
    return {
      profile: response.profiles.items
        ?.filter(
          (item) =>
            item.brand?.toLowerCase() === EDITED_BRAND.toLowerCase() &&
            item.flavor?.toLowerCase() === RAW_FLAVOR.toLowerCase(),
        )
        .map((item) => ({ brand: item.brand, flavor: item.flavor }))[0],
      recipe: response.recipes.items
        ?.filter(
          (item) => item.name?.toLowerCase() === EDITED_RECIPE.toLowerCase(),
        )
        .map((item) => ({ name: item.name }))[0],
    };
  }, { timeout: 20_000 }).toEqual({
    profile: {
      brand: EDITED_BRAND.toLowerCase(),
      flavor: RAW_FLAVOR.toLowerCase(),
    },
    recipe: { name: EDITED_RECIPE },
  });
});

test("persists every ingredient from a photographed multi-ingredient dough recipe", async ({
  page,
}) => {
  const username = uniqueTestId("e2e_photo_multi_dough");
  testUsernames.add(username);

  await signUp(page, username);
  await promoteToManager(username);
  await page.evaluate(() => fetch("/api/auth/sign-out", { method: "POST" }));
  await signIn(page, username);

  let imageRequestCount = 0;
  let transcriptionImageCount = 0;
  let structuredParseCount = 0;
  let doughClientId = "";
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/dough-recipes")
    ) {
      doughClientId = request.headers()["x-client-id"] ?? doughClientId;
    }
  });
  await page.route("**/api/ai/parse-spec-images", async (route) => {
    imageRequestCount += 1;
    const body = route.request().postDataJSON() as {
      images?: Array<{ imageBase64?: string; mimeType?: string }>;
    };
    transcriptionImageCount = body.images?.length ?? 0;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        workbookText: `${RAW_BRAND}\t${RAW_FLAVOR}\t${RAW_MULTI_DOUGH_RECIPE}`,
        generatedAt: Date.now(),
        note: "Two photographed dough pages transcribed for review.",
      }),
    });
  });
  await page.route("**/api/ai/parse-spec-sheet", async (route) => {
    structuredParseCount += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        profiles: [
          {
            brand: RAW_BRAND,
            flavor: RAW_FLAVOR,
            dieType: "12 inch",
            pizzasPerCase: 12,
            applicators: [],
            pepperonis: [],
          },
        ],
        recipes: [
          {
            kind: "dough",
            name: RAW_MULTI_DOUGH_RECIPE,
            rows: [
              { ingredient: "High Gluten Flour", lbs: 50 },
              { ingredient: "Water", lbs: 29.5 },
              { ingredient: "Olive Oil", lbs: 1.25 },
            ],
          },
        ],
        generatedAt: Date.now(),
      }),
    });
  });
  await page.route("**/api/ai/match-import", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        brandMatches: [],
        flavorMatches: [],
        ingredientMatches: [],
        appTypeMatches: [],
        pepTypeMatches: [],
        generatedAt: Date.now(),
      }),
    });
  });

  await openPhotoImport(page);
  const photoImport = page.getByTestId("spec-photo-import");
  const uploadInput = photoImport.locator('input[type="file"]').last();
  await uploadInput.setInputFiles([
    { name: `${FIXTURE_SUFFIX}-multi-dough-page-one.png`, mimeType: "image/png", buffer: PNG },
    { name: `${FIXTURE_SUFFIX}-multi-dough-page-two.png`, mimeType: "image/png", buffer: PNG },
  ]);
  await expect(photoImport.getByRole("img", { name: "Selected spec page 1" })).toBeVisible();
  await expect(photoImport.getByRole("img", { name: "Selected spec page 2" })).toBeVisible();
  await photoImport.getByRole("button", { name: "Read 2 photos", exact: true }).click();

  const review = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(review).toContainText("Step 1 of 2 — products");
  const doughBrandInput = review.locator('input[aria-label^="Brand for "]');
  await expect(doughBrandInput).toHaveCount(1);
  await doughBrandInput.fill(EDITED_BRAND);
  await review.getByRole("button", { name: "Next", exact: true }).click();
  await expect(review).toContainText(`${EDITED_BRAND} — ${RAW_FLAVOR}`);
  const doughRecipeInput = review.locator('input[aria-label^="Name for recipe "]');
  await expect(doughRecipeInput).toHaveCount(1);
  await doughRecipeInput.fill(EDITED_MULTI_DOUGH_RECIPE);

  await review.getByRole("button", { name: /^Apply \d+ items?$/ }).click();
  await expect.poll(async () => {
    if (!await review.isVisible().catch(() => false)) return "hidden";
    return (await review.textContent()) ?? "";
  }, { timeout: 20_000 }).toMatch(/Step 1 of 2 — products|hidden/);
  if (
    await review.isVisible().catch(() => false) &&
    await review.getByRole("button", { name: "Next", exact: true }).isVisible().catch(() => false)
  ) {
    await doughBrandInput.fill(EDITED_BRAND);
    await review.getByRole("button", { name: "Next", exact: true }).click();
    await doughRecipeInput.fill(EDITED_MULTI_DOUGH_RECIPE);
    const destructiveConfirmation = review.getByTestId("spec-import-destructive-confirmation");
    if (await destructiveConfirmation.isVisible().catch(() => false)) {
      await destructiveConfirmation.check();
    }
    await review.getByRole("button", { name: /^Apply \d+ items?$/ }).click();
  }
  await expect(review).toBeHidden({ timeout: 20_000 });

  expect(imageRequestCount).toBe(1);
  expect(transcriptionImageCount).toBe(2);
  expect(structuredParseCount).toBeGreaterThanOrEqual(1);

  await expect.poll(async () => {
    const response = await page.evaluate(async ({ clientId }) => {
      const headers = clientId ? { "x-client-id": clientId } : undefined;
      const doughResponse = await fetch("/api/dough-recipes", { headers });
      if (!doughResponse.ok) {
        throw new Error(`dough recipe endpoint returned ${doughResponse.status}`);
      }
      return await doughResponse.json() as {
        items?: Array<{
          name?: string;
          components?: Array<{ ingredient?: string; lbs?: number }>;
        }>;
      };
    }, { clientId: doughClientId });
    return response.items
      ?.filter((item) => item.name?.toLowerCase() === EDITED_MULTI_DOUGH_RECIPE.toLowerCase())
      .map((item) => ({
        name: item.name,
        components: item.components?.map((component) => ({
          ingredient: component.ingredient,
          lbs: component.lbs,
        })),
      }))[0];
  }, { timeout: 20_000 }).toEqual({
    name: EDITED_MULTI_DOUGH_RECIPE,
    components: [
      { ingredient: "High Gluten Flour", lbs: 50 },
      // Ingredient master data canonicalizes this name during persistence.
      { ingredient: "WATER", lbs: 29.5 },
      { ingredient: "Olive Oil", lbs: 1.25 },
    ],
  });
});

test("applies a photographed sauce review edit to the authenticated sauce recipe pool", async ({
  page,
}) => {
  const username = uniqueTestId("e2e_photo_sauce_apply");
  testUsernames.add(username);

  await signUp(page, username);
  await promoteToManager(username);
  await page.evaluate(() => fetch("/api/auth/sign-out", { method: "POST" }));
  await signIn(page, username);

  let imageRequestCount = 0;
  let transcriptionImageCount = 0;
  let structuredParseCount = 0;
  let sauceClientId = "";
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/sauce-recipes")
    ) {
      sauceClientId = request.headers()["x-client-id"] ?? sauceClientId;
    }
  });
  await page.route("**/api/ai/parse-spec-images", async (route) => {
    imageRequestCount += 1;
    const body = route.request().postDataJSON() as {
      images?: Array<{ imageBase64?: string; mimeType?: string }>;
    };
    transcriptionImageCount = body.images?.length ?? 0;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        workbookText: `${RAW_BRAND}\t${RAW_FLAVOR}\t${RAW_SAUCE_RECIPE}`,
        generatedAt: Date.now(),
        note: "Two photographed sauce pages transcribed for review.",
      }),
    });
  });
  await page.route("**/api/ai/parse-spec-sheet", async (route) => {
    structuredParseCount += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        profiles: [
          {
            brand: RAW_BRAND,
            flavor: RAW_FLAVOR,
            sauceName: RAW_SAUCE_RECIPE,
            dieType: "12 inch",
            pizzasPerCase: 12,
            applicators: [],
            pepperonis: [],
          },
        ],
        recipes: [
          {
            kind: "sauce",
            name: RAW_SAUCE_RECIPE,
            rows: [
              { ingredient: "Tomato Sauce", lbs: 25 },
              { ingredient: "Garlic Puree", lbs: 3.5 },
              { ingredient: "Olive Oil", lbs: 1.25 },
            ],
          },
        ],
        generatedAt: Date.now(),
      }),
    });
  });
  await page.route("**/api/ai/match-import", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        brandMatches: [],
        flavorMatches: [],
        ingredientMatches: [],
        appTypeMatches: [],
        pepTypeMatches: [],
        generatedAt: Date.now(),
      }),
    });
  });

  await openPhotoImport(page);
  const photoImport = page.getByTestId("spec-photo-import");
  const uploadInput = photoImport.locator('input[type="file"]').last();
  await uploadInput.setInputFiles([
    { name: `${FIXTURE_SUFFIX}-sauce-page-one.png`, mimeType: "image/png", buffer: PNG },
    { name: `${FIXTURE_SUFFIX}-sauce-page-two.png`, mimeType: "image/png", buffer: PNG },
  ]);
  await expect(photoImport.getByRole("img", { name: "Selected spec page 1" })).toBeVisible();
  await expect(photoImport.getByRole("img", { name: "Selected spec page 2" })).toBeVisible();
  await photoImport.getByRole("button", { name: "Read 2 photos", exact: true }).click();

  const review = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(review).toContainText("Step 1 of 2 — products");
  const sauceBrandInput = review.locator('input[aria-label^="Brand for "]');
  await expect(sauceBrandInput).toHaveCount(1);
  await sauceBrandInput.fill(EDITED_BRAND);
  await review.getByRole("button", { name: "Next", exact: true }).click();
  await expect(review).toContainText(`${EDITED_BRAND} — ${RAW_FLAVOR}`);
  const sauceRecipeInput = review.locator('input[aria-label^="Name for recipe "]');
  await expect(sauceRecipeInput).toHaveCount(1);
  await sauceRecipeInput.fill(EDITED_SAUCE_RECIPE);

  await review.getByRole("button", { name: /^Apply \d+ items?$/ }).click();
  await expect.poll(async () => {
    if (!await review.isVisible().catch(() => false)) return "hidden";
    return (await review.textContent()) ?? "";
  }, { timeout: 20_000 }).toMatch(/Step 1 of 2 — products|hidden/);
  if (
    await review.isVisible().catch(() => false) &&
    await review.getByRole("button", { name: "Next", exact: true }).isVisible().catch(() => false)
  ) {
    await sauceBrandInput.fill(EDITED_BRAND);
    await review.getByRole("button", { name: "Next", exact: true }).click();
    await sauceRecipeInput.fill(EDITED_SAUCE_RECIPE);
    const destructiveConfirmation = review.getByTestId("spec-import-destructive-confirmation");
    if (await destructiveConfirmation.isVisible().catch(() => false)) {
      await destructiveConfirmation.check();
    }
    await review.getByRole("button", { name: /^Apply \d+ items?$/ }).click();
  }
  await expect(review).toBeHidden({ timeout: 20_000 });

  expect(imageRequestCount).toBe(1);
  expect(transcriptionImageCount).toBe(2);
  expect(structuredParseCount).toBeGreaterThanOrEqual(1);

  await expect.poll(async () => {
    const response = await page.evaluate(async ({ clientId }) => {
      const headers = clientId ? { "x-client-id": clientId } : undefined;
      const sauceResponse = await fetch("/api/sauce-recipes", { headers });
      if (!sauceResponse.ok) {
        throw new Error(`sauce recipe endpoint returned ${sauceResponse.status}`);
      }
      return await sauceResponse.json() as {
        items?: Array<{
          name?: string;
          components?: Array<{ ingredient?: string; lbs?: number }>;
        }>;
      };
    }, { clientId: sauceClientId });
    return response.items
      ?.filter((item) => item.name?.toLowerCase() === EDITED_SAUCE_RECIPE.toLowerCase())
      .map((item) => ({
        name: item.name,
        components: item.components?.map((component) => ({
          ingredient: component.ingredient,
          lbs: component.lbs,
        })),
      }))[0];
  }, { timeout: 20_000 }).toEqual({
    name: EDITED_SAUCE_RECIPE,
    components: [
      { ingredient: "Tomato Sauce", lbs: 25 },
      { ingredient: "Garlic Puree", lbs: 3.5 },
      { ingredient: "Olive Oil", lbs: 1.25 },
    ],
  });
});
