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
import {
  MANAGEMENT_PERFORMANCE_BUDGETS,
  PERFORMANCE_BUDGETS,
} from "../src/performanceDiagnostics";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

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
};

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0]?.split("#")[0] || "/unknown";
  }
}

async function signUp(page: Page, username: string): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.locator("#accessCode").fill(SIGNUP_CODE);
  const response = page.waitForResponse((candidate) =>
    candidate.url().includes("/api/auth/sign-up"),
  );
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  expect((await response).status(), "isolated sign-up should succeed").toBeGreaterThanOrEqual(200);
  expect((await response).status(), "isolated sign-up should not be rejected").toBeLessThan(300);
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  const getStarted = page.getByRole("button", { name: /^get.?started$/i });
  if (await getStarted.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await getStarted.click();
  }
  await page.keyboard.press("Escape");
}

async function promoteToManager(username: string): Promise<void> {
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await database.connect();
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

async function capturedDiagnostics(page: Page): Promise<CapturedDiagnostic[]> {
  return page.evaluate(() => {
    const diagnostics = (window as Window & {
      __calculatorPerformance?: CapturedDiagnostic[];
    }).__calculatorPerformance ?? [];
    return diagnostics.map(({ name, durationMs, kind }) => ({ name, durationMs, kind }));
  });
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
  } finally {
    await database.end().catch(() => {});
  }
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

  const username = uniqueTestId("e2e_management_performance");
  testUsernames.add(username);
  const staffChunkRequests: string[] = [];
  const apiEvidence: ApiEvidence[] = [];
  const apiStartedAt = new Map<string, number>();
  const consoleOutput: Array<{ type: string; text: string }> = [];

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
  await page.getByRole("menuitem", { name: "Staff roster", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Staff Roster" })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => staffChunkRequests.length).toBe(1);

  await expect.poll(async () => {
    const diagnostics = await capturedDiagnostics(page);
    return diagnostics.filter((entry) =>
      entry.name === "management:staff-chunk-load" ||
      entry.name === "management:staff-first-visit",
    );
  }).toEqual([
    expect.objectContaining({ name: "management:staff-chunk-load", kind: "load" }),
    expect.objectContaining({ name: "management:staff-first-visit", kind: "navigation" }),
  ]);

  const diagnostics = await capturedDiagnostics(page);
  const budgetByName: Record<string, number> = {
    "browser:navigation-to-dom-content-loaded": PERFORMANCE_BUDGETS.initialLoadMs,
    "browser:navigation-to-load": PERFORMANCE_BUDGETS.initialLoadMs,
    "management:staff-chunk-load": PERFORMANCE_BUDGETS.initialLoadMs,
    "management:staff-first-visit": MANAGEMENT_PERFORMANCE_BUDGETS.staffFirstVisitMs,
  };
  const measured = diagnostics.filter((entry) => entry.name in budgetByName);
  const overBudget = measured.filter((entry) => entry.durationMs > budgetByName[entry.name]!);
  const report = diagnostics
    .filter((entry) =>
      entry.name === "browser:navigation-to-dom-content-loaded" ||
      entry.name === "browser:navigation-to-load" ||
      entry.name === "management:staff-chunk-load" ||
      entry.name === "management:staff-first-visit",
    )
    .map(({ name, durationMs, kind }) => ({
      name,
      kind,
      durationMs: Math.round(durationMs * 100) / 100,
    }));
  const evidence = {
    diagnostics: report,
    budgets: budgetByName,
    staffChunkRequests: staffChunkRequests.length,
    apiRequests: apiEvidence,
    console: consoleOutput,
    environment: {
      baseURL: new URL(testInfo.project.use.baseURL ?? "http://unknown").origin,
      browser: testInfo.project.name,
      setup: "isolated account and facility created; manager role authorized",
    },
    classification: overBudget.length === 0 ? "pass" : "application-regression",
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