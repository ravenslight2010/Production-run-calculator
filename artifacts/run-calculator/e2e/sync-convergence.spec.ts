/**
 * Operational sync convergence matrix.
 *
 * This suite deliberately uses two real browser contexts sharing one account:
 * one context is the sleeping/offline device and the other is the active
 * operator.  The assertions check both the rendered/local state and the
 * canonical server response after wake.
 */

import { expect, test, type Browser, type Page, type Route, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import { selectCanonicalFixtureRun } from "./canonical-run-selection";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
} from "./isolation";
import {
  dismissOnboardingIfPresent,
  signUpAndHandleOnboarding,
} from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const users = new Set<string>();
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

function uid(): string {
  return `e2e_sync_${Math.random().toString(36).slice(2, 10)}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

test.beforeEach(async () => {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("sync-convergence beforeEach"),
  });
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date = $1", [today()]);
  } finally {
    await db.end().catch(() => {});
  }
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || users.size === 0) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupTestUsers(db, users);
  } finally {
    await db.end().catch(() => {});
  }
});

async function signUp(page: Page, username: string): Promise<void> {
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    onboarding: {
      dialog: (currentPage) => currentPage.getByRole("dialog"),
      afterComplete: async (currentPage) => {
        await currentPage
          .locator('[data-state="open"][aria-hidden="true"]')
          .waitFor({ state: "detached", timeout: 5_000 })
          .catch(() => {});
        await currentPage.waitForTimeout(300);
      },
    },
  });
}

async function promoteToManager(page: Page): Promise<void> {
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    return response.ok ? await response.json() as { userId?: string } : null;
  });
  expect(identity?.userId, "signed-in test user id").toBeTruthy();
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("sync-convergence promotion"),
  });
  try {
    await db.connect();
    await db.query("BEGIN");
    const role = await db.query(
      `UPDATE roles
       SET capabilities = $1::jsonb, updated_at = NOW()
       WHERE name = 'manager'
       RETURNING name`,
      [JSON.stringify(MANAGER_CAPABILITIES)],
    );
    expect(role.rows, "built-in manager role fixture").toHaveLength(1);
    await db.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'manager')
       ON CONFLICT (user_id)
       DO UPDATE SET role = 'manager', updated_at = NOW()`,
      [identity!.userId],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await db.end().catch(() => {});
  }
  // The current page already cached /api/me before the direct fixture role
  // update. Re-enter the application so capability-gated reset and scheduling
  // controls use the promoted identity rather than that stale auth snapshot.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
  await expect.poll(async () => page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (!response.ok) return null;
    const me = await response.json() as { role?: string; capabilities?: string[] };
    return {
      role: me.role,
      canReset: me.capabilities?.includes("manage-staff") ?? false,
      canSchedule: me.capabilities?.includes("manage-factory-settings") ?? false,
    };
  }), {
    message: "promoted manager identity and capabilities",
    timeout: 20_000,
  }).toEqual({
    role: "manager",
    canReset: true,
    canSchedule: true,
  });
}

type ScheduleMoveFixture = {
  currentDate: string;
  futureDate: string;
  liveRunId: string;
  futureRunId: string;
};

function scheduleMoveFixture(): ScheduleMoveFixture {
  const currentDate = today();
  const futureDate = (() => {
    const d = new Date(`${currentDate}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    currentDate,
    futureDate,
    liveRunId: `move-live-${suffix}`,
    futureRunId: `move-future-${suffix}`,
  };
}

async function seedScheduleMoveFixture(page: Page, fixture: ScheduleMoveFixture): Promise<void> {
  await page.evaluate(async ({ currentDate, futureDate, liveRunId, futureRunId }) => {
    const epochResponse = await fetch("/api/sync/reset-epoch", { cache: "no-store" });
    const epoch = (await epochResponse.json() as { epoch?: number }).epoch ?? 0;
    const put = async (path: string, payload: unknown) => {
      const response = await fetch(`${path}&epoch=${epoch}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senderId: "schedule-move-e2e", payload }),
      });
      if (!response.ok) throw new Error(`fixture PUT failed: ${response.status}`);
    };
    await put(`/api/sync/today?today=${currentDate}`, {
      dayState: {
        date: currentDate,
        runs: [{ id: liveRunId, brand: "Move Existing", flavor: "Live Plan" }],
      },
      runValues: { [liveRunId]: { casesNeeded: 11, casesPerSkid: 12 } },
      runValuesUpdatedAt: { [liveRunId]: 100 },
    });
    await put(`/api/sync/${futureDate}?today=${currentDate}`, {
      dayState: {
        date: futureDate,
        runs: [{ id: futureRunId, brand: "Move Future", flavor: "Tomorrow" }],
      },
      runValues: { [futureRunId]: { casesNeeded: 37, casesPerSkid: 12 } },
      runValuesUpdatedAt: { [futureRunId]: 200 },
    });
  }, fixture);
}

function observeScheduleMoveEvidence(page: Page) {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  const backendResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api/sync/")) {
      backendResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  return { consoleMessages, pageErrors, backendResponses };
}

async function attachScheduleMoveEvidence(
  testInfo: TestInfo,
  evidence: ReturnType<typeof observeScheduleMoveEvidence>,
): Promise<void> {
  await testInfo.attach("schedule-move-console-backend-evidence.json", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
}

async function cleanupScheduleMoveFixture(fixture: ScheduleMoveFixture): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("schedule move e2e cleanup"),
  });
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date IN ($1, $2)", [
      fixture.currentDate,
      fixture.futureDate,
    ]);
  } finally {
    await db.end().catch(() => {});
  }
}

type SyncPayload = {
  dayState: {
    date: string;
    runs: Array<Record<string, unknown>>;
    currentIndex: number;
  };
  deletedItems?: { runs?: string[] };
  runValues: Record<string, Record<string, unknown>>;
  runValuesUpdatedAt: Record<string, number>;
  syncVersion?: number;
  completeness?: "complete" | "partial";
  baseSnapshotId?: string;
};

async function putToday(page: Page, payload: SyncPayload): Promise<{
  body: Record<string, unknown>;
  responseStatus: number;
}> {
  return page.evaluate(async ({ date, payload }) => {
    const [epochResponse, baselineResponse] = await Promise.all([
      fetch("/api/sync/reset-epoch", { cache: "no-store" }),
      fetch(`/api/sync/today?today=${date}`, { cache: "no-store" }),
    ]);
    if (!epochResponse.ok || !baselineResponse.ok) {
      throw new Error("sync fixture baseline request failed");
    }
    const epochBody = await epochResponse.json() as { epoch?: number };
    const epoch = typeof epochBody.epoch === "number" ? epochBody.epoch : 0;
    const snapshotId = baselineResponse.headers.get("X-Sync-Snapshot");
    if (!snapshotId) throw new Error("sync fixture snapshot identity is missing");
    const payloadToSend = payload.completeness === "complete"
      ? { ...payload, baseSnapshotId: payload.baseSnapshotId ?? snapshotId }
      : payload;
    const response = await fetch(`/api/sync/today?today=${date}&epoch=${epoch}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "sync-matrix",
        payload: payloadToSend,
        snapshotId,
      }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.snapshotId !== "string") {
      const headerSnapshot = response.headers.get("X-Sync-Snapshot");
      if (headerSnapshot) body.snapshotId = headerSnapshot;
    }
    return { responseStatus: response.status, body };
  }, { date: today(), payload });
}

async function getToday(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async (date) => {
    const response = await fetch(`/api/sync/today?today=${date}`);
    return (await response.json()) as Record<string, unknown>;
  }, today());
}

async function localRuns(page: Page): Promise<Array<{ id?: string; endedAt?: number }>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(() => {
        const raw = localStorage.getItem("run-calc-day");
        return ((JSON.parse(raw ?? "{}") as { runs?: Array<{ id?: string; endedAt?: number }> }).runs ?? []);
      });
    } catch (error) {
      if (attempt === 2) throw error;
      // Wake reconciliation can reload the page between the poll's call and
      // its evaluation. Wait for that navigation to settle, then read the
      // durable copy again rather than turning a transient destroyed context
      // into a failed convergence test.
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
  }
  return [];
}

function seededPayload(runId: string): SyncPayload {
  return {
    dayState: {
      date: today(),
      currentIndex: 0,
      runs: [{ id: runId, brand: "Wake", flavor: "Convergence" }],
    },
    runValues: { [runId]: { casesNeeded: 24, casesPerSkid: 12 } },
    runValuesUpdatedAt: { [runId]: 1 },
    syncVersion: 1,
    completeness: "complete",
  };
}

test("frontline supply recovers across runs and converges with a second tab", async ({ page, browser }, testInfo) => {
  // The browser runner owns a disposable PostgreSQL cluster. Never run this
  // canonical-stock fixture against development, production, or shared data.
  const username = uid();
  users.add(username);
  await signUp(page, username);
  await promoteToManager(page);

  const runA = `frontline-a-${Date.now()}`;
  const runB = `frontline-b-${Date.now()}`;
  const plannedValues = {
    casesNeeded: 120, pizzasPerCase: 12, casesPerSkid: 12,
    crustsPerCycle: 12, cycleSpeed: 600, approxLineSpeed: 120,
    app1Type: "Cheese", app1OzPerPizza: 4, app1BatchLbs: 25,
    app1CheeseRecipe: [],
    app2Type: "", app3Type: "", app4Type: "",
    pep1Type: "Pepperoni", pep1OzPerPizza: 1,
    pep1TypeB: "", pep2Type: "", pep2TypeB: "",
  };
  const seeded: SyncPayload = {
    dayState: {
      date: today(),
      currentIndex: 0,
      runs: [
        { id: runA, brand: "Fixture", flavor: "First" },
        { id: runB, brand: "Fixture", flavor: "Second" },
      ],
    },
    runValues: { [runA]: plannedValues, [runB]: plannedValues },
    runValuesUpdatedAt: { [runA]: 1, [runB]: 1 },
    syncVersion: 1,
    completeness: "complete",
  };
  expect((await putToday(page, seeded)).responseStatus).toBe(200);
  const db = new Client({ connectionString: requireIsolatedTestDatabase("Frontline canonical supply fixture") });
  try {
    await db.connect();
    const row = await db.query<{ data: SyncPayload }>(
      "SELECT data FROM daily_sync WHERE scope = 'live' AND date = $1",
      [today()],
    );
    expect(row.rows).toHaveLength(1);
    const data = row.rows[0].data;
    Object.assign(data.runValues[runA], {
      app1StockLbs: 25,
      app1StockConsumedLbs: 0,
      app1StockAnchorNetSec: 0,
      app1StockCorrectionGeneration: 0,
      app1BatchesMade: 0,
      app1BatchAnchorNetSec: 0,
      app1BatchCorrectionGeneration: 0,
      pep1StockLbs: 0,
      pep1StockAnchorNetSec: 0,
      pep1StockCorrectionGeneration: 0,
      applicatorStockInitialized: true,
    });
    await db.query("UPDATE daily_sync SET data = $1::jsonb WHERE scope = 'live' AND date = $2",
      [JSON.stringify(data), today()]);
  } finally {
    await db.end();
  }

  const canonical = async () => (await getToday(page)) as {
    dayState: { runs: Array<{ id: string; startedAt?: number; pausedAt?: number; endedAt?: number }> };
    runValues: Record<string, Record<string, number>>;
    syncVersion?: number;
  };
  await page.reload({ waitUntil: "domcontentloaded" });
  await selectCanonicalFixtureRun(page, runA);
  await expect(page.getByTestId("input-casesNeeded")).toHaveValue("120");
  await page.getByTestId("button-start-run").click();
  await expect.poll(async () => Boolean(
    (await canonical()).dayState.runs.find((run) => run.id === runA)?.startedAt,
  )).toBe(true);
  await page.getByRole("button", { name: /^pause.?run$/i }).click();
  await expect.poll(async () => Boolean(
    (await canonical()).dayState.runs.find((run) => run.id === runA)?.pausedAt,
  )).toBe(true);

  const peerContext = await browser.newContext({ storageState: await page.context().storageState() });
  const peer = await peerContext.newPage();
  try {
    await peer.goto("/");
    await selectCanonicalFixtureRun(peer, runA);
    await Promise.all([page.getByTestId("tab-frontline").click(), peer.getByTestId("tab-frontline").click()]);
    const supply = (p: Page) => p.getByTestId("frontline-supply-app1");
    const batchesOnLine = async (p: Page) =>
      Number.parseFloat((await supply(p).getByTestId("output-app1-batches-on-line").textContent()) ?? "");
    const initialStock = (await canonical()).runValues[runA].app1StockLbs;
    await expect.poll(() => batchesOnLine(page)).toBeCloseTo(initialStock / 25, 2);
    await expect.poll(() => batchesOnLine(peer)).toBeCloseTo(initialStock / 25, 2);
    await expect(supply(page)).toContainText("Automatic tracking paused with run");
    await expect(page.getByText("Applicator Stock On Hand")).toHaveCount(0);
    if (initialStock > 25) {
      await supply(page).getByRole("button", { name: "Decrease app1 batches on line" }).click();
      await expect.poll(async () => (await canonical()).runValues[runA].app1StockLbs)
        .toBe(initialStock - 25);
    }
    const beforeLoad = (await canonical()).runValues[runA].app1StockLbs;
    const beforeConsumed = (await canonical()).runValues[runA].app1StockConsumedLbs;
    const beforeNeeded = Number.parseFloat(
      (await page.getByTestId("output-app1-batches").textContent()) ?? "",
    );
    await supply(page).getByRole("button", { name: "Increase app1 batches on line" }).click();
    await expect.poll(async () => (await canonical()).runValues[runA].app1StockLbs).toBe(beforeLoad + 25);
    expect((await canonical()).runValues[runA].app1StockConsumedLbs).toBe(beforeConsumed);
    await expect.poll(() => batchesOnLine(page)).toBeCloseTo((beforeLoad + 25) / 25, 2);
    await expect.poll(() => batchesOnLine(peer)).toBeCloseTo((beforeLoad + 25) / 25, 2);
    await expect.poll(async () => Number.parseFloat(
      (await page.getByTestId("output-app1-batches").textContent()) ?? "",
    )).toBeCloseTo(beforeNeeded - 1, 1);
    const pepperoni = page.getByTestId("stock-pep1-lbs");
    await pepperoni.fill("12.5");
    await expect(peer.getByTestId("stock-pep1-lbs")).toHaveValue("0");
    const refillResponse = page.waitForResponse((response) =>
      response.url().includes("/api/sync/manual-section")
      && response.request().method() === "POST"
      && response.request().postDataJSON()?.section === "pep1",
    );
    await pepperoni.locator("..").getByRole("button", { name: "Save", exact: true }).click();
    const refill = await refillResponse;
    const refillBody = await refill.json() as { code?: string };
    expect(refill.status(), `Pepperoni refill rejection code: ${refillBody.code ?? "none"}`).toBe(200);
    await expect.poll(async () => (await canonical()).runValues[runA].pep1StockLbs).toBe(12.5);
    await expect(peer.getByTestId("stock-pep1-lbs")).toHaveValue("12.5");
    const afterPepperoniLoad = (await canonical()).runValues[runA];
    expect(afterPepperoniLoad.app1StockLbs).toBe(beforeLoad + 25);
    expect(afterPepperoniLoad.app1StockConsumedLbs).toBe(beforeConsumed);
    await expect(page.getByTestId("stock-app1-lbs")).toHaveCount(0);
    await testInfo.attach("fixture-frontline-current-supply", {
      body: await page.screenshot(), contentType: "image/png",
    });

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      const row = supply(page);
      await expect(row.getByRole("button", { name: "Decrease app1 batches on line" })).toBeVisible();
      await expect(row.getByTestId("output-app1-batches-on-line")).toBeVisible();
      const bounds = await row.boundingBox();
      expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? viewport.width) + (bounds?.width ?? 1)).toBeLessThanOrEqual(viewport.width + 1);
      const pepperoniBounds = await pepperoni.boundingBox();
      expect(pepperoniBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((pepperoniBounds?.x ?? viewport.width) + (pepperoniBounds?.width ?? 1)).toBeLessThanOrEqual(viewport.width + 1);
    }
    if (process.env.FRONTLINE_PEPPERONI_ONLY === "1") {
      testInfo.annotations.push({ type: "scope", description: "Review repair only: pepperoni refill and peer adoption; no new run-transition evidence." });
      return;
    }

    await page.getByTestId("tab-run").click();
    await page.getByTestId("resume-run").click();
    await expect.poll(async () => {
      const run = (await canonical()).dayState.runs.find((candidate) => candidate.id === runA);
      return run ? Boolean(run.pausedAt) : null;
    }).toBe(false);
    await page.getByTestId("tab-packaging").click();
    const beforeCorrection = (await canonical()).runValues[runA].casesOnCurrentSkid || 0;
    await page.getByTestId("btn-inc-casesOnCurrentSkid").click();
    await expect.poll(async () => (await canonical()).runValues[runA].casesOnCurrentSkid)
      .toBeGreaterThan(beforeCorrection);
    const afterCorrection = (await canonical()).runValues[runA].casesOnCurrentSkid;
    await expect.poll(async () => (await canonical()).runValues[runA].app1StockConsumedLbs, {
      timeout: 70_000,
    }).toBeGreaterThan(beforeConsumed);
    expect((await canonical()).runValues[runA].casesOnCurrentSkid).toBe(afterCorrection);
    const convergenceSamples: Array<Record<string, number | string | null>> = [];
    const peerSyncFailures: Array<Record<string, number | string>> = [];
    const peerSyncFailureReads: Promise<void>[] = [];
    peer.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (!pathname.startsWith("/api/sync/") || response.ok()) return;
      const failure: Record<string, number | string> = {
        pathname,
        status: response.status(),
        error: "Reading safe response detail",
      };
      peerSyncFailures.push(failure);
      if (peerSyncFailures.length > 12) peerSyncFailures.shift();
      peerSyncFailureReads.push((async () => {
        let claimShape: unknown = null;
        if (pathname === "/api/sync/auto-track/claim") {
          try {
            const requestBody = response.request().postDataJSON() as {
              claim?: Record<string, unknown>;
            } | null;
            const claim = requestBody?.claim;
            const rawMutations = Array.isArray(claim?.mutations)
              ? claim.mutations
              : [];
            claimShape = claim
              ? {
                  version: claim.version,
                  channel: claim.channel,
                  sequence: claim.sequence,
                  dueAt: claim.dueAt,
                  nextDueAt: claim.nextDueAt,
                  baseUpdatedAt: claim.baseUpdatedAt,
                  correctionGeneration: claim.correctionGeneration,
                  runIdValid: typeof claim.runId === "string"
                    && /^[A-Za-z0-9:_-]{1,160}$/.test(claim.runId),
                  generationValid: typeof claim.generation === "string"
                    && /^[A-Za-z0-9:_-]{1,160}$/.test(claim.generation),
                  eventIdValid: typeof claim.eventId === "string"
                    && /^[A-Za-z0-9:_-]{1,160}$/.test(claim.eventId),
                  mutations: rawMutations.map((mutation) => {
                    const item = mutation as Record<string, unknown>;
                    return {
                      field: item.field,
                      from: item.from,
                      to: item.to,
                    };
                  }),
                }
              : null;
          } catch {
            // Request details are diagnostic-only; keep the safe status record.
          }
        }
        let error = "No safe server error message";
        try {
          const body = await response.json() as { error?: unknown };
          if (typeof body.error === "string") error = body.error;
        } catch {
          // Keep diagnostics useful without retaining an unparsed response body.
        }
        Object.assign(failure, {
          error,
          ...(claimShape ? { claimShape: JSON.stringify(claimShape) } : {}),
        });
      })().catch(() => {
        Object.assign(failure, { error: "Safe response diagnostics unavailable" });
      }));
    });
    peer.on("requestfailed", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (!pathname.startsWith("/api/sync/")) return;
      peerSyncFailures.push({
        pathname,
        error: request.failure()?.errorText ?? "request failed",
      });
      if (peerSyncFailures.length > 12) peerSyncFailures.shift();
    });
    try {
      await expect.poll(async () => {
        const peerBatches = await batchesOnLine(peer);
        // Read the live peer UI first and the canonical row afterward. Stock
        // can change while the running line produces and consumes, so reading
        // the server first can compare the peer with an already-stale snapshot.
        const snapshot = await canonical();
        const values = snapshot.runValues[runA];
        // The UI shows two decimal places; compare at that same precision so
        // legitimate display rounding is not mistaken for a sync mismatch.
        const canonicalDisplayBatches = Number((values.app1StockLbs / 25).toFixed(2));
        convergenceSamples.push({
          syncVersion: snapshot.syncVersion ?? null,
          canonicalStockLbs: values.app1StockLbs,
          canonicalConsumedLbs: values.app1StockConsumedLbs,
          canonicalDisplayBatches,
          peerDisplayedBatches: peerBatches,
        });
        if (convergenceSamples.length > 12) convergenceSamples.shift();
        return peerBatches === canonicalDisplayBatches;
      }, {
        timeout: 15_000,
        message: "second tab applicator supply should match fresh canonical stock after the accepted claim",
      }).toBe(true);
    } catch (error) {
      await Promise.allSettled(peerSyncFailureReads);
      const cause = error instanceof Error ? error.message : String(error);
      const diagnostics = JSON.stringify(
        { convergenceSamples, peerSyncFailures },
        null,
        2,
      );
      await testInfo.attach("frontline-canonical-peer-convergence", {
        body: diagnostics,
        contentType: "application/json",
      });
      throw new Error(`${cause}\nConvergence diagnostics:\n${diagnostics}`, {
        cause: error,
      });
    }
    await Promise.allSettled(peerSyncFailureReads);
    const rejectedClaims = peerSyncFailures.filter(
      (failure) =>
        failure.pathname === "/api/sync/auto-track/claim"
        && failure.status === 400,
    );
    expect(
      rejectedClaims,
      `Auto-track claims must satisfy the server request contract: ${JSON.stringify(rejectedClaims)}`,
    ).toHaveLength(0);
    await page.getByTestId("tab-run").click();
    await page.getByRole("button", { name: /^stop.?run$/i }).first().click();
    await expect.poll(async () => Boolean(
      (await canonical()).dayState.runs.find((run) => run.id === runA)?.endedAt,
    )).toBe(true);
    await selectCanonicalFixtureRun(page, runB);
    await page.getByTestId("button-start-run").click();
    await expect.poll(async () => Boolean(
      (await canonical()).dayState.runs.find((run) => run.id === runB)?.startedAt,
    )).toBe(true);
    expect((await canonical()).dayState.runs.find((run) => run.id === runA)?.endedAt).toBeTruthy();
    await page.getByTestId("tab-frontline").click();
    await expect(supply(page)).toBeVisible();
    await expect.poll(async () => (await canonical()).runValues[runB].app1StockLbs, {
      timeout: 70_000,
    }).toBeGreaterThan(0);
    await testInfo.attach("fixture-new-run-rearmed", {
      body: await page.screenshot(), contentType: "image/png",
    });
  } finally {
    await peerContext.close();
  }
});

test("measures canonical edit and foreground recovery latency", async ({ page, browser }, testInfo) => {
  const username = uid();
  users.add(username);
  await signUp(page, username);
  const runId = `latency-${Date.now()}`;
  expect((await putToday(page, seededPayload(runId))).responseStatus).toBe(200);
  // Verify the canonical fixture before reload so a missing seed is distinct
  // from a client hydration/convergence failure.
  const seededCanonical = await getToday(page) as {
    runValues?: Record<string, { casesNeeded?: number }>;
  };
  expect(seededCanonical.runValues?.[runId]?.casesNeeded).toBe(24);
  await page.reload({ waitUntil: "domcontentloaded" });
  await selectCanonicalFixtureRun(page, runId);
  await expect(page.getByTestId("input-casesNeeded")).toHaveValue("24");
  const peerContext = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const peer = await peerContext.newPage();
  const browserSignals = {
    ownerConsoleErrors: 0,
    ownerConsoleWarnings: 0,
    ownerPageErrors: 0,
    peerConsoleErrors: 0,
    peerConsoleWarnings: 0,
    peerPageErrors: 0,
  };
  page.on("console", (message) => {
    if (message.type() === "error") browserSignals.ownerConsoleErrors++;
    if (message.type() === "warning") browserSignals.ownerConsoleWarnings++;
  });
  page.on("pageerror", () => { browserSignals.ownerPageErrors++; });
  peer.on("console", (message) => {
    if (message.type() === "error") browserSignals.peerConsoleErrors++;
    if (message.type() === "warning") browserSignals.peerConsoleWarnings++;
  });
  peer.on("pageerror", () => { browserSignals.peerPageErrors++; });
  await peer.addInitScript(() => {
    const sources: EventSource[] = [];
    const Original = window.EventSource;
    window.EventSource = class extends Original {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        sources.push(this);
      }
    };
    (window as unknown as { fixtureSyncSources: EventSource[] }).fixtureSyncSources = sources;
  });
  const samples: Array<Record<string, number | string>> = [];
  const wakeSamples: Array<Record<string, number | string>> = [];
  const timings: string[] = [];
  let injectedDelayMs = 0;
  let failNextPull = false;
  let timeoutNextPull = false;
  let timedOutPulls = 0;
  let failedPulls = 0;
  let peerPulls = 0;
  let peerWrites = 0;
  await page.route("**/api/sync/today**", async (route) => {
    if (injectedDelayMs) await new Promise((resolve) => setTimeout(resolve, injectedDelayMs));
    await route.continue();
  });
  await peer.route("**/api/sync/today**", async (route) => {
    if (route.request().method() === "GET") peerPulls++;
    if (route.request().method() === "PUT") peerWrites++;
    if (route.request().method() === "GET" && timeoutNextPull) {
      timeoutNextPull = false;
      timedOutPulls++;
      // Retain the fixture route beyond the existing 10s CLIENT deadline.
      // The next request is not stalled, so canonical recovery can succeed.
      await new Promise((resolve) => setTimeout(resolve, 11_000));
      await route.abort().catch(() => {});
    } else if (route.request().method() === "GET" && failNextPull) {
      failNextPull = false;
      failedPulls++;
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Temporary fixture outage"}' });
    } else await route.continue();
  });
  const isWriteFor = (response: import("@playwright/test").Response, value: number) => {
    if (!response.url().includes("/api/sync/today") || response.request().method() !== "PUT" || !response.ok()) return false;
    const body = response.request().postDataJSON() as { payload?: SyncPayload };
    return body.payload?.runValues?.[runId]?.casesNeeded === value;
  };
  try {
    await peer.goto(new URL("/", page.url()).href);
    await dismissOnboardingIfPresent(peer);
    await peer.getByTestId("tab-run").click();
    await expect(peer.getByTestId("input-casesNeeded")).toHaveValue("24");
    // Warm cache and first edit after document reload are labeled separately.
    for (let sample = 0; sample < 6; sample++) {
      injectedDelayMs = sample >= 3 ? 40 : 0;
      const value = 31 + sample;
      const ack = page.waitForResponse((response) => isWriteFor(response, value));
      const start = Date.now();
      await page.getByTestId("input-casesNeeded").fill(String(value));
      const response = await ack;
      const canonical = await response.json() as { data?: SyncPayload };
      expect(canonical.data?.runValues?.[runId]?.casesNeeded).toBe(value);
      const ackMs = Date.now() - start;
      await expect(peer.getByTestId("input-casesNeeded")).toHaveValue(String(value), { timeout: 10_000 });
      const peerMs = Date.now() - start;
      timings.push(response.headers()["server-timing"] ?? "");
      samples.push({
        ackMs, peerMs,
        requestBytes: Buffer.byteLength(response.request().postData() ?? ""),
        injectedRequestDelayMs: injectedDelayMs,
        condition: sample === 0 ? "document-cold-server-warm" : "warm",
      });
    }
    injectedDelayMs = 0;
    const wakeCount = testInfo.project.name === "desktop-chromium" ? 5 : 4;
    for (let sample = 0; sample < wakeCount; sample++) {
      await peer.evaluate(() => {
        // Playwright offline mode does not terminate existing SSE sockets.
        // Close the owned fixture streams so wake MUST adopt the HTTP row.
        (window as unknown as { fixtureSyncSources: EventSource[] })
          .fixtureSyncSources.forEach((source) => source.close());
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await peerContext.setOffline(true);
      const value = 61 + sample;
      const ack = page.waitForResponse((response) => isWriteFor(response, value));
      await page.getByTestId("input-casesNeeded").fill(String(value));
      await (await ack).finished();
      failNextPull = sample === 1;
      timeoutNextPull = sample === 4;
      const startedAt = Date.now();
      await peerContext.setOffline(false);
      await peer.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("online"));
        window.dispatchEvent(new Event("focus"));
      });
      if (sample === 4) {
        await expect.poll(() => timedOutPulls).toBe(1);
        const notice = peer.getByTestId("foreground-recovery-status");
        await expect(notice).toHaveAttribute("data-foreground-recovery-state", "recovering");
        await expect(peer.getByTestId("input-casesNeeded")).not.toHaveValue(String(value));
      }
      await expect(peer.getByTestId("input-casesNeeded")).toHaveValue(String(value), { timeout: sample === 4 ? 18_000 : 12_000 });
      // A displayed value is not enough: the recovery owner must finish.
      await expect(peer.getByTestId("foreground-recovery-status")).toHaveAttribute("data-foreground-recovery-state", "outcome");
      wakeSamples.push({ durationMs: Date.now() - startedAt, condition: sample === 4 ? "one-client-timeout-then-retry" : sample === 1 ? "one-503-then-retry" : "healthy-duplicate-wake" });
    }
    const stageMeasurements = await page.evaluate((date) =>
      JSON.parse(localStorage.getItem(`run-calc-sync-measurements:${date}`) ?? "[]"), today());
    // Measurements are fixed numeric fields; never attach cookies or payloads.
    const evidence = { environment: "isolated-browser", project: testInfo.project.name,
      network: "loopback, 0/40ms injected request delay, no bandwidth cap",
      samples, wakeSamples, serverTiming: timings, stageMeasurements, failedPulls, peerPulls, peerWrites, timedOutPulls, browserSignals };
    console.info(`sync-browser-latency ${JSON.stringify(evidence)}`);
    await testInfo.attach("sync-latency.json", { body: JSON.stringify(evidence), contentType: "application/json" });
    await testInfo.attach("authenticated-peer-converged.png", {
      body: await peer.getByTestId("input-casesNeeded").screenshot(),
      contentType: "image/png",
    });
    expect(failedPulls).toBe(1);
    expect(Math.max(...samples.map((sample) => Number(sample.ackMs)))).toBeLessThan(2000);
    expect(Math.max(...samples.map((sample) => Number(sample.peerMs)))).toBeLessThan(2000);
    expect(Math.max(...wakeSamples.filter((sample) => sample.condition !== "one-client-timeout-then-retry").map((sample) => Number(sample.durationMs)))).toBeLessThan(5000);
    expect(peerPulls).toBeLessThan(20);
    expect(peerWrites).toBeLessThan(20);
  } finally {
    await peerContext.close();
  }
});

test(
  "temporarily failed sync write retries automatically after the network recovers",
  async ({ page }: { page: Page }) => {
    const username = uid();
    users.add(username);
    await signUp(page, username);
    await page.getByTestId("tab-run").click();
    await page.getByTestId("input-casesNeeded").waitFor({ state: "visible", timeout: 20_000 });

    let blocked = true;
    let syncWriteAttempts = 0;
    let blockedWrites = 0;
    let completeWritesAfterRecovery = 0;
    await page.route("**/api/sync/today**", async (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        syncWriteAttempts += 1;
        const body = request.postDataJSON() as {
          payload?: { completeness?: string };
        };
        if (!blocked && body.payload?.completeness === "complete") {
          completeWritesAfterRecovery += 1;
        }
      }
      if (request.method() === "PUT" && blocked) {
        blockedWrites += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "temporary sync outage" }),
        });
        return;
      }
      await route.continue();
    });

    const casesNeeded = page.getByTestId("input-casesNeeded");
    await casesNeeded.fill("17");
    await expect
      .poll(() => blockedWrites, { timeout: 10_000 })
      .toBe(1);

    // The failed request must retain the edit locally and expose the queued
    // retry state instead of treating the parseable error response as an ack.
    await expect
      .poll(async () => page.evaluate(() => {
        const raw = localStorage.getItem("run-calc-day");
        const day = JSON.parse(raw ?? "{}") as { runs?: Array<{ id?: string }> };
        const runId = day.runs?.[0]?.id;
        if (!runId) return null;
        const values = JSON.parse(localStorage.getItem(`run-calc-run-${runId}`) ?? "{}") as {
          casesNeeded?: number;
        };
        return values.casesNeeded;
      }), { timeout: 10_000 })
      .toBe(17);

    const syncButton = page.locator('button[title="Sync connected"]');
    await syncButton.click();
    await expect(page.getByText("Your local change is retained on this device.")).toBeVisible();
    await expect(page.getByText("Pending writes")).toBeVisible();
    await expect(page.getByText("Retry latest retained change")).toBeVisible();

    // The route now allows the next attempt through. The existing retry queue
    // should recover without a manual retry and clear the retained-change state
    // only after the server acknowledges the write.
    const telemetryObservedSince = new Date();
    blocked = false;
    await expect.poll(() => syncWriteAttempts, { timeout: 15_000 }).toBeGreaterThan(1);
    await expect.poll(() => completeWritesAfterRecovery, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByText(
      "Your latest changes are retained on this device, but the server has not acknowledged them. Other devices cannot see them until sync succeeds.",
      { exact: true },
    )).toBeHidden();
    await expect.poll(async () => {
      const server = await getToday(page);
      const values = server.runValues as Record<string, { casesNeeded?: number }> | undefined;
      return Object.values(values ?? {})[0]?.casesNeeded;
    }, { timeout: 15_000 }).toBe(17);

    const telemetryClientId = await page.evaluate(() =>
      localStorage.getItem("run-calc-field-check-client"),
    );
    expect(telemetryClientId).toBeTruthy();
    const evidenceDb = new Client({
      connectionString: requireIsolatedTestDatabase("sync-convergence workflow evidence"),
    });
    try {
      await evidenceDb.connect();
      await expect.poll(async () => {
        const result = await evidenceDb.query<{
          outcome: string;
          metrics: Record<string, number>;
        }>(
          `SELECT outcome, metrics
           FROM field_check_observations
           WHERE check_name = $1
             AND outcome = 'success'
             AND left(observation_id, char_length($2)) = $2
             AND observed_at >= $3
           ORDER BY observed_at DESC
           LIMIT 1`,
          ["production-run-save-sync", `${telemetryClientId}:`, telemetryObservedSince],
        );
        return result.rows[0] ?? null;
      }, { timeout: 15_000 }).toEqual(expect.objectContaining({
        outcome: "success",
        metrics: expect.objectContaining({ durationMs: expect.any(Number) }),
      }));
      const stored = await evidenceDb.query<{ metrics: Record<string, number> }>(
        `SELECT metrics
         FROM field_check_observations
         WHERE check_name = $1 AND outcome = 'success'
           AND left(observation_id, char_length($2)) = $2
           AND observed_at >= $3
         ORDER BY observed_at DESC
         LIMIT 1`,
        ["production-run-save-sync", `${telemetryClientId}:`, telemetryObservedSince],
      );
      expect(Object.keys(stored.rows[0]?.metrics ?? {})).toEqual(["durationMs"]);
      expect(stored.rows[0]?.metrics.durationMs).toBeGreaterThanOrEqual(0);
      expect(stored.rows[0]?.metrics.durationMs).toBeLessThanOrEqual(15 * 60 * 1000);
    } finally {
      await evidenceDb.end().catch(() => {});
    }

    // Verify the server-acknowledged progress is restored after a real reload.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
    await page.getByTestId("tab-run").click();
    await expect(page.getByTestId("input-casesNeeded")).toHaveValue("17");
  },
);


test(
  "queued Target Cases edit recovers when a sleeping tab wakes",
  async ({ page }: { page: Page }) => {
    const username = uid();
    users.add(username);
    await signUp(page, username);
    await page.getByTestId("tab-run").click();
    await page.getByTestId("input-casesNeeded").waitFor({ state: "visible", timeout: 20_000 });

    let blocked = true;
    let blockedWrites = 0;
    let wakePulls = 0;
    let syncWriteAttempts = 0;
    await page.route("**/api/sync/today**", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        wakePulls += 1;
        await route.continue();
        return;
      }
      if (request.method() === "PUT") {
        syncWriteAttempts += 1;
        if (blocked) {
          blockedWrites += 1;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "sleep-time sync outage" }),
          });
          return;
        }
      }
      await route.continue();
    });

    const casesNeeded = page.getByTestId("input-casesNeeded");
    await casesNeeded.fill("23");
    await expect.poll(() => blockedWrites, { timeout: 10_000 }).toBe(1);
    await expect
      .poll(async () => page.evaluate(() => {
        const raw = localStorage.getItem("run-calc-day");
        const day = JSON.parse(raw ?? "{}") as { runs?: Array<{ id?: string }> };
        const runId = day.runs?.[0]?.id;
        if (!runId) return null;
        const values = JSON.parse(localStorage.getItem(`run-calc-run-${runId}`) ?? "{}") as {
          casesNeeded?: number;
        };
        return values.casesNeeded;
      }), { timeout: 10_000 })
      .toBe(23);

    const pullsBeforeSleep = wakePulls;
    // Model the browser being backgrounded/suspended, then returning to the
    // foreground. Dispatching the real DOM event exercises the same handler
    // used by a browser wake; the visibilityState override makes the test
    // deterministic in headless Chromium.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    blocked = false;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect.poll(() => wakePulls, { timeout: 15_000 }).toBeGreaterThan(pullsBeforeSleep);
    await expect.poll(() => syncWriteAttempts, { timeout: 15_000 }).toBeGreaterThan(1);
    await expect(page.getByText(
      "Your latest changes are retained on this device, but the server has not acknowledged them. Other devices cannot see them until sync succeeds.",
      { exact: true },
    )).toBeHidden();
    await expect.poll(async () => {
      const server = await getToday(page);
      const values = server.runValues as Record<string, { casesNeeded?: number }> | undefined;
      return Object.values(values ?? {})[0]?.casesNeeded;
    }, { timeout: 15_000 }).toBe(23);
  },
);

test(
  "@real-mobile-browser queued Target Cases edit recovers after Android Chrome suspension",
  async ({ page }: { page: Page }) => {
    test.skip(
      test.info().project.name !== "real-mobile-chromium",
      "This optional check requires PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT.",
    );
    test.setTimeout(300_000);
    const username = uid();
    users.add(username);
    await signUp(page, username);
    await page.getByTestId("tab-run").click();
    await page.getByTestId("input-casesNeeded").waitFor({ state: "visible", timeout: 20_000 });

    let blocked = true;
    let blockedWrites = 0;
    let wakePulls = 0;
    let syncWriteAttempts = 0;
    await page.route("**/api/sync/today**", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        wakePulls += 1;
        await route.continue();
        return;
      }
      if (request.method() === "PUT") {
        syncWriteAttempts += 1;
        if (blocked) {
          blockedWrites += 1;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "android-suspension sync outage" }),
          });
          return;
        }
      }
      await route.continue();
    });

    await page.getByTestId("input-casesNeeded").fill("21");
    await expect.poll(() => blockedWrites, { timeout: 10_000 }).toBe(1);
    await expect.poll(async () => page.evaluate(() => {
      const raw = localStorage.getItem("run-calc-day");
      const day = JSON.parse(raw ?? "{}") as { runs?: Array<{ id?: string }> };
      const runId = day.runs?.[0]?.id;
      if (!runId) return null;
      const values = JSON.parse(localStorage.getItem(`run-calc-run-${runId}`) ?? "{}") as {
        casesNeeded?: number;
      };
      return values.casesNeeded;
    }), { timeout: 10_000 }).toBe(21);

    const pullsBeforeSuspension = wakePulls;
    const attemptsBeforeSuspension = syncWriteAttempts;
    console.log(
      "Physical Android step: background this Chrome tab now, leave it suspended briefly, then return to the app.",
    );

    // Unlike the deterministic Chromium test above, these waits require the
    // visibility lifecycle generated by the physical Android browser. Keep the
    // write blocked while suspended so the foreground wake path owns recovery.
    await page.waitForFunction(
      () => document.visibilityState === "hidden",
      undefined,
      { timeout: 120_000 },
    );
    blocked = false;
    await page.waitForFunction(
      () => document.visibilityState === "visible",
      undefined,
      { timeout: 120_000 },
    );

    await expect.poll(() => wakePulls, { timeout: 20_000 })
      .toBeGreaterThan(pullsBeforeSuspension);
    await expect.poll(() => syncWriteAttempts, { timeout: 20_000 })
      .toBeGreaterThan(attemptsBeforeSuspension);
    await expect(page.getByText(
      "Your latest changes are retained on this device, but the server has not acknowledged them. Other devices cannot see them until sync succeeds.",
      { exact: true },
    )).toBeHidden();
    await expect.poll(async () => {
      const server = await getToday(page);
      const values = server.runValues as Record<string, { casesNeeded?: number }> | undefined;
      return Object.values(values ?? {})[0]?.casesNeeded;
    }, { timeout: 20_000 }).toBe(21);
  },
);

test(
  "@real-mobile-browser queued Target Cases edit survives an Android Chrome process restart",
  async ({ page }: { page: Page }) => {
    test.skip(
      test.info().project.name !== "real-mobile-chromium",
      "This optional check requires PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT.",
    );
    test.setTimeout(180_000);
    const username = uid();
    users.add(username);
    await signUp(page, username);
    await page.getByTestId("tab-run").click();
    await page.getByTestId("input-casesNeeded").waitFor({ state: "visible", timeout: 20_000 });

    let blocked = true;
    let blockedWrites = 0;
    const blockedTargetCases: number[] = [];
    await page.route("**/api/sync/today**", async (route) => {
      const request = route.request();
      if (request.method() !== "PUT") {
        await route.continue();
        return;
      }
      if (blocked) {
        blockedWrites += 1;
        const body = request.postDataJSON() as {
          payload?: {
            runValues?: Record<string, { casesNeeded?: number }>;
          };
        } | null;
        const casesNeeded = Object.values(body?.payload?.runValues ?? {})[0]?.casesNeeded;
        if (typeof casesNeeded === "number") blockedTargetCases.push(casesNeeded);
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "android-process-restart sync outage" }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByTestId("input-casesNeeded").fill("18");
    await expect.poll(() => blockedWrites, { timeout: 10_000 }).toBe(1);
    await expect.poll(async () => page.evaluate(() => {
      const raw = localStorage.getItem("run-calc-day");
      const day = JSON.parse(raw ?? "{}") as { runs?: Array<{ id?: string }> };
      const runId = day.runs?.[0]?.id;
      if (!runId) return null;
      const values = JSON.parse(localStorage.getItem(`run-calc-run-${runId}`) ?? "{}") as {
        casesNeeded?: number;
      };
      return values.casesNeeded;
    }), { timeout: 10_000 }).toBe(18);

    // Queue a second edit while the first one is still unacknowledged. The
    // durable retry record must collapse to the newest value, not replay the
    // stale first edit after the Android process-restart boundary.
    await page.getByTestId("input-casesNeeded").fill("27");
    await expect.poll(() => blockedTargetCases.includes(27), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => page.evaluate(() => {
      const raw = localStorage.getItem("run-calc-day");
      const day = JSON.parse(raw ?? "{}") as { runs?: Array<{ id?: string }> };
      const runId = day.runs?.[0]?.id;
      if (!runId) return null;
      const values = JSON.parse(localStorage.getItem(`run-calc-run-${runId}`) ?? "{}") as {
        casesNeeded?: number;
      };
      return values.casesNeeded;
    }), { timeout: 10_000 }).toBe(27);
    expect(blockedTargetCases).toContain(18);
    expect(blockedWrites).toBeGreaterThan(1);

    // A terminated Android Chrome process cannot preserve the in-memory route
    // or React state, but it does preserve localStorage. Removing the route
    // and reopening the page gives this journey the same durable boundary in
    // CI while allowing the real-device project to run it as well.
    const context = page.context();
    await page.unroute("**/api/sync/today**");
    await page.close();
    const reopened = await context.newPage();
    try {
      let reopenedWriteAttempts = 0;
      await reopened.route("**/api/sync/today**", async (route) => {
        if (route.request().method() === "PUT") reopenedWriteAttempts += 1;
        await route.continue();
      });
      await reopened.goto("/", { waitUntil: "domcontentloaded" });
      await reopened.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });

      // No manual retry is clicked: boot recovery must replay the retained
      // payload automatically after the process-restart boundary.
      await expect.poll(() => reopenedWriteAttempts, { timeout: 20_000 }).toBeGreaterThan(0);
      await expect.poll(async () => {
        const server = await getToday(reopened);
        const values = server.runValues as Record<string, { casesNeeded?: number }> | undefined;
        return Object.values(values ?? {})[0]?.casesNeeded;
      }, { timeout: 20_000 }).toBe(27);
      await expect(reopened.getByText(
        "Your latest changes are retained on this device, but the server has not acknowledged them. Other devices cannot see them until sync succeeds.",
        { exact: true },
      )).toBeHidden();
    } finally {
      await reopened.close();
    }
  },
);

test(
  "exhausted sync failure retains the change for a manual retry",
  async ({ page }: { page: Page }) => {
    const username = uid();
    users.add(username);
    await signUp(page, username);
    await page.getByTestId("tab-run").click();
    await page.getByTestId("input-casesNeeded").waitFor({ state: "visible", timeout: 20_000 });

    let blocked = true;
    let syncWriteAttempts = 0;
    let blockedWrites = 0;
    await page.route("**/api/sync/today**", async (route) => {
      const request = route.request();
      if (request.method() !== "PUT") {
        await route.continue();
        return;
      }

      syncWriteAttempts += 1;
      if (blocked) {
        blockedWrites += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "temporary sync outage" }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByTestId("input-casesNeeded").fill("19");

    // Four failed PUTs means the initial attempt and all three automatic
    // retries were rejected. The client must stop retrying and expose the
    // retained local change instead of silently dropping it.
    await expect
      .poll(() => blockedWrites, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(4);
    await expect(page.getByText(
      "Your latest changes are retained on this device, but the server has not acknowledged them. Other devices cannot see them until sync succeeds.",
      { exact: true },
    )).toBeVisible();
    const retryButton = page.getByRole("button", { name: "Retry sync", exact: true });
    await expect(retryButton).toBeVisible();

    // Only the explicit user action is allowed through now. It must retry the
    // retained payload, clear the terminal failure, and persist the edit.
    const failedAttemptCount = syncWriteAttempts;
    blocked = false;
    await retryButton.click();
    await expect
      .poll(() => syncWriteAttempts, { timeout: 10_000 })
      .toBeGreaterThan(failedAttemptCount);
    await expect(page.getByText(
      "Your latest changes are retained on this device, but the server has not acknowledged them. Other devices cannot see them until sync succeeds.",
      { exact: true },
    )).toBeHidden();
    await expect.poll(async () => {
      const server = await getToday(page);
      const values = server.runValues as Record<string, { casesNeeded?: number }> | undefined;
      return Object.values(values ?? {})[0]?.casesNeeded;
    }, { timeout: 15_000 }).toBe(19);
  },
);

test(
  "offline device adopts active deletion, survives reload, and never resurrects the run",
  async ({ page, browser }: { page: Page; browser: Browser }) => {
    const username = uid();
    users.add(username);
    await signUp(page, username);

    const runId = `offline-delete-${Date.now()}`;
    const seeded = seededPayload(runId);
    expect((await putToday(page, seeded)).responseStatus).toBe(200);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });

    const peerContext = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    const peer = await peerContext.newPage();
    try {
      await peer.goto("/", { waitUntil: "domcontentloaded" });
      await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
      // Establish the sleeping device's durable pre-edit copy explicitly.
      // The page has already completed its normal boot reconciliation; this
      // models the copy held by a device that went offline immediately after
      // its last successful sync.
      await peer.evaluate((payload) => {
        localStorage.setItem("run-calc-day", JSON.stringify(payload.dayState));
      }, seeded);
      await expect.poll(async () => (await localRuns(peer)).some((run) => run.id === runId)).toBe(true);

      // Device B is now asleep/offline with a populated local copy.
      await peerContext.setOffline(true);
      const deletedPayload: SyncPayload = {
        ...seeded,
        dayState: {
          ...seeded.dayState,
          runs: [],
          currentIndex: 0,
        },
        deletedItems: { runs: [runId] },
        runValues: {},
        runValuesUpdatedAt: {},
      };
      const activeWrite = await putToday(page, deletedPayload);
      expect(activeWrite.responseStatus).toBe(200);
      const canonical = activeWrite.body.data as SyncPayload;
      expect(canonical.dayState.runs.some((run) => run.id === runId)).toBe(false);
      expect(canonical.deletedItems?.runs).toContain(runId);

      // Wake triggers the real foreground reconciliation path.  It must pull
      // before releasing queued writes, so the old offline run cannot return.
      await peerContext.setOffline(false);
      // The reset frame may synchronously reload the page.  Dispatching an
      // event through a destroyed execution context would hide the behavior
      // under test, so let the browser finish that navigation naturally.
      await peer.waitForTimeout(1_000);
      await peer.waitForLoadState("domcontentloaded").catch(() => {});
      await expect.poll(async () => (await localRuns(peer)).some((run) => run.id === runId), {
        timeout: 15_000,
      }).toBe(false);

      await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
      await peer.reload({ waitUntil: "domcontentloaded" });
      await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
      expect((await localRuns(peer)).some((run) => run.id === runId)).toBe(false);

      const server = await getToday(page);
      expect((server.dayState as SyncPayload["dayState"]).runs.some((run) => run.id === runId)).toBe(false);
    } finally {
      await peerContext.close();
    }
  },
);

test(
  "wake enforces reset epoch and client-date scope while unchanged writes stay no-op",
  async ({ page, browser }: { page: Page; browser: Browser }, testInfo: TestInfo) => {
    const username = uid();
    users.add(username);
    await signUp(page, username);
    await promoteToManager(page);
    const runId = `reset-wake-${Date.now()}`;
    const seeded = seededPayload(runId);
    const first = await putToday(page, seeded);
    expect(first.responseStatus).toBe(200);
    const firstSnapshot = first.body.snapshotId;
    expect(typeof firstSnapshot).toBe("string");

    // Assert the no-op before opening the second context. A newly booted peer
    // can still finish its initial hydration and issue a legitimate background
    // merge; allowing that startup write to race this assertion makes the
    // snapshot comparison depend on viewport/project timing rather than the
    // unchanged-write contract.
    const unchanged = await page.evaluate(async ({ date, payload, snapshotId }) => {
      const epochResponse = await fetch("/api/sync/reset-epoch", { cache: "no-store" });
      const epoch = (await epochResponse.json() as { epoch?: number }).epoch ?? 0;
      const completePayload = { ...payload, baseSnapshotId: snapshotId };
      const response = await fetch(`/api/sync/today?today=${date}&epoch=${epoch}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senderId: "unchanged-wake", payload: completePayload, snapshotId }),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    }, {
      date: today(),
      payload: { ...seeded, baseSnapshotId: firstSnapshot },
      snapshotId: firstSnapshot,
    });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body).toMatchObject({ unchanged: true, snapshotId: firstSnapshot });
    expect(unchanged.body.data).toBeUndefined();

    const peerContext = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    const peer = await peerContext.newPage();
    const peerSyncRequests: Array<Record<string, string | number | boolean | null>> = [];
    peer.on("requestfinished", async (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/sync/")) return;
      const entry: Record<string, string | number | boolean | null> = {
        method: request.method(),
        path: url.pathname,
        queryKeys: [...url.searchParams.keys()].sort().join(","),
        epoch: url.searchParams.has("epoch")
          ? Number(url.searchParams.get("epoch"))
          : null,
      };
      const response = await request.response().catch(() => null);
      entry.status = response?.status() ?? null;
      if (url.pathname === "/api/sync/today" && request.method() === "GET" && response?.ok()) {
        const body = await response.json().catch(() => null) as {
          resetEpoch?: number;
          dayState?: { runs?: Array<{ id?: string }> };
        } | null;
        const runs = body?.dayState?.runs ?? [];
        entry.responseEpoch = Number.isSafeInteger(body?.resetEpoch) ? body!.resetEpoch! : null;
        entry.responseRunCount = runs.length;
        entry.responseContainsTestRun = runs.some((run) => run.id === runId);
      }
      if (url.pathname === "/api/sync/today" && request.method() === "PUT") {
        let body: { payload?: { dayState?: { runs?: Array<{ id?: string }> } } } | null = null;
        try {
          body = request.postDataJSON() as typeof body;
        } catch {
          // Keep the diagnostic summary bounded if a request body is malformed.
        }
        const runs = body?.payload?.dayState?.runs ?? [];
        entry.requestRunCount = runs.length;
        entry.requestContainsTestRun = runs.some((run) => run.id === runId);
      }
      peerSyncRequests.push(entry);
    });
    peer.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/sync/")) return;
      peerSyncRequests.push({
        method: request.method(),
        path: url.pathname,
        queryKeys: [...url.searchParams.keys()].sort().join(","),
        epoch: url.searchParams.has("epoch")
          ? Number(url.searchParams.get("epoch"))
          : null,
        status: null,
      });
    });
    try {
      await peer.addInitScript(() => {
        // Start without a local day row so the peer must adopt the seeded
        // canonical run before it becomes the intentionally stale device.
        localStorage.removeItem("run-calc-day");
      });
      await peer.goto("/", { waitUntil: "domcontentloaded" });
      await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
      await expect(peer.getByTestId("sync-status-button")).toHaveAttribute(
        "title",
        "Sync connected",
        { timeout: 20_000 },
      );
      await expect.poll(
        async () => (await localRuns(peer)).some((run) => run.id === runId),
        { timeout: 20_000 },
      ).toBe(true);
      await peerContext.setOffline(true);
      await expect.poll(
        () => peer.evaluate(() => navigator.onLine),
        { timeout: 5_000 },
      ).toBe(false);

      // Use the context request client so the reset broadcast can navigate the
      // page without destroying an in-flight page.evaluate execution context.
      const resetRequestedAt = Date.now();
      const resetResponse = await page.request.post("/api/sync/reset", {
        data: { reason: "sync convergence test" },
      });
      const reset = {
        status: resetResponse.status(),
        body: await resetResponse.json() as { epoch?: number },
      };
      expect(reset.status).toBe(200);
      expect(reset.body.epoch).toBeGreaterThan(0);

      // The stale device must reconcile the new epoch on wake, not republish
      // its pre-reset run.  Failed/reset-stale responses are safe no-ops.
      const resetNavigation = peer.waitForEvent("framenavigated", {
        predicate: (frame) => frame === peer.mainFrame(),
        timeout: 20_000,
      });
      await peerContext.setOffline(false);
      await resetNavigation;
      await peer.waitForLoadState("domcontentloaded");
      await peer.getByTestId("tab-run").waitFor({
        state: "attached",
        timeout: 20_000,
      });
      const adoptedResetEpoch = await peer.evaluate(() => {
        const raw = localStorage.getItem("run-calc-reset-epoch");
        return raw === null ? 0 : JSON.parse(raw) as number;
      });
      expect(adoptedResetEpoch).toBe(reset.body.epoch);
      try {
        await expect.poll(
          async () => peer.evaluate((after) => {
            const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
              .filter((key): key is string => key?.startsWith("run-calc-sync-diagnostics:") === true);
            return keys.some((key) => {
              try {
                const events = JSON.parse(localStorage.getItem(key) ?? "[]") as Array<{
                  kind?: string;
                  message?: string;
                  at?: number;
                }>;
                return events.some((event) =>
                  event.kind === "ack"
                  && event.message === "Server baseline received"
                  && typeof event.at === "number"
                  && event.at >= after,
                );
              } catch {
                return false;
              }
            });
          }, resetRequestedAt),
          {
            message: "peer accepted a canonical baseline after the reset",
            timeout: 20_000,
          },
        ).toBe(true);
        await expect.poll(async () => (await localRuns(peer)).some((run) => run.id === runId), {
          timeout: 15_000,
        }).toBe(false);
      } catch (error) {
        const postResetBaselineReceived = await peer.evaluate((after) => {
          const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
            .filter((key): key is string => key?.startsWith("run-calc-sync-diagnostics:") === true);
          return keys.some((key) => {
            try {
              const events = JSON.parse(localStorage.getItem(key) ?? "[]") as Array<{
                kind?: string;
                message?: string;
                at?: number;
              }>;
              return events.some((event) =>
                event.kind === "ack"
                && event.message === "Server baseline received"
                && typeof event.at === "number"
                && event.at >= after,
              );
            } catch {
              return false;
            }
          });
        }, resetRequestedAt).catch(() => false);
        const localState = await peer.evaluate((targetRunId) => {
          const raw = localStorage.getItem("run-calc-day");
          let runs: Array<{ id?: string }> = [];
          let date: string | null = null;
          try {
            const day = JSON.parse(raw ?? "{}") as { date?: string; runs?: Array<{ id?: string }> };
            runs = day.runs ?? [];
            date = day.date ?? null;
          } catch {
            // Report malformed cache state without retaining its raw contents.
          }
          return {
            resetEpoch: localStorage.getItem("run-calc-reset-epoch"),
            hasDayState: raw !== null,
            date,
            runCount: runs.length,
            containsTestRun: runs.some((run) => run.id === targetRunId),
          };
        }, runId).catch(() => ({ pageUnavailable: true }));
        await testInfo.attach("peer-reset-diagnostics.json", {
          body: JSON.stringify({
            localState,
            postResetBaselineReceived,
            syncRequests: peerSyncRequests,
          }),
          contentType: "application/json",
        }).catch(() => {});
        throw error;
      }
      await peer.reload({ waitUntil: "domcontentloaded" });
      await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
      expect((await localRuns(peer)).some((run) => run.id === runId)).toBe(false);

      // A client-date-scoped read must still be a valid empty canonical row;
      // this catches accidental server-UTC routing during a local-day wake.
      const empty = await getToday(page);
      expect((empty.dayState as SyncPayload["dayState"]).runs).toEqual([]);
    } finally {
      await peerContext.close();
    }
  },
);

test(
  "manager moves a future run into a populated today plan and keeps it after reload",
  async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const username = uid();
    users.add(username);
    const liveRunId = `move-live-${Date.now()}`;
    const futureRunId = `move-future-${Date.now()}`;
    const currentDate = today();
    const futureDate = (() => {
      const d = new Date(`${currentDate}T12:00:00`);
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    })();

    await signUp(page, username);
    await promoteToManager(page);
    const seededFutureStamp = await page.evaluate(async ({ currentDate, futureDate, liveRunId, futureRunId }) => {
      const epochResponse = await fetch("/api/sync/reset-epoch", { cache: "no-store" });
      const epoch = (await epochResponse.json() as { epoch?: number }).epoch;
      if (!epochResponse.ok || !Number.isInteger(epoch) || epoch === undefined || epoch < 0) {
        throw new Error("Schedule fixture requires the canonical reset epoch.");
      }
      const put = async (path: string, payload: unknown) => {
        const response = await fetch(`${path}&epoch=${epoch}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ senderId: "schedule-move-e2e", payload }),
        });
        if (!response.ok) throw new Error(`fixture PUT failed: ${response.status}`);
      };
      await put(`/api/sync/today?today=${currentDate}`, {
        dayState: {
          date: currentDate,
          runs: [{ id: liveRunId, brand: "Move Existing", flavor: "Live Plan" }],
        },
        runValues: { [liveRunId]: { casesNeeded: 11, casesPerSkid: 12 } },
        runValuesUpdatedAt: { [liveRunId]: 100 },
      });
      await put(`/api/sync/${futureDate}?today=${currentDate}`, {
        dayState: {
          date: futureDate,
          runs: [{ id: futureRunId, brand: "Move Future", flavor: "Tomorrow" }],
        },
        runValues: { [futureRunId]: { casesNeeded: 37, casesPerSkid: 12 } },
        runValuesUpdatedAt: { [futureRunId]: 200 },
      });
      const accepted = await fetch(`/api/sync/${futureDate}?today=${currentDate}`, {
        cache: "no-store",
      });
      if (!accepted.ok) throw new Error(`Reading accepted schedule fixture failed: ${accepted.status}`);
      const canonical = await accepted.json() as { runValuesUpdatedAt?: Record<string, number> };
      const stamp = canonical.runValuesUpdatedAt?.[futureRunId];
      if (typeof stamp !== "number" || !Number.isFinite(stamp) || stamp <= 0) {
        throw new Error("Accepted schedule fixture has no canonical value stamp.");
      }
      return stamp;
    }, { currentDate, futureDate, liveRunId, futureRunId });

    try {
      // Promotion happens after sign-up, so reload once to hydrate the manager
      // capability before using the manager-only Schedule control.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      await page.getByTitle("More").click();
      await page.getByRole("menuitem", { name: /^Schedule/ }).click();
      const dialog = page.getByRole("dialog", { name: "Scheduled Days" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("schedule-today-card")).toContainText("1 run on today's plan");

      const futureDay = page.getByTestId(`schedule-day-${futureDate}`);
      await expect(futureDay).toBeVisible();
      await futureDay.locator("button").first().click();
      const moveRun = futureDay.getByTestId(`move-run-${futureRunId}`);
      await expect(moveRun).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("01-future-run-before-move.png"), fullPage: true });
      await moveRun.click();

      const moveDate = futureDay.getByTestId(`move-date-${futureRunId}`);
      await expect(moveDate).toHaveAttribute("min", currentDate);
      await moveDate.fill(currentDate);
      const moveWrite = page.waitForResponse((response) => {
        if (response.request().method() !== "PUT"
          || new URL(response.url()).pathname !== "/api/sync/today") return false;
        const body = response.request().postDataJSON() as {
          payload?: { dayState?: { runs?: Array<{ id?: string }> } };
        };
        return body.payload?.dayState?.runs?.some((run) => run.id === futureRunId) === true;
      });
      await futureDay.getByRole("button", { name: "Move", exact: true }).last().click();
      const movedResponse = await moveWrite;
      expect(movedResponse.ok(), "the move must receive a canonical destination acknowledgement").toBe(true);
      const movedBody = await movedResponse.json() as {
        data?: { runValuesUpdatedAt?: Record<string, number> };
      };
      const movedStamp = movedBody.data?.runValuesUpdatedAt?.[futureRunId];
      expect(typeof movedStamp).toBe("number");
      // A new destination write may receive a newer server stamp. It must not
      // regress behind the accepted source, and subsequent reads must match
      // the move's actual acknowledgement, not the fixture's client hint.
      expect(movedStamp).toBeGreaterThanOrEqual(seededFutureStamp);

      await expect(dialog.getByTestId("schedule-today-card")).toContainText("2 runs on today's plan");
      await expect(page.getByTestId(`schedule-day-${futureDate}`)).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("02-after-move.png"), fullPage: true });

      const canonical = await page.evaluate(async (date) => {
        const response = await fetch(`/api/sync/today?today=${date}`, { cache: "no-store" });
        return await response.json() as {
          dayState?: { runs?: Array<{ id?: string }> };
          runValues?: Record<string, { casesNeeded?: number }>;
          runValuesUpdatedAt?: Record<string, number>;
        };
      }, currentDate);
      expect(canonical.dayState?.runs?.map((run) => run.id)).toEqual([liveRunId, futureRunId]);
      expect(canonical.runValues?.[futureRunId]?.casesNeeded).toBe(37);
      expect(canonical.runValuesUpdatedAt?.[futureRunId]).toBe(movedStamp);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      await dismissOnboardingIfPresent(page);
      await page.getByTitle("More").click();
      await page.getByRole("menuitem", { name: /^Schedule/ }).click();
      const reloadedDialog = page.getByRole("dialog", { name: "Scheduled Days" });
      await expect(reloadedDialog.getByTestId("schedule-today-card")).toContainText("2 runs on today's plan");
      await expect(page.getByTestId(`schedule-day-${futureDate}`)).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("03-today-after-reload.png"), fullPage: true });
    } finally {
      const db = new Client({
        connectionString: requireIsolatedTestDatabase("schedule move e2e cleanup"),
      });
      try {
        await db.connect();
        await db.query("DELETE FROM daily_sync WHERE date IN ($1, $2)", [currentDate, futureDate]);
      } finally {
        await db.end().catch(() => {});
      }
    }
  },
);

test(
  "keeps the future source available with retry guidance when the destination write fails",
  async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const username = uid();
    users.add(username);
    const fixture = scheduleMoveFixture();
    const evidence = observeScheduleMoveEvidence(page);
    let forcedDestinationFailures = 0;
    const destinationFailureRoute = async (route: Route) => {
      const request = route.request();
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname === "/api/sync/today" &&
        request.postData()?.includes(fixture.futureRunId)
      ) {
        forcedDestinationFailures += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "forced destination failure" }),
        });
        return;
      }
      await route.continue();
    };

    try {
      await signUp(page, username);
      await promoteToManager(page);
      await seedScheduleMoveFixture(page, fixture);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      await page.getByTitle("More").click();
      await page.getByRole("menuitem", { name: /^Schedule/ }).click();

      const dialog = page.getByRole("dialog", { name: "Scheduled Days" });
      const futureDay = page.getByTestId(`schedule-day-${fixture.futureDate}`);
      await expect(futureDay).toBeVisible();
      await futureDay.locator("button").first().click();
      const moveRun = futureDay.getByTestId(`move-run-${fixture.futureRunId}`);
      await moveRun.click();
      const moveDate = futureDay.getByTestId(`move-date-${fixture.futureRunId}`);
      await moveDate.fill(fixture.currentDate);

      await page.route("**/api/sync/**", destinationFailureRoute);
      await futureDay.getByRole("button", { name: "Move", exact: true }).last().click();

      const destinationWriteError = page
        .getByRole("alert")
        .filter({ hasText: "Couldn't save the destination plan." })
        .filter({
          hasText: "The source is unchanged; check your connection and try again.",
        });
      await expect(destinationWriteError).toContainText(
        "The source is unchanged; check your connection and try again.",
      );
      await expect(futureDay).toBeVisible();
      await expect(moveDate).toHaveValue(fixture.currentDate);
      expect(forcedDestinationFailures).toBe(1);
      await page.screenshot({
        path: testInfo.outputPath("04-destination-failure-source-retained.png"),
        fullPage: true,
      });

      // The failed destination write leaves the same move controls active. A
      // retry after the injected failure should now complete normally.
      await page.unroute("**/api/sync/**", destinationFailureRoute);
      await futureDay.getByRole("button", { name: "Move", exact: true }).last().click();
      await expect(dialog.getByTestId("schedule-today-card")).toContainText("2 runs on today's plan");
      await expect(page.getByTestId(`schedule-day-${fixture.futureDate}`)).toHaveCount(0);
      expect(evidence.pageErrors).toEqual([]);
    } finally {
      await page.unroute("**/api/sync/**", destinationFailureRoute).catch(() => {});
      await attachScheduleMoveEvidence(testInfo, evidence);
      await cleanupScheduleMoveFixture(fixture);
    }
  },
);

test(
  "retries source cleanup after a successful destination write without duplicating today's run",
  async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const username = uid();
    users.add(username);
    const fixture = scheduleMoveFixture();
    const evidence = observeScheduleMoveEvidence(page);
    let forcedCleanupFailures = 0;
    const cleanupFailureRoute = async (route: Route) => {
      const request = route.request();
      if (
        request.method() === "DELETE" &&
        new URL(request.url()).pathname === `/api/sync/${fixture.futureDate}`
      ) {
        forcedCleanupFailures += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "forced source cleanup failure" }),
        });
        return;
      }
      await route.continue();
    };

    try {
      await signUp(page, username);
      await promoteToManager(page);
      await seedScheduleMoveFixture(page, fixture);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      await page.getByTitle("More").click();
      await page.getByRole("menuitem", { name: /^Schedule/ }).click();

      const dialog = page.getByRole("dialog", { name: "Scheduled Days" });
      const futureDay = page.getByTestId(`schedule-day-${fixture.futureDate}`);
      await expect(futureDay).toBeVisible();
      await futureDay.locator("button").first().click();
      const moveRun = futureDay.getByTestId(`move-run-${fixture.futureRunId}`);
      await moveRun.click();
      const moveDate = futureDay.getByTestId(`move-date-${fixture.futureRunId}`);
      await moveDate.fill(fixture.currentDate);

      await page.route("**/api/sync/**", cleanupFailureRoute);
      await futureDay.getByRole("button", { name: "Move", exact: true }).last().click();

      await expect(dialog.getByTestId("schedule-today-card")).toContainText("2 runs on today's plan");
      await expect(page.getByRole("alert")).toContainText("Retry Move to finish.");
      await expect(futureDay).toBeVisible();
      expect(forcedCleanupFailures).toBe(1);
      await page.screenshot({
        path: testInfo.outputPath("05-cleanup-failure-retry-guidance.png"),
        fullPage: true,
      });

      // The destination is already canonical. Retrying the same move must
      // perform only the pending source cleanup, not append another run.
      await page.unroute("**/api/sync/**", cleanupFailureRoute);
      await futureDay.getByRole("button", { name: "Move", exact: true }).last().click();
      await expect(dialog.getByTestId("schedule-today-card")).toContainText("2 runs on today's plan");
      await expect(page.getByTestId(`schedule-day-${fixture.futureDate}`)).toHaveCount(0);

      const canonical = await page.evaluate(async (date) => {
        const response = await fetch(`/api/sync/today?today=${date}`, { cache: "no-store" });
        return await response.json() as { dayState?: { runs?: Array<{ id?: string }> } };
      }, fixture.currentDate);
      expect(canonical.dayState?.runs?.map((run) => run.id)).toEqual([
        fixture.liveRunId,
        fixture.futureRunId,
      ]);
      expect(evidence.pageErrors).toEqual([]);
    } finally {
      await page.unroute("**/api/sync/**", cleanupFailureRoute).catch(() => {});
      await attachScheduleMoveEvidence(testInfo, evidence);
      await cleanupScheduleMoveFixture(fixture);
    }
  },
);