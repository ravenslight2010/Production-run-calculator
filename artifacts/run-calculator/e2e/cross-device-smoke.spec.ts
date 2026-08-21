/**
 * Cross-device release smoke:
 * sign in → select the newly-created run → start → pause → resume → reload →
 * survive one failed foreground sync pull → recover on the next online event.
 *
 * This is deliberately a small journey. Timer catch-up, detailed mobile layout,
 * and individual failed-write regressions belong to their focused suites.
 */

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers, requireIsolatedTestDatabase } from "./isolation";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

function uid(): string {
  return `e2e_matrix_${Math.random().toString(36).slice(2, 10)}`;
}

test.beforeEach(async () => {
  const url = requireIsolatedTestDatabase("cross-device smoke beforeEach");
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

async function signUp(page: Page, username: string): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.locator("#accessCode").fill(SIGNUP_CODE);
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  await page.locator('[data-testid="tab-run"]').waitFor({
    state: "attached",
    timeout: 25_000,
  });

  const getStarted = page.getByRole("button", { name: /^get.?started$/i });
  if (await getStarted.isVisible().catch(() => false)) {
    await getStarted.click();
    await page
      .locator('[data-state="open"][aria-hidden="true"]')
      .waitFor({ state: "detached", timeout: 5_000 })
      .catch(() => {});
  }
}

async function seedPendingRun(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dayKey = "run-calc-day";
    const day = JSON.parse(localStorage.getItem(dayKey) ?? "{}") as {
      date?: string;
      runs?: Array<Record<string, unknown>>;
      currentIndex?: number;
    };
    const id = `smoke-run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(
      dayKey,
      JSON.stringify({
        ...day,
        date: today,
        runs: [{ id, brand: "Smoke", flavor: "Lifecycle" }],
        currentIndex: 0,
      }),
    );
  });
  // Home reads the day state during mount, so reload after seeding rather than
  // trying to mutate React state from the fixture.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
}

async function selectedRunId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
      runs?: Array<{ id?: string }>;
      currentIndex?: number;
    };
    const run = day.runs?.[day.currentIndex ?? 0];
    if (!run?.id) throw new Error("The smoke account has no selected run");
    return run.id;
  });
}

async function readSelectedRun(page: Page): Promise<{
  id: string;
  startedAt?: number;
  pausedAt?: number;
  endedAt?: number;
  stoppages?: Array<{ type?: string; endedAt?: number }>;
}> {
  return page.evaluate(() => {
    const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
      runs?: Array<{
        id: string;
        startedAt?: number;
        pausedAt?: number;
        endedAt?: number;
        stoppages?: Array<{ type?: string; endedAt?: number }>;
      }>;
      currentIndex?: number;
    };
    const run = day.runs?.[day.currentIndex ?? 0];
    if (!run) throw new Error("The selected run disappeared from local state");
    return run;
  });
}

async function dismissPauseDecision(page: Page): Promise<void> {
  const noButton = page.getByTestId("pause-stop-tunnel-no");
  if (await noButton.isVisible().catch(() => false)) {
    await noButton.click();
  }
}

test("staff lifecycle recovers across desktop and phone layouts", async ({
  page,
}) => {
  const username = uid();
  testUsernames.add(username);
  await signUp(page, username);
  await seedPendingRun(page);

  // Selecting the Run tab is the stable cross-layout equivalent of choosing
  // the account's newly-created pending run from the run strip.
  await page.getByTestId("tab-run").click();
  const runId = await selectedRunId(page);
  await expect(page.getByTestId("button-start-run")).toBeVisible();

  await page.getByTestId("button-start-run").click();
  await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();
  await expect.poll(async () => (await readSelectedRun(page)).id).toBe(runId);

  await page.getByRole("button", { name: /pause run/i }).click();
  await expect(page.getByTestId("resume-run")).toBeVisible();
  await dismissPauseDecision(page);
  await expect.poll(async () => (await readSelectedRun(page)).pausedAt).toBeTruthy();

  // Resume is a real lifecycle write, not just a visual toggle.
  await page.getByTestId("resume-run").click();
  await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();
  await expect.poll(async () => (await readSelectedRun(page)).pausedAt).toBeUndefined();

  // The running state and the selected run survive a receiving-device reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();
  await expect.poll(async () => (await selectedRunId(page))).toBe(runId);

  // Fail exactly one foreground reconciliation pull while simulating a
  // background → foreground wake. The online event below must cause a later
  // pull; no action is clicked twice and no pause is cloned.
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

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await failedPullObserved;
  await page.unroute("**/api/sync/today?*");
  const recoveredPull = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().includes("/api/sync/today"),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await recoveredPull;

  await expect
    .poll(async () => (await readSelectedRun(page)).stoppages?.filter(
      (stop) => stop.type === "pause",
    ).length)
    .toBe(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();
  await expect.poll(async () => (await selectedRunId(page))).toBe(runId);

  // A successful recovery must release the synchronous lifecycle fence, not
  // merely refresh the UI. This real action is blocked while the fence is
  // stuck, so it proves the recovered page can write its adopted state again.
  await page.getByRole("button", { name: /pause run/i }).click();
  await expect(page.getByTestId("resume-run")).toBeVisible();
  await dismissPauseDecision(page);
  await expect.poll(async () => (await readSelectedRun(page)).pausedAt).toBeTruthy();
});
