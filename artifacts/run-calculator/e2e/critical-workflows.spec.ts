/**
 * E2E: critical manager-mediated workflows.
 *
 * These tests keep setup deterministic with disposable database fixtures while
 * driving the actual calculator UI for the password recovery and Data Health
 * workflows. Every record is uniquely named and removed in afterEach.
 */

import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

const OLD_PASSWORD = "TestPass123!";
const NEW_PASSWORD = "NewTestPass456!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const MANAGER_CAPABILITIES = [
  "manage-staff",
  "manage-inventory",
  "edit-production-rules",
  "approve-password-resets",
  "review-incidents",
  "use-ai-tools",
  "manage-factory-settings",
  "manage-profiles",
];

type CleanupPlan = {
  usernames: string[];
  dataHealth?: {
    profileKeys: string[];
    recipeIds: string[];
    savedSheetLabel: string;
    dailyDate: string;
    batchIds: string[];
  };
};

let cleanupPlan: CleanupPlan | null = null;
let extraBrowserContext: BrowserContext | null = null;

function requireSignupCode(): void {
  if (!SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for critical workflow e2e.");
  }
}

async function signUp(page: Page, username: string, password = OLD_PASSWORD): Promise<void> {
  requireSignupCode();
  await signUpAndHandleOnboarding(page, username, password, {
    signupCode: SIGNUP_CODE,
    onboarding: { visibilityTimeout: 5_000 },
  });
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
}

async function promoteToManager(username: string): Promise<string> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await db.query(
      "UPDATE roles SET capabilities = $1::jsonb, updated_at = NOW() WHERE name = 'manager'",
      [JSON.stringify(MANAGER_CAPABILITIES)],
    );
    const user = await db.query("SELECT id FROM users WHERE username = $1", [username]);
    expect(user.rows).toHaveLength(1);
    await db.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager', updated_at = NOW()`,
      [user.rows[0].id],
    );
    return user.rows[0].id as string;
  } finally {
    await db.end().catch(() => {});
  }
}

function attachBrowserErrorCapture(page: Page, errors: string[]): void {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      errors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
}

async function openStaffRoster(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Staff roster", exact: true }).click();
  await expect(page.getByText("Staff & Roles", { exact: true })).toBeVisible();
}

async function openDataHealth(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Settings", exact: true }).click();
  await settings.getByRole("button", { name: "Data Health & Audit", exact: true }).click();
  await expect(page.getByTestId("data-health-workspace")).toBeVisible();
}

async function runDataHealthCheck(page: Page): Promise<void> {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/api/profile-data/health-workspace") &&
      candidate.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Run check", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByText(/active findings$/)).toBeVisible();
}

async function seedDataHealthFixture(
  managerUsername: string,
): Promise<{
  managerId: string;
  brand: string;
  safeFlavors: [string, string];
  protectedFlavor: string;
  wrongNames: [string, string];
  recipeNames: [string, string];
  futureRunIds: [string, string];
  startedRunId: string;
}> {
  const managerId = await promoteToManager(managerUsername);
  const fixture = uniqueTestId("health");
  const brand = `H ${fixture}`;
  const safeFlavors: [string, string] = [
    `A ${fixture}`,
    `B ${fixture}`,
  ];
  const protectedFlavor = `R ${fixture}`;
  const wrongNames: [string, string] = [
    `Bad A ${fixture}`,
    `Bad B ${fixture}`,
  ];
  const recipeNames: [string, string] = [
    `Good A ${fixture}`,
    `Good B ${fixture}`,
  ];
  const recipeIds = [`${fixture}-recipe-a`, `${fixture}-recipe-b`];
  const profileKeys = safeFlavors.map(
    (flavor) => `${brand.toLocaleLowerCase()}__${flavor.toLocaleLowerCase()}`,
  );
  const protectedKey = `${brand.toLocaleLowerCase()}__${protectedFlavor.toLocaleLowerCase()}`;
  const savedSheetLabel = `Data Health saved setup ${fixture}`;
  const dailyDate = `25${String(Date.now() % 400).padStart(3, "0")}-${String(
    (Date.now() % 12) + 1,
  ).padStart(2, "0")}-${String((Date.now() % 27) + 1).padStart(2, "0")}`;
  const futureRunIds: [string, string] = [
    `${fixture}-future-a`,
    `${fixture}-future-b`,
  ];
  const startedRunId = `${fixture}-started-a`;

  cleanupPlan = {
    usernames: [managerUsername],
    dataHealth: {
      profileKeys: [...profileKeys, protectedKey],
      recipeIds,
      savedSheetLabel,
      dailyDate,
      batchIds: [],
    },
  };

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    for (let index = 0; index < recipeIds.length; index += 1) {
      await db.query(
        `INSERT INTO sauce_recipes
          (id, scope, name, components, enabled)
         VALUES ($1, 'live', $2, $3::jsonb, true)`,
        [
          recipeIds[index],
          recipeNames[index],
          JSON.stringify([{ ingredient: `Sauce Ingredient ${index} ${fixture}`, lbs: 12 + index }]),
        ],
      );
    }

    for (let index = 0; index < safeFlavors.length; index += 1) {
      await db.query(
        `INSERT INTO brand_profiles
          (key, scope, brand, flavor, values, crust_values, updated_at_ms)
         VALUES ($1, 'live', $2, $3, $4::jsonb, '{}'::jsonb, 100)`,
        [
          profileKeys[index],
          brand,
          safeFlavors[index],
          JSON.stringify({
            frontlineRecipeName: wrongNames[index],
            frontlineRecipe: [],
          }),
        ],
      );
    }
    await db.query(
      `INSERT INTO brand_profiles
        (key, scope, brand, flavor, values, crust_values, updated_at_ms)
       VALUES ($1, 'live', $2, $3, $4::jsonb, '{}'::jsonb, 100)`,
      [
        protectedKey,
        brand,
        protectedFlavor,
        JSON.stringify({
          frontlineRecipeName: recipeNames[0],
          frontlineRecipe: [{ ingredient: "Already entered", lbs: 4 }],
        }),
      ],
    );

    await db.query(
      `INSERT INTO saved_spec_sheets (scope, label, data)
       VALUES ('live', $1, $2::jsonb)`,
      [
        savedSheetLabel,
        JSON.stringify({
          profiles: [
            { brand, flavor: safeFlavors[0], sauceName: recipeNames[0] },
            { brand, flavor: safeFlavors[1], sauceName: recipeNames[1] },
            { brand, flavor: protectedFlavor, sauceName: recipeNames[1] },
          ],
        }),
      ],
    );

    await db.query(
      `INSERT INTO daily_sync (scope, date, data)
       VALUES ('live', $1, $2::jsonb)`,
      [
        dailyDate,
        JSON.stringify({
          dayState: {
            runs: [
              { id: futureRunIds[0], brand, flavor: safeFlavors[0] },
              { id: futureRunIds[1], brand, flavor: safeFlavors[1] },
              { id: startedRunId, brand, flavor: safeFlavors[0], startedAt: 1 },
            ],
          },
          runValues: {
            [futureRunIds[0]]: {
              frontlineRecipeName: wrongNames[0],
              frontlineRecipe: [],
            },
            [futureRunIds[1]]: {
              frontlineRecipeName: wrongNames[1],
              frontlineRecipe: [],
            },
            [startedRunId]: {
              frontlineRecipeName: wrongNames[0],
              frontlineRecipe: [],
            },
          },
          runValuesUpdatedAt: {
            [futureRunIds[0]]: 10,
            [futureRunIds[1]]: 10,
            [startedRunId]: 10,
          },
        }),
      ],
    );
  } finally {
    await db.end().catch(() => {});
  }

  return {
    managerId,
    brand,
    safeFlavors,
    protectedFlavor,
    wrongNames,
    recipeNames,
    futureRunIds,
    startedRunId,
  };
}

async function cleanupFixtures(): Promise<void> {
  if (!cleanupPlan || !process.env.DATABASE_URL) return;
  const plan = cleanupPlan;
  cleanupPlan = null;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const users = await db.query(
      "SELECT id FROM users WHERE username = ANY($1::text[])",
      [plan.usernames],
    );
    const userIds = users.rows.map((row) => row.id as string);
    if (userIds.length > 0) {
      await db.query("DELETE FROM data_health_repair_batches WHERE actor = ANY($1::text[])", [
        userIds,
      ]);
      await db.query("DELETE FROM audit_logs WHERE actor = ANY($1::text[])", [userIds]);
    }
    if (plan.dataHealth) {
      await db.query("DELETE FROM daily_sync WHERE scope = 'live' AND date = $1", [
        plan.dataHealth.dailyDate,
      ]);
      await db.query("DELETE FROM saved_spec_sheets WHERE scope = 'live' AND label = $1", [
        plan.dataHealth.savedSheetLabel,
      ]);
      await db.query(
        "DELETE FROM brand_profiles WHERE scope = 'live' AND key = ANY($1::text[])",
        [plan.dataHealth.profileKeys],
      );
      await db.query(
        "DELETE FROM sauce_recipes WHERE scope = 'live' AND id = ANY($1::text[])",
        [plan.dataHealth.recipeIds],
      );
      if (plan.dataHealth.batchIds.length > 0) {
        await db.query(
          "DELETE FROM data_health_repair_batches WHERE id = ANY($1::text[])",
          [plan.dataHealth.batchIds],
        );
      }
    }
    await cleanupTestUsers(db, plan.usernames);
  } finally {
    await db.end().catch(() => {});
  }
}

test.beforeAll(() => {
  requireIsolatedTestDatabase("critical workflow e2e");
});

test.afterEach(async () => {
  await extraBrowserContext?.close();
  extraBrowserContext = null;
  await cleanupFixtures();
});

test("completes manager-approved password recovery and fences the old session", async ({
  browser,
}, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  const staffUsername = uniqueTestId("e2e_reset_staff");
  const managerUsername = uniqueTestId("e2e_reset_manager");
  cleanupPlan = { usernames: [staffUsername, managerUsername] };
  const browserErrors: string[] = [];
  const staffContext = await browser.newContext();
  const managerContext = await browser.newContext();
  const resetContext = await browser.newContext();
  const oldStaffPage = await staffContext.newPage();
  const managerPage = await managerContext.newPage();
  const resetPage = await resetContext.newPage();
  let replayPage: Page | null = null;
  for (const page of [oldStaffPage, managerPage, resetPage]) {
    attachBrowserErrorCapture(page, browserErrors);
  }

  try {
    await signUp(oldStaffPage, staffUsername);
    expect(
      await oldStaffPage.evaluate(async () => (await fetch("/api/me")).status),
    ).toBe(200);

    await signUp(managerPage, managerUsername);
    await promoteToManager(managerUsername);
    await managerPage.reload({ waitUntil: "domcontentloaded" });
    await managerPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await resetPage.goto("/forgot-password", { waitUntil: "domcontentloaded" });
    await resetPage.locator("#ru").waitFor({ state: "visible", timeout: 20_000 });
    await resetPage.locator("#ru").fill(staffUsername);
    const requestResponse = resetPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/forgot-password") &&
        response.request().method() === "POST",
    );
    await resetPage.getByRole("button", { name: "Request reset", exact: true }).click();
    expect((await requestResponse).status()).toBe(200);
    await expect(resetPage.getByText("Ask your manager to approve your request.")).toBeVisible();

    await openStaffRoster(managerPage);
    const requestRow = managerPage
      .getByRole("button", { name: "Approve", exact: true })
      .locator("xpath=../..");
    await expect(requestRow).toBeVisible();
    const approveResponse = managerPage.waitForResponse(
      (response) =>
        response.url().includes("/api/password-reset-requests/") &&
        response.url().endsWith("/approve") &&
        response.request().method() === "POST",
    );
    await requestRow.getByRole("button", { name: "Approve", exact: true }).click();
    expect((await approveResponse).status()).toBe(200);

    const codeDialog = managerPage
      .getByRole("dialog")
      .filter({ hasText: `Reset code for ${staffUsername}` });
    await expect(codeDialog).toBeVisible();
    const code = (await codeDialog.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/).textContent())?.trim();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    await codeDialog.getByRole("button", { name: "Done", exact: true }).click();

    await resetPage.locator("#rc").fill(code!);
    await resetPage.locator("#rp").fill(NEW_PASSWORD);
    await resetPage.locator("#rp2").fill(NEW_PASSWORD);
    const resetResponse = resetPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/reset-password") &&
        response.request().method() === "POST",
    );
    await resetPage.getByRole("button", { name: "Reset password", exact: true }).click();
    expect((await resetResponse).status()).toBe(204);
    await expect(resetPage.getByText("Your password has been reset.")).toBeVisible();

    await expect.poll(
      () => oldStaffPage.evaluate(async () => (await fetch("/api/me")).status),
      { timeout: 10_000 },
    ).toBe(401);

    await resetPage.getByRole("button", { name: "Go to sign in", exact: true }).click();
    await resetPage.locator("#username").fill(staffUsername);
    await resetPage.locator("#password").fill(NEW_PASSWORD);
    await resetPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await resetPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    replayPage = await resetContext.newPage();
    attachBrowserErrorCapture(replayPage, browserErrors);
    await replayPage.goto("/forgot-password", { waitUntil: "domcontentloaded" });
    await replayPage.locator("#ru").fill(staffUsername);
    await replayPage.getByRole("button", { name: "Request reset", exact: true }).click();
    await expect(replayPage.getByText("Ask your manager to approve your request.")).toBeVisible();
    await replayPage.locator("#rc").fill(code!);
    await replayPage.locator("#rp").fill("ReplayAttempt789!");
    await replayPage.locator("#rp2").fill("ReplayAttempt789!");
    const replayResponse = replayPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/reset-password") &&
        response.request().method() === "POST",
    );
    await replayPage.getByRole("button", { name: "Reset password", exact: true }).click();
    expect((await replayResponse).status()).toBe(401);
    await expect(replayPage.getByText("That reset code is invalid or has expired.")).toBeVisible();

    await oldStaffPage.screenshot({ path: testInfo.outputPath("password-reset-old-session.png") });
    await managerPage.screenshot({ path: testInfo.outputPath("password-reset-manager-code.png") });
    await resetPage.screenshot({ path: testInfo.outputPath("password-reset-complete.png") });
    expect(browserErrors).toEqual([]);
  } finally {
    await Promise.all([
      oldStaffPage.close(),
      managerPage.close(),
      resetPage.close(),
      replayPage?.close() ?? Promise.resolve(),
    ]);
    await Promise.all([
      staffContext.close(),
      managerContext.close(),
      resetContext.close(),
    ]);
  }
});

test("repairs scoped Data Health findings, preserves started runs, and guards undo", async ({
  page,
  browser,
}, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  const managerUsername = uniqueTestId("e2e_health_manager");
  const browserErrors: string[] = [];
  attachBrowserErrorCapture(page, browserErrors);

  await signUp(page, managerUsername);
  await page.close();
  const fixture = await seedDataHealthFixture(managerUsername);
  extraBrowserContext = await browser.newContext();
  await extraBrowserContext.addInitScript(
    ({ brand, flavors }: { brand: string; flavors: string[] }) => {
      const readList = (key: string): string[] => {
        try {
          const value = JSON.parse(localStorage.getItem(key) ?? "[]");
          return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
        } catch {
          return [];
        }
      };
      const brands = [...new Set([...readList("run-calc-brands"), brand])];
      const flavorMap = (() => {
        try {
          const value = JSON.parse(localStorage.getItem("run-calc-brand-flavors") ?? "{}");
          return value && typeof value === "object" ? value as Record<string, string[]> : {};
        } catch {
          return {};
        }
      })();
      flavorMap[brand] = [...new Set([...(flavorMap[brand] ?? []), ...flavors])];
      localStorage.setItem("run-calc-brands", JSON.stringify(brands));
      localStorage.setItem("run-calc-brand-flavors", JSON.stringify(flavorMap));
    },
    { brand: fixture.brand, flavors: [...fixture.safeFlavors, fixture.protectedFlavor] },
  );
  page = await extraBrowserContext.newPage();
  attachBrowserErrorCapture(page, browserErrors);
  await signIn(page, managerUsername, OLD_PASSWORD);
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  await openDataHealth(page);
  await runDataHealthCheck(page);
  const workspace = page.getByTestId("data-health-workspace");
  await expect(page.getByTestId("source-reconciliation-status")).toBeVisible();
  await expect(page.getByTestId("source-reconciliation-status")).toContainText("Authoritative source reconciliation");
  await expect(page.getByTestId("source-reconciliation-status")).toContainText("Report ");
  await expect(workspace).toContainText(`${fixture.brand} — ${fixture.safeFlavors[0]}`);
  await expect(workspace).toContainText("review only");
  await expect(workspace).toContainText(fixture.protectedFlavor);
  await page.screenshot({ path: testInfo.outputPath("data-health-findings.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Filter source reconciliation category")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("data-health-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByLabel("Filter data health category").selectOption("profile-links");
  await page.getByLabel("Filter source reconciliation category").selectOption("all");
  await page.getByLabel("Filter data health repairability").selectOption("safe");
  await page.getByLabel("Filter data health brand").selectOption(fixture.brand);
  await expect(workspace).toContainText(`${fixture.brand} / ${fixture.safeFlavors[0]} / sauce`);
  await expect(workspace).not.toContainText(fixture.protectedFlavor);

  for (const flavor of fixture.safeFlavors) {
    await page.getByLabel(`Select repair for ${fixture.brand} / ${flavor} / sauce`).check();
  }
  await expect(page.getByRole("button", { name: "Preview 2 repairs", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Preview 2 repairs", exact: true }).click();
  await expect(workspace).toContainText("Review exact changes before applying");
  await expect(workspace).toContainText(fixture.recipeNames[0]);
  await page.screenshot({ path: testInfo.outputPath("data-health-preview.png") });

  const applyResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/profile-data/health-check/apply") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Apply safe repairs", exact: true }).click();
  const apply = await applyResponse;
  const applyBody = await apply.text();
  expect(
    apply.status(),
    `apply response ${apply.status()}: ${applyBody}; payload: ${apply.request().postData() ?? "<none>"}`,
  ).toBe(200);
  await expect(workspace).toContainText("Applied 2 repairs and refreshed 2 future run snapshots");
  const batch = workspace.locator('[data-testid^="data-health-repair-batch-"]').first();
  await expect(batch).toBeVisible();
  const batchTestId = await batch.getAttribute("data-testid");
  expect(batchTestId).toMatch(/^data-health-repair-batch-/);
  cleanupPlan!.dataHealth!.batchIds.push(batchTestId!.replace("data-health-repair-batch-", ""));

  let reloadProfileSnapshots: Array<{
    key: string;
    values: Record<string, unknown>;
    crustValues: Record<string, unknown>;
    updatedAt: number;
  }> = [];
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const profiles = await db.query(
      `SELECT key, values, crust_values, updated_at_ms FROM brand_profiles
       WHERE scope = 'live' AND key = ANY($1::text[])`,
      [cleanupPlan!.dataHealth!.profileKeys],
    );
    reloadProfileSnapshots = profiles.rows.map((row) => ({
      key: row.key as string,
      values: row.values as Record<string, unknown>,
      crustValues: row.crust_values as Record<string, unknown>,
      updatedAt: Number(row.updated_at_ms),
    }));
    const byKey = new Map(reloadProfileSnapshots.map((row) => [row.key, row.values]));
    for (let index = 0; index < fixture.safeFlavors.length; index += 1) {
      const key = cleanupPlan!.dataHealth!.profileKeys[index];
      expect(byKey.get(key)?.frontlineRecipeName).toBe(fixture.recipeNames[index]);
    }
    const day = await db.query(
      "SELECT data FROM daily_sync WHERE scope = 'live' AND date = $1",
      [cleanupPlan!.dataHealth!.dailyDate],
    );
    const data = day.rows[0].data as {
      runValues: Record<string, Record<string, unknown>>;
    };
    expect(data.runValues[fixture.futureRunIds[0]].frontlineRecipeName).toBe(fixture.recipeNames[0]);
    expect(data.runValues[fixture.futureRunIds[1]].frontlineRecipeName).toBe(fixture.recipeNames[1]);
    expect(data.runValues[fixture.startedRunId].frontlineRecipeName).toBe(fixture.wrongNames[0]);

    await db.query(
      `UPDATE brand_profiles
       SET values = values || $1::jsonb, updated_at_ms = updated_at_ms + 1
       WHERE scope = 'live' AND key = $2`,
      [
        JSON.stringify({ frontlineRecipeName: `Manager changed ${uniqueTestId("after-repair")}` }),
        cleanupPlan!.dataHealth!.profileKeys[1],
      ],
    );
    const beforeReload = await db.query(
      `SELECT key, values FROM brand_profiles
       WHERE scope = 'live' AND key = ANY($1::text[])`,
      [cleanupPlan!.dataHealth!.profileKeys],
    );
    const beforeReloadByKey = new Map(
      beforeReload.rows.map((row) => [row.key as string, row.values as Record<string, unknown>]),
    );
    expect(
      beforeReloadByKey.get(cleanupPlan!.dataHealth!.profileKeys[0])?.frontlineRecipeName,
      JSON.stringify([...beforeReloadByKey.entries()]),
    ).toBe(fixture.recipeNames[0]);
    expect(
      beforeReloadByKey.get(cleanupPlan!.dataHealth!.profileKeys[1])?.frontlineRecipeName,
      JSON.stringify([...beforeReloadByKey.entries()]),
    ).toMatch(/^Manager changed /);
  } finally {
    await db.end().catch(() => {});
  }

  await page.evaluate(
    (profiles: Array<{
      key: string;
      values: Record<string, unknown>;
      crustValues: Record<string, unknown>;
      updatedAt: number;
    }>) => {
      const readMap = (key: string): Record<string, number> => {
        try {
          const value = JSON.parse(localStorage.getItem(key) ?? "{}");
          return value && typeof value === "object" ? value as Record<string, number> : {};
        } catch {
          return {};
        }
      };
      const stamps = readMap("run-calc-profilesync-stamps-v1");
      const synced = readMap("run-calc-profilesync-synced-v1");
      for (const profile of profiles) {
        localStorage.setItem(`run-calc-profile-${profile.key}`, JSON.stringify(profile.values));
        localStorage.setItem(`run-calc-crust-profile-${profile.key}`, JSON.stringify(profile.crustValues));
        stamps[profile.key] = profile.updatedAt;
        synced[profile.key] = profile.updatedAt;
      }
      localStorage.setItem("run-calc-profilesync-stamps-v1", JSON.stringify(stamps));
      localStorage.setItem("run-calc-profilesync-synced-v1", JSON.stringify(synced));
    },
    reloadProfileSnapshots,
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await openDataHealth(page);
  await runDataHealthCheck(page);
  await expect(page.getByTestId("data-health-repair-history")).toBeVisible();
  const reloadedBatch = page.locator('[data-testid^="data-health-repair-batch-"]').first();
  await expect(reloadedBatch).toContainText("applied");
  await page.screenshot({ path: testInfo.outputPath("data-health-history-after-reload.png") });

  page.once("dialog", (dialog) => void dialog.accept());
  const undoResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/profile-data/health-check/batches/") &&
      response.url().endsWith("/undo") &&
      response.request().method() === "POST",
  );
  await reloadedBatch.getByRole("button", { name: "Undo batch", exact: true }).click();
  const undo = await undoResponse;
  expect(undo.status()).toBe(200);
  await expect(reloadedBatch).toContainText("undone");
  await page.screenshot({ path: testInfo.outputPath("data-health-undo-result.png") });

  const verifyDb = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await verifyDb.connect();
    const profiles = await verifyDb.query(
      `SELECT key, values FROM brand_profiles
       WHERE scope = 'live' AND key = ANY($1::text[])`,
      [cleanupPlan!.dataHealth!.profileKeys],
    );
    const byKey = new Map(profiles.rows.map((row) => [row.key as string, row.values as Record<string, unknown>]));
    expect(
      byKey.get(cleanupPlan!.dataHealth!.profileKeys[0])?.frontlineRecipeName,
      JSON.stringify([...byKey.entries()]),
    ).toBe(fixture.wrongNames[0]);
    expect(
      byKey.get(cleanupPlan!.dataHealth!.profileKeys[1])?.frontlineRecipeName,
      JSON.stringify([...byKey.entries()]),
    ).toMatch(/^Manager changed /);

    const day = await verifyDb.query(
      "SELECT data FROM daily_sync WHERE scope = 'live' AND date = $1",
      [cleanupPlan!.dataHealth!.dailyDate],
    );
    const data = day.rows[0].data as {
      runValues: Record<string, Record<string, unknown>>;
    };
    // Future snapshots have their own guarded records. Both are restored even
    // though the second profile changed after apply; the started run remains
    // protected and is never refreshed.
    expect(data.runValues[fixture.futureRunIds[0]].frontlineRecipeName).toBe(fixture.wrongNames[0]);
    expect(data.runValues[fixture.futureRunIds[1]].frontlineRecipeName).toBe(fixture.wrongNames[1]);
    expect(data.runValues[fixture.startedRunId].frontlineRecipeName).toBe(fixture.wrongNames[0]);
  } finally {
    await verifyDb.end().catch(() => {});
  }
  expect(browserErrors).toEqual([]);
});