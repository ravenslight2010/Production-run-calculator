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
  DEFAULT_MANAGER_CAPABILITIES,
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
    await db.query(
      "UPDATE roles SET capabilities = $1::jsonb, updated_at = NOW() WHERE name = 'manager'",
      [JSON.stringify(DEFAULT_MANAGER_CAPABILITIES)],
    );
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

async function readCanonicalDoughValues(
  page: Page,
  runId: string,
): Promise<{ traysOnLine?: number; batchesReady?: number } | null> {
  const today = new Date().toISOString().slice(0, 10);
  const response = await page.request.get(`/api/sync/today?today=${today}`);
  if (!response.ok()) return null;
  const body = await response.json() as {
    operationalProjection?: {
      runId?: string;
      counters?: { traysOnLine?: number; batchesReady?: number };
    };
  };
  const projection = body.operationalProjection;
  if (projection?.runId !== runId || !projection.counters) return null;
  return {
    traysOnLine: projection.counters.traysOnLine,
    batchesReady: projection.counters.batchesReady,
  };
}

async function observeDoughTimerControlEvents(page: Page, runId: string): Promise<void> {
  await page.evaluate((targetRunId) => {
    const host = window as typeof window & { __doughTimerControlObservations?: unknown[] };
    const observations: unknown[] = [];
    host.__doughTimerControlObservations = observations;
    const record = (kind: string, detail: Record<string, unknown>, defaultPrevented: boolean) => {
      const selected = kind === "published"
        ? detail
        : (detail[targetRunId] as Record<string, unknown> | undefined);
      let localControls: Record<string, Record<string, unknown>> = {};
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem("run-calculator:dough-timer-controls") ?? "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          localControls = parsed as typeof localControls;
        }
      } catch {}
      let run: { id?: string; metaUpdatedAt?: number; startedAt?: number } | undefined;
      try {
        const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
          runs?: Array<{ id?: string; metaUpdatedAt?: number; startedAt?: number }>;
        };
        run = day.runs?.find((candidate) => candidate.id === targetRunId);
      } catch {}
      const local = localControls[targetRunId];
      const expectedGeneration = run
        ? `${run.id}:${run.metaUpdatedAt ?? run.startedAt ?? 0}`.slice(0, 160)
        : "";
      observations.push({
        kind,
        accepted: kind === "published" ? !defaultPrevented : undefined,
        targetsCurrentRun: kind === "published"
          ? detail.runId === targetRunId
          : selected !== undefined,
        paused: Number(selected?.pausedAt) > 0,
        generationMatchesLocalRun: !!selected && selected.generation === expectedGeneration,
        localControlPresent: !!local,
        localControlPaused: Number(local?.pausedAt) > 0,
      });
    };
    window.addEventListener("run-calculator:dough-timer-control", (event) => {
      const custom = event as CustomEvent<Record<string, unknown>>;
      record("published", custom.detail ?? {}, event.defaultPrevented);
    });
    window.addEventListener("run-calculator:dough-timer-control-adopt", (event) => {
      const custom = event as CustomEvent<Record<string, unknown>>;
      record("adopted", custom.detail ?? {}, event.defaultPrevented);
    });
  }, runId);
}

async function advanceServerToFirstTrayTick(page: Page): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const snapshotResponse = await page.request.get(`/api/sync/today?today=${today}`);
  expect(snapshotResponse.ok(), "read the current authoritative tray schedule").toBe(true);
  const snapshot = await snapshotResponse.json() as {
    serverTime?: number;
    operationalProjection?: {
      due?: { entries?: Array<{ channel: string; dueAt: number }> };
    };
  };
  const trayDueAt = snapshot.operationalProjection?.due?.entries
    ?.find((entry) => entry.channel === "tray-consume")?.dueAt;
  expect(Number.isFinite(trayDueAt), "authoritative tray-consume due time").toBe(true);

  // Release-browser tests use this test-only endpoint to drive the same
  // authoritative server tick without relying on background wall-clock timing.
  const nowMs = Math.max(snapshot.serverTime ?? Date.now(), Math.ceil(trayDueAt!)) + 1;
  const tick = await page.request.post(`/api/sync/e2e/auto-track-tick?today=${today}`, {
    data: { nowMs, rearm: true },
  });
  expect(tick.ok(), `authoritative tray fixture tick failed: ${tick.status()}`).toBe(true);
  const result = await tick.json() as { accepted?: number };
  expect(Number.isInteger(result.accepted), "tick response must report accepted events").toBe(true);
  expect(result.accepted, "first authoritative tray tick should be accepted").toBeGreaterThan(0);
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
  const todaySyncResponses: Array<{ method: string; status: number }> = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname === "/api/sync/today") {
      todaySyncResponses.push({
        method: response.request().method(),
        status: response.status(),
      });
    }
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
  // Wait for the live Dough projection instead of assuming it has settled
  // after an arbitrary delay following Start Run.
  await expect(page.getByTestId("btn-pause-dough-timers")).toBeVisible({
    timeout: 15_000,
  });

  // Drive the one-shot authoritative tray seed before deriving a manual
  // correction. A full tray seed can legitimately leave batches at zero.
  await advanceServerToFirstTrayTick(page);
  // The deterministic tick is issued outside the page. Reload to adopt its
  // canonical revision before sending the manager's next command.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-dough").waitFor({ state: "visible", timeout: 25_000 });
  await page.getByTestId("tab-dough").click();
  await observeDoughTimerControlEvents(page, runId);
  let seedObservation: {
    ready: boolean;
    form: { trays: number; batches: number };
    canonical: { traysOnLine?: number; batchesReady?: number } | null;
    recentTodaySyncResponses: Array<{ method: string; status: number }>;
  } = {
    ready: false,
    form: { trays: 0, batches: 0 },
    canonical: null,
    recentTodaySyncResponses: [],
  };
  try {
    await expect.poll(async () => {
    const trays = await readStepperValue(page, "input-traysOnLine");
    const batches = await readStepperValue(page, "input-batchesReady");
    const canonical = await readCanonicalDoughValues(page, runId);
    seedObservation = {
      ready: trays > 0
        && canonical?.traysOnLine === trays
        && canonical?.batchesReady === batches,
      form: { trays, batches },
      canonical,
      recentTodaySyncResponses: todaySyncResponses.slice(-6),
    };
      return seedObservation.ready;
    }, { timeout: 15_000 }).toBe(true);
  } catch (error) {
    await testInfo.attach("dough-seed-diagnostics.json", {
      body: JSON.stringify(seedObservation, null, 2),
      contentType: "application/json",
    });
    throw error;
  }
  const currentTrays = await readStepperValue(page, "input-traysOnLine");
  const currentBatches = await readStepperValue(page, "input-batchesReady");

  await page.screenshot({ path: testInfo.outputPath("dough-before-correction.png") });

  // Use the operator's decrement control. A typed target calculated before
  // an authoritative server tick can already equal the new displayed value,
  // which is not a manual edit and correctly starts no Dough timer pause.
  await page.getByTestId("btn-dec-traysOnLine").click();
  const correctedTrays = await readStepperValue(page, "input-traysOnLine");
  expect(correctedTrays).toBeLessThan(currentTrays);
  const correctedDough = {
    traysOnLine: correctedTrays,
    batchesReady: currentBatches > 0 ? Math.max(0, currentBatches - 1) : 2,
  };
  const doughControlDiagnostics = await page.evaluate((targetRunId) => {
    const host = window as typeof window & { __doughTimerControlObservations?: unknown[] };
    let localControls: Record<string, Record<string, unknown>> = {};
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem("run-calculator:dough-timer-controls") ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        localControls = parsed as typeof localControls;
      }
    } catch {}
    const local = localControls[targetRunId];
    const visibleControlError = [...document.querySelectorAll<HTMLElement>('[role="alert"], [role="status"]')]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.textContent?.trim() ?? "")
      .find((text) => /control is not confirmed|run action is still pending|could not be saved for delivery/i.test(text));
    return {
      events: host.__doughTimerControlObservations ?? [],
      localControlPresent: !!local,
      localControlPaused: Number(local?.pausedAt) > 0,
      visibleControlError: visibleControlError ?? null,
    };
  }, runId);
  await testInfo.attach("dough-timer-control-diagnostics.json", {
    body: JSON.stringify(doughControlDiagnostics, null, 2),
    contentType: "application/json",
  });
  await expect(page.getByTestId("dough-timers-paused-banner")).toBeVisible();
  // Each edit starts the same timed Dough-only pause. The second correction
  // becomes its final baseline.
  expect(correctedDough.batchesReady).not.toBe(currentBatches);
  await setNumberField(page, "input-batchesReady", String(correctedDough.batchesReady));
  await expect(page.getByTestId("input-batchesReady")).toHaveValue(String(correctedDough.batchesReady));
  // A full tray seed can satisfy the entire run, so derived needs may stay
  // zero despite both real counter corrections. Verify the corrected counters
  // and canonical state instead of requiring demand to change.
  await expect(page.getByTestId("dough-timers-paused-banner")).toBeVisible();
  await expect
    .poll(
      async () => readCanonicalDoughValues(page, runId),
      { timeout: 15_000, intervals: [100, 250, 500] },
    )
    .toMatchObject(correctedDough);
  const correctionAcceptedAt = Date.now();
  // The pause is a real tray cadence, not just a transient render state.
  await page.waitForTimeout(500);
  await expect(page.getByTestId("dough-timers-paused-banner")).toBeVisible();
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
  await expect.poll(async () => ({
    pausedBannerVisible: await page.getByTestId("dough-timers-paused-banner").isVisible().catch(() => false),
    pauseButtonVisible: await page.getByTestId("btn-pause-dough-timers").isVisible().catch(() => false),
  }), {
    timeout: MAX_TRAY_PAUSE_MS,
    intervals: [100, 250, 500],
    message: "the Dough timer should re-arm after the timed correction pause",
  }).toEqual({
    pausedBannerVisible: false,
    pauseButtonVisible: true,
  });
  await page.waitForTimeout(750);
  expect(await readStepperValue(page, "input-traysOnLine"))
    .toBeGreaterThanOrEqual(correctedDough.traysOnLine - 1);
  expect(await readStepperValue(page, "input-batchesReady"))
    .toBeGreaterThanOrEqual(correctedDough.batchesReady - 1);

  const postCorrectionDoughWrites = syncWrites.filter(
    (write) =>
      write.requestAt >= correctionAcceptedAt
      && (
        write.traysOnLine !== correctedDough.traysOnLine
        || write.batchesReady !== correctedDough.batchesReady
      ),
  );
  const firstPostCorrectionDoughWrite = postCorrectionDoughWrites[0];
  let previousWrite = correctedDough;
  for (const write of postCorrectionDoughWrites) {
    expect(
      write.traysOnLine,
      "each resumed tray write may advance one normal cadence, never catch up the hidden pause",
    ).toBeGreaterThanOrEqual(previousWrite.traysOnLine - 1);
    expect(write.traysOnLine).toBeLessThanOrEqual(previousWrite.traysOnLine);
    expect(
      write.batchesReady,
      "each resumed batch write may advance one normal cadence, never catch up the hidden pause",
    ).toBeGreaterThanOrEqual(previousWrite.batchesReady - 1);
    expect(write.batchesReady).toBeLessThanOrEqual(previousWrite.batchesReady);
    previousWrite = write;
  }
  const canonicalAfterResume = await readCanonicalDoughValues(page, runId);
  expect(canonicalAfterResume.traysOnLine)
    .toBeGreaterThanOrEqual(correctedDough.traysOnLine - 1);
  expect(canonicalAfterResume.batchesReady)
    .toBeGreaterThanOrEqual(correctedDough.batchesReady - 1);
  if (firstPostCorrectionDoughWrite) {
    expect(canonicalAfterResume).toMatchObject(previousWrite);
  }

  await page.screenshot({ path: testInfo.outputPath("dough-resumed-no-catch-up.png") });
  expect(browserErrors).toEqual([]);
});