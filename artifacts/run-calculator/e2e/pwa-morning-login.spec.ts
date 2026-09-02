/**
 * Tablet-sized PWA cold-start smoke:
 * stale local day -> one sign-in -> mount-time rollover -> authenticated Home.
 *
 * This is intentionally separate from the service-worker handoff test. It
 * uses a disposable account and records the auth/rollover request sequence so
 * a morning login bounce is visible in release evidence.
 */

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { completeOnboarding } from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

type ApiEvidence = {
  method: string;
  path: string;
  status: number;
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
  expect((await response).status()).toBeGreaterThanOrEqual(200);
  expect((await response).status()).toBeLessThan(300);
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  const getStarted = page.getByRole("button", { name: /^get.?started$/i });
  if (await getStarted.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await completeOnboarding(page, page.getByRole("dialog"), { button: getStarted });
  }
}

async function signOut(page: Page): Promise<void> {
  const response = await page.evaluate(async () => {
    const result = await fetch("/api/auth/sign-out", { method: "POST" });
    return result.status;
  });
  expect(response).toBeGreaterThanOrEqual(200);
  expect(response).toBeLessThan(300);
}

test.beforeEach(async () => {
  const url = requireIsolatedTestDatabase("PWA morning login smoke");
  const db = new Client({ connectionString: url });
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date = $1", [
      new Date().toISOString().slice(0, 10),
    ]);
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

test("keeps one morning sign-in authenticated through stale-day rollover", async ({
  page,
}, testInfo) => {
  requireIsolatedTestDatabase("PWA morning login smoke");
  if (!SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for PWA morning login smoke.");
  }

  const username = uniqueTestId("e2e_pwa_morning_login");
  testUsernames.add(username);
  const apiEvidence: ApiEvidence[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  let capture = false;

  page.on("response", (response) => {
    if (!capture || !response.url().includes("/api/")) return;
    apiEvidence.push({
      method: response.request().method(),
      path: safePath(response.url()),
      status: response.status(),
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));

  await signUp(page, username);
  await signOut(page);
  capture = true;

  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem(
      "run-calc-day",
      JSON.stringify({
        date: "2000-01-01",
        runs: [
          {
            id: "pwa-stale-run",
            brand: "Morning",
            flavor: "Smoke",
            startedAt: 1,
          },
        ],
        currentIndex: 0,
        substitutions: [],
        substitutionLog: [],
        stagedItems: {},
      }),
    );
  });

  const signIn = page.waitForResponse(
    (response) =>
      safePath(response.url()) === "/api/auth/sign-in" &&
      response.request().method() === "POST",
  );
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await signIn).status()).toBe(200);

  await page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 30_000 });
  await expect(page.getByTestId("auth-screen")).toHaveCount(0);
  await expect
    .poll(() => apiEvidence.filter((entry) => entry.path.startsWith("/api/sync/")).length)
    .toBeGreaterThan(0);

  const evidence = {
    viewport: { width: 1024, height: 768 },
    oneSignIn: apiEvidence.filter(
      (entry) => entry.path === "/api/auth/sign-in" && entry.method === "POST",
    ).length,
    authenticatedHome: await page.getByTestId("tab-run").isVisible(),
    apiRequests: apiEvidence,
    consoleErrors,
    expectedHttpErrorConsoleMessages: consoleErrors.filter((message) =>
      /failed to load resource: the server responded with a status of (401|403) \(\)$/i.test(
        message,
      ),
    ),
    pageErrors,
    physicalFollowUp:
      "Still verify once on a physical iPad Home Screen/PWA launch in Safari: use yesterday's local state, sign in once, confirm Home remains visible after rollover, then repeat with an already-active session and confirm daily re-authentication.",
  };
  await testInfo.attach("pwa-morning-login-evidence.json", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });

  expect(evidence.oneSignIn, "the smoke journey must perform exactly one sign-in").toBe(1);
  expect(evidence.authenticatedHome).toBe(true);
  expect(
    apiEvidence.filter((entry) => entry.path === "/api/auth/sign-out"),
    "mount-time rollover must not sign out the just-established session",
  ).toEqual([]);
  expect(pageErrors, "the authenticated tablet journey must have no page errors").toEqual([]);
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) =>
      !/failed to load resource: the server responded with a status of (401|403) \(\)$/i.test(
        message,
      ),
  );
  expect(
    unexpectedConsoleErrors,
    "the authenticated tablet journey must have no unexpected console errors",
  ).toEqual([]);
});