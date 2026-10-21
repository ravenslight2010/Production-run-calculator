import { expect, test, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupDailySync,
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
  DEFAULT_MANAGER_CAPABILITIES,
} from "./isolation";
import {
  dismissOnboardingIfPresent,
  signUpAndHandleOnboarding,
} from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

async function openMore(page: Page): Promise<void> {
  const menu = page.getByRole("menu");
  if (await menu.isVisible().catch(() => false)) {
    await expect(menu).toBeHidden({ timeout: 5_000 });
  }
  await page.getByTitle("More").click();
  await expect(menu).toBeVisible();
}

async function openMoreItem(page: Page, label: string): Promise<void> {
  await openMore(page);
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

async function expectDeferredPanel(
  page: Page,
  label: string,
  content: Locator,
): Promise<void> {
  await expect(content, `${label} should render on first open`).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(`Loading ${label}…`, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: `Couldn’t load ${label}.` }),
  ).toHaveCount(0);
}

async function promoteToManager(username: string): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("promote Home panel fixture"),
  });
  try {
    await db.connect();
    await db.query(
      "UPDATE roles SET capabilities = $1::jsonb, updated_at = NOW() WHERE name = 'manager'",
      [JSON.stringify(DEFAULT_MANAGER_CAPABILITIES)],
    );
    const user = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE username = $1",
      [username],
    );
    expect(user.rows).toHaveLength(1);
    await db.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager', updated_at = NOW()`,
      [user.rows[0].id],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

test.beforeAll(() => {
  requireIsolatedTestDatabase("Home deferred panels browser check");
});

test.beforeEach(async () => {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase(
      "reset Home deferred panel fixture",
    ),
  });
  try {
    await db.connect();
    // Playwright projects share this disposable database. Clear any live run
    // left by the previous browser/viewport before exercising the idle path.
    const dates = [
      ...new Set([
        new Date().toISOString().slice(0, 10),
        new Date().toLocaleDateString("en-CA"),
      ]),
    ];
    await cleanupDailySync(db, dates, "live");
  } finally {
    await db.end().catch(() => {});
  }
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

test("Home opens each deferred panel in the selected browser and viewport", async ({
  page,
}) => {
  const username = uniqueTestId("e2e_home_deferred");
  const pageErrors: string[] = [];
  const failedScriptRequests: string[] = [];
  testUsernames.add(username);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (
      response.request().resourceType() === "script" &&
      !response.ok()
    ) {
      failedScriptRequests.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.resourceType() === "script") {
      failedScriptRequests.push(
        `${request.failure()?.errorText ?? "request failed"} ${request.url()}`,
      );
    }
  });

  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
  });
  await dismissOnboardingIfPresent(page);
  await promoteToManager(username);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("tab-run")).toHaveAttribute(
    "data-state",
    "active",
  );

  await page.getByTestId("tab-warehouse").click();
  await expectDeferredPanel(
    page,
    "Warehouse",
    page.getByTestId("warehouse-page-heading"),
  );

  await openMoreItem(page, "Setup");
  await expectDeferredPanel(
    page,
    "Setup",
    page.getByTestId("setup-header"),
  );
  await expectDeferredPanel(
    page,
    "Setup recipes",
    page.getByTestId("setup-recipe-picker-dough"),
  );

  await openMoreItem(page, "Mix Plan");
  await expectDeferredPanel(
    page,
    "Mix Plan",
    page.getByRole("heading", { name: "Mix Plan", exact: true }),
  );

  await openMoreItem(page, "Summary");
  await expectDeferredPanel(
    page,
    "Summary tools",
    page.getByTestId("summary-tools-header"),
  );
  await expectDeferredPanel(
    page,
    "Summary",
    page.getByTestId("day-timeline"),
  );
  await expect(page.getByTestId("manager-action-queue")).toBeVisible();

  // The remaining production stations are opened through the fixed station
  // navigation. Each assertion checks visible content from the loaded panel,
  // not only that navigation changed tabs.
  await page.getByTestId("tab-dough").click();
  await expectDeferredPanel(
    page,
    "Dough",
    page.getByText("Batch Pipeline · 3 max", { exact: true }),
  );

  await page.getByTestId("tab-sauce").click();
  await expectDeferredPanel(
    page,
    "Sauce",
    page.getByTestId("sauce-daily-needs"),
  );

  await page.getByTestId("tab-frontline").click();
  await expectDeferredPanel(
    page,
    "Frontline",
    page.getByText("Batches Needed", { exact: true }),
  );

  await page.getByTestId("tab-packaging").click();
  await expectDeferredPanel(
    page,
    "Packaging",
    page.getByText("Line Assembly", { exact: true }),
  );

  // Inventory and the management/review workspace are manager-authorized
  // routes; this fixture is promoted before any of them are opened.
  await openMoreItem(page, "Inventory");
  await expectDeferredPanel(
    page,
    "Inventory",
    page.getByText("No inventory yet.", { exact: false }),
  );
  await expect(page.getByText("Loading inventory…", { exact: true })).toHaveCount(0);

  await openMoreItem(page, "Operations Insights");
  await expect(page.getByTestId("button-anomaly-check")).toBeVisible();
  await expect(page.getByTestId("spec-reconcile-panel")).toBeVisible();
  await expect(page.getByTestId("import-history-panel")).toBeVisible();

  await openMoreItem(page, "Reported issues");
  await expect(
    page.getByRole("heading", { name: "Reported issues", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Loading quality tools…", { exact: true })).toHaveCount(0);

  await openMoreItem(page, "Downtime trends");
  await expect(page.getByTestId("downtime-trends-tab")).toBeVisible();
  await expect(page.getByText("Loading quality tools…", { exact: true })).toHaveCount(0);

  await openMoreItem(page, "QC workflows & history");
  await expect(page.getByTestId("qc-workflow-tab")).toBeVisible();
  await expect(page.getByText("Loading quality tools…", { exact: true })).toHaveCount(0);

  await openMoreItem(page, "Staff roster");
  await expect(page.getByRole("heading", { name: "Staff Roster", exact: true })).toBeVisible();
  await expect(page.getByText("Loading staff roster…", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Loading roles…", { exact: true })).toHaveCount(0);

  // The manager's settings dialog has its own deferred recipe and audit
  // surfaces, separate from the station-level Setup and Operations tabs.
  await openMoreItem(page, "Settings");
  const settingsDialog = page.getByRole("dialog", {
    name: "Manage Lists & Settings",
  });
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole("button", { name: "Recipes", exact: true }).click();
  await settingsDialog.getByRole("button", { name: "Mix Recipes", exact: true }).click();
  await expectDeferredPanel(
    page,
    "mix management",
    settingsDialog.getByText(
      "Define shared pre-blended recipes made ahead for a product.",
      { exact: false },
    ),
  );
  await expectDeferredPanel(
    page,
    "mix reconciliation",
    settingsDialog.getByTestId("mix-reconcile-panel"),
  );

  // The remaining recipe and settings managers are independently deferred
  // inside the same manager dialog, so exercise each first-open route too.
  await settingsDialog.getByRole("button", { name: "Dough", exact: true }).click();
  await expectDeferredPanel(
    page,
    "named recipes",
    settingsDialog
      .getByTestId("dough-recipe-editor")
      .getByText("Dough Recipes", { exact: true }),
  );
  await settingsDialog.getByRole("button", { name: "Sauce", exact: true }).click();
  await expectDeferredPanel(
    page,
    "named recipes",
    settingsDialog
      .getByTestId("sauce-recipe-editor")
      .getByText("Sauce Recipes", { exact: true }),
  );
  await settingsDialog.getByRole("button", { name: "Cheese", exact: true }).click();
  await expectDeferredPanel(
    page,
    "cheese recipes",
    settingsDialog.getByText("Cheese Recipes", { exact: true }),
  );

  await settingsDialog.getByRole("button", { name: "Settings", exact: true }).click();
  await settingsDialog.getByRole("button", { name: "Rules", exact: true }).click();
  await expectDeferredPanel(
    page,
    "production rules",
    settingsDialog.getByText("Production Rules", { exact: true }),
  );
  await settingsDialog.getByRole("button", { name: "Freezer Pull", exact: true }).click();
  await expectDeferredPanel(
    page,
    "freezer pull items",
    settingsDialog.getByText("Freezer-Pull Items", { exact: true }),
  );
  await settingsDialog.getByRole("button", { name: "Die Defaults", exact: true }).click();
  await expectDeferredPanel(
    page,
    "die defaults",
    settingsDialog.getByTestId("die-line-defaults-manager"),
  );
  await settingsDialog.getByRole("button", { name: "Cycle Counts", exact: true }).click();
  await expectDeferredPanel(
    page,
    "cycle-count schedules",
    settingsDialog.getByText("Cycle-Count Schedules", { exact: true }),
  );
  await settingsDialog.getByRole("button", {
    name: "Data Health & Audit",
    exact: true,
  }).click();
  await expectDeferredPanel(
    page,
    "data health",
    settingsDialog.getByTestId("data-health-workspace"),
  );
  await settingsDialog.getByRole("button", { name: "Close settings" }).click();

  // Line Map is an optional panel inside Run, loaded only after the control is
  // opened for the first time in this authenticated session.
  await page.getByTestId("tab-run").click();
  const lineMapToggle = page.locator("button").filter({ hasText: "Line Map" });
  await lineMapToggle.click();
  await expectDeferredPanel(
    page,
    "Line map",
    page.getByRole("heading", { name: "Production Line Map", exact: true }),
  );
  await lineMapToggle.click();
  await expect(
    page.getByRole("heading", { name: "Production Line Map", exact: true }),
  ).toHaveCount(0);

  // The Glance overlay is intentionally available only while a run is active.
  // Start the empty run in this disposable fixture to exercise its supported
  // first-open path without changing shared data.
  const startRunButton = page.getByTestId("button-start-run");
  await expect(startRunButton).toBeEnabled();
  await startRunButton.click();
  await expect(page.getByRole("button", { name: /PAUSE RUN/ })).toBeVisible();
  await page.getByTitle("Glance view — large numbers for distance viewing").click();
  await expectDeferredPanel(
    page,
    "glance view",
    page.getByTestId("glance-now"),
  );
  await page.getByText("Tap anywhere to dismiss", { exact: true }).click();
  await expect(page.getByTestId("glance-now")).toHaveCount(0);

  // With the disposable run active, Stoppages has its real empty log content
  // instead of the intentionally absent log for an idle, not-yet-started run.
  await openMoreItem(page, "Stoppages");
  await expectDeferredPanel(
    page,
    "Stoppages",
    page.getByTestId("stoppage-log"),
  );

  // Cast displays are also opened through the supported screen query route.
  // The authenticated browser session is retained across this navigation.
  const screenUrl = new URL(page.url());
  screenUrl.search = "?screen=dashboard";
  screenUrl.hash = "";
  await page.goto(screenUrl.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Production Dashboard", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  expect(pageErrors).toEqual([]);
  expect(failedScriptRequests).toEqual([]);
});
