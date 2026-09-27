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
  seedCanonicalDailyRuns,
  seedCanonicalDailySnapshot,
  clearCompletedRunHistory,
  DEFAULT_MANAGER_CAPABILITIES,
} from "./isolation";
import { dismissOnboardingIfPresent, signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

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

/**
 * Publish the seeded run into the canonical server-side day row.
 *
 * A run that exists only in localStorage is not a state the product can
 * reach: applyOperationalIntent resolves its target out of the SERVER day
 * state and answers "review-required" without applying anything when the run
 * is missing, which the client then treats as permanently blocking for
 * pause/resume. Seeding the row keeps both sides on the same run.
 */
async function seedCanonicalRun(runId: string): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("seed WebKit canonical run"),
  });
  try {
    await db.connect();
    await seedCanonicalDailyRuns(db, today(), "live", [
      { id: runId, brand: "WebKit", flavor: "Release Smoke" },
    ]);
  } finally {
    await db.end().catch(() => {});
  }
}

/**
 * Seed the authoritative report fixture.
 *
 * The report derives its numbers from the canonical server-side day row and
 * answers 409 canonical-snapshot-invalid when that row is missing or does not
 * derive cleanly, so the fixture must be a COMPLETE snapshot (day state plus
 * run values plus packaging progress), not a run appended to an empty day.
 * completed_run_history is the second canonical input, so same-day completion
 * rows are cleared to keep the day unambiguous.
 */
async function seedReportSnapshot(date: string): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("seed WebKit report snapshot"),
  });
  try {
    await db.connect();
    const runId = uniqueTestId("webkit_report_run");
    const endedAt = Date.now() - 60_000;
    const startedAt = endedAt - 7_200_000;
    await clearCompletedRunHistory(db, date, "live");
    await seedCanonicalDailySnapshot(db, date, "live", {
      dayState: {
        date,
        resetAt: 10,
        runs: [{ id: runId, brand: "WebKit", flavor: "Report Smoke", startedAt, endedAt }],
      },
      runValues: {
        [runId]: {
          pizzasPerCase: 10,
          casesPerSkid: 20,
          casesNeeded: 100,
          crustsPerCycle: 4,
          cycleSpeed: 10,
          speedAdjustment: 1,
          freezerTime: 10,
          tempFreezerTime: 30,
          tempCrustsPerCycle: 5,
          tempCycleSpeed: 12,
        },
      },
      packagingProgress: { [runId]: { skidsCompleted: 2, casesOnCurrentSkid: 3 } },
    });
  } finally {
    await db.end().catch(() => {});
  }
}

async function seedPendingRun(page: Page): Promise<string> {
  const runId = uniqueTestId("webkit_run");
  await seedCanonicalRun(runId);
  await page.evaluate((id) => {
    for (const key of Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))) {
      if (key?.startsWith("run-calc-run-")) localStorage.removeItem(key);
    }
    localStorage.setItem(
      "run-calc-day",
      JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        runs: [{ id, brand: "WebKit", flavor: "Release Smoke", seeded: false }],
        currentIndex: 0,
        resetAt: 0,
      }),
    );
  }, runId);
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
  if (await stopTunnelNo.isVisible().catch(() => false)) await stopTunnelNo.click();
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

  // Home's scheduler debounces foreground passes by 500ms and DROPS any signal
  // inside that window. A single synthetic "focus" dispatched right after mount
  // therefore lands in the debounce and no pull is ever attempted, so the abort
  // route never fires. Re-dispatch until the app actually issues the request we
  // are about to fail — this waits on the real condition, not a guessed sleep.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        return failedPull;
      },
      { timeout: 20_000, intervals: [200, 400, 800] },
    )
    .toBe(true);
  await failedPullObserved;
  await page.unroute("**/api/sync/today?*");

  let recovered = 0;
  const countRecovered = (response: { request(): { method(): string }; url(): string }): void => {
    if (response.request().method() === "GET" && response.url().includes("/api/sync/today")) {
      recovered += 1;
    }
  };
  page.on("response", countRecovered);
  // "online" is the app's reconnect signal, but the wake guard coalesces bursts,
  // so the first dispatch can be absorbed by a reconciliation still in flight.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        return recovered;
      },
      { timeout: 20_000, intervals: [200, 400, 800] },
    )
    .toBeGreaterThan(0);
  page.off("response", countRecovered);

  await expect(page.locator('[title="Sync connected"]')).toBeVisible();
  expect(failedPull).toBe(true);
});

test("manager can preview an authoritative operational report", async ({ page }) => {
  const username = uniqueTestId("e2e_webkit_report");
  testUsernames.add(username);
  await signUp(page, username);
  await promoteToManager(username);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: "Summary", exact: true }).click();

  // The panel sits behind the "Reports and trends" <details> disclosure. A
  // closed <details> gives its contents no layout box, so Playwright reports
  // the panel as hidden rather than missing even though it is in the DOM.
  const details = page.getByTestId("summary-report-details");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");

  // Seed AFTER hydration: the signed-in client pushes its own day once it
  // mounts, and that write would otherwise replace the authoritative fixture
  // the preview is about to read.
  await seedReportSnapshot(today());

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