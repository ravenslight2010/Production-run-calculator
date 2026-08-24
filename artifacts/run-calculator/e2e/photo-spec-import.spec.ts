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

const RAW_BRAND = "Photo Import Bakery";
const RAW_FLAVOR = "Three Cheese";
const EDITED_BRAND = "Photo Import Bakery Reviewed";
const RAW_RECIPE = "Photo Import Dough";
const EDITED_RECIPE = "Photo Import Dough Reviewed";

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
        workbookText: "Photo Import Bakery\tThree Cheese\tPhoto Import Dough",
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