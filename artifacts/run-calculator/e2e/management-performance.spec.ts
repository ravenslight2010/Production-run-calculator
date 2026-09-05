/**
 * E2E: authenticated startup and deferred staff-management performance.
 *
 * This journey deliberately opens the staff surface only after the
 * authenticated shell has settled. It protects the startup path from
 * accidentally importing the staff-management bundle eagerly.
 */

import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers, requireIsolatedTestDatabase, uniqueTestId } from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";
import {
  AUTHENTICATED_STARTUP_PERFORMANCE_BUDGETS,
  MANAGEMENT_PERFORMANCE_BUDGETS,
  PERFORMANCE_BUDGETS,
} from "../src/performanceDiagnostics";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();
const testRoleNames = new Set<string>();

type CapturedDiagnostic = {
  name: string;
  durationMs: number;
  kind: string;
};

type ApiEvidence = {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  startedAtMs: number;
};

type ResourceEvidence = {
  path: string;
  status?: number;
  failed?: boolean;
  errorText?: string;
};

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0]?.split("#")[0] || "/unknown";
  }
}

async function signUp(page: Page, username: string): Promise<void> {
  const response = page.waitForResponse((candidate) =>
    candidate.url().includes("/api/auth/sign-up"),
  );
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    onboarding: { visibilityTimeout: 2_000 },
  });
  const signupStatus = (await response).status();
  expect(signupStatus, "isolated sign-up should succeed").toBeGreaterThanOrEqual(200);
  expect(signupStatus, "isolated sign-up should not be rejected").toBeLessThan(300);
  await page.keyboard.press("Escape");
}

async function promoteToManager(username: string): Promise<void> {
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await database.connect();
    await database.query(
      `UPDATE roles
       SET capabilities = $1::jsonb, updated_at = NOW()
       WHERE name = 'manager'`,
      [JSON.stringify([
        "manage-staff",
        "manage-inventory",
        "edit-production-rules",
        "approve-password-resets",
        "review-incidents",
        "use-ai-tools",
        "manage-factory-settings",
        "manage-profiles",
      ])],
    );
    const user = await database.query("SELECT id FROM users WHERE username = $1", [username]);
    expect(user.rows).toHaveLength(1);
    await database.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager'`,
      [user.rows[0].id],
    );
  } finally {
    await database.end().catch(() => {});
  }
}

async function grantPasswordResetApprover(username: string, roleName: string): Promise<void> {
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await database.connect();
    await database.query(
      `INSERT INTO roles (name, capabilities, builtin)
       VALUES ($1, $2::jsonb, false)
       ON CONFLICT (name) DO UPDATE
       SET capabilities = EXCLUDED.capabilities, builtin = false, updated_at = NOW()`,
      [roleName, JSON.stringify(["approve-password-resets"])],
    );
    const user = await database.query("SELECT id FROM users WHERE username = $1", [username]);
    expect(user.rows).toHaveLength(1);
    await database.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
      [user.rows[0].id, roleName],
    );
  } finally {
    await database.end().catch(() => {});
  }
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.evaluate(() => fetch("/api/auth/sign-out", { method: "POST" }));
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await page.keyboard.press("Escape");
}

async function throttleToSlow3G(page: Page): Promise<() => Promise<void>> {
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: Math.round((500 * 1024) / 8),
    uploadThroughput: Math.round((500 * 1024) / 8),
  });
  return async () => {
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await client.detach();
  };
}

async function capturedDiagnostics(page: Page): Promise<CapturedDiagnostic[]> {
  return page.evaluate(() => {
    const diagnostics = (window as Window & {
      __calculatorPerformance?: CapturedDiagnostic[];
    }).__calculatorPerformance ?? [];
    return diagnostics.map(({ name, durationMs, kind }) => ({ name, durationMs, kind }));
  });
}

async function expectInteractiveStaffControls(page: Page, username: string): Promise<void> {
  await expect(page.getByText("Staff & Roles", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Actions for ${username}`, exact: true }),
  ).toBeVisible();

  // Waiting for a role action, rather than only the card heading, proves that
  // the deferred RolesManager has mounted and finished loading its catalog.
  const editManager = page.getByRole("button", { name: "Edit manager", exact: true });
  await expect(editManager).toBeVisible({ timeout: 20_000 });
  await expect(editManager).toBeEnabled();

  const newRole = page.getByRole("button", { name: "New role", exact: true });
  await expect(newRole).toBeVisible();
  await expect(newRole).toBeEnabled();
  await newRole.click();

  const dialog = page.getByRole("dialog", { name: "New role" });
  await expect(dialog).toBeVisible();
  const roleName = dialog.getByLabel("Role name");
  await expect(roleName).toBeVisible();
  await expect(roleName).toBeEnabled();

  const capability = dialog.getByRole("checkbox").first();
  await expect(capability).toBeVisible();
  await expect(capability).toBeEnabled();
  await capability.click();
  await expect(capability).toHaveAttribute("data-state", "checked");

  const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(dialog).toBeHidden();
}

test("keeps signed-out cold and warm startup within the budget", async ({ page }, testInfo: TestInfo) => {
  await page.addInitScript(() => {
    (window as Window & { __calculatorPerformance?: CapturedDiagnostic[] }).__calculatorPerformance = [];
    window.addEventListener("calculator-performance", (event) => {
      const detail = (event as CustomEvent<CapturedDiagnostic>).detail;
      if (!detail || typeof detail.name !== "string" || typeof detail.durationMs !== "number") return;
      (window as Window & { __calculatorPerformance: CapturedDiagnostic[] })
        .__calculatorPerformance.push({
          name: detail.name,
          durationMs: detail.durationMs,
          kind: detail.kind,
        });
    });
  });

  const apiResponses: Array<{ path: string; status: number }> = [];
  const consoleErrors: string[] = [];
  page.on("response", (response) => {
    if (safePath(response.url()) === "/api/me") {
      apiResponses.push({ path: "/api/me", status: response.status() });
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const measure = async (label: string) => {
    await page.goto("/", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "Production Run Calculator" })).toBeVisible();
    const diagnostics = await capturedDiagnostics(page);
    const load = diagnostics.find((entry) => entry.name === "browser:navigation-to-load");
    expect(load, `${label} navigation timing should be recorded`).toBeDefined();
    expect(
      load!.durationMs,
      `${label} signed-out startup exceeded ${PERFORMANCE_BUDGETS.initialLoadMs}ms`,
    ).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.initialLoadMs);
    return load!;
  };

  const cold = await measure("cold");
  const warm = await measure("warm");
  expect(apiResponses.filter(({ status }) => status === 401).length).toBeGreaterThanOrEqual(2);
  const expectedSignedOut401Messages = consoleErrors.filter((message) =>
    /failed to load resource: the server responded with a status of 401/i.test(message),
  );
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) => !expectedSignedOut401Messages.includes(message),
  );
  expect(
    unexpectedConsoleErrors,
    "the expected signed-out /api/me 401 must not become an application console error",
  ).toEqual([]);

  await testInfo.attach("calculator-signed-out-startup.json", {
    body: JSON.stringify({
      cold: { name: cold.name, durationMs: cold.durationMs, kind: cold.kind },
      warm: { name: warm.name, durationMs: warm.durationMs, kind: warm.kind },
      budgetMs: PERFORMANCE_BUDGETS.initialLoadMs,
      apiResponses,
      expectedSignedOut401Messages,
      consoleErrors,
    }, null, 2),
    contentType: "application/json",
  });
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await database.connect();
    await cleanupTestUsers(database, testUsernames);
    if (testRoleNames.size > 0) {
      await database.query("DELETE FROM roles WHERE name = ANY($1::text[])", [
        [...testRoleNames],
      ]);
    }
  } finally {
    await database.end().catch(() => {});
  }
});

test("keeps role-management controls unavailable to a non-manager on the staff roster", async ({
  page,
}, testInfo: TestInfo) => {
  requireIsolatedTestDatabase("non-manager staff authorization e2e");
  if (!SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for non-manager staff authorization e2e.");
  }

  const username = uniqueTestId("e2e_authenticated_slow_network");
  const roleName = uniqueTestId("e2e_reset_approver");
  testUsernames.add(username);
  testRoleNames.add(roleName);
  const protectedApiResponses: Array<{ method: string; path: string; status: number }> = [];

  page.on("response", (response) => {
    const path = safePath(response.url());
    if (
      (path === "/api/users" || path === "/api/roles") &&
      response.request().method() === "GET"
    ) {
      protectedApiResponses.push({
        method: response.request().method(),
        path,
        status: response.status(),
      });
    }
  });

  await signUp(page, username);
  await grantPasswordResetApprover(username, roleName);
  await signIn(page, username);

  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Staff roster", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Staff roster", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Staff Roster" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Staff & Roles", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Managing roles requires the Manage staff & roles capability.", {
      exact: true,
    }),
  ).toBeVisible();

  await expect(page.getByRole("button", { name: "New role", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(0);

  // Deferred child components may mount after the denial state is visible. Give
  // their disabled queries a chance to run, then ensure no protected load was
  // presented as a successful roster or role fetch.
  await page.waitForTimeout(300);
  await testInfo.attach("calculator-non-manager-staff-denial.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await testInfo.attach("calculator-non-manager-staff-denial.json", {
    body: JSON.stringify(
      {
        role: roleName,
        capabilities: ["approve-password-resets"],
        protectedApiResponses,
        roleManagementMessage:
          "Managing roles requires the Manage staff & roles capability.",
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(
    protectedApiResponses.filter((response) => response.status >= 200 && response.status < 300),
    "non-manager staff and role endpoints must never load successfully",
  ).toEqual([]);
});

test("captures authenticated initial load and deferred staff visit budgets", async ({ page }, testInfo: TestInfo) => {
  requireIsolatedTestDatabase("management performance e2e");
  if (!SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for management performance e2e.");
  }
  await page.addInitScript(() => {
    (window as Window & { __calculatorPerformance?: CapturedDiagnostic[] }).__calculatorPerformance = [];
    window.addEventListener("calculator-performance", (event) => {
      const detail = (event as CustomEvent<CapturedDiagnostic>).detail;
      if (!detail || typeof detail.name !== "string" || typeof detail.durationMs !== "number") return;
      (window as Window & { __calculatorPerformance: CapturedDiagnostic[] })
        .__calculatorPerformance.push({
          name: detail.name,
          durationMs: detail.durationMs,
          kind: detail.kind,
        });
    });
  });

  const username = uniqueTestId("e2e_authenticated_slow_network");
  testUsernames.add(username);
  const staffChunkRequests: string[] = [];
  const apiEvidence: ApiEvidence[] = [];
  const apiStartedAt = new Map<string, number>();
  const consoleOutput: Array<{ type: string; text: string }> = [];
  let staffNavigationStartedAt: number | null = null;

  page.on("request", (request) => {
    if (request.url().includes("StaffManagementSurface")) staffChunkRequests.push(request.url().split("?")[0]);
    if (request.url().includes("/api/")) {
      apiStartedAt.set(`${request.method()}:${request.url()}`, performance.now());
    }
  });
  page.on("response", (response) => {
    if (!response.url().includes("/api/")) return;
    const key = `${response.request().method()}:${response.url()}`;
    const startedAt = apiStartedAt.get(key);
    if (startedAt === undefined) return;
    apiStartedAt.delete(key);
    apiEvidence.push({
      method: response.request().method(),
      path: safePath(response.url()),
      status: response.status(),
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      startedAtMs: Math.round(startedAt * 100) / 100,
    });
  });
  page.on("console", (message) => {
    // Keep the evidence useful without retaining request payloads or URLs.
    consoleOutput.push({
      type: message.type(),
      text: message.text().replace(/https?:\/\/\S+/g, "[url]").slice(0, 300),
    });
  });

  await signUp(page, username);
  await promoteToManager(username);
  await signIn(page, username);

  // A full reload after role promotion is the measured clean authenticated
  // production visit, rather than the sign-in transition itself.
  await page.reload({ waitUntil: "load" });
  await page.waitForLoadState("load");
  await expect.poll(() => capturedDiagnostics(page)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "browser:navigation-to-dom-content-loaded", kind: "load" }),
      expect.objectContaining({ name: "browser:navigation-to-load", kind: "load" }),
    ]),
  );
  expect(staffChunkRequests, "staff surface must stay deferred during startup").toEqual([]);

  await page.getByRole("button", { name: "More" }).click();
  staffNavigationStartedAt = performance.now();
  await page.getByRole("menuitem", { name: "Staff roster", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Staff Roster" })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => staffChunkRequests.length).toBe(1);

  await expect.poll(async () => {
  const diagnostics = await capturedDiagnostics(page);
    return diagnostics.filter((entry) =>
      entry.name === "management:staff-chunk-load" ||
      entry.name === "management:staff-surface-commit" ||
      entry.name === "management:staff-first-visit",
    );
  }).toEqual([
    expect.objectContaining({ name: "management:staff-chunk-load", kind: "load" }),
    expect.objectContaining({ name: "management:staff-surface-commit", kind: "render" }),
    expect.objectContaining({ name: "management:staff-first-visit", kind: "navigation" }),
  ]);
  await expect(page.getByText("Staff & Roles", { exact: true })).toBeVisible();
  await expect(page.getByText("Roles", { exact: true })).toBeVisible();
  await expectInteractiveStaffControls(page, username);

  // Return through the management menu after leaving the surface. This covers
  // the already-preloaded chunk path as well as the progressive remount.
  await page.getByTestId("tab-run").click();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Staff roster", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Staff Roster" })).toBeVisible({ timeout: 20_000 });
  await expectInteractiveStaffControls(page, username);

  const diagnostics = await capturedDiagnostics(page);
  const staffApiEvidence = apiEvidence.filter(
    (request) =>
      staffNavigationStartedAt !== null &&
      request.startedAtMs >= staffNavigationStartedAt,
  );
  const budgetByName: Record<string, number> = {
    "browser:navigation-to-dom-content-loaded": PERFORMANCE_BUDGETS.initialLoadMs,
    "browser:navigation-to-load": PERFORMANCE_BUDGETS.initialLoadMs,
    "management:staff-chunk-load": PERFORMANCE_BUDGETS.initialLoadMs,
    "management:staff-surface-commit": MANAGEMENT_PERFORMANCE_BUDGETS.staffSurfaceCommitMs,
    "management:staff-first-visit": MANAGEMENT_PERFORMANCE_BUDGETS.staffFirstVisitMs,
  };
  const measured = diagnostics.filter((entry) => entry.name in budgetByName);
  const overBudget = measured.filter((entry) => entry.durationMs > budgetByName[entry.name]!);
  const report = diagnostics
    .filter((entry) =>
      entry.name === "browser:navigation-to-dom-content-loaded" ||
      entry.name === "browser:navigation-to-load" ||
      entry.name === "management:staff-chunk-load" ||
      entry.name === "management:staff-surface-commit" ||
      entry.name === "management:staff-first-visit",
    )
    .map(({ name, durationMs, kind }) => ({
      name,
      kind,
      durationMs: Math.round(durationMs * 100) / 100,
    }));
  const evidence = {
    networkProfile: { latencyMs: 400, downloadKbps: 500, uploadKbps: 500 },
    authenticatedVisitMs: Math.round(runReadyMs * 100) / 100,
    budgetMs: AUTHENTICATED_STARTUP_PERFORMANCE_BUDGETS.runReadyMs,
    homeChunkRequests,
    homeChunkDiagnostic: homeChunkDiagnostic
      ? { name: homeChunkDiagnostic.name, durationMs: homeChunkDiagnostic.durationMs, kind: homeChunkDiagnostic.kind }
      : null,
    chunkLoadFailure: failureDiagnostic
      ? { name: failureDiagnostic.name, durationMs: failureDiagnostic.durationMs, kind: failureDiagnostic.kind }
      : null,
    failedResources,
    setup: "isolated account and facility created; manager role authorized",
  };
  await testInfo.attach("calculator-authenticated-startup.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await testInfo.attach("calculator-performance-diagnostics.json", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
  expect(
    overBudget,
    `application performance regression (isolated setup completed): ${JSON.stringify(
      overBudget.map((entry) => ({
        name: entry.name,
        durationMs: Math.round(entry.durationMs),
        budgetMs: budgetByName[entry.name],
      })),
    )}`,
  ).toEqual([]);
  console.log("calculator performance diagnostics", JSON.stringify({
    diagnostics: report,
    budgets: budgetByName,
    apiRequests: apiEvidence.length,
    consoleMessages: consoleOutput.length,
  }));
});

test(
  "keeps the first authenticated calculator visit usable on slow 3G @mobile-slow-network",
  async ({ page }, testInfo: TestInfo) => {
    requireIsolatedTestDatabase("authenticated slow-network performance e2e");
    if (!SIGNUP_CODE) {
      throw new Error("STAFF_SIGNUP_CODE must be configured for authenticated slow-network performance e2e.");
    }

  await page.addInitScript(() => {
    (window as Window & { __calculatorPerformance?: CapturedDiagnostic[] }).__calculatorPerformance = [];
    window.addEventListener("calculator-performance", (event) => {
      const detail = (event as CustomEvent<CapturedDiagnostic>).detail;
      if (!detail || typeof detail.name !== "string" || typeof detail.durationMs !== "number") return;
      (window as Window & { __calculatorPerformance: CapturedDiagnostic[] })
        .__calculatorPerformance.push({
          name: detail.name,
          durationMs: detail.durationMs,
          kind: detail.kind,
        });
    });
  });

  const username = uniqueTestId("e2e_authenticated_slow_network");
  testUsernames.add(username);
  const homeChunkRequests: string[] = [];
  let authenticatedVisitStarted = false;
  const failedResources: ResourceEvidence[] = [];
  const slowNetworkStartedAt = Date.now();
  page.on("request", (request) => {
    if (authenticatedVisitStarted && request.resourceType() === "script") {
      homeChunkRequests.push(safePath(request.url()));
    }
  });
  page.on("response", (response) => {
    if (response.request().resourceType() !== "script" || response.status() < 400) return;
    failedResources.push({ path: safePath(response.url()), status: response.status() });
  });
  page.on("requestfailed", (request) => {
    if (request.resourceType() !== "script") return;
    failedResources.push({
      path: safePath(request.url()),
      failed: true,
      errorText: request.failure()?.errorText?.slice(0, 160),
    });
  });

  await signUp(page, username);
  await promoteToManager(username);
  await page.evaluate(() => fetch("/api/auth/sign-out", { method: "POST" }));
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });

  const restoreNetwork = await throttleToSlow3G(page);
  const authenticatedVisitStartedAt = performance.now();
  authenticatedVisitStarted = true;
  let visitError: unknown;
  try {
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 20_000 });
  } catch (error) {
    visitError = error;
  } finally {
    await restoreNetwork();
  }
  const runReadyMs = performance.now() - authenticatedVisitStartedAt;
  const diagnostics = await capturedDiagnostics(page);
  const homeChunkDiagnostic = diagnostics.find((entry) => entry.name === "startup:home-chunk-load");
  const failureDiagnostic = diagnostics.find((entry) => entry.name === "startup:home-chunk-load-failure");
  const evidence = {
    networkProfile: { latencyMs: 400, downloadKbps: 500, uploadKbps: 500 },
    authenticatedVisitMs: Math.round(runReadyMs * 100) / 100,
    budgetMs: AUTHENTICATED_STARTUP_PERFORMANCE_BUDGETS.runReadyMs,
    homeChunkRequests,
    homeChunkDiagnostic: homeChunkDiagnostic
      ? { name: homeChunkDiagnostic.name, durationMs: homeChunkDiagnostic.durationMs, kind: homeChunkDiagnostic.kind }
      : null,
    chunkLoadFailure: failureDiagnostic
      ? { name: failureDiagnostic.name, durationMs: failureDiagnostic.durationMs, kind: failureDiagnostic.kind }
      : null,
    failedResources,
    setup: "isolated account and facility created; manager role authorized",
  };
    await testInfo.attach("calculator-authenticated-slow-network.json", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    if (visitError) throw visitError;
    expect(homeChunkRequests.length, "the deferred Home bundle should load after authentication").toBeGreaterThan(0);
    expect(homeChunkDiagnostic, "the deferred Home bundle should report its load timing").toBeDefined();
    expect(failureDiagnostic, "the deferred Home bundle must not fail to load").toBeUndefined();
    expect(
      runReadyMs,
      `authenticated calculator was not usable within ${AUTHENTICATED_STARTUP_PERFORMANCE_BUDGETS.runReadyMs}ms; evidence=${JSON.stringify({
        elapsedMs: Math.round(runReadyMs),
        homeChunkRequests: homeChunkRequests.length,
        failedResources,
        diagnostics: diagnostics.filter((entry) => entry.name.startsWith("startup:")),
        setupElapsedMs: Date.now() - slowNetworkStartedAt,
      })}`,
    ).toBeLessThanOrEqual(AUTHENTICATED_STARTUP_PERFORMANCE_BUDGETS.runReadyMs);
  },
);
