/**
 * E2E: a manager's Dough supply correction pauses only Dough tracking.
 *
 * This suite is intentionally isolated from the destructive live-day browser
 * suite and from the Packaging correction/sync-status coverage. It drives the
 * responsive web UI, then observes the real sync payloads to ensure the
 * timed Dough pause expires cleanly instead of replaying stale elapsed time.
 */

import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const MAX_TRAY_PAUSE_MS = 15_000;
const testUsernames = new Set<string>();

type SyncDoughObservation = {
  requestAt: number;
  runId?: string;
  traysOnLine?: number;
  batchesReady?: number;
};

function parseVisibleNumber(text: string | null): number {
  const value = Number.parseFloat((text ?? "").replace(/,/g, ""));
  if (!Number.isFinite(value)) {
    throw new Error(`Expected a numeric output, received ${JSON.stringify(text)}`);
  }
  return value;
}

async function deleteTodaySyncRow(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date = $1", [
      new Date().toISOString().slice(0, 10),
    ]);
  } finally {
    await db.end().catch(() => {});
  }
}

async function promoteToManager(page: Page): Promise<void> {
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    return response.ok ? (await response.json()) as { userId?: string } : null;
  });
  expect(identity?.userId, "signed-in user id").toBeTruthy();

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await db.query("UPDATE roles SET updated_at = NOW() WHERE name = 'manager'");
    await db.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager', updated_at = NOW()`,
      [identity!.userId],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

async function openLineSetup(page: Page): Promise<void> {
  const details = page.locator("details").filter({
    has: page.locator("summary", { hasText: /line.?setup/i }),
  }).first();
  await details.waitFor({ state: "attached", timeout: 10_000 });
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator("summary").click();
  }
}

async function setNumberField(page: Page, testId: string, value: string): Promise<void> {
  const input = page.getByTestId(testId);
  await input.fill(value);
  await input.blur();
}

async function setRunInputs(page: Page): Promise<void> {
  await page.getByTestId("button-start-run").waitFor({ state: "visible", timeout: 15_000 });
  await configureLineSetup(page);
}

async function configureLineSetup(page: Page): Promise<void> {
  await openLineSetup(page);

  // The large run need keeps the line active throughout the correction window.
  await setNumberField(page, "input-casesNeeded", "200");
  await setNumberField(page, "input-cycleSpeed", "60");
  await setNumberField(page, "input-crustsPerCycle", "1");
  await setNumberField(page, "input-pizzasPerCase", "1");
  await setNumberField(page, "input-casesPerSkid", "10");
  await setNumberField(page, "input-freezerTime", "0");
  await setNumberField(page, "input-doughballsPerTray", "6");
  await setNumberField(page, "input-doughBatchYield", "4");
  await page.waitForTimeout(500);

  for (const [testId, expected] of [
    ["input-casesNeeded", "200"],
    ["input-cycleSpeed", "60"],
    ["input-crustsPerCycle", "1"],
    ["input-pizzasPerCase", "1"],
    ["input-casesPerSkid", "10"],
    ["input-freezerTime", "0"],
    ["input-doughballsPerTray", "6"],
    ["input-doughBatchYield", "4"],
  ] as const) {
    await expect(page.getByTestId(testId)).toHaveValue(expected);
  }
}

async function readDoughNeeds(page: Page): Promise<{ batches: number; trays: number }> {
  return {
    batches: parseVisibleNumber(
      await page.getByTestId("output-batches-needed").textContent(),
    ),
    trays: parseVisibleNumber(
      await page.getByTestId("output-trays-needed").textContent(),
    ),
  };
}

async function readStepperValue(page: Page, testId: string): Promise<number> {
  return parseVisibleNumber(await page.getByTestId(testId).inputValue());
}

function captureSyncDoughWrites(page: Page, runId: string): SyncDoughObservation[] {
  const observations: SyncDoughObservation[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "PUT"
      || !/\/api\/sync\/(?:\d{4}-\d{2}-\d{2}|today)(?:\?|$)/.test(request.url())
    ) {
      return;
    }

    try {
      const body = JSON.parse(request.postData() ?? "") as {
        payload?: {
          runValues?: Record<string, {
            traysOnLine?: number;
            batchesReady?: number;
          }>;
        };
      };
      const values = body.payload?.runValues?.[runId];
      if (!values) return;
      observations.push({
        requestAt: Date.now(),
        runId,
        traysOnLine: values.traysOnLine,
        batchesReady: values.batchesReady,
      });
    } catch {
      // A malformed request will be surfaced by the browser/API assertions;
      // do not let request instrumentation change the user journey.
    }
  });
  return observations;
}

test.beforeEach(async () => {
  requireIsolatedTestDatabase("Dough correction resume browser beforeEach");
  await deleteTodaySyncRow();
});

test.afterAll(async () => {
  await deleteTodaySyncRow();
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

test("manager Dough corrections resume without a catch-up write", async ({
  page,
}, testInfo: TestInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  const username = uniqueTestId("e2e_dough_correction_manager");
  testUsernames.add(username);
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
  });
  await promoteToManager(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const manager = await page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    return response.ok ? (await response.json()) as { role?: string } : null;
  });
  expect(manager?.role, "browser session role").toBe("manager");

  await page.getByTestId("tab-run").click();
  await setRunInputs(page);
  await page.getByTestId("button-start-run").click();
  await page.getByRole("button", { name: /pause.?run/i }).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  const runId = await page.evaluate(() => {
    const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
      runs?: Array<{ id?: string }>;
      currentIndex?: number;
    };
    const run = day.runs?.[day.currentIndex ?? 0];
    if (!run?.id) throw new Error("Started run was not persisted locally");
    return run.id;
  });
  const syncWrites = captureSyncDoughWrites(page, runId);

  await page.getByTestId("tab-dough").click();
  await expect(page.getByTestId("output-batches-needed")).toBeVisible();
  await expect(page.getByTestId("output-trays-needed")).toBeVisible();

  const needsBefore = await readDoughNeeds(page);
  const currentTrays = await readStepperValue(page, "input-traysOnLine");
  const currentBatches = await readStepperValue(page, "input-batchesReady");
  const correctedDough = {
    traysOnLine: currentTrays > 0 ? currentTrays - 1 : 3,
    batchesReady: currentBatches > 0 ? currentBatches - 1 : 2,
  };

  await page.screenshot({ path: testInfo.outputPath("dough-before-correction.png") });

  // These are real controlled-input edits. Each edit starts the same timed
  // Dough-only pause, so the second correction is the pause's final baseline.
  await setNumberField(page, "input-traysOnLine", String(correctedDough.traysOnLine));
  await expect(page.getByTestId("manual-override-banner")).toContainText("Dough station");
  await expect(page.getByTestId("dough-timers-paused-banner")).toBeVisible();
  await setNumberField(page, "input-batchesReady", String(correctedDough.batchesReady));
  const needsAfter = await readDoughNeeds(page);
  expect(needsAfter.batches).not.toBe(needsBefore.batches);
  expect(needsAfter.trays).not.toBe(needsBefore.trays);
  await expect(page.getByTestId("manual-override-banner")).toContainText(/resumes in ~/);
  await expect
    .poll(
      () =>
        syncWrites.some(
          (write) =>
            write.traysOnLine === correctedDough.traysOnLine
            && write.batchesReady === correctedDough.batchesReady,
        ),
      { timeout: 5_000, intervals: [100, 250] },
    )
    .toBe(true);
  // The pause is a real tray cadence, not just a transient render state.
  await page.waitForTimeout(500);
  await expect(page.getByTestId("manual-override-banner")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("dough-correction-paused.png") });

  // Packaging must keep advancing while the Dough-specific timer is paused.
  // Its live counter is intentionally mounted on the Packaging tab, so observe
  // it there during the same Dough-only suppression window.
  await page.getByTestId("tab-packaging").click();
  const packagingCountdown = page.getByText(/Next case in/i).first();
  await expect(packagingCountdown).toBeVisible();
  const packagingCountdownBefore = await packagingCountdown.textContent();
  await expect
    .poll(() => packagingCountdown.textContent(), { timeout: 5_000, intervals: [250, 500] })
    .not.toBe(packagingCountdownBefore);
  await page.getByTestId("tab-dough").click();

  // Wait for the correction's one-tray pause. Expiry should re-arm the Dough
  // timers, not apply elapsed time as a catch-up write.
  await expect(page.getByTestId("manual-override-banner")).toBeHidden({
    timeout: MAX_TRAY_PAUSE_MS,
  });
  const pauseExpiredAt = Date.now();
  await expect(page.getByTestId("dough-timers-paused-banner")).toBeHidden();
  await expect(page.getByTestId("btn-pause-dough-timers")).toBeVisible();
  await page.waitForTimeout(750);

  const postPauseDoughWrites = syncWrites.filter(
    (write) =>
      write.requestAt >= pauseExpiredAt
      && (
        write.traysOnLine !== correctedDough.traysOnLine
        || write.batchesReady !== correctedDough.batchesReady
      ),
  );
  expect(
    postPauseDoughWrites,
    "Dough values must stay at the corrected baseline through pause expiry; Packaging writes may carry them unchanged",
  ).toHaveLength(0);

  await page.screenshot({ path: testInfo.outputPath("dough-resumed-no-catch-up.png") });
  expect(browserErrors).toEqual([]);
});