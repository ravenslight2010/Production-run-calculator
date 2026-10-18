import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireDedicatedTestDatabase,
  uniqueTestId,
} from "./isolation";

const API_BASE =
  process.env.PLAYWRIGHT_BASE_URL
  ?? (process.env.RELEASE_BROWSER_LOCAL_SERVERS === "1"
    ? `http://127.0.0.1:${process.env.RELEASE_BROWSER_WEB_PORT ?? "18084"}`
    : `https://${process.env.REPLIT_DEV_DOMAIN}`);
const PASSWORD = "TestPass123!";
const TOUCH_PROJECTS = new Set([
  "phone-safari",
  "tablet-portrait-safari",
  "tablet-landscape-safari",
]);

function signupCode(): string {
  const code = process.env.STAFF_SIGNUP_CODE;
  if (!code) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for the WebKit recipe-picker journey.");
  }
  return code;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function activate(locator: Locator, touch: boolean): Promise<void> {
  if (touch) await locator.tap();
  else await locator.click();
}

async function chooseOption(
  page: Page,
  trigger: Locator,
  label: string,
  optionName: string,
  touch: boolean,
): Promise<void> {
  await activate(trigger, touch);
  if (touch) {
    const dialog = page.getByRole("dialog", { name: label, exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("option", { name: optionName, exact: true }).tap();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  } else {
    const search = page.getByPlaceholder("Search or add…").last();
    await search.fill(optionName);
    await page.getByRole("button", { name: optionName, exact: true }).last().click();
  }
  await expect(trigger).toContainText(optionName);
}

async function addOption(
  page: Page,
  trigger: Locator,
  label: string,
  optionName: string,
  touch: boolean,
): Promise<void> {
  await activate(trigger, touch);
  const picker = touch
    ? page.getByRole("dialog", { name: label, exact: true })
    : page.getByPlaceholder("Search or add…").last().locator("xpath=..");
  await expect(picker).toBeVisible();
  const search = picker.getByPlaceholder("Search or add…");
  await search.fill(optionName);
  await picker
    .getByRole("button", { name: new RegExp(`^Add .*${escapeRegExp(optionName)}`) })
    .click();
  if (touch) {
    await expect(picker).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  await expect(trigger).toContainText(optionName);
}

async function pickOrAddNamedValue(
  page: Page,
  surface: Locator,
  trigger: Locator,
  dialogName: string,
  value: string,
  touch: boolean,
): Promise<void> {
  await activate(trigger, touch);
  const picker = touch
    ? page.getByRole("dialog", { name: dialogName, exact: true })
    : surface;
  await expect(picker).toBeVisible();
  await picker.getByPlaceholder("Search or add…").last().fill(value);
  const existing = picker.getByRole(touch ? "option" : "button", { name: value, exact: true });
  if (await existing.count()) {
    await existing.click();
  } else {
    await picker.getByRole("button", { name: new RegExp(`^Add .*${escapeRegExp(value)}`) }).click();
  }
  if (touch) {
    await expect(picker).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  await expect(surface).toContainText(value);
}

async function clearType(
  page: Page,
  trigger: Locator,
  touch: boolean,
): Promise<void> {
  await activate(trigger, touch);
  if (touch) {
    const dialog = page.getByRole("dialog", { name: "Applicator 1", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("option", { name: "— None", exact: true }).tap();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  } else {
    const menu = page.getByPlaceholder("Search or add…").last().locator("xpath=..");
    await menu.getByRole("button", { name: "— None", exact: true }).click();
  }
  await expect(trigger).toContainText("Select…");
}

async function exercisePickerSurface(
  page: Page,
  surface: Locator,
  surfaceName: string,
  typeTestId: string,
  alternateDoughName: string,
  addedDoughName: string,
  addedTypeName: string,
  touch: boolean,
): Promise<void> {
  const doughPicker = surface.getByTestId("setup-recipe-picker-dough");
  await expect(doughPicker, `${surfaceName}: Dough recipe accessible label`)
    .toHaveAccessibleName("Dough recipe");
  await chooseOption(page, doughPicker, "Dough recipe", alternateDoughName, touch);
  await addOption(page, doughPicker, "Dough recipe", addedDoughName, touch);

  const typePicker = surface.getByTestId(typeTestId);
  await expect(typePicker, `${surfaceName}: Applicator 1 accessible label`)
    .toHaveAccessibleName("Applicator 1");
  await chooseOption(page, typePicker, "Applicator 1", "Mix", touch);
  await addOption(page, typePicker, "Applicator 1", addedTypeName, touch);
  await clearType(page, typePicker, touch);
}

test("shared recipe pickers select, add, clear, and restore focus in setup and live-run surfaces", async ({
  page,
  playwright,
}, testInfo) => {
  test.setTimeout(120_000);
  requireDedicatedTestDatabase("WebKit recipe-picker journey");
  const touch = TOUCH_PROJECTS.has(testInfo.project.name);
  const fixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    API_BASE,
    signupCode(),
  );

  const brand = uniqueTestId("SafariPickerBrand");
  const flavor = uniqueTestId("SafariPickerFlavor");
  const doughNameA = uniqueTestId("SafariDoughA");
  const doughNameB = uniqueTestId("SafariDoughB");
  const addedProfileDough = uniqueTestId("SafariAddedProfileDough");
  const addedLiveDough = uniqueTestId("SafariAddedLiveDough");
  const addedProfileType = uniqueTestId("SafariAddedProfileType");
  const addedLiveType = uniqueTestId("SafariAddedLiveType");
  const runId = uniqueTestId("safari-picker-run");
  const values = {
    casesNeeded: 1,
    pizzasPerCase: 1,
    casesPerSkid: 1,
    crustsPerCycle: 1,
    cycleSpeed: 1,
    speedAdjustment: 1,
    doughRecipeName: doughNameA,
    doughRecipe: [{ ingredient: "Flour", lbs: 10 }],
    targetDoughballWeight: 16,
    doughballsPerTray: 1,
    frontlineRecipeName: "",
    frontlineRecipe: [],
    app1Type: "Cheese",
    app1CheeseRecipeName: "",
    app1CheeseRecipe: [{ ingredient: "Cheese", lbs: 10 }],
    app1OzPerPizza: 1,
    app2Type: "",
    app2CheeseRecipeName: "",
    app2CheeseRecipe: [],
    app3Type: "",
    app3CheeseRecipeName: "",
    app3CheeseRecipe: [],
    app4Type: "",
    app4CheeseRecipeName: "",
    app4CheeseRecipe: [],
  };

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("webkit_recipe_picker"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    for (const name of [doughNameA, doughNameB]) {
      await fixtures.seedNamedRecipe("dough", account, {
        id: uniqueTestId("safari-picker-dough"),
        name,
        components: [{ ingredient: "Flour", lbs: 10 }],
      });
    }
    await fixtures.seedBrandProfile(account, {
      brand,
      flavor,
      values,
      updatedAt: Date.now(),
    });
    const syncDate = new Date().toISOString().slice(0, 10);
    await fixtures.removeTodaySync([syncDate]);
    await fixtures.seedTodaySync({
      token: account.token,
      senderId: uniqueTestId("safari-picker-sender"),
      date: syncDate,
      payload: {
        dayState: {
          date: syncDate,
          runs: [{ id: runId, brand, flavor, casesNeeded: 1, seeded: false }],
          currentIndex: 0,
          resetAt: 0,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        },
        runValues: { [runId]: values },
        runValuesUpdatedAt: { [runId]: Date.now() },
        packagingProgress: {},
      },
    });

    await page.context().addCookies([{
      name: "rc_auth",
      value: account.token,
      url: API_BASE,
    }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await page.getByTestId("tab-warehouse").click();
    await page.getByRole("button", { name: /^More(?: — \d+ manager actions? need attention)?$/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Manage Lists & Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("button", { name: "Setup Profiles", exact: true }).click();
    await page.getByRole("button", { name: "Open Setup Profiles Editor", exact: true }).click();

    const profileSurface = page.getByRole("dialog", { name: "Setup Profiles" });
    await expect(profileSurface).toBeVisible();
    const brandPicker = profileSurface.getByRole("button", {
      name: "Pick or add a brand…",
      exact: true,
    });
    await pickOrAddNamedValue(
      page,
      profileSurface,
      brandPicker,
      "Select pick or add a brand",
      brand,
      touch,
    );

    const flavorPicker = profileSurface.getByRole("button", {
      name: "Pick or add a flavor…",
      exact: true,
    });
    await pickOrAddNamedValue(
      page,
      profileSurface,
      flavorPicker,
      "Select pick or add a flavor",
      flavor,
      touch,
    );

    await exercisePickerSurface(
      page,
      profileSurface,
      "Setup Profiles",
      "setup-profile-picker-app-1-type",
      doughNameB,
      addedProfileDough,
      addedProfileType,
      touch,
    );
    await profileSurface.getByRole("button", { name: "Close setup profiles" }).click();
    await expect(profileSurface).toBeHidden();

    await page.getByRole("button", { name: /^More(?: — \d+ manager actions? need attention)?$/ }).click();
    await page.getByRole("menuitem", { name: "Setup", exact: true }).click();
    const liveSurface = page.getByTestId("setup-recipes-fieldset");
    await expect(liveSurface).toBeVisible();
    await liveSurface.getByText("Sauce & Applicator Weights", { exact: true }).click();
    await exercisePickerSurface(
      page,
      liveSurface,
      "live Setup",
      "live-setup-picker-app-1-type",
      doughNameB,
      addedLiveDough,
      addedLiveType,
      touch,
    );
  } finally {
    await fixtures.cleanup();
  }
});
