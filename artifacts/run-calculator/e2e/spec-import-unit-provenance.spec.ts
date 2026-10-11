import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
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
const FORMULA_BRAND = `Formula Review Bakery ${suffix}`;
const FORMULA_FLAVOR = `Manual Value ${suffix}`;
const FORMULA_SAUCE_RECIPE = `Formula Review Sauce ${suffix}`;
const FORMULA_FILE_NAME = `formula-missing-result-${suffix}.xlsx`;
const formulaImportOperationIds = new Set<string>();

function unitProvenanceWorkbook(): Buffer {
  const profiles = XLSX.utils.aoa_to_sheet([
    [
      "Brand",
      "Flavor",
      "Cases Planned",
      "Notes",
      "Dough Recipe",
      "Sauce Recipe",
      "Sauce oz/pizza",
      "Applicator 2 Type",
      "Applicator 2 oz/pizza",
      "Applicator 4 Type",
      "Applicator 4 oz/pizza",
      "Pepperoni 1 Type",
      "Pepperoni 1 Sticks",
      "Pepperoni 1 oz/pizza",
    ],
    [
      BRAND,
      FLAVOR,
      12,
      "Unit provenance review fixture",
      DOUGH_RECIPE,
      SAUCE_RECIPE,
      17.25,
      "Cheese",
      18.25,
      "Cheese",
      20.75,
      "Natural",
      3,
      19.25,
    ],
  ]);
  const dough = XLSX.utils.aoa_to_sheet([
    [`Recipe: ${DOUGH_RECIPE}`],
    ["Ingredient", "lbs"],
    ["Flour", 50.25],
  ]);
  const sauce = XLSX.utils.aoa_to_sheet([
    [`Recipe: ${SAUCE_RECIPE}`],
    ["Ingredient"],
    ["Tomato Paste", 3.75],
  ]);
  const cheese = XLSX.utils.aoa_to_sheet([
    [`Recipe: ${CHEESE_RECIPE}`],
    ["Ingredient", "batch weight"],
    ["Mozzarella", 7.125],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, profiles, "Production Runs");
  XLSX.utils.book_append_sheet(workbook, dough, "Dough Recipe Unit Review");
  XLSX.utils.book_append_sheet(workbook, sauce, "Sauce Recipe Unit Review");
  XLSX.utils.book_append_sheet(workbook, cheese, "Cheese Recipe Unit Review");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

function missingFormulaResultWorkbook(): Buffer {
  const profiles = XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Sauce Recipe", "Sauce oz/pizza", "Die Type", "Pizzas Per Case"],
    [FORMULA_BRAND, FORMULA_FLAVOR, FORMULA_SAUCE_RECIPE, "", "12 inch", 12],
  ]);
  // A formula cell without `v` models a workbook whose producer did not save a
  // cached result. The app must not evaluate the formula or use it as evidence.
  profiles.D2 = { t: "n", f: "1/2" };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, profiles, "Profiles");
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
      "manage-staff",
        "manage-profiles",
        "use-ai-tools",
        "manage-factory-settings",
      ])],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

async function setUserRole(username: string, role: "operator" | "manager"): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const user = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE username = $1",
      [username],
    );
    expect(user.rows[0]?.id, "sign-up did not create a database user").toBeTruthy();
    await db.query(
      "INSERT INTO user_roles (user_id, role) VALUES ($1, $2) " +
        "ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role",
      [user.rows[0]!.id, role],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

async function openWorkbookImport(
  page: Page,
  fileName: string,
  buffer: Buffer,
): Promise<void> {
  await page.getByRole("button", { name: /more/i }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog").filter({ hasText: "Manage Lists" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Tools", exact: true }).click();
  await settings.getByRole("button", { name: "Import", exact: true }).click();

  const chooser = page.waitForEvent("filechooser");
  await settings.getByRole("button", { name: "Import Spec Sheet", exact: true }).click();
  await (await chooser).setFiles({
    name: fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
}

async function openSetupProfileEditor(page: Page) {
  let settings = page.getByRole("dialog").filter({ hasText: "Manage Lists" });
  if (!(await settings.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /more/i }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    settings = page.getByRole("dialog").filter({ hasText: "Manage Lists" });
  }
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Tools", exact: true }).click();
  await settings.getByRole("button", { name: "Setup Profiles", exact: true }).click();
  await settings.getByRole("button", { name: "Open Setup Profiles Editor", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Setup Profiles" });
  await expect(editor).toBeVisible();
  return editor;
}

async function selectSetupProfileIdentity(
  page: Page,
  editor: Locator,
  brand: string,
  flavor: string,
): Promise<void> {
  await editor.getByRole("button", { name: "Pick or add a brand…", exact: true }).click();
  await page.getByPlaceholder("Search or add…").fill(brand);
  await page.getByRole("button", { name: brand, exact: true }).last().click();

  await editor.getByRole("button", { name: "Pick or add a flavor…", exact: true }).click();
  await page.getByPlaceholder("Search or add…").fill(flavor);
  await page.getByRole("button", { name: flavor, exact: true }).last().click();
}

async function expectAmountWarnings(review: Locator): Promise<void> {
  const summary = review.getByTestId("spec-import-amount-warnings");
  await expect(summary).toContainText("4 per-pizza amounts above the advisory limit");
  await expect(summary).toContainText("These warnings do not block Apply or change values");

  const warnings = review.getByTestId("spec-profile-amount-warning-pk0");
  await warnings.scrollIntoViewIfNeeded();
  await expect(warnings).toBeVisible();
  await expect(warnings).toContainText("Check per-pizza amounts — advisory only");
  await expect(warnings).toContainText(
    "Sauce: 17.25 oz per pizza exceeds the 16 oz per pizza advisory limit",
  );
  await expect(warnings).toContainText(
    "Applicator 2 (Cheese): 18.25 oz per pizza exceeds the 16 oz per pizza advisory limit",
  );
  await expect(warnings).toContainText(
    "Applicator 4 (Cheese): 20.75 oz per pizza exceeds the 16 oz per pizza advisory limit",
  );
  await expect(warnings).toContainText(
    "Pepperoni entry 1 (Natural): 19.25 oz per pizza exceeds the 16 oz per pizza advisory limit",
  );

  const rows = warnings.locator("li");
  await expect(rows).toHaveCount(4);
  for (const message of [
    "Applicator 2 (Cheese): 18.25 oz per pizza exceeds the 16 oz per pizza advisory limit",
    "Applicator 4 (Cheese): 20.75 oz per pizza exceeds the 16 oz per pizza advisory limit",
  ]) {
    const stationWarning = rows.filter({ hasText: message });
    await expect(stationWarning).toHaveCount(1);
    await expect(stationWarning).toBeVisible();
    await expect(stationWarning).toContainText(message);
  }
  for (const row of await rows.all()) {
    await expect(row).toBeVisible();
    const dimensions = await row.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(dimensions.clientWidth).toBeGreaterThan(0);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    expect(dimensions.clientHeight).toBeGreaterThan(0);
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
  }
}

async function captureReviewState(
  review: Locator,
  testInfo: TestInfo,
  viewport: "portrait" | "landscape",
  step: "products" | "details",
): Promise<void> {
  await testInfo.attach(`tablet-${viewport}-${step}`, {
    body: await review.screenshot({ type: "jpeg", quality: 75 }),
    contentType: "image/jpeg",
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
    for (const operationId of formulaImportOperationIds) {
      await db.query("DELETE FROM import_history WHERE operation_id = $1", [operationId]);
      await db.query(
        "DELETE FROM import_operations WHERE id = $1 AND scope = 'live'",
        [operationId],
      );
    }
    await db.query(
      "DELETE FROM brand_profiles WHERE scope = 'live' AND brand = $1 AND flavor = $2",
      [FORMULA_BRAND, FORMULA_FLAVOR],
    );
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

test("shows amount advisories and recipe unit provenance without rescaling or blocking Apply", async (
  { page },
  testInfo,
) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => {
    // The isolated WebKit runner cannot fetch the optional Google Fonts CSS.
    // Keep real application page errors fatal while excluding this network-only
    // failure, which does not affect the fallback-font layout under test.
    if (error.message.includes("fonts.googleapis.com/css2?family=")) return;
    browserErrors.push(error.message);
  });
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
  // Signup may bootstrap the first account as manager. Explicitly set this
  // account to operator first so the same journey proves the access boundary.
  await setUserRole(username, "operator");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  const operator = await page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (!response.ok) return { status: response.status, capabilities: [] as string[] };
    const body = await response.json() as { capabilities?: string[] };
    return { status: response.status, capabilities: body.capabilities ?? [] };
  });
  expect(operator.status).toBe(200);
  expect(operator.capabilities).not.toContain("manage-profiles");
  expect(operator.capabilities).not.toContain("manage-inventory");
  await page.getByRole("button", { name: /more/i }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const operatorSettings = page.getByRole("dialog").filter({ hasText: "Manage Lists" });
  await expect(operatorSettings).toBeVisible();
  await operatorSettings.getByRole("button", { name: "Tools", exact: true }).click();
  await operatorSettings.getByRole("button", { name: "Import", exact: true }).click();
  await expect(
    operatorSettings.getByRole("button", { name: "Import Spec Sheet", exact: true }),
  ).toHaveCount(0);
  const deniedApply = await page.evaluate(async (operationId) => {
    const response = await fetch(`/api/import-operations/${operationId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        importType: "spec",
        changes: { brandProfiles: { upsert: [], delete: [] } },
      }),
    });
    return { status: response.status, body: await response.json() as { error?: string } };
  }, uniqueTestId("operator-import-denied"));
  expect(deniedApply.status).toBe(403);
  expect(deniedApply.body.error).toContain("manage-profiles");
  await operatorSettings.getByRole("button", { name: "Close settings" }).click();

  await promoteToManager(username);
  await dismissOnboardingIfPresent(page, { visibilityTimeout: 5_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await dismissOnboardingIfPresent(page, { visibilityTimeout: 5_000 });
  await expect.poll(async () => page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (!response.ok) return false;
    const me = await response.json() as { capabilities?: string[] };
    return me.capabilities?.includes("manage-factory-settings") ?? false;
  }), { timeout: 20_000 }).toBe(true);

  await openWorkbookImport(page, "recipe-unit-provenance.xlsx", unitProvenanceWorkbook());

  const review = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(review).toContainText("Step 1 of 2 — products", { timeout: 20_000 });
  await expectAmountWarnings(review);
  await expect(review.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
  await captureReviewState(review, testInfo, "portrait", "products");
  await review.getByRole("button", { name: "Next", exact: true }).click();
  await expect(review).toContainText("Step 2 of 2 — details");
  await expectAmountWarnings(review);

  const recipeCards = review.locator('li[data-testid^="spec-recipe-"]');
  const dough = recipeCards.filter({ hasText: DOUGH_RECIPE });
  const sauce = recipeCards.filter({ hasText: SAUCE_RECIPE });
  const cheese = recipeCards.filter({ hasText: CHEESE_RECIPE });
  await expect(dough).toContainText("Reported row unit: lbs");
  await expect(dough).toContainText(/(?:Read|Will change to): Flour 50\.25 lb/);
  await expect(sauce).toContainText("The workbook did not clearly state");
  await expect(sauce).toContainText(/(?:Read|Will change to): Tomato (?:Paste|Sauce) 3\.75 lb/);
  await expect(cheese).toContainText("The reported row unit “batch weight” is ambiguous.");
  await expect(cheese).toContainText(/(?:Read|Will change to): Mozzarella 7\.125 lb/);
  await expect(sauce).toContainText("the values will stay exactly as reported");
  await expect(cheese).toContainText("the values will stay exactly as reported");

  await expectAmountWarnings(review);
  const apply = review.getByRole("button", { name: /^Apply \d+ items?$/ });
  await expect(apply).toBeVisible();
  await expect(apply).toBeInViewport();
  await expect(apply).toBeEnabled();
  await captureReviewState(review, testInfo, "portrait", "details");

  await page.setViewportSize({ width: 1024, height: 768 });
  await expectAmountWarnings(review);
  await expect(apply).toBeVisible();
  await expect(apply).toBeInViewport();
  await expect(apply).toBeEnabled();
  await captureReviewState(review, testInfo, "landscape", "details");

  await review.getByRole("button", { name: "Back", exact: true }).click();
  await expect(review).toContainText("Step 1 of 2 — products");
  await expectAmountWarnings(review);
  await expect(review.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
  await captureReviewState(review, testInfo, "landscape", "products");
  await review.getByRole("button", { name: "Next", exact: true }).click();
  await expect(review).toContainText("Step 2 of 2 — details");
  await expectAmountWarnings(review);
  await expect(apply).toBeVisible();
  await expect(apply).toBeInViewport();
  await expect(apply).toBeEnabled();
  expect(browserErrors, "browser page errors").toEqual([]);
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review).toBeHidden();
});

test("a manager can replace a missing formula result and only redacted source evidence is retained", async (
  { page },
  testInfo,
) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => {
    // The isolated browser runner may not be able to fetch optional Google
    // Fonts CSS. Keep application errors fatal while allowing its fallback font.
    if (error.message.includes("fonts.googleapis.com/css2?family=")) return;
    browserErrors.push(error.message);
  });

  const username = uniqueTestId("e2e_formula_profile");
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
  await dismissOnboardingIfPresent(page, { visibilityTimeout: 5_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await dismissOnboardingIfPresent(page, { visibilityTimeout: 5_000 });

  const manager = await page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (!response.ok) return { status: response.status, capabilities: [] as string[] };
    const body = await response.json() as { capabilities?: string[] };
    return { status: response.status, capabilities: body.capabilities ?? [] };
  });
  expect(manager.status).toBe(200);
  expect(manager.capabilities).toEqual(
    expect.arrayContaining([
      "manage-profiles",
      "manage-inventory",
      "manage-staff",
      "manage-factory-settings",
    ]),
  );

  await openWorkbookImport(page, FORMULA_FILE_NAME, missingFormulaResultWorkbook());
  const review = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(review).toContainText("Step 1 of 2 — products", { timeout: 20_000 });
  const missingResult = review.getByTestId("spec-import-missing-formula-results");
  await expect(missingResult).toContainText("1 formula cell has no saved result");
  await expect(missingResult).toContainText("Sauce oz/pizza");
  await expect(missingResult).toContainText(`${FORMULA_FILE_NAME} · Profiles!D2`);
  await testInfo.attach("formula-missing-result-review", {
    body: await review.screenshot({ type: "jpeg", quality: 75 }),
    contentType: "image/jpeg",
  });

  await review.getByRole("button", {
    name: `Review missing formula result at ${FORMULA_FILE_NAME} · Profiles!D2`,
  }).click();
  await expect(review.getByTestId("spec-source-preview-formula")).toHaveText("=1/2");
  await expect(review.getByTestId("spec-source-preview-value"))
    .toHaveText("No saved result in workbook");

  const manualValue = review.getByRole("textbox", {
    name: `Manual value for Sauce oz/pizza · ${FORMULA_BRAND} — ${FORMULA_FLAVOR}`,
  });
  await manualValue.fill("0.75");
  const next = review.getByRole("button", { name: "Next", exact: true });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(review).toContainText("Step 2 of 2 — details");
  const apply = review.getByRole("button", { name: /^Apply 1 item$/ });
  await expect(apply).toBeEnabled();

  const applyResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/import-operations/")
    && response.url().endsWith("/apply")
    && response.request().method() === "POST",
  );
  await apply.click();
  const applyResponse = await applyResponsePromise;
  expect(applyResponse.status()).toBe(200);
  const operationMatch = new URL(applyResponse.url()).pathname.match(
    /\/api\/import-operations\/([^/]+)\/apply$/,
  );
  expect(operationMatch?.[1]).toBeTruthy();
  const operationId = decodeURIComponent(operationMatch![1]!);
  formulaImportOperationIds.add(operationId);
  const applyBody = applyResponse.request().postDataJSON() as Record<string, unknown>;
  expect(applyBody).not.toHaveProperty("sourcePreviewCells");
  expect(applyBody).not.toHaveProperty("missingFormulaResults");
  const transmittedEvidence = applyBody.sourceEvidence as { sourceText?: unknown };
  expect(typeof transmittedEvidence?.sourceText).toBe("string");
  const transmittedText = transmittedEvidence.sourceText as string;
  for (const reviewOnlyDetail of ["1/2", "0.75", FORMULA_FILE_NAME, "Profiles!D2"]) {
    expect(transmittedText).not.toContain(reviewOnlyDetail);
  }
  await expect(review).toBeHidden();

  const savedProfile = await page.evaluate(async ({ brand, flavor }) => {
    const response = await fetch("/api/brand-profiles", { cache: "no-store" });
    if (!response.ok) return { status: response.status, profile: null };
    const body = await response.json() as {
      items: Array<{ brand: string; flavor: string; values: Record<string, unknown> }>;
    };
    const profile = body.items.find((item) =>
      item.brand.toLowerCase() === brand.toLowerCase()
      && item.flavor.toLowerCase() === flavor.toLowerCase(),
    );
    return { status: response.status, profile: profile ?? null };
  }, { brand: FORMULA_BRAND, flavor: FORMULA_FLAVOR });
  expect(savedProfile.status).toBe(200);
  expect(savedProfile.profile?.values.sauceOzPerPizza).toBe(0.75);

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const persisted = await db.query<{ distill_evidence: Record<string, unknown> }>(
      "SELECT distill_evidence FROM import_operations " +
        "WHERE id = $1 AND scope = 'live' AND import_type = 'spec' AND status = 'applied' " +
        "AND actor_id = (SELECT id FROM users WHERE username = $2)",
      [operationId, username],
    );
    expect(persisted.rows).toHaveLength(1);
    const evidence = persisted.rows[0]!.distill_evidence;
    expect(evidence.format).toBe("spec-apply-source-v1");
    expect(typeof evidence.sourceText).toBe("string");
    const persistedEvidenceText = JSON.stringify(evidence);
    for (const reviewOnlyDetail of ["1/2", "0.75", FORMULA_FILE_NAME, "Profiles!D2"]) {
      expect(persistedEvidenceText).not.toContain(reviewOnlyDetail);
    }
  } finally {
    await db.end().catch(() => {});
  }

  const editor = await openSetupProfileEditor(page);
  await selectSetupProfileIdentity(page, editor, FORMULA_BRAND, FORMULA_FLAVOR);
  await expect(editor.getByTestId("input-sauceOzPerPizza")).toHaveValue("0.75");
  await testInfo.attach("formula-correction-saved-profile", {
    body: await editor.screenshot({ type: "jpeg", quality: 75 }),
    contentType: "image/jpeg",
  });
  await editor.getByRole("button", { name: "Close setup profiles" }).click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const reloadedEditor = await openSetupProfileEditor(page);
  await selectSetupProfileIdentity(page, reloadedEditor, FORMULA_BRAND, FORMULA_FLAVOR);
  await expect(reloadedEditor.getByTestId("input-sauceOzPerPizza")).toHaveValue("0.75");
  expect(browserErrors, "browser page errors").toEqual([]);
});