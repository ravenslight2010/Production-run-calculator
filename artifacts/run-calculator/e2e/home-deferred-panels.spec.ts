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

async function readCanonicalFactoryValues(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const response = await fetch("/api/factory-data", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Canonical factory-data read failed (${response.status})`);
    }
    const snapshot = await response.json() as {
      data?: Record<string, { value?: unknown }>;
    };
    if (!snapshot.data || typeof snapshot.data !== "object") {
      throw new Error("Canonical factory-data response has no data map");
    }
    return Object.fromEntries(Object.entries(snapshot.data).map(([key, entry]) => {
      if (!entry || typeof entry !== "object" || !("value" in entry)) {
        throw new Error(`Canonical factory-data row is malformed (${key})`);
      }
      return [key, entry.value];
    }));
  });
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
      response.status() >= 400
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

test("manager removes saved copies repeatedly without touching pending or active data", async ({
  page,
}, testInfo) => {
  const username = uniqueTestId("e2e_saved_copy_removal");
  const fixtureId = uniqueTestId("savedcopy");
  const pageErrors: string[] = [];
  testUsernames.add(username);
  page.on("pageerror", (error) => pageErrors.push(error.message));

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
  await expect(page.getByTestId("button-start-run")).toBeEnabled();
  await page.getByTestId("button-start-run").click();
  await expect(page.getByRole("button", { name: /PAUSE RUN/ })).toBeVisible();

  const legacyItems = [
    { key: "run-calc-stop-reasons", label: "Stop reasons" },
    { key: "run-calc-circles", label: "Packaging circles" },
    { key: "run-calc-shippers", label: "Shippers" },
  ];
  const pendingQueueKey = "run-calc-fkv-queue-v1";
  const pendingQueue = JSON.stringify([{
    key: "run-calc-brands",
    value: [`PENDING_${fixtureId}`],
    updatedAt: 1,
    g: 1,
  }]);
  const historyKey = "run-calc-history";
  const historyDates = ["2026-02-11", "2026-02-12", "2026-02-13", "2026-02-14"];
  const history = historyDates.map((date, index) => ({
    date,
    runs: [],
    runValues: {},
    fixture: `${fixtureId}_${index + 1}`,
  }));
  const unrelatedKey = `run-calc-saved-copy-unrelated:${fixtureId}`;
  const unrelatedValue = `KEEP_${fixtureId}`;
  const unrelatedOutboxKey = `run-calc-completed-history-outbox.live:unrelated_${fixtureId}`;
  const unrelatedOutboxValue = `[{"fixture":"${fixtureId}","pending":true}]`;

  await page.evaluate((data) => {
    for (const [key, value] of Object.entries(data.legacyItems)) {
      localStorage.setItem(
        `run-calc-fkv-legacy-review:unowned:${key}`,
        JSON.stringify(value),
      );
    }
    localStorage.setItem(data.pendingQueueKey, data.pendingQueue);
    localStorage.setItem(data.historyKey, JSON.stringify(data.history));
    localStorage.setItem(data.unrelatedKey, data.unrelatedValue);
    localStorage.setItem(data.unrelatedOutboxKey, data.unrelatedOutboxValue);
  }, {
    legacyItems: Object.fromEntries(legacyItems.map(({ key }, index) => [
      key,
      [`SAVED_${fixtureId}_${index + 1}`],
    ])),
    pendingQueueKey,
    pendingQueue,
    historyKey,
    history,
    unrelatedKey,
    unrelatedValue,
    unrelatedOutboxKey,
    unrelatedOutboxValue,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("tab-run")).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(page.getByRole("button", { name: /PAUSE RUN/ })).toBeVisible();
  const factoryReview = page.getByTestId("factory-directory-review");
  const sharedReview = page.getByTestId("shared-records-status");
  await expect(factoryReview).toBeVisible();
  await expect(sharedReview).toBeVisible();
  await factoryReview.locator("summary").click();
  await sharedReview.locator("summary").click();
  await expect(factoryReview).toContainText("4 saved facility-list edits need review");
  await expect(sharedReview).toContainText("4 saved local items to review");
  await expect(factoryReview.getByRole("button", { name: "Removal unavailable" })).toBeDisabled();
  await expect(factoryReview).toContainText("may not have been sent to the facility yet");
  const activeRunBeforeRemoval = await page.evaluate(() => {
    const raw = localStorage.getItem("run-calc-day");
    if (!raw) throw new Error("Synthetic active-run recovery was not saved");
    const state = JSON.parse(raw);
    const run = state.runs?.[state.currentIndex];
    if (!run?.id) throw new Error("Synthetic active run has no stable identity");
    return { date: state.date as string, runId: run.id as string };
  });
  const preservedBefore = await page.evaluate(({ queueKey, unrelatedKey, outboxKey }) => ({
    activeRecovery: localStorage.getItem("run-calc-day"),
    pendingQueue: localStorage.getItem(queueKey),
    unrelated: localStorage.getItem(unrelatedKey),
    outbox: localStorage.getItem(outboxKey),
  }), { queueKey: pendingQueueKey, unrelatedKey, outboxKey: unrelatedOutboxKey });
  const canonicalBefore = await readCanonicalFactoryValues(page);
  await page.screenshot({
    path: testInfo.outputPath("saved-copy-removal-before.png"),
    fullPage: false,
  });

  let confirmations = 0;
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "confirm") confirmations += 1;
    await dialog.accept();
  });

  // Change the first source after review but before confirming. Its stale
  // evidence must remain and show an actionable failure rather than disappear.
  const staleLegacyKey = `run-calc-fkv-legacy-review:unowned:${legacyItems[0].key}`;
  const staleLegacyCard = page.getByRole("heading", {
    name: legacyItems[0].label,
    exact: true,
  }).locator("..");
  await page.evaluate(({ key, value, label }) => {
    const heading = Array.from(
      document.querySelectorAll('[data-testid="factory-directory-review"] h3'),
    ).find((candidate) => candidate.textContent === label);
    const removeButton = Array.from(heading?.parentElement?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent?.includes("Remove saved copy from this device"));
    if (!removeButton) throw new Error("Synthetic stale directory button was not found");
    removeButton.addEventListener("click", () => {
      localStorage.setItem(key, value);
    }, { capture: true, once: true });
  }, {
    key: staleLegacyKey,
    value: JSON.stringify([`UPDATED_${fixtureId}`]),
    label: legacyItems[0].label,
  });
  await staleLegacyCard.getByRole("button", {
    name: "Remove saved copy from this device",
  }).click();
  await expect(factoryReview.getByRole("alert").filter({
    hasText: "The copy changed or could not be removed",
  })).toBeVisible();
  await expect(staleLegacyCard).toContainText(`UPDATED_${fixtureId}`);
  expect(confirmations).toBe(1);

  for (const [index, item] of legacyItems.entries()) {
    const card = page.getByRole("heading", {
      name: item.label,
      exact: true,
    }).locator("..");
    const removeButton = card.getByRole("button", {
      name: "Remove saved copy from this device",
    });
    if (index === 0) {
      await removeButton.focus();
      await removeButton.press("Enter");
    } else {
      await removeButton.click();
    }
    await expect(factoryReview.getByRole("status")).toContainText(
      "Saved copy removed from this device.",
    );
    await expect(card).toHaveCount(0);
    expect(confirmations).toBe(index + 2);
  }
  await expect(factoryReview.getByRole("button", { name: "Removal unavailable" })).toBeDisabled();
  await expect(factoryReview).toContainText("PENDING_");
  await expect(factoryReview.getByRole("button", {
    name: "Remove saved copy from this device",
  })).toHaveCount(0);

  // The same local UI reports a changed retained record, then allows three
  // unchanged records to be removed one at a time, including the last one.
  const firstHistoryItem = sharedReview.locator("li").filter({
    hasText: historyDates[0],
  });
  await page.evaluate(({ date, key, fixture }) => {
    const item = Array.from(
      document.querySelectorAll('[data-testid="shared-records-status"] li'),
    ).find((candidate) => candidate.textContent?.includes(`Date: ${date}.`));
    const removeButton = Array.from(item?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent?.includes("Remove this saved copy from this device"));
    if (!removeButton) throw new Error("Synthetic stale-review button was not found");
    // Write during the trusted click, before React handles it, so an unrelated
    // rerender cannot replace the reviewed evidence between two automation steps.
    removeButton.addEventListener("click", () => {
      const records = JSON.parse(localStorage.getItem(key) ?? "[]") as Array<Record<string, unknown>>;
      const index = records.findIndex((record) => record.date === date);
      if (index < 0) throw new Error("Synthetic retained record was not found");
      records[index] = { ...records[index], fixture };
      localStorage.setItem(key, JSON.stringify(records));
    }, { capture: true, once: true });
  }, {
    key: historyKey,
    date: historyDates[0],
    fixture: `UPDATED_${fixtureId}`,
  });
  await firstHistoryItem.getByRole("button", {
    name: "Remove this saved copy from this device",
  }).click();
  await expect(sharedReview.getByRole("alert").filter({
    hasText: "This saved copy changed or could not be removed",
  })).toBeVisible();
  await expect(firstHistoryItem).toContainText(historyDates[0]);
  expect(confirmations).toBe(5);

  for (const [index, date] of historyDates.entries()) {
    const item = sharedReview.locator("li").filter({ hasText: date });
    await item.getByRole("button", {
      name: "Remove this saved copy from this device",
    }).click();
    await expect(sharedReview.getByText("Saved copy removed from this device.", {
      exact: true,
    })).toBeVisible();
    await expect(item).toHaveCount(0);
    expect(confirmations).toBe(index + 6);
  }
  await expect(page.getByText("4 saved local items to review")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("saved-copy-removal-after.png"),
    fullPage: false,
  });

  const activeRunBeforeReload = await page.evaluate(() => {
    const raw = localStorage.getItem("run-calc-day");
    if (!raw) throw new Error("Active-run recovery disappeared during local cleanup");
    const state = JSON.parse(raw);
    const run = state.runs?.[state.currentIndex];
    if (!run?.id) throw new Error("Active-run identity disappeared during local cleanup");
    return { date: state.date as string, runId: run.id as string };
  });
  expect(activeRunBeforeReload).toEqual(activeRunBeforeRemoval);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("tab-run")).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(page.getByRole("button", { name: /PAUSE RUN/ })).toBeVisible();
  await expect(page.getByTestId("factory-directory-review")).toBeVisible();
  const reloadedFactoryReview = page.getByTestId("factory-directory-review");
  await reloadedFactoryReview.locator("summary").click();
  await expect(reloadedFactoryReview).toContainText("PENDING_");
  await expect(reloadedFactoryReview.getByRole("button", {
    name: "Removal unavailable",
  })).toBeDisabled();
  await expect(page.getByTestId("shared-records-status")).toHaveCount(0);

  const preservedAfter = await page.evaluate(({ queueKey, unrelatedKey, outboxKey }) => ({
    activeRecovery: localStorage.getItem("run-calc-day"),
    pendingQueue: localStorage.getItem(queueKey),
    unrelated: localStorage.getItem(unrelatedKey),
    outbox: localStorage.getItem(outboxKey),
    removedLegacy: Object.keys(localStorage).filter((key) =>
      key.startsWith("run-calc-fkv-legacy-review:unowned:run-calc-")
      && !key.endsWith("run-calc-brands"),
    ),
    history: localStorage.getItem("run-calc-history"),
  }), { queueKey: pendingQueueKey, unrelatedKey, outboxKey: unrelatedOutboxKey });
  expect(preservedAfter).toMatchObject({
    pendingQueue: preservedBefore.pendingQueue,
    unrelated: preservedBefore.unrelated,
    outbox: preservedBefore.outbox,
    removedLegacy: [],
    history: null,
  });
  const activeRunAfterReload = JSON.parse(preservedAfter.activeRecovery ?? "null");
  expect({
    date: activeRunAfterReload?.date,
    runId: activeRunAfterReload?.runs?.[activeRunAfterReload.currentIndex]?.id,
  }).toEqual(activeRunBeforeRemoval);
  const canonicalAfter = await readCanonicalFactoryValues(page);
  expect(canonicalAfter).toEqual(canonicalBefore);
  const knownWebKitBackgroundApiErrors = testInfo.project.name.includes("webkit")
    ? pageErrors.filter((message) =>
      message.includes("due to access control checks")
      && /\/api\/(incidents|factory-data|sync\/auto-track\/claim)(?:\?| |$)/.test(message))
    : [];
  const unexpectedPageErrors = pageErrors.filter(
    (message) => !knownWebKitBackgroundApiErrors.includes(message),
  );
  expect(unexpectedPageErrors).toEqual([]);
  if (knownWebKitBackgroundApiErrors.length > 0) {
    const description = knownWebKitBackgroundApiErrors.join("; ");
    testInfo.annotations.push({
      type: "WebKit background API access-control errors",
      description,
    });
    console.warn(`[${testInfo.project.name}] ${description}`);
  }
});
