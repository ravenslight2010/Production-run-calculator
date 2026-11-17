import { expect, test } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  freshMasterDataSeedHeaders,
  requireDedicatedTestDatabase,
  uniqueTestId,
} from "./isolation";

const WEB_BASE =
  process.env.PLAYWRIGHT_BASE_URL
  ?? (process.env.RELEASE_BROWSER_LOCAL_SERVERS === "1"
    ? `http://127.0.0.1:${process.env.RELEASE_BROWSER_WEB_PORT ?? "18084"}`
    : `https://${process.env.REPLIT_DEV_DOMAIN}`);
const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL;
const PASSWORD = "TestPass123!";

function signupCode(): string {
  const code = process.env.STAFF_SIGNUP_CODE;
  if (!code) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for the Schedule picker journey.");
  }
  return code;
}

test("Saved Schedule date, brand, and cases survive a reload @focused-only", async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(25_000);
  requireDedicatedTestDatabase("Schedule save/reload journey");
  if (!API_BASE) {
    throw new Error("PLAYWRIGHT_API_BASE_URL must point to the isolated local API.");
  }
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, signupCode());
  const brand = uniqueTestId("ScheduleSavedBrand");
  const cases = 137;
  const scheduleDates = new Set<string>();
  let managerHeaders: Record<string, string> | null = null;
  let originalBrands: string[] | null = null;
  try {
    const manager = await fixtures.createAccount({
      username: uniqueTestId("schedule_save_manager"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    await fixtures.assignManagerRole(manager);
    managerHeaders = { Cookie: `rc_auth=${manager.token}` };
    const factoryResponse = await page.request.get(`${API_BASE}/api/factory-data`, {
      headers: managerHeaders,
    });
    expect(factoryResponse.ok()).toBeTruthy();
    const factory = await factoryResponse.json();
    const storedBrands = factory.data?.["run-calc-brands"]?.value;
    originalBrands = Array.isArray(storedBrands) ? storedBrands : [];
    const brandSeed = await page.request.put(`${API_BASE}/api/factory-data`, {
      headers: await freshMasterDataSeedHeaders(
        page.request, `${API_BASE}/api/factory-data`, managerHeaders,
      ),
      data: { key: "run-calc-brands", value: [...originalBrands, brand] },
    });
    expect(brandSeed.ok()).toBeTruthy();
    await fixtures.seedBrandProfile(manager, {
      brand,
      flavor: "",
      values: {
        pizzasPerCase: 12,
        casesPerSkid: 50,
        crustsPerCycle: 1,
        cycleSpeed: 1,
        speedAdjustment: 1,
      },
    });
    await page.context().addCookies([{
      name: "rc_auth", value: manager.token, url: WEB_BASE,
    }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    const openSchedule = async () => {
      await page.getByRole("button", { name: /^More/ }).click();
      // Saved days add a numeric badge to the item's accessible name.
      await page.getByRole("menuitem", { name: /^Schedule(?:\s*\d+)?$/ }).click();
    };
    const dialog = page.getByRole("dialog").filter({
      has: page.locator("#scheduled-days-dialog-title"),
    }).first();
    await openSchedule();
    await dialog.getByRole("button", { name: "Schedule New Day", exact: true }).click();

    // Choose tomorrow through the calendar, including month/year boundaries.
    const { date, calendarLabel } = await page.evaluate(() => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const date = [
        tomorrow.getFullYear(),
        String(tomorrow.getMonth() + 1).padStart(2, "0"),
        String(tomorrow.getDate()).padStart(2, "0"),
      ].join("-");
      return { date, calendarLabel: tomorrow.toLocaleDateString() };
    });
    scheduleDates.add(date); // Register before Save so failed assertions still clean up.
    const dateTrigger = dialog.getByTestId("schedule-date-trigger");
    const initialDate = await dateTrigger.getAttribute("data-date-value");
    await dateTrigger.click();
    // Schedule's calendar is in a portaled popover dialog. The standalone
    // calendar fixture's named region is not part of this production surface.
    const calendar = page.getByRole("dialog").filter({ has: page.getByRole("grid") }).last();
    if (initialDate?.slice(0, 7) !== date.slice(0, 7)) {
      await calendar.getByRole("button", { name: "Go to the Next Month" }).click();
    }
    const tomorrowButton = calendar.locator(`button[data-day="${calendarLabel}"]`);
    await tomorrowButton.click();
    await expect(dialog.getByTestId("schedule-date-trigger")).toHaveAttribute("data-date-value", date);

    const brandTrigger = dialog.getByRole("combobox", { name: "Schedule brand", exact: true })
      .or(dialog.getByRole("button", { name: "Schedule brand", exact: true }));
    if (await brandTrigger.evaluate((element) => element.tagName === "SELECT")) {
      await expect(brandTrigger.locator("option", { hasText: brand })).toHaveCount(1, { timeout: 25_000 });
      await brandTrigger.selectOption(brand);
    } else {
      await brandTrigger.click();
      await page.getByRole("dialog", { name: "Schedule brand", exact: true })
        .getByRole("option", { name: brand, exact: true }).click({ timeout: 25_000 });
    }
    // The editor has one run; break controls are time inputs, not spinbuttons.
    const casesInput = dialog.getByRole("spinbutton");
    await casesInput.fill(String(cases));
    const [saved] = await Promise.all([
      page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/sync/${date}`
        && response.request().method() === "PUT",
      { timeout: 25_000 }),
      dialog.getByRole("button", { name: "Save Schedule", exact: true }).click(),
    ]);
    expect(saved.ok()).toBeTruthy();
    await expect(dialog.getByRole("button", { name: "Schedule New Day", exact: true })).toBeVisible();
    const canonicalResponse = await page.request.get(`${API_BASE}/api/sync/${date}`, {
      headers: managerHeaders,
    });
    expect(canonicalResponse.ok()).toBeTruthy();
    const canonical = await canonicalResponse.json();
    expect(canonical.dayState.runs).toHaveLength(1);
    const run = canonical.dayState.runs[0];
    expect(run.brand).toBe(brand);
    expect(canonical.runValues[run.id].casesNeeded).toBe(cases);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await openSchedule();
    // Scope Edit to this date's card, rather than any other planned day.
    const dayCard = dialog.getByTestId(`move-day-${date}`).locator("../..");
    await expect(dayCard).toBeVisible({ timeout: 25_000 });
    await dayCard.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(dialog.getByTestId("schedule-date-trigger")).toHaveAttribute("data-date-value", date);
    if (await brandTrigger.evaluate((element) => element.tagName === "SELECT")) {
      await expect(brandTrigger).toHaveValue(brand);
    } else {
      await expect(brandTrigger).toContainText(brand);
    }
    await expect(casesInput).toHaveValue(String(cases));
  } finally {
    // Stop page/SSE work before removing server fixtures.
    try {
      await page.goto("about:blank");
    } finally {
      try {
        if (managerHeaders && originalBrands) {
          const restored = await page.request.put(`${API_BASE}/api/factory-data`, {
            headers: await freshMasterDataSeedHeaders(
              page.request, `${API_BASE}/api/factory-data`, managerHeaders,
            ),
            data: { key: "run-calc-brands", value: originalBrands },
          });
          expect(restored.ok()).toBeTruthy();
        }
      } finally {
        await fixtures.cleanup({ syncDates: scheduleDates });
      }
    }
  }
});

test("Schedule access and nested brand picker work across browser sizes", async ({
  page,
  playwright,
}, testInfo) => {
  test.setTimeout(120_000);
  requireDedicatedTestDatabase("Schedule dialog-layering journey");
  if (!API_BASE) {
    throw new Error("PLAYWRIGHT_API_BASE_URL must point to the isolated local API.");
  }

  const fixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    API_BASE,
    signupCode(),
  );

  const brandA = uniqueTestId("ScheduleLayerBrandA");
  const brandB = uniqueTestId("ScheduleLayerBrandB");
  const values = {
    casesNeeded: 1,
    pizzasPerCase: 1,
    casesPerSkid: 1,
    crustsPerCycle: 1,
    cycleSpeed: 1,
    speedAdjustment: 1,
    doughRecipeName: "",
    doughRecipe: [],
    targetDoughballWeight: 16,
    doughballsPerTray: 1,
    frontlineRecipeName: "",
    frontlineRecipe: [],
    app1Type: "Cheese",
    app1CheeseRecipeName: "",
    app1CheeseRecipe: [],
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
  let managerHeaders: Record<string, string> | null = null;
  let originalBrands: string[] | null = null;

  try {
    const manager = await fixtures.createAccount({
      username: uniqueTestId("schedule_picker_manager"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    // The manager only seeds/restores fixtures. The browser actor must not
    // inherit unrelated manager permissions (especially manage-profiles).
    const scheduler = await fixtures.createAccount({
      username: uniqueTestId("schedule_picker_only"),
      password: PASSWORD,
      capabilities: ["manage-factory-settings"],
      onboardingSeen: true,
    });
    const restricted = await fixtures.createAccount({
      username: uniqueTestId("schedule_picker_restricted"),
      password: PASSWORD,
      capabilities: [],
      onboardingSeen: true,
    });

    for (const [account, capabilities] of [
      [scheduler, ["manage-factory-settings"]],
      [restricted, []],
    ] as const) {
      const session = await page.request.get(`${API_BASE}/api/me`, {
        headers: account.cookieHeader,
      });
      expect(session.ok()).toBe(true);
      const user = await session.json();
      expect(user.userId).toBe(account.userId);
      expect(user.capabilities).toEqual(capabilities);
    }

    managerHeaders = { Cookie: `rc_auth=${manager.token}` };
    const factoryDataResponse = await page.request.get(`${API_BASE}/api/factory-data`, {
      headers: managerHeaders,
    });
    if (!factoryDataResponse.ok()) {
      throw new Error(`Isolated factory-data read failed (${factoryDataResponse.status()}).`);
    }
    const factoryData = await factoryDataResponse.json() as {
      data?: Record<string, { value?: unknown }>;
    };
    const storedBrands = factoryData.data?.["run-calc-brands"]?.value;
    const brands = Array.isArray(storedBrands)
      ? storedBrands.filter((brand): brand is string => typeof brand === "string")
      : [];
    originalBrands = brands;
    const brandSeed = await page.request.put(`${API_BASE}/api/factory-data`, {
      headers: await freshMasterDataSeedHeaders(
        page.request,
        `${API_BASE}/api/factory-data`,
        managerHeaders,
      ),
      data: {
        key: "run-calc-brands",
        value: [brandA, brandB],
      },
    });
    if (!brandSeed.ok()) {
      throw new Error(`Isolated brand-list seed failed (${brandSeed.status()}).`);
    }

    await fixtures.seedBrandProfile(manager, {
      brand: brandA,
      flavor: uniqueTestId("ScheduleLayerFlavorA"),
      values,
    });
    await fixtures.seedBrandProfile(manager, {
      brand: brandB,
      flavor: uniqueTestId("ScheduleLayerFlavorB"),
      values,
    });

    await page.context().addCookies([{
      name: "rc_auth",
      value: scheduler.token,
      url: WEB_BASE,
    }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: "Schedule", exact: true }).click();
    const scheduleDialog = page
      .getByRole("dialog")
      .filter({ has: page.locator("#scheduled-days-dialog-title") })
      .first();
    await expect(scheduleDialog).toBeVisible();
    await scheduleDialog.getByRole("button", { name: "Schedule New Day", exact: true }).click();
    await expect(scheduleDialog.getByRole("heading", { name: /Plan for/ })).toBeVisible();

    const brandTrigger = scheduleDialog.getByRole("combobox", {
      name: "Schedule brand",
      exact: true,
    }).or(scheduleDialog.getByRole("button", {
      name: "Schedule brand",
      exact: true,
    }));
    await expect(brandTrigger).toBeVisible();
    const touchLayout = testInfo.project.name.includes("phone")
      || testInfo.project.name.includes("tablet");

    if (touchLayout) {
      await expect(brandTrigger).toHaveAttribute("aria-haspopup", "dialog");

      // Pointer selection proves the nested picker is above Schedule and its
      // actual option is reachable in the responsive viewport.
      const scheduleLayer = await scheduleDialog.evaluate((element) =>
        Number(getComputedStyle(element.parentElement!).zIndex),
      );
      await brandTrigger.tap();
      const pickerDialog = page.getByRole("dialog", { name: "Schedule brand", exact: true });
      await expect(pickerDialog).toBeVisible();
      const pickerOptionA = pickerDialog.getByRole("option", { name: brandA, exact: true });
      await expect(pickerOptionA).toBeVisible();
      await expect(pickerOptionA).toBeInViewport();
      const pickerLayer = await pickerDialog.evaluate((element) =>
        Number(getComputedStyle(element).zIndex),
      );
      expect(pickerLayer).toBeGreaterThan(scheduleLayer);
      await pickerOptionA.tap();
      await expect(pickerDialog).toBeHidden();
      await expect(brandTrigger).toContainText(brandA);

      // Keyboard selection must reach and activate a different visible option.
      await brandTrigger.focus();
      await page.keyboard.press("Enter");
      await expect(pickerDialog).toBeVisible();
      const pickerOptionB = pickerDialog.getByRole("option", { name: brandB, exact: true });
      await expect(pickerOptionB).toBeVisible();
      await pickerOptionB.focus();
      await page.keyboard.press("Enter");
      await expect(pickerDialog).toBeHidden();
      await expect(brandTrigger).toContainText(brandB);
    } else {
      await expect(brandTrigger).toHaveJSProperty("tagName", "SELECT");
      await expect(brandTrigger).toHaveValue("");

      // Open the native options with a real pointer action, then select by
      // keyboard. Navigate to each exact option rather than assuming the
      // fixture brands sort ahead of any existing factory brands.
      const optionValues = await brandTrigger.locator("option").evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value),
      );
      const selectWithKeyboard = async (value: string) => {
        const index = optionValues.indexOf(value);
        expect(index).toBeGreaterThan(0);
        await brandTrigger.focus();
        await page.keyboard.press("Home");
        for (let step = 0; step < index; step += 1) {
          await page.keyboard.press("ArrowDown");
        }
        await page.keyboard.press("Enter");
      };
      await brandTrigger.click();
      await selectWithKeyboard(brandA);
      await expect(brandTrigger).toHaveValue(brandA);
      await selectWithKeyboard(brandB);
      await expect(brandTrigger).toHaveValue(brandB);
    }

    await scheduleDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(scheduleDialog.getByRole("button", { name: "Schedule New Day" })).toBeVisible();
    await scheduleDialog.getByRole("button", { name: "Close scheduled days" }).click();
    await expect(scheduleDialog).toBeHidden();

    // Replace the Schedule-only session with a clean account that lacks the exact
    // Schedule capability, then verify the entry point is not offered.
    await page.context().clearCookies();
    await page.context().addCookies([{
      name: "rc_auth",
      value: restricted.token,
      url: WEB_BASE,
    }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await page.getByRole("button", { name: /^More/ }).click();
    await expect(page.getByRole("menuitem", { name: "Schedule", exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Scheduled Days" })).toHaveCount(0);
  } finally {
    try {
      if (managerHeaders && originalBrands) {
        const factoryRestore = await page.request.put(`${API_BASE}/api/factory-data`, {
          headers: await freshMasterDataSeedHeaders(
            page.request,
            `${API_BASE}/api/factory-data`,
            managerHeaders,
          ),
          data: { key: "run-calc-brands", value: originalBrands },
        });
        if (!factoryRestore.ok()) {
          throw new Error(`Isolated brand-list restore failed (${factoryRestore.status()}).`);
        }
      }
    } finally {
      await fixtures.cleanup();
    }
  }
});
