import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";
import { assertRecipePickerContract } from "./recipe-picker-contract";
const API_BASE = requireLocalFixtureApiOrigin("manager attention fixtures");
const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";

async function openManagerAttention(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: /^Manager attention/ }).click();
  await expect(page.getByRole("dialog", { name: "Manager attention" })).toBeVisible();
}

async function expectSmallTextContrast(locator: Locator, label: string): Promise<void> {
  const colors = await locator.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    const parseRgb = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) {
        throw new Error(`Cannot parse rendered color: ${value}`);
      }
      return {
        red: channels[0],
        green: channels[1],
        blue: channels[2],
        alpha: channels[3] ?? 1,
      };
    };
    const luminance = ({ red, green, blue }: ReturnType<typeof parseRgb>) => {
      const linearize = (channel: number) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * linearize(red)
        + 0.7152 * linearize(green)
        + 0.0722 * linearize(blue)
      );
    };
    const foreground = parseRgb(styles.color);
    const background = parseRgb(styles.backgroundColor);
    if (background.alpha !== 1) {
      throw new Error(`Expected an opaque badge background, got ${styles.backgroundColor}`);
    }
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return {
      foreground: styles.color,
      background: styles.backgroundColor,
      ratio: (values[0] + 0.05) / (values[1] + 0.05),
    };
  });

  expect(
    colors.ratio,
    `${label} contrast (${colors.foreground} on ${colors.background})`,
  ).toBeGreaterThanOrEqual(4.5);
}

async function createReviewableIncident(
  page: Page,
  token: string,
  description: string,
): Promise<string> {
  const response = await page.request.post(`${API_BASE}/api/incidents`, {
    headers: { Cookie: `rc_auth=${token}` },
    data: {
      source: "user_report",
      screen: "Run",
      appPlatform: "web",
      description,
    },
  });
  expect(response.ok(), `incident fixture creation failed: ${await response.text()}`).toBe(true);
  const body = await response.json() as { incidentId: string };
  return body.incidentId;
}
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);

  const incidentIds: string[] = [];

  const incidentIds: string[] = [];

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_manager_attention"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;
    await page.route("**/api/incidents/actionable-count", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 1 }),
      }));
    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

        const headerBadge = page.getByLabel(
          `${count} manager actions need attention`,
          { exact: true },
        );
    await expect(headerBadge).toBeVisible();
    await expect(headerBadge).toHaveText("1");
    await expectSmallTextContrast(headerBadge, "Header manager-attention badge");

    await page.getByRole("button", { name: /^More/ }).click();
        const menuItem = page.getByRole("menuitem", {
          name: accessibleMenuName,
          exact: true,
        });
        await expect(menuItem, `accessible menu item at ${viewport.name}`).toBeVisible();
        const menuBadge = menuItem.locator('span[aria-hidden="true"]');
    await expect(menuBadge).toBeVisible();
    await expect(menuBadge).toHaveText("1");
    await expectSmallTextContrast(menuBadge, "More-menu manager-attention badge");
  } finally {
    await fixtures.cleanup();
  }
});

test("manager can review and resolve an incident with Enter and Space", async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);

  const incidentIds: string[] = [];

  const incidentIds: string[] = [];
  let mockedAttentionCount = 1;

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_manager_attention"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;
    await page.route("**/api/incidents/actionable-count", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: mockedAttentionCount }),
      }));
    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);

    const viewports = [
      { name: "desktop", width: 1440, height: 1000 },
      { name: "phone", width: 390, height: 844 },
      { name: "tablet portrait", width: 768, height: 1024 },
      { name: "tablet landscape", width: 1024, height: 768 },
    ] as const;

    for (const count of [1, 42, 123]) {
      mockedAttentionCount = count;
      const countResponse = page.waitForResponse(
        (response) => response.url().includes("/api/incidents/actionable-count"),
        { timeout: 25_000 },
      );
      if (page.url() === "about:blank") {
        await page.goto("/", { waitUntil: "domcontentloaded" });
      } else {
        await page.reload({ waitUntil: "domcontentloaded" });
      }
      const response = await countResponse;
      expect(response.ok(), `mocked count endpoint for ${count}`).toBe(true);
      expect(await response.json()).toEqual({ count });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const headerBadge = page.getByLabel(
          `${count} manager actions need attention`,
          { exact: true },
        );
        await expect(headerBadge, `header badge at ${viewport.name}`).toBeVisible();
        await expect(headerBadge).toHaveText(String(count));
        await expectBadgeFitsViewport(headerBadge, `header badge at ${viewport.name}`);

        await page.getByRole("button", { name: /^More/ }).click();
        const accessibleMenuName =
          `Manager attention — ${count} manager actions need attention`;
        const menuItem = page.getByRole("menuitem", {
          name: accessibleMenuName,
          exact: true,
        });
        await expect(menuItem, `accessible menu item at ${viewport.name}`).toBeVisible();
        const menuBadge = menuItem.locator('span[aria-hidden="true"]');
        await expect(menuBadge, `visual menu badge at ${viewport.name}`).toBeVisible();
        await expect(menuBadge).toHaveText(String(count));
        await expectBadgeFitsViewport(menuBadge, `menu badge at ${viewport.name}`);
        await page.keyboard.press("Escape");
      }
    }
  } finally {
    await fixtures.cleanup();
  }
});

async function expectBadgeFitsViewport(locator: Locator, label: string): Promise<void> {
  const bounds = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(bounds.width, `${label} has a rendered width`).toBeGreaterThan(0);
  expect(bounds.height, `${label} has a rendered height`).toBeGreaterThan(0);
  expect(bounds.scrollWidth, `${label} text is not clipped horizontally`)
    .toBeLessThanOrEqual(bounds.clientWidth);
  expect(bounds.x, `${label} remains inside the left viewport edge`).toBeGreaterThanOrEqual(0);
  expect(bounds.y, `${label} remains inside the top viewport edge`).toBeGreaterThanOrEqual(0);
  expect(bounds.right, `${label} remains inside the right viewport edge`)
    .toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.bottom, `${label} remains inside the bottom viewport edge`)
    .toBeLessThanOrEqual(bounds.viewportHeight);
}

test("manager can open and close Manager attention using only the keyboard", async ({
  page,
  playwright,
}) => {
  test.setTimeout(60_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);

  const incidentIds: string[] = [];

  const incidentIds: string[] = [];

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_manager_attention"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;
    await page.route("**/api/incidents/actionable-count", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 1 }),
      }));
    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    const moreButton = page.getByRole("button", { name: /^More/ });
    await expect(page.getByLabel("1 manager actions need attention", { exact: true })).toBeVisible();
    await moreButton.focus();
    await expect(moreButton).toBeFocused();
    await page.keyboard.press("Enter");

    const managerAttentionItem = page.getByRole("menuitem", {
      name: /^Manager attention/,
    });
    await expect(managerAttentionItem).toBeVisible();
    await page.keyboard.press("Home");
    await expect(managerAttentionItem).toBeFocused();
    await page.keyboard.press("Enter");

      const dialog = page.getByRole("dialog", { name: "Manager attention" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(moreButton).toBeVisible();
    await expect(moreButton).toBeFocused();
  } finally {
    await fixtures.cleanup();
  }
});

test("manager can keyboard-open each Manager attention workflow and retain useful focus", async ({
  page,
  playwright,
}) => {
  test.setTimeout(90_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);

  const incidentIds: string[] = [];

  const incidentIds: string[] = [];

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_manager_attention"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;
    const scheduledBrand = uniqueTestId("AttentionBrand");
    const scheduledFlavor = uniqueTestId("AttentionFlavor");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    await page.route("**/api/password-reset-requests", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          id: uniqueTestId("keyboard-reset"),
          userId: uniqueTestId("keyboard-staff"),
          username: "keyboard-fixture-staff",
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
            id: uniqueTestId("keyboard-scheduled"),
            brand: scheduledBrand,
            flavor: scheduledFlavor,
            casesNeeded: 10,
            dieType: "",
          }],
        }]),
      }));
    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    const activateByTabAndEnter = async (action: Locator) => {
      for (let tabCount = 0; tabCount < 40; tabCount += 1) {
        if (await action.evaluate((element) => element === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(action).toBeFocused();
      await page.keyboard.press("Enter");
    };
    const expectUsefulFocus = async () => {
      const focused = page.locator(":focus");
      await expect(focused).toBeVisible();
      const focusState = await focused.evaluate((element) => ({
        tagName: element.tagName,
        enabled: !("disabled" in element) || !(element as HTMLButtonElement).disabled,
        actionable:
          element.matches("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
      }));
      expect(focusState.tagName, "focus must not be abandoned on the document body").not.toMatch(
        /^(BODY|HTML)$/,
      );
      expect(focusState.enabled, "focus must remain on an enabled control").toBe(true);
      expect(focusState.actionable, "focus must remain on a keyboard-operable control").toBe(true);
    };

    const moreButton = page.getByRole("button", { name: /^More/ });
    const workflows = [
      {
        kind: "password-resets",
        destination: () => page.getByRole("heading", { name: "Staff Roster" }),
      },
      {
        kind: "incidents",
        destination: () =>
          page
            .locator(".station-tabs [role='tabpanel'][data-state='active']")
            .getByText("Reported issues", { exact: true }),
      },
      {
        kind: "recipe-setup",
        destination: () => page.getByRole("dialog", { name: "Setup Profiles" }),
      },
    ] as const;

    for (const workflow of workflows) {
      await openManagerAttention(page);
      const dialog = page.getByRole("dialog", { name: "Manager attention" });
      await expect(dialog.getByTestId(`manager-attention-${workflow.kind}`)).toBeVisible();
      const action = dialog.getByTestId(`manager-attention-action-${workflow.kind}`);
      await activateByTabAndEnter(action);
      await expect(workflow.destination()).toBeVisible();
      await expect(dialog).toBeHidden();
      await expectUsefulFocus();

      if (workflow.kind !== "recipe-setup") {
        await expect(
          page.locator(".station-tabs [role='tabpanel'][data-state='active']"),
        ).toBeFocused();
      } else {
        await expect(page.getByText(scheduledBrand, { exact: true })).toBeVisible();
        await expect(page.getByText(scheduledFlavor, { exact: true })).toBeVisible();
        await page.getByRole("dialog", { name: "Setup Profiles" })
          .getByRole("button", { name: "Close", exact: true })
          .click();
      }
      await expect(moreButton).toBeVisible();
    }
  } finally {
    await fixtures.cleanup();
  }
});

test("manager can approve and decline password resets by keyboard and retain useful focus", async ({
  page,
  playwright,
}) => {
  test.setTimeout(150_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);

  const incidentIds: string[] = [];

  const incidentIds: string[] = [];
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  try {
    const manager = await fixtures.createAccount({
      username: uniqueTestId("e2e_reset_keyboard_manager"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    const approvedStaff = await fixtures.createAccount({
      username: uniqueTestId("e2e_reset_keyboard_approved"),
      password: PASSWORD,
      capabilities: [],
      onboardingSeen: true,
    });
    const declinedStaff = await fixtures.createAccount({
      username: uniqueTestId("e2e_reset_keyboard_declined"),
      password: PASSWORD,
      capabilities: [],
      onboardingSeen: true,
    });
    const approvedRequestId = uniqueTestId("keyboard_approved_reset");
    const declinedRequestId = uniqueTestId("keyboard_declined_reset");
    const seedDb = new Client({
      connectionString: requireIsolatedTestDatabase("seed malformed manager-attention alias"),
    });
    try {
      await seedDb.connect();
    const now = Date.now();
      await seedDb.query(
        `INSERT INTO password_reset_requests (id, user_id, status, created_at)
         VALUES ($1, $2, 'pending', $3), ($4, $5, 'pending', $6)`,
        [
          approvedRequestId,
          approvedStaff.userId,
          new Date(now),
          declinedRequestId,
          declinedStaff.userId,
          new Date(now - 1_000),
        ],
      );
    } finally {
      await seedDb.end().catch(() => {});
    }

    await page.context().addCookies([
      { name: "rc_auth", value: manager.token, url: API_BASE },
    ]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await openManagerAttention(page);
    await page.getByTestId("manager-attention-action-password-resets").click();

    const approvedRow = page.getByTestId(`password-reset-request-${approvedRequestId}`);
    const declinedRow = page.getByTestId(`password-reset-request-${declinedRequestId}`);
    await expect(approvedRow).toContainText(approvedStaff.username);
    await expect(declinedRow).toContainText(declinedStaff.username);

    const tabTo = async (target: Locator) => {
      for (let tabCount = 0; tabCount < 120; tabCount += 1) {
        if (await target.evaluate((element) => element === document.activeElement)) return;
        await page.keyboard.press("Tab");
      }
      throw new Error("Keyboard navigation did not reach the requested password reset control.");
    };

    const approvedDecline = approvedRow.getByRole("button", {
      name: "Decline",
      exact: true,
    });
    const approve = approvedRow.getByRole("button", {
      name: "Approve",
      exact: true,
    });
    await tabTo(approvedDecline);
    await expect(approvedDecline).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(approve).toBeFocused();
    await page.keyboard.press("Enter");

    const codeDialog = page.getByRole("dialog", {
      name: `Reset code for ${approvedStaff.username}`,
    });
    await expect(codeDialog).toBeVisible();
    await expect(codeDialog.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)).toBeVisible();
    const approvedStatus = page.getByTestId("password-reset-decision-status");
    await expect(approvedStatus).toContainText(
      `Password reset request for ${approvedStaff.username} approved.`,
    );

    const doneButton = codeDialog.getByRole("button", { name: "Done", exact: true });
    await tabTo(doneButton);
    await expect(doneButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(codeDialog).toBeHidden();
    await expect(approvedRow).toBeHidden();
    await expect(declinedRow).toBeVisible();
    const declinedAction = declinedRow.getByRole("button", {
      name: "Decline",
      exact: true,
    });
    await expect(declinedAction).toBeFocused();

    const declinedApprove = declinedRow.getByRole("button", {
      name: "Approve",
      exact: true,
    });
    await page.keyboard.press("Tab");
    await expect(declinedApprove).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(declinedAction).toBeFocused();
    await page.keyboard.press("Space");

    await expect(declinedRow).toBeHidden();
    await expect(page.getByText("No pending password reset requests.")).toBeVisible();
    await expect(page.getByTestId("password-reset-decision-status")).toContainText(
      `Password reset request for ${declinedStaff.username} declined.`,
    );
    await expect(
      page.getByText("Password reset requests", { exact: true }),
    ).toBeFocused();

    const verifyDb = new Client({
      connectionString: requireIsolatedTestDatabase(
        "verify keyboard password reset decisions",
      ),
    });
    try {
      await verifyDb.connect();
      const result = await seedDb.query<{ id: number }>(
        `INSERT INTO spec_import_aliases
          (scope, kind, external_name, canonical_name, context)
         VALUES ('live', 'flavor', $1, $2, NULL)
         RETURNING id`,
        [malformedAliasExternalName, malformedAliasCanonicalName],
      );
      expect(result.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: approvedRequestId,
            status: "approved",
            code_hash: expect.any(String),
          }),
          expect.objectContaining({
            id: declinedRequestId,
            status: "declined",
            code_hash: null,
          }),
        ]),
      );
    } finally {
      await verifyDb.end().catch(() => {});
    }
    expect(browserErrors).toEqual([]);
  } finally {
    await fixtures.cleanup();
  }
});

test("manager setup stays usable when recipe names are incomplete", async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);

  const incidentIds: string[] = [];

  const incidentIds: string[] = [];
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_manager_attention"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;
    const scheduledBrand = uniqueTestId("AttentionBrand");
    const scheduledFlavor = uniqueTestId("AttentionFlavor");
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

  const incidentIds: string[] = [];

  const incidentIds: string[] = [];

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_manager_attention"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;
    const brand = uniqueTestId("RecipeRoundTripBrand");
    const flavor = uniqueTestId("RecipeRoundTripFlavor");

    const oldCheeseName = uniqueTestId("RecipeRoundTripOldCheese");
    const oldMixName = uniqueTestId("RecipeRoundTripOldMix");
    const doughName = uniqueTestId("PickerContractDough");
    const sauceName = uniqueTestId("PickerContractSauce");
    const cheeseName = uniqueTestId("PickerContractCheese");
    const mixName = uniqueTestId("PickerContractMix");
    const savedCheeseName = uniqueTestId("PickerSavedCheese");
    const savedMixName = uniqueTestId("PickerSavedMix");
    const runId = uniqueTestId("picker-contract-run");
    const now = Date.now();
    const values = {
      casesNeeded: 1,
      pizzasPerCase: 1,
      casesPerSkid: 1,
      crustsPerCycle: 1,
      cycleSpeed: 1,
      speedAdjustment: 1,
      app1Type: "Cheese",
      app1CheeseRecipeName: oldCheeseName,
      app1CheeseRecipe: [{ ingredient: "Old Cheese", lbs: 10 }],
      app2Type: "Mix",
      app2CheeseRecipeName: oldMixName,
      app2CheeseRecipe: [{ ingredient: "Old Mix", lbs: 10 }],
      app3Type: "Cheese",
      app3CheeseRecipeName: oldCheeseName,
      app3CheeseRecipe: [{ ingredient: "Old Cheese", lbs: 10 }],
      app4Type: "Mix",
      app4CheeseRecipeName: oldMixName,
      app4CheeseRecipe: [{ ingredient: "Old Mix", lbs: 10 }],
    };

    const openSetupProfiles = async () => {
      await page.getByRole("button", { name: /^More/ }).click();
      await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
      await expect(settings).toBeVisible();
      await settings.getByRole("button", { name: "Tools", exact: true }).click();
      await settings.getByRole("button", { name: "Setup Profiles", exact: true }).click();
      await settings.getByRole("button", { name: "Open Setup Profiles Editor", exact: true }).click();

      const profileSurface = page.getByRole("dialog", { name: "Setup Profiles" });
      await expect(profileSurface).toBeVisible();
      return profileSurface;
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
    await fixtures.seedCheeseRecipe(account, {
      id: uniqueTestId("picker-saved-cheese"),
      name: savedCheeseName,
      components: [{ ingredient: "Saved Cheese", lbs: 10 }],
    });
    await fixtures.seedMix(account, {
      id: uniqueTestId("picker-contract-mix"),
      name: mixName,
      components: [{ ingredient: "Blend", perPizza: 1 }],
    });
    await fixtures.seedMix(account, {
      id: uniqueTestId("picker-saved-mix"),
      name: savedMixName,
      components: [{ ingredient: "Saved Blend", perPizza: 1 }],
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
    const profilesRead = page.waitForResponse(
      (response) =>
        response.url().includes("/api/brand-profiles")
        && response.request().method() === "GET"
        && response.status() === 200,
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await profilesRead;

    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: "Setup", exact: true }).click();
    const liveSurface = page.getByTestId("setup-recipes-fieldset");
    await expect(liveSurface).toBeVisible();
    await expect(liveSurface.getByTestId("setup-recipe-picker-dough")).toBeVisible();
    await liveSurface.getByText("Sauce & Applicator Weights", { exact: true }).click();
    await assertRecipePickerContract(liveSurface, "live Setup tab");

    let profileSurface = await openSetupProfiles();
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

    await profileSurface
      .getByTestId("setup-recipe-picker-app-1-cheese")
      .selectOption(savedCheeseName);
    await profileSurface
      .getByTestId("setup-recipe-picker-app-3-cheese")
      .selectOption(savedCheeseName);

    const selectMixRecipe = async (testId: string, recipeName: string) => {
      const picker = profileSurface.getByTestId(testId);
      await picker.click();
      const dropdown = page.getByPlaceholder("Search or add…").locator("..");
      await dropdown.getByRole("button", { name: recipeName, exact: true }).click();
      await expect(picker).toContainText(recipeName);
    };

    await selectMixRecipe("setup-recipe-picker-app-2-mix", savedMixName);
    await selectMixRecipe("setup-recipe-picker-app-4-mix", savedMixName);

    const savedProfile = page.waitForResponse(
      (response) =>
        response.url().includes("/api/brand-profiles")
        && response.request().method() === "POST"
        && response.status() === 200,
    );
    await profileSurface.getByRole("button", { name: "Save Setup", exact: true }).click();
    await savedProfile;
    await expect(
      page.getByText(`Saved setup for ${brand} — ${flavor}`, { exact: true }),
    ).toBeVisible();
    await profileSurface.getByRole("button", { name: "Close", exact: true }).click();
    await expect(profileSurface).toBeHidden();

    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    const reopenedSettings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
    await expect(reopenedSettings).toBeVisible();
    await reopenedSettings.getByRole("button", { name: "Tools", exact: true }).click();
    await reopenedSettings.getByRole("button", { name: "Setup Profiles", exact: true }).click();
    await reopenedSettings.getByRole("button", { name: "Open Setup Profiles Editor", exact: true }).click();
    const reopenedProfileSurface = page.getByRole("dialog", { name: "Setup Profiles" });
    await expect(reopenedProfileSurface).toBeVisible();

    const reopenPicker = async (
      pickerName: "Pick or add a brand…" | "Pick or add a flavor…",
      value: string,
    ) => {
      const picker = reopenedProfileSurface.getByRole("button", { name: pickerName, exact: true });
      await picker.click();
      await page.getByPlaceholder("Search or add…").fill(value);
      const existing = page.getByRole("button", { name: value, exact: true });
      if (await existing.count()) {
        await existing.last().click();
      } else {
        await page.getByRole("button", { name: `Add "${value}"`, exact: true }).click();
      }
    };

    await reopenPicker("Pick or add a brand…", brand);
    await reopenPicker("Pick or add a flavor…", flavor);
    await expect(
      reopenedProfileSurface.getByTestId("setup-recipe-picker-app-1-cheese"),
    ).toHaveValue(savedCheeseName);
    await expect(
      reopenedProfileSurface.getByTestId("setup-recipe-picker-app-3-cheese"),
    ).toHaveValue(savedCheeseName);
    await expect(
      reopenedProfileSurface.getByTestId("setup-recipe-picker-app-2-mix"),
    ).toContainText(savedMixName);
    await expect(
      reopenedProfileSurface.getByTestId("setup-recipe-picker-app-4-mix"),
    ).toContainText(savedMixName);
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

  const incidentIds: string[] = [];

  const incidentIds: string[] = [];
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

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;

    const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;
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
      localStorage.setItem("run-calc-recipe-name-consolidation-v1", "1");
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
    await expect(page.getByText("Valid Dough", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Legacy Dough", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: testInfo.outputPath("manager-attention-destination.png") });
    const setupProfilesClose = page.getByRole("button", { name: "Close", exact: true });
    if (await setupProfilesClose.count()) {
      await setupProfilesClose.click();
    }

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

    const resolvedButton = incident.getByRole("button", { name: "Mark resolved" });

    const focused = page.locator(":focus");

async function deleteIncidentFixtures(incidentIds: readonly string[]): Promise<void> {
  if (incidentIds.length === 0) return;
  const connectionString = requireIsolatedTestDatabase("clean up manager incident fixtures");
  const db = new Client({ connectionString });
  try {
    await db.connect();
    await db.query(
      "DELETE FROM incidents WHERE id = ANY($1::text[]) AND scope = 'live'",
      [incidentIds],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

    const incidentId = await createReviewableIncident(page, account.token, description);

    const reviewedIncident = page.getByTestId("incident-row").filter({
      has: page.locator(`[data-incident-header="${incidentId}"]`),
    });

    const reviewedButton = incident.getByRole("button", { name: "Mark reviewed" });

async function tabToControl(page: Page, control: Locator, maxTabs = 30): Promise<void> {
  for (let tabCount = 0; tabCount < maxTabs; tabCount += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(control).toBeFocused();
}

    const headerButton = incident.locator("[data-incident-header]");

    const incident = page.getByTestId("incident-row").filter({
      has: page.locator(`[data-incident-header="${incidentId}"]`),
    });

    const section = page.locator('section[aria-labelledby="incident-list-heading"]');
