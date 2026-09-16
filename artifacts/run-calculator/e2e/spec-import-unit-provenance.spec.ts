import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import * as XLSX from "xlsx";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import {
  dismissOnboardingIfPresent,
  signUpAndHandleOnboarding,
} from "./onboarding";

const PASSWORD = "SpecUnitReview123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();
const suffix = uniqueTestId("unit_fixture");
const BRAND = `Unit Review Bakery ${suffix}`;
const FLAVOR = `Classic ${suffix}`;
const DOUGH_RECIPE = `Unit Dough ${suffix}`;
const SAUCE_RECIPE = `Unit Sauce ${suffix}`;
const CHEESE_RECIPE = `Unit Cheese ${suffix}`;

function unitProvenanceWorkbook(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Recipe", "Kind", "Ingredient", "Raw Value", "Unit"],
    [BRAND, FLAVOR, DOUGH_RECIPE, "dough", "Flour", 50.25, "lbs"],
    [BRAND, FLAVOR, SAUCE_RECIPE, "sauce", "Tomato Paste", 3.75, ""],
    [BRAND, FLAVOR, CHEESE_RECIPE, "cheese", "Mozzarella", 7.125, "batch weight"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Recipe Unit Review");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
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

async function openWorkbookImport(page: Page): Promise<void> {
  await page.getByRole("button", { name: /more/i }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog").filter({ hasText: "Manage Lists" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Tools", exact: true }).click();
  await settings.getByRole("button", { name: "Import", exact: true }).click();

  const chooser = page.waitForEvent("filechooser");
  await settings.getByRole("button", { name: "Import Spec Sheet", exact: true }).click();
  await (await chooser).setFiles({
    name: "recipe-unit-provenance.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: unitProvenanceWorkbook(),
  });
}

test.beforeAll(async () => {
  await requireIsolatedTestDatabase("spec import unit provenance browser regression");
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

test("shows recipe unit provenance without rescaling workbook values or blocking Apply", async ({
  page,
}) => {
  const username = uniqueTestId("e2e_spec_units");
  testUsernames.add(username);
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    waitForApp: async (currentPage) => {
      await currentPage.getByTestId("tab-run").waitFor({
        state: "attached",
        timeout: 60_000,
      });
    },
    onboarding: { visibilityTimeout: 5_000 },
  });
  await promoteToManager(username);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await dismissOnboardingIfPresent(page, { visibilityTimeout: 5_000 });

  let workbookText = "";
  let structuredParseCount = 0;
  await page.route("**/api/ai/parse-spec-sheet", async (route) => {
    structuredParseCount += 1;
    const body = route.request().postDataJSON() as { workbookText?: string };
    workbookText = body.workbookText ?? workbookText;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        profiles: [{
          brand: BRAND,
          flavor: FLAVOR,
          doughName: DOUGH_RECIPE,
          sauceName: SAUCE_RECIPE,
          dieType: "12 inch",
          pizzasPerCase: 12,
          applicators: [],
          pepperonis: [],
        }],
        recipes: [
          {
            kind: "dough",
            name: DOUGH_RECIPE,
            rowsUnit: "lbs",
            rows: [{ ingredient: "Flour", lbs: 50.25 }],
          },
          {
            kind: "sauce",
            name: SAUCE_RECIPE,
            rows: [{ ingredient: "Tomato Paste", lbs: 3.75 }],
          },
          {
            kind: "cheese",
            name: CHEESE_RECIPE,
            rowsUnit: "batch weight",
            rows: [{ ingredient: "Mozzarella", lbs: 7.125 }],
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

  await openWorkbookImport(page);

  const review = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(review).toContainText("Step 1 of 2 — products", { timeout: 20_000 });
  expect(structuredParseCount).toBeGreaterThanOrEqual(1);
  expect(workbookText).toContain(DOUGH_RECIPE);
  expect(workbookText).toContain("50.25");
  expect(workbookText).toContain("batch weight");

  await review.getByRole("button", { name: "Next", exact: true }).click();
  await expect(review).toContainText("Step 2 of 2 — details");

  const recipeCards = review.locator('li[data-testid^="spec-recipe-"]');
  const dough = recipeCards.filter({ hasText: DOUGH_RECIPE });
  const sauce = recipeCards.filter({ hasText: SAUCE_RECIPE });
  const cheese = recipeCards.filter({ hasText: CHEESE_RECIPE });
  await expect(dough).toContainText("Reported row unit: lbs");
  await expect(dough).toContainText("Read: Flour 50.25 lb");
  await expect(sauce).toContainText("The workbook did not clearly state");
  await expect(sauce).toContainText(/Read: Tomato (?:Paste|Sauce) 3\.75 lb/);
  await expect(cheese).toContainText("The reported row unit “batch weight” is ambiguous.");
  await expect(cheese).toContainText("Read: Mozzarella 7.125 lb");
  await expect(sauce).toContainText("the values will stay exactly as reported");
  await expect(cheese).toContainText("the values will stay exactly as reported");

  const apply = review.getByRole("button", { name: /^Apply \d+ items?$/ });
  await expect(apply).toBeVisible();
  await expect(apply).toBeEnabled();
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review).toBeHidden();
});