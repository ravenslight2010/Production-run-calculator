import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { assertRecipePickerContract } from "./recipe-picker-contract";

const API_BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";

async function openManagerAttention(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Manager attention", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Manager attention" })).toBeVisible();
}

test("manager setup stays usable when recipe names are incomplete", async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_manager_setup_incomplete"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    const scheduledBrand = uniqueTestId("IncompleteBrand");
    const scheduledFlavor = uniqueTestId("IncompleteFlavor");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    await page.route("**/api/password-reset-requests", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    });
    await page.route("**/api/incidents/actionable-count", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 0 }),
      }));
    await page.route("**/api/sync/scheduled?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          date: tomorrow,
          runCount: 1,
          runs: [{
            id: uniqueTestId("scheduled-incomplete"),
            brand: scheduledBrand,
            flavor: scheduledFlavor,
            casesNeeded: 10,
            dieType: "",
          }],
        }]),
      }));
    await page.route("**/api/master-data/bootstrap*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ingredients: [],
          doughRecipes: [
            { id: uniqueTestId("malformed-dough"), name: null, components: [], enabled: true },
            { id: uniqueTestId("valid-dough"), name: "Valid Dough", components: [], enabled: true },
          ],
          sauceRecipes: [
            { id: uniqueTestId("malformed-sauce"), name: 42, components: [], enabled: true },
            { id: uniqueTestId("valid-sauce"), name: "Valid Sauce", components: [], enabled: true },
          ],
          cheeseRecipes: [
            { id: uniqueTestId("malformed-cheese"), name: {}, components: [], enabled: true },
            { id: uniqueTestId("valid-cheese"), name: "Valid Cheese", brand: "", flavors: [], components: [], enabled: true },
          ],
          mixes: [
            { id: uniqueTestId("malformed-mix"), name: false, components: [], enabled: true },
            { id: uniqueTestId("valid-mix"), name: "Valid Mix", brand: "", flavor: "", components: [], enabled: true },
          ],
        }),
      }));
    await page.addInitScript(() => {
      localStorage.setItem("run-calc-dough-recipe-names", JSON.stringify([null, "Legacy Dough"]));
      localStorage.setItem("run-calc-frontline-recipe-names", JSON.stringify([{}, "Legacy Sauce"]));
    });

    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    const bootstrapRead = page.waitForResponse(
      (response) =>
        response.request().method() === "GET"
        && response.url().includes("/api/master-data/bootstrap"),
      { timeout: 25_000 },
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await expect((await bootstrapRead).status()).toBe(200);
    await openManagerAttention(page);
    await page.getByTestId("manager-attention-action-recipe-setup").click();
    await expect(page.getByRole("heading", { name: "Setup Profiles" })).toBeVisible();
    await expect(page.getByText(scheduledBrand, { exact: true })).toBeVisible();
    await expect(page.getByText(scheduledFlavor, { exact: true })).toBeVisible();

    const openPickerAndSelect = async (
      picker: Locator,
      validName: string,
      malformedName: string,
    ) => {
      await picker.click();
      const dropdown = page.getByPlaceholder("Search or add…").locator("..");
      await expect(dropdown.getByRole("button", { name: validName, exact: true })).toBeVisible();
      await expect(dropdown.getByText(malformedName, { exact: true })).toHaveCount(0);
      await dropdown.getByRole("button", { name: validName, exact: true }).click();
      // The trigger keeps its stable accessible label (for example
      // "Dough recipe") after selection; the chosen recipe is its content,
      // not its accessible name. Assert the picker contract directly instead
      // of looking for a second button named after the selected recipe.
      await expect(picker).toContainText(validName);
    };

    await openPickerAndSelect(
      page.getByTestId("setup-recipe-picker-dough"),
      "Valid Dough",
      "null",
    );

    const saucePicker = page.getByTestId("setup-recipe-picker-sauce");
    await openPickerAndSelect(saucePicker, "Valid Sauce", "42");

    const app1TypePicker = page.getByText("Applicator 1", { exact: true }).locator("..").getByRole("button");
    await app1TypePicker.click();
    let dropdown = page.getByPlaceholder("Search or add…").locator("..");
    await expect(dropdown.getByRole("button", { name: "Cheese", exact: true })).toBeVisible();
    await dropdown.getByRole("button", { name: "Cheese", exact: true }).click();

    const cheeseRecipePicker = page.getByTestId("setup-recipe-picker-app-1-cheese");
    await expect(cheeseRecipePicker.locator("option", { hasText: "Valid Cheese" })).toHaveCount(1);
    await expect(cheeseRecipePicker.locator("option", { hasText: "[object Object]" })).toHaveCount(0);
    await cheeseRecipePicker.selectOption("Valid Cheese");
    await expect(cheeseRecipePicker).toHaveValue("Valid Cheese");

    await app1TypePicker.click();
    dropdown = page.getByPlaceholder("Search or add…").locator("..");
    await dropdown.getByRole("button", { name: "Mix", exact: true }).click();
    await openPickerAndSelect(
      page.getByTestId("setup-recipe-picker-app-1-mix"),
      "Valid Mix",
      "false",
    );

    expect(browserErrors).toEqual([]);
  } finally {
    await fixtures.cleanup();
  }
});

test("live and setup profile recipe pickers keep the shared selector contract", async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_recipe_picker_contract"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    const brand = uniqueTestId("PickerContractBrand");
    const flavor = uniqueTestId("PickerContractFlavor");
    const doughName = uniqueTestId("PickerContractDough");
    const sauceName = uniqueTestId("PickerContractSauce");
    const cheeseName = uniqueTestId("PickerContractCheese");
    const mixName = uniqueTestId("PickerContractMix");
    const runId = uniqueTestId("picker-contract-run");
    const now = Date.now();
    const values = {
      casesNeeded: 1,
      pizzasPerCase: 1,
      casesPerSkid: 1,
      crustsPerCycle: 1,
      cycleSpeed: 1,
      speedAdjustment: 1,
      doughRecipeName: doughName,
      doughRecipe: [{ ingredient: "Flour", lbs: 10 }],
      frontlineRecipeName: sauceName,
      frontlineRecipe: [{ ingredient: "Tomato", lbs: 10 }],
      app1Type: "Cheese",
      app1CheeseRecipeName: cheeseName,
      app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10 }],
      app2Type: "Mix",
      app2CheeseRecipeName: mixName,
      app2CheeseRecipe: [{ ingredient: "Blend", lbs: 10 }],
    };

    await fixtures.seedNamedRecipe("dough", account, {
      id: uniqueTestId("picker-contract-dough"),
      name: doughName,
      components: [{ ingredient: "Flour", lbs: 10 }],
    });
    await fixtures.seedNamedRecipe("sauce", account, {
      id: uniqueTestId("picker-contract-sauce"),
      name: sauceName,
      components: [{ ingredient: "Tomato", lbs: 10 }],
    });
    await fixtures.seedCheeseRecipe(account, {
      id: uniqueTestId("picker-contract-cheese"),
      name: cheeseName,
      components: [{ ingredient: "Cheese", lbs: 10 }],
    });
    await fixtures.seedMix(account, {
      id: uniqueTestId("picker-contract-mix"),
      name: mixName,
      components: [{ ingredient: "Blend", perPizza: 1 }],
    });
    await fixtures.seedBrandProfile(account, {
      brand,
      flavor,
      values,
      updatedAt: now,
    });
    await fixtures.seedTodaySync({
      token: account.token,
      senderId: uniqueTestId("picker-contract-sender"),
      payload: {
        dayState: {
          date: new Date().toISOString().slice(0, 10),
          runs: [{ id: runId, brand, flavor, casesNeeded: 1, seeded: false }],
          currentIndex: 0,
          resetAt: 0,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        },
        runValues: { [runId]: values },
        runValuesUpdatedAt: { [runId]: now },
        packagingProgress: {},
      },
    });

    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: "Setup", exact: true }).click();
    const liveSurface = page.getByTestId("setup-recipes-fieldset");
    await expect(liveSurface).toBeVisible();
    await expect(liveSurface.getByTestId("setup-recipe-picker-dough")).toBeVisible();
    await liveSurface.getByText("Sauce & Applicator Weights", { exact: true }).click();
    await assertRecipePickerContract(liveSurface, "live Setup tab");

    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Tools", exact: true }).click();
    await settings.getByRole("button", { name: "Setup Profiles", exact: true }).click();
    await settings.getByRole("button", { name: "Open Setup Profiles Editor", exact: true }).click();

    const profileSurface = page.getByRole("dialog", { name: "Setup Profiles" });
    await expect(profileSurface).toBeVisible();
    const brandPicker = profileSurface.getByRole("button", {
      name: "Pick or add a brand…",
      exact: true,
    });
    await brandPicker.click();
    await page.getByPlaceholder("Search or add…").fill(brand);
    const existingBrand = page.getByRole("button", { name: brand, exact: true });
    if (await existingBrand.count()) {
      await existingBrand.last().click();
    } else {
      await page.getByRole("button", { name: `Add "${brand}"`, exact: true }).click();
    }
    const flavorPicker = profileSurface.getByRole("button", {
      name: "Pick or add a flavor…",
      exact: true,
    });
    await flavorPicker.click();
    await page.getByPlaceholder("Search or add…").fill(flavor);
    const existingFlavor = page.getByRole("button", { name: flavor, exact: true });
    if (await existingFlavor.count()) {
      await existingFlavor.last().click();
    } else {
      await page.getByRole("button", { name: `Add "${flavor}"`, exact: true }).click();
    }
    await expect(profileSurface.getByTestId("setup-recipe-picker-dough")).toBeVisible();
    await assertRecipePickerContract(profileSurface, "Setup Profiles editor");
  } finally {
    await fixtures.cleanup();
  }
});

test("manager attention remains stable across dialog and destination transitions", async ({
  page,
  playwright,
}, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  let malformedAliasId: number | null = null;

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_manager_attention"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    const malformedAliasExternalName = uniqueTestId("MalformedFlavorAlias");
    const malformedAliasCanonicalName = uniqueTestId("CanonicalFlavor");
    const seedDb = new Client({
      connectionString: requireIsolatedTestDatabase("seed malformed manager-attention alias"),
    });
    try {
      await seedDb.connect();
      const result = await seedDb.query<{ id: number }>(
        `INSERT INTO spec_import_aliases
          (scope, kind, external_name, canonical_name, context)
         VALUES ('live', 'flavor', $1, $2, NULL)
         RETURNING id`,
        [malformedAliasExternalName, malformedAliasCanonicalName],
      );
      malformedAliasId = result.rows[0]?.id ?? null;
      expect(malformedAliasId).not.toBeNull();
    } finally {
      await seedDb.end().catch(() => {});
    }
    const scheduledBrand = uniqueTestId("AttentionBrand");
    const scheduledFlavor = uniqueTestId("AttentionFlavor");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    await page.route("**/api/password-reset-requests", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          id: uniqueTestId("reset"),
          userId: uniqueTestId("staff"),
          username: "fixture-staff",
          requestedAt: new Date().toISOString(),
        }]),
      });
    });
    await page.route("**/api/incidents/actionable-count", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 1 }),
      }));
    await page.route("**/api/sync/scheduled?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          date: tomorrow,
          runCount: 1,
          runs: [{
            id: uniqueTestId("scheduled"),
            brand: scheduledBrand,
            flavor: scheduledFlavor,
            casesNeeded: 10,
            dieType: "",
          }],
        }]),
      }));
    await page.route("**/api/master-data/bootstrap*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ingredients: [],
          doughRecipes: [
            { id: uniqueTestId("malformed-dough"), name: null, components: [], enabled: true },
            { id: uniqueTestId("valid-dough"), name: "Valid Dough", components: [], enabled: true },
          ],
          sauceRecipes: [
            { id: uniqueTestId("malformed-sauce"), name: 42, components: [], enabled: true },
            { id: uniqueTestId("valid-sauce"), name: "Valid Sauce", components: [], enabled: true },
          ],
          cheeseRecipes: [
            { id: uniqueTestId("malformed-cheese"), name: {}, components: [], enabled: true },
            { id: uniqueTestId("valid-cheese"), name: "Valid Cheese", brand: "", flavors: [], components: [], enabled: true },
          ],
          mixes: [
            { id: uniqueTestId("malformed-mix"), name: false, components: [], enabled: true },
            { id: uniqueTestId("valid-mix"), name: "Valid Mix", brand: "", flavor: "", components: [], enabled: true },
          ],
        }),
      }));
    await page.addInitScript(() => {
      localStorage.setItem("run-calc-dough-recipe-names", JSON.stringify([null, "Legacy Dough"]));
      localStorage.setItem("run-calc-frontline-recipe-names", JSON.stringify([{}, "Legacy Sauce"]));
    });

    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const malformedAliasRead = page.waitForResponse(
      (response) =>
        response.request().method() === "GET"
        && response.url().includes("/api/spec-import-aliases"),
      { timeout: 25_000 },
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await expect((await malformedAliasRead).status()).toBe(200);

    await openManagerAttention(page);
    await expect(page.getByTestId("manager-attention-password-resets")).toBeVisible();
    await expect(page.getByTestId("manager-attention-incidents")).toBeVisible();
    await expect(page.getByTestId("manager-attention-recipe-setup")).toBeVisible();
    await expect(page.getByText("Urgent", { exact: true })).toBeVisible();
    await expect(page.getByText("High", { exact: true })).toBeVisible();
    await expect(page.getByText("Upcoming", { exact: true })).toBeVisible();
    await expect(page.getByText(`${scheduledBrand} — ${scheduledFlavor}`, { exact: true })).toBeVisible();
    await expect(page.getByText(/10 cases cannot be planned reliably/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open full manager queue" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("manager-attention-open.png") });

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog", { name: "Manager attention" })).toBeHidden();
    await expect(page.getByRole("button", { name: /^More/ })).toBeFocused();
    await openManagerAttention(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("dialog", { name: "Manager attention" })).toBeVisible();
    await expect(page.getByTestId("manager-attention-recipe-setup")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("manager-attention-phone.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByTestId("manager-attention-action-password-resets").click();
    await expect(page.getByRole("heading", { name: "Staff Roster" })).toBeVisible();

    await openManagerAttention(page);
    await page.getByTestId("manager-attention-action-incidents").click();
    await expect(page.getByText("Reported issues", { exact: true })).toBeVisible();

    await openManagerAttention(page);
    await page.getByTestId("manager-attention-action-recipe-setup").click();
    await expect(page.getByRole("heading", { name: "Setup Profiles" })).toBeVisible();
    await expect(page.getByText(scheduledBrand, { exact: true })).toBeVisible();
    await expect(page.getByText(scheduledFlavor, { exact: true })).toBeVisible();
    const doughRecipePicker = page.getByTestId("setup-recipe-picker-dough");
    await doughRecipePicker.click();
    await expect(page.getByText("Valid Dough", { exact: true })).toBeVisible();
    await expect(page.getByText("Legacy Dough", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: testInfo.outputPath("manager-attention-destination.png") });
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await openManagerAttention(page);
    await expect(page.getByTestId("manager-attention-list")).toBeVisible();
    await page.getByRole("button", { name: "Open full manager queue" }).click();
    await expect(page.getByTestId("manager-action-queue")).toBeVisible();
    await expect(page.getByText("Something went wrong", { exact: true })).toHaveCount(0);
    expect(browserErrors).toEqual([]);
  } finally {
    if (malformedAliasId !== null) {
      const cleanupDb = new Client({
        connectionString: requireIsolatedTestDatabase("remove malformed manager-attention alias"),
      });
      try {
        await cleanupDb.connect();
        await cleanupDb.query("DELETE FROM spec_import_aliases WHERE id = $1", [malformedAliasId]);
      } finally {
        await cleanupDb.end().catch(() => {});
      }
    }
    await fixtures.cleanup();
  }
});
