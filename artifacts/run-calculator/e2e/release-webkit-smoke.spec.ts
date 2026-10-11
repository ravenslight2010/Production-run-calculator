/**
 * Minimum cross-browser release contract for WebKit.
 *
 * This lane intentionally covers only the highest-risk operational boundaries:
 * authentication, a current-run lifecycle, one failed sync pull followed by
 * reconnect recovery, and a manager's authoritative report preview.
 */

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
  DEFAULT_MANAGER_CAPABILITIES,
} from "./isolation";
import { dismissOnboardingIfPresent, signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

// Make the controlled transport failure deterministic instead of allowing the
// service worker to satisfy the sync request before Playwright's route.
test.use({ serviceWorkers: "block" });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function signUp(page: Page, username: string): Promise<void> {
  if (!SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for the WebKit release smoke.");
  }
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    onboarding: { visibilityTimeout: 5_000 },
  });
  await dismissOnboardingIfPresent(page);
}

async function promoteToManager(username: string): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("promote WebKit report fixture"),
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

async function seedPendingRun(page: Page): Promise<string> {
  const runId = uniqueTestId("webkit_run");
  const date = new Date().toISOString().slice(0, 10);
  // The server's operational-intent reducer only applies a lifecycle command to
  // a run the canonical row already owns; otherwise it answers `review-required`
  // and the optimistic start is rolled back. Register the run canonically first
  // (as the multi-device and sync-convergence harnesses do) so the WebKit
  // lifecycle journey exercises the real reducer instead of a rejected command.
  await page.evaluate(async ({ id, day }) => {
    const epochResponse = await fetch("/api/sync/reset-epoch", { cache: "no-store" });
    const epochBody = await epochResponse.json() as { epoch?: number };
    const epoch = typeof epochBody.epoch === "number" ? epochBody.epoch : 0;
    const response = await fetch(`/api/sync/today?today=${day}&epoch=${epoch}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "webkit-release-smoke",
        payload: {
          dayState: {
            date: day,
            currentIndex: 0,
            resetAt: 0,
            runs: [{ id, brand: "WebKit", flavor: "Release Smoke" }],
          },
          runValues: {},
          runValuesUpdatedAt: {},
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`WebKit smoke canonical fixture PUT failed: ${response.status}`);
    }
  }, { id: runId, day: date });
  await page.evaluate(({ id, day }) => {
    for (const key of Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))) {
      if (key?.startsWith("run-calc-run-")) localStorage.removeItem(key);
    }
    localStorage.setItem(
      "run-calc-day",
      JSON.stringify({
        date: day,
        runs: [{ id, brand: "WebKit", flavor: "Release Smoke", seeded: false }],
        currentIndex: 0,
        resetAt: 0,
      }),
    );
  }, { id: runId, day: date });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  return runId;
}

async function selectedRun(page: Page): Promise<{
  id: string;
  pausedAt?: number;
  stoppages?: Array<{ type?: string }>;
}> {
  return page.evaluate(() => {
    const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
      runs?: Array<{ id: string; pausedAt?: number; stoppages?: Array<{ type?: string }> }>;
      currentIndex?: number;
    };
    const run = day.runs?.[day.currentIndex ?? 0];
    if (!run) throw new Error("WebKit smoke selected run disappeared");
    return run;
  });
}

test.beforeAll(async () => {
  requireIsolatedTestDatabase("WebKit release smoke");
});

test.beforeEach(async () => {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("WebKit release smoke reset"),
  });
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date = $1", [today()]);
    await db.query("DELETE FROM completed_run_history WHERE date = $1", [today()]);
  } finally {
    await db.end().catch(() => {});
  }
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupTestUsers(db, testUsernames);
    await db.query("DELETE FROM daily_sync WHERE date = $1", [today()]);
    await db.query("DELETE FROM completed_run_history WHERE date = $1", [today()]);
  } finally {
    await db.end().catch(() => {});
  }
});

test("authenticates and preserves current-run start, pause, resume, and reload", async ({ page }) => {
  const username = uniqueTestId("e2e_webkit_lifecycle");
  testUsernames.add(username);
  await signUp(page, username);
  const runId = await seedPendingRun(page);

  await expect(page.getByTestId("button-start-run")).toBeVisible();
  await page.getByTestId("button-start-run").click();
  await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();
  await expect.poll(async () => (await selectedRun(page)).id).toBe(runId);

  await page.getByRole("button", { name: /pause run/i }).click();
  const stopTunnelNo = page.getByTestId("pause-stop-tunnel-no");
  if (await stopTunnelNo.isVisible().catch(() => false)) {
    // WebKit can remount this optional prompt while the pause write is
    // acknowledged. The persisted pausedAt assertion remains authoritative.
    await stopTunnelNo.click({ timeout: 2_000 }).catch(() => {});
  }
  await expect(page.getByTestId("resume-run")).toBeVisible();
  await expect.poll(async () => (await selectedRun(page)).pausedAt).toBeTruthy();

  await page.getByTestId("resume-run").click();
  await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();
  await expect.poll(async () => (await selectedRun(page)).pausedAt).toBeUndefined();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();
  await expect.poll(async () => (await selectedRun(page)).id).toBe(runId);
});

test("recovers a failed sync pull after the browser reconnects", async ({ page }) => {
  const username = uniqueTestId("e2e_webkit_sync");
  testUsernames.add(username);
  await signUp(page, username);
  await seedPendingRun(page);
  await page.getByTestId("tab-run").click();

  let failedPull = false;
  let failedPullResolve!: () => void;
  const failedPullObserved = new Promise<void>((resolve) => {
    failedPullResolve = resolve;
  });
  await page.route("**/api/sync/today?*", async (route) => {
    if (route.request().method() === "GET" && !failedPull) {
      failedPull = true;
      failedPullResolve();
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  // Use browser connectivity transitions so the app's real online recovery
  // listener runs; a synthetic focus event does not trigger that path.
  await page.context().setOffline(true);
  await page.context().setOffline(false);
  await failedPullObserved;
  await page.unroute("**/api/sync/today?*");
  const recoveredPull = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().includes("/api/sync/today"),
  );
  await page.context().setOffline(true);
  await page.context().setOffline(false);
  await recoveredPull;
  await expect(page.locator('[title="Sync connected"]')).toBeVisible();
  expect(failedPull).toBe(true);
});

test("manager can preview an authoritative operational report", async ({ page }) => {
  const username = uniqueTestId("e2e_webkit_report");
  testUsernames.add(username);
  await signUp(page, username);
  const runId = await seedPendingRun(page);
  await promoteToManager(username);
  // The report must read the canonical server snapshot, not a later browser
  // write from the freshly hydrated page.
  await page.route("**/api/sync/today**", async (route) => {
    if (route.request().method() === "GET") await route.continue();
    else await route.abort();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  const operationalView = await page.request.get(
    `/api/reports/operational-view?date=${today()}&runId=${encodeURIComponent(runId)}`,
  );
  expect(
    operationalView.status(),
    `Operational view fixture returned ${operationalView.status()}: ${(await operationalView.text()).slice(0, 2_000)}`,
  ).toBe(200);

  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
  const reportDetails = page.getByTestId("summary-report-details");
  await expect(reportDetails).toBeVisible();
  await reportDetails.locator("summary").click();
  const report = page.getByTestId("operational-report");
  await expect(report).toBeVisible();

  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith("/api/reports/operational") &&
      candidate.request().method() === "POST",
  );
  await report.getByRole("button", { name: "Preview report", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(report.getByText("CONFIRMED CANONICAL REPORT", { exact: true })).toBeVisible();
  await expect(report.getByText("Report ready. Statistics are authoritative and deterministic.", { exact: true })).toBeVisible();
});