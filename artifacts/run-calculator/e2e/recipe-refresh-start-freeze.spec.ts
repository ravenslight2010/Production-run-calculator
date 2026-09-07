import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  uniqueTestId,
} from "./isolation";

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const PASSWORD = "TestPass123!";
const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
const TODAY = new Date().toISOString().slice(0, 10);

let fixtures: AuthorizedBrowserFixtures;

test.beforeAll(async ({ playwright }) => {
  fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
});

test.beforeEach(async () => {
  await fixtures.removeTodaySync([TODAY]);
});

test.afterAll(async () => {
  await fixtures?.cleanup({ syncDates: [TODAY] });
});

async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Recipes", exact: true }).click();
  await dialog.getByRole("button", { name: "Cheese", exact: true }).click();
  return dialog;
}

async function openSummary(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
}

async function setRecipeBatchLbs(
  page: Page,
  recipeName: string,
  lbs: string,
): Promise<void> {
  const dialog = await openSettings(page);
  const search = dialog.getByPlaceholder("Search cheese recipes by name, customer, or flavor…");
  await search.fill(recipeName);
  await dialog.getByRole("button", { name: new RegExp(recipeName) }).click();
  const input = dialog.getByRole("textbox", { name: "lbs per batch" });
  const saved = page.waitForResponse((response) =>
    response.url().includes("/api/cheese-recipes")
      && response.request().method() === "POST"
      && response.status() === 200,
  );
  await input.fill(lbs);
  await input.blur();
  await saved;
  await dialog.getByRole("button", { name: "Close settings" }).click();
}

test("pending recipes refresh while Start freezes the running snapshot", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const username = uniqueTestId("e2e_recipe_freeze");
  const brand = `Recipe Refresh ${uniqueTestId("brand")}`;
  const flavor = "Phone Fixture";
  const recipeId = uniqueTestId("cheese-recipe");
  const recipeName = `Shared Cheese ${uniqueTestId("recipe")}`;
  const currentRunId = uniqueTestId("current-run");
  const upcomingRunId = uniqueTestId("upcoming-run");
  const now = Date.now();
  const account = await fixtures.createAccount({
    username,
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });

  await fixtures.seedCheeseRecipe(account, {
    id: recipeId,
    name: recipeName,
    brand,
    components: [{ ingredient: "Cheese", lbs: 0 }],
  });

  const values = {
    casesNeeded: 100,
    pizzasPerCase: 1,
    casesPerSkid: 10,
    casesPerLayer: 0,
    crustsPerCycle: 1,
    cycleSpeed: 1,
    speedAdjustment: 1,
    freezerTime: 0,
    app1Type: "Cheese",
    app1OzPerPizza: 16,
    app1BatchLbs: 0,
    app1CheeseRecipeName: recipeName,
    app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 0 }],
  };
  await fixtures.seedBrandProfile(account, {
    brand,
    flavor,
    values,
    updatedAt: now,
  });
  await fixtures.seedTodaySync({
    token: account.token,
    senderId: `recipe-freeze-${username}`,
    date: TODAY,
    payload: {
      dayState: {
        date: TODAY,
        runs: [
          { id: currentRunId, brand, flavor, metaUpdatedAt: now, seeded: false },
          { id: upcomingRunId, brand, flavor, metaUpdatedAt: now, seeded: false },
        ],
        currentIndex: 0,
        resetAt: 0,
        substitutions: [],
        substitutionLog: [],
        stagedItems: {},
      },
      runValues: {
        [currentRunId]: values,
        [upcomingRunId]: values,
      },
      runValuesUpdatedAt: {
        [currentRunId]: now,
        [upcomingRunId]: now,
      },
      packagingProgress: {},
    },
  });

  await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTestId("tab-frontline").click();
  await expect(page.getByTestId("output-app1-batches")).toHaveText("120.0 lbs");

  await openSummary(page);
  const upcoming = page.getByTestId(`run-summary-${upcomingRunId}`);
  await expect(upcoming).toContainText("120.0 lbs");

  await setRecipeBatchLbs(page, recipeName, "20");
  await expect(upcoming).toContainText("6.00 batches");
  await page.getByTestId("tab-frontline").click();
  await expect(page.getByTestId("output-app1-batches")).toContainText("6.00");

  await page.getByTestId("tab-run").click();
  await page.getByTestId("button-start-run").click();
  await expect(page.getByRole("button", { name: /pause.?run/i })).toBeVisible();

  await setRecipeBatchLbs(page, recipeName, "40");
  await openSummary(page);
  await expect(upcoming).toContainText("3.00 batches");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-frontline").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTestId("tab-frontline").click();
  await expect(page.getByTestId("output-app1-batches")).toContainText("6.00");
  await openSummary(page);
  await expect(page.getByTestId(`run-summary-${upcomingRunId}`)).toContainText("3.00 batches");
});