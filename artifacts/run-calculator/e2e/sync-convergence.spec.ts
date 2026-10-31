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
import { DEFAULT_VALUES } from "../src/types";
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

async function seedAdditionalScheduleDay(
  page: Page,
  todayDate: string,
  date: string,
  runId: string,
): Promise<void> {
  await page.evaluate(async ({ todayDate, date, runId }) => {
    const epochResponse = await fetch("/api/sync/reset-epoch", { cache: "no-store" });
    const epoch = (await epochResponse.json() as { epoch?: number }).epoch ?? 0;
    const response = await fetch(`/api/sync/${date}?today=${todayDate}&epoch=${epoch}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "schedule-choice-e2e",
        payload: {
          dayState: { date, runs: [{ id: runId, brand: "Move Choice", flavor: date }] },
          runValues: { [runId]: { casesNeeded: 9 } },
          runValuesUpdatedAt: { [runId]: 300 },
        },
      }),
    });
    if (!response.ok) throw new Error(`additional schedule fixture failed: ${response.status}`);
  }, { todayDate, date, runId });
}

async function cleanupScheduleMoveFixture(
  fixture: ScheduleMoveFixture,
  extraDates: string[] = [],
): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("schedule move e2e cleanup"),
  });
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date = ANY($1::text[])", [
      [fixture.currentDate, fixture.futureDate, ...extraDates],
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
  const response = await page.request.get(`/api/sync/today?today=${today()}`, {
    headers: { "cache-control": "no-store" },
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok()) {
    throw new Error(`canonical today GET failed: ${response.status()} ${JSON.stringify(body)}`);
  }
  if (!body.dayState || !Array.isArray((body.dayState as { runs?: unknown }).runs)) {
    throw new Error(
      `canonical today GET returned no day state (status ${response.status()}, keys ${Object.keys(body).sort().join(",")})`,
    );
  }
  return body;
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

type BaselinePushObservation = {
  localRunIds: string[];
  localDate: string | null;
  localResetAt: number;
  baselineAcknowledged: boolean;
  outgoingRunIds: string[];
  outgoingRunValues: Record<string, unknown>;
};

async function clearTodaySyncRow(): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("empty first-baseline fixture"),
  });
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date = $1", [today()]);
  } finally {
    await db.end().catch(() => {});
  }
}

async function startStaleBaselineClient(
  page: Page,
  options: {
    staleRunId: string;
    interruptFirstStream?: boolean;
  },
): Promise<{
  peer: Page;
  pushes: BaselinePushObservation[];
  streamAttempts: number;
  firstStreamInterrupted: boolean;
}> {
  const context = page.context();
  await page.close();
  const peer = await context.newPage();
  await peer.addInitScript(({ staleRunId, date }) => {
    localStorage.setItem("run-calc-day", JSON.stringify({
      date,
      resetAt: 0,
      runs: [{ id: staleRunId, brand: "", flavor: "", seeded: true }],
      currentIndex: 0,
      substitutions: [],
      substitutionLog: [],
      stagedItems: {},
    }));
  }, { staleRunId: options.staleRunId, date: today() });

  const pushes: BaselinePushObservation[] = [];
  let streamAttempts = 0;
  let firstStreamInterrupted = false;
  await peer.route("**/api/sync/today**", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    const requestBody = route.request().postDataJSON() as {
      payload?: {
        dayState?: { runs?: Array<{ id?: string }> };
        runValues?: Record<string, unknown>;
      };
    };
    const local = await peer.evaluate((staleId) => {
      const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
        date?: string;
        resetAt?: number;
        runs?: Array<{ id?: string }>;
      };
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => key?.startsWith("run-calc-sync-diagnostics:") === true);
      const diagnostics = keys.flatMap((key) => {
        try {
          return JSON.parse(localStorage.getItem(key) ?? "[]") as Array<{
            kind?: string;
            message?: string;
          }>;
        } catch {
          return [];
        }
      });
      return {
        date: day.date ?? null,
        resetAt: day.resetAt ?? 0,
        runs: day.runs ?? [],
        baselineAcknowledged: diagnostics.some((entry) =>
          entry.kind === "ack"
          && (entry.message === "Server baseline received" || entry.message === "Server baseline unchanged"),
        ),
        containsStaleRun: (day.runs ?? []).some((run) => run.id === staleId),
      };
    }, options.staleRunId);
    pushes.push({
      localRunIds: local.runs.map((run) => run.id ?? ""),
      localDate: local.date,
      localResetAt: local.resetAt,
      baselineAcknowledged: local.baselineAcknowledged,
      outgoingRunIds: (requestBody.payload?.dayState?.runs ?? []).map((run) => run.id ?? ""),
      outgoingRunValues: requestBody.payload?.runValues ?? {},
    });
    await route.continue();
  });
  if (options.interruptFirstStream) {
    await peer.route("**/api/sync/events**", async (route) => {
      streamAttempts += 1;
      if (streamAttempts === 1) {
        firstStreamInterrupted = true;
        await route.abort("internetdisconnected");
        return;
      }
      await route.continue();
    });
  }
  await peer.goto("/", { waitUntil: "domcontentloaded" });
  await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  return { peer, pushes, get streamAttempts() { return streamAttempts; }, get firstStreamInterrupted() { return firstStreamInterrupted; } };
}

async function expectFirstBaselineAdopted(
  peer: Page,
  staleRunId: string,
  canonicalRunId?: string,
): Promise<void> {
  await expect.poll(async () => {
    const state = await peer.evaluate(() => {
      const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
        runs?: Array<{ id?: string }>;
      };
      return day.runs ?? [];
    });
    return {
      containsStale: state.some((run) => run.id === staleRunId),
      containsCanonical: canonicalRunId
        ? state.some((run) => run.id === canonicalRunId)
        : true,
    };
  }, { timeout: 25_000, message: "the client must adopt the server baseline before writing" }).toEqual({
    containsStale: false,
    containsCanonical: true,
  });
}

async function attachFirstBaselineEvidence(
  testInfo: TestInfo,
  peer: Page,
  staleRunId: string,
  pushes: BaselinePushObservation[],
  stream: { attempts: number; firstInterrupted: boolean },
): Promise<void> {
  const local = await peer.evaluate((staleId) => {
    const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
      date?: string;
      resetAt?: number;
      runs?: Array<{ id?: string; brand?: string; flavor?: string }>;
    };
    return {
      date: day.date ?? null,
      resetAt: day.resetAt ?? 0,
      runs: day.runs ?? [],
      containsStaleRun: (day.runs ?? []).some((run) => run.id === staleId),
    };
  }, staleRunId);
  await testInfo.attach("first-daily-baseline-browser-evidence.json", {
    body: JSON.stringify({ local, pushes, stream }, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach("first-daily-baseline-after-adoption.png", {
    body: await peer.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test.describe("first daily baseline adoption", () => {
  test.use({ serviceWorkers: "block" });

  test("server's first daily baseline replaces stale local day state before recovery push", async ({
    page,
  }, testInfo) => {
    const username = uid();
    users.add(username);
    await signUp(page, username);
    await promoteToManager(page);

    const canonicalRunId = `baseline-populated-${Date.now()}`;
    const staleRunId = `baseline-stale-${Date.now()}`;
    const seeded = seededPayload(canonicalRunId);
    expect((await putToday(page, seeded)).responseStatus).toBe(200);
    const authContext = page.context();
    const client = await startStaleBaselineClient(page, {
      staleRunId,
    });

    try {
      await expectFirstBaselineAdopted(client.peer, staleRunId, canonicalRunId);
      await expect(client.peer.getByTestId("sync-status-button")).toHaveAttribute(
        "title",
        "Sync connected",
        { timeout: 20_000 },
      );
      const localRuns = await client.peer.evaluate(() => {
        const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
          runs?: Array<{ id?: string; brand?: string; flavor?: string }>;
        };
        return day.runs ?? [];
      });
      expect(localRuns).toContainEqual(expect.objectContaining({
        id: canonicalRunId,
        brand: "Wake",
        flavor: "Convergence",
      }));
      await expect.poll(() => client.pushes.length, {
        timeout: 10_000,
        message: "the queued startup recovery write should resume after baseline adoption",
      }).toBeGreaterThan(0);
      for (const push of client.pushes) {
        expect(push.localRunIds).toContain(canonicalRunId);
        expect(push.localRunIds).not.toContain(staleRunId);
        expect(push.outgoingRunIds).toContain(canonicalRunId);
        expect(push.outgoingRunIds).not.toContain(staleRunId);
        expect(push.baselineAcknowledged).toBe(true);
      }
      const canonical = await getToday(client.peer);
      expect((canonical.dayState as SyncPayload["dayState"]).runs)
        .toContainEqual(expect.objectContaining({
          id: canonicalRunId,
          brand: "Wake",
          flavor: "Convergence",
        }));
      expect((canonical.dayState as SyncPayload["dayState"]).runs.some((run) => run.id === staleRunId))
        .toBe(false);
      await attachFirstBaselineEvidence(
        testInfo,
        client.peer,
        staleRunId,
        client.pushes,
        { attempts: 1, firstInterrupted: false },
      );

      await client.peer.reload({ waitUntil: "domcontentloaded" });
      await client.peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
      await expectFirstBaselineAdopted(client.peer, staleRunId, canonicalRunId);
      const afterReload = await getToday(client.peer);
      expect((afterReload.dayState as SyncPayload["dayState"]).runs.map((run) => run.id))
        .toContain(canonicalRunId);
    } finally {
      await authContext.close();
    }
  });

  test("server's explicit empty first daily baseline removes stale local day state", async ({
    page,
  }, testInfo) => {
    const username = uid();
    users.add(username);
    await signUp(page, username);
    await promoteToManager(page);

    const staleRunId = `baseline-empty-stale-${Date.now()}`;
    const authContext = page.context();
    await page.close();
    await clearTodaySyncRow();
    const peer = await authContext.newPage();
    await peer.addInitScript(({ staleId, date }) => {
      localStorage.setItem("run-calc-day", JSON.stringify({
        date,
        resetAt: 0,
        runs: [{ id: staleId, brand: "", flavor: "", seeded: true }],
        currentIndex: 0,
        substitutions: [],
        substitutionLog: [],
        stagedItems: {},
      }));
    }, { staleId: staleRunId, date: today() });
    const pushes: BaselinePushObservation[] = [];
    await peer.route("**/api/sync/today**", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON() as {
        payload?: { dayState?: { runs?: Array<{ id?: string }> } };
      };
      const localRuns = await peer.evaluate(() => {
        const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
          runs?: Array<{ id?: string }>;
          resetAt?: number;
        };
        return { runs: day.runs ?? [], resetAt: day.resetAt ?? 0 };
      });
      pushes.push({
        localRunIds: localRuns.runs.map((run) => run.id ?? ""),
        localDate: today(),
        localResetAt: localRuns.resetAt,
        baselineAcknowledged: false,
        outgoingRunIds: (body.payload?.dayState?.runs ?? []).map((run) => run.id ?? ""),
        outgoingRunValues: {},
      });
      await route.continue();
    });
    await peer.goto("/", { waitUntil: "domcontentloaded" });
    try {
      await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      await expectFirstBaselineAdopted(peer, staleRunId);
      await expect(peer.getByTestId("sync-status-button")).toHaveAttribute(
        "title",
        "Sync connected",
        { timeout: 20_000 },
      );
      for (const push of pushes) {
        expect(push.localRunIds).not.toContain(staleRunId);
        expect(push.outgoingRunIds).not.toContain(staleRunId);
      }
      const canonical = await getToday(peer);
      expect((canonical.dayState as SyncPayload["dayState"]).runs.map((run) => run.id))
        .not.toContain(staleRunId);
      await attachFirstBaselineEvidence(
        testInfo,
        peer,
        staleRunId,
        pushes,
        { attempts: 1, firstInterrupted: false },
      );

      await peer.reload({ waitUntil: "domcontentloaded" });
      await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
      await expectFirstBaselineAdopted(peer, staleRunId);
      const afterReload = await getToday(peer);
      expect((afterReload.dayState as SyncPayload["dayState"]).runs.map((run) => run.id))
        .not.toContain(staleRunId);
    } finally {
      await authContext.close();
    }
  });

  test("server's first daily baseline is adopted after a stream interruption", async ({
    page,
  }, testInfo) => {
    const username = uid();
    users.add(username);
    await signUp(page, username);
    await promoteToManager(page);

    const canonicalRunId = `baseline-reconnect-${Date.now()}`;
    const staleRunId = `baseline-reconnect-stale-${Date.now()}`;
    const seeded = seededPayload(canonicalRunId);
    expect((await putToday(page, seeded)).responseStatus).toBe(200);
    const authContext = page.context();
    const client = await startStaleBaselineClient(page, {
      staleRunId,
      interruptFirstStream: true,
    });

    try {
      await expect.poll(() => client.streamAttempts, {
        timeout: 20_000,
        message: "EventSource must retry after the injected first-stream interruption",
      }).toBeGreaterThanOrEqual(2);
      expect(client.firstStreamInterrupted).toBe(true);
      await expectFirstBaselineAdopted(client.peer, staleRunId, canonicalRunId);
      await expect(client.peer.getByTestId("sync-status-button")).toHaveAttribute(
        "title",
        "Sync connected",
        { timeout: 20_000 },
      );
      await expect.poll(() => client.pushes.length, {
        timeout: 10_000,
        message: "the reconnect recovery write should resume after baseline adoption",
      }).toBeGreaterThan(0);
      for (const push of client.pushes) {
        expect(push.localRunIds).toContain(canonicalRunId);
        expect(push.localRunIds).not.toContain(staleRunId);
        expect(push.outgoingRunIds).toContain(canonicalRunId);
        expect(push.outgoingRunIds).not.toContain(staleRunId);
      }
      const canonical = await getToday(client.peer);
      expect((canonical.dayState as SyncPayload["dayState"]).runs.map((run) => run.id))
        .toContain(canonicalRunId);
      expect((canonical.dayState as SyncPayload["dayState"]).runs.map((run) => run.id))
        .not.toContain(staleRunId);
      await attachFirstBaselineEvidence(
        testInfo,
        client.peer,
        staleRunId,
        client.pushes,
        { attempts: client.streamAttempts, firstInterrupted: client.firstStreamInterrupted },
      );
    } finally {
      await authContext.close();
    }
  });
});

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
  const peerPutOutcomes: Array<{ status: number; unchanged: boolean }> = [];
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
  peer.on("response", (response) => {
    if (!response.url().includes("/api/sync/today") || response.request().method() !== "PUT") return;
    void response.json().then((body: unknown) => {
      const unchanged = typeof body === "object" && body !== null
        && "unchanged" in body
        && (body as { unchanged?: unknown }).unchanged === true;
      peerPutOutcomes.push({ status: response.status(), unchanged });
    }).catch(() => peerPutOutcomes.push({ status: response.status(), unchanged: false }));
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
    await expect.poll(() => peerPutOutcomes.length).toBe(peerWrites);
    const stageMeasurements = await page.evaluate((date) =>
      JSON.parse(localStorage.getItem(`run-calc-sync-measurements:${date}`) ?? "[]"), today());
    // Measurements are fixed numeric fields; never attach cookies or payloads.
    const evidence = { environment: "isolated-browser", project: testInfo.project.name,
      network: "loopback, 0/40ms injected request delay, no bandwidth cap",
      samples, wakeSamples, serverTiming: timings, stageMeasurements, failedPulls, peerPulls, peerWrites, timedOutPulls, peerPutOutcomes, browserSignals };
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
    expect(peerPutOutcomes).toHaveLength(peerWrites);
    expect(peerPutOutcomes.every((outcome) => outcome.status === 200 && outcome.unchanged)).toBe(true);
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
    await promoteToManager(page);
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
  "stale-base recovery keeps the server conflict, reapplies independent edits and settles after reload",
  async ({ page }: { page: Page }) => {
    await page.addInitScript(() => {
      const NativeEventSource = window.EventSource;
      const sources: EventSource[] = [];
      const hooks = window as unknown as {
        fixtureSyncSources: EventSource[];
        armRecoveryCopyStorageFailure: () => void;
        recoveryCopyStorageFailureOccurred: boolean;
      };
      let failNextPendingSyncWrite = false;
      hooks.recoveryCopyStorageFailureOccurred = false;
      hooks.armRecoveryCopyStorageFailure = () => {
        failNextPendingSyncWrite = true;
      };
      const nativeSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (failNextPendingSyncWrite && key.startsWith("run-calculator:sync-pending-v1:")) {
          failNextPendingSyncWrite = false;
          hooks.recoveryCopyStorageFailureOccurred = true;
          throw new DOMException("synthetic recovery-copy storage failure", "QuotaExceededError");
        }
        nativeSetItem.call(this, key, value);
      };
      window.EventSource = class extends NativeEventSource {
        constructor(...args: ConstructorParameters<typeof EventSource>) {
          super(...args);
          sources.push(this);
        }
      } as typeof EventSource;
      hooks.fixtureSyncSources = sources;
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    const username = uid();
    users.add(username);
    await signUp(page, username);
    await promoteToManager(page);
    await page.getByTestId("tab-run").click();
    const casesNeeded = page.getByTestId("input-casesNeeded");
    await expect(casesNeeded).toBeVisible();

    const runId = `server-wins-${Date.now()}`;
    const initial = seededPayload(runId);
    initial.runValues[runId] = {
      ...DEFAULT_VALUES,
      casesNeeded: 24,
      casesPerSkid: 12,
    };
    expect((await putToday(page, initial)).responseStatus).toBe(200);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
    await page.getByTestId("tab-run").click();
    await expect(casesNeeded).toHaveValue("24", { timeout: 20_000 });
    expect((await localRuns(page)).some((run) => run.id === runId)).toBe(true);
    await expect(page.getByTestId("sync-status-button")).toHaveAttribute(
      "title",
      "Sync connected",
      { timeout: 20_000 },
    );

    await page.evaluate(() => {
      (window as unknown as { fixtureSyncSources: EventSource[] })
        .fixtureSyncSources.forEach((source) => source.close());
    });

    // Advance the canonical server field without notifying this intentionally
    // stale tab. Its next real UI write must receive the server's fallback.
    const current = await getToday(page) as unknown as SyncPayload;
    const serverUpdate = structuredClone(current);
    serverUpdate.syncVersion = 1;
    serverUpdate.completeness = "complete";
    serverUpdate.baseSnapshotId = undefined;
    serverUpdate.runValues[runId] = {
      ...serverUpdate.runValues[runId],
      casesNeeded: 999,
    };
    serverUpdate.runValuesUpdatedAt[runId] = Math.max(
      Date.now(),
      (serverUpdate.runValuesUpdatedAt[runId] ?? 0) + 1,
    );
    expect((await putToday(page, serverUpdate)).responseStatus).toBe(200);
    await expect.poll(async () => {
      const server = await getToday(page) as unknown as SyncPayload;
      return server.runValues[runId]?.casesNeeded;
    }).toBe(999);

    const runValueWrites: number[] = [];
    const runValueWritePayloads: Array<{
      casesNeeded: number;
      pizzasPerCase?: number;
      casesPerSkid?: number;
    }> = [];
    const runValueWriteResponses: Array<{
      value: number;
      status: number;
      responseKind: string;
      canonicalRevision: number | null;
    }> = [];
    const expectCanonicalConflictSequence = () => {
      // One coalesced newest snapshot may drain after the stale write is
      // rebased. Allow that bounded queue drain, but never another stale value
      // or more than one follow-up snapshot.
      expect(runValueWrites.length).toBeGreaterThanOrEqual(2);
      expect(runValueWrites.length).toBeLessThanOrEqual(3);
      expect(runValueWrites[0]).toBe(777);
      expect(runValueWrites.slice(1).every((value) => value === 999)).toBe(true);
      expect(runValueWritePayloads).toHaveLength(runValueWrites.length);
      expect(runValueWritePayloads[0]).toEqual({
        casesNeeded: 777,
        pizzasPerCase: 8,
        casesPerSkid: 16,
      });
      expect(runValueWritePayloads.slice(1).every((payload) =>
        payload.casesNeeded === 999 &&
        payload.pizzasPerCase === 8 &&
        payload.casesPerSkid === 16,
      )).toBe(true);
    };
    page.on("request", (request) => {
      if (request.method() !== "PUT" || !request.url().includes("/api/sync/today")) return;
      try {
        const body = request.postDataJSON() as {
          payload?: { runValues?: Record<string, {
            casesNeeded?: number;
            pizzasPerCase?: number;
            casesPerSkid?: number;
          }> };
        };
        const values = body.payload?.runValues?.[runId];
        if (typeof values?.casesNeeded === "number") {
          runValueWrites.push(values.casesNeeded);
          runValueWritePayloads.push({
            casesNeeded: values.casesNeeded,
            pizzasPerCase: values.pizzasPerCase,
            casesPerSkid: values.casesPerSkid,
          });
        }
      } catch {
        // Ignore unrelated requests with no JSON body.
      }
    });
    page.on("response", (response) => {
      const request = response.request();
      if (request.method() !== "PUT" || !request.url().includes("/api/sync/today")) return;
      let value: number | undefined;
      try {
        const body = request.postDataJSON() as {
          payload?: { runValues?: Record<string, { casesNeeded?: number }> };
        };
        value = body.payload?.runValues?.[runId]?.casesNeeded;
      } catch {
        return;
      }
      if (typeof value !== "number") return;
      void response.json().then((body: { canonicalRevision?: unknown }) => {
        runValueWriteResponses.push({
          value,
          status: response.status(),
          responseKind: response.headers()["x-sync-response"] ?? "missing",
          canonicalRevision: typeof body.canonicalRevision === "number"
            ? body.canonicalRevision
            : null,
        });
      }).catch(() => {});
    });
    let recoveryCopyFaultInjected = false;
    await page.route("**/api/sync/today**", async (route) => {
      const request = route.request();
      if (recoveryCopyFaultInjected || request.method() !== "PUT") {
        await route.continue();
        return;
      }
      let cases: number | undefined;
      try {
        const body = request.postDataJSON() as {
          payload?: { runValues?: Record<string, { casesNeeded?: number }> };
        };
        cases = body.payload?.runValues?.[runId]?.casesNeeded;
      } catch {
        // Keep unrelated or malformed requests on the ordinary route.
      }
      if (cases !== 777) {
        await route.continue();
        return;
      }
      recoveryCopyFaultInjected = true;
      const response = await route.fetch();
      await page.evaluate(() => {
        (window as unknown as { armRecoveryCopyStorageFailure: () => void })
          .armRecoveryCopyStorageFailure();
      });
      await route.fulfill({ response });
    });
    const staleWriteResponse = page.waitForResponse((response) => {
      if (response.request().method() !== "PUT" || !response.url().includes("/api/sync/today")) {
        return false;
      }
      try {
        const body = response.request().postDataJSON() as {
          payload?: { runValues?: Record<string, { casesNeeded?: number }> };
        };
        return body.payload?.runValues?.[runId]?.casesNeeded === 777;
      } catch {
        return false;
      }
    });
    const lineSetup = page.locator("details").filter({
      has: page.locator("summary", { hasText: /line.?setup/i }),
    }).first();
    if (!(await lineSetup.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await lineSetup.locator("summary").click();
    }
    await page.getByTestId("input-pizzasPerCase").fill("8");
    await page.getByTestId("input-pizzasPerCase").blur();
    await page.getByTestId("input-casesPerSkid").fill("16");
    await page.getByTestId("input-casesPerSkid").blur();
    await casesNeeded.fill("777");
    const response = await staleWriteResponse;
    expect(response.status()).toBe(200);
    expect((await response.json() as { partialFallback?: boolean }).partialFallback).toBe(true);
    expect(recoveryCopyFaultInjected).toBe(true);
    await expect.poll(() => page.evaluate(() => (
      window as unknown as { recoveryCopyStorageFailureOccurred: boolean }
    ).recoveryCopyStorageFailureOccurred)).toBe(true);

    await expect(casesNeeded).toHaveValue("999", { timeout: 15_000 });
    await expect(page.getByTestId("input-pizzasPerCase")).toHaveValue("8");
    await expect(page.getByTestId("input-casesPerSkid")).toHaveValue("16");
    await expect.poll(() => page.evaluate((id) => {
      const raw = localStorage.getItem(`run-calc-run-${id}`);
      const values = JSON.parse(raw ?? "{}") as {
        casesNeeded?: number;
        pizzasPerCase?: number;
        casesPerSkid?: number;
      };
      return {
        casesNeeded: values.casesNeeded,
        pizzasPerCase: values.pizzasPerCase,
        casesPerSkid: values.casesPerSkid,
      };
    }, runId)).toEqual({
      casesNeeded: 999,
      pizzasPerCase: 8,
      casesPerSkid: 16,
    });
    await page.getByTestId("sync-status-button").click();
    const conflictActivity = page.locator('[data-testid^="sync-activity-"]')
      .filter({ hasText: "discarded the conflicting local value" });
    await expect(conflictActivity).toBeVisible({ timeout: 10_000 });
    await expect(conflictActivity).toContainText("kept the server value for 1 conflict");
    await expect(conflictActivity).toContainText(/reapplied \d+ changes/);
    await expect(conflictActivity).toContainText("browser storage did not save this rebase for reload");
    await expect(conflictActivity).toContainText("review the current value before editing again");

    const pendingWrites = page.getByText("Pending writes", { exact: true });
    await expect(pendingWrites).toBeVisible();
    await expect.poll(async () => Number(await pendingWrites.evaluate(
      (element) => element.nextElementSibling?.textContent?.trim() ?? "NaN",
    ))).toBe(0);

    expectCanonicalConflictSequence();
    await expect.poll(() => runValueWriteResponses.length).toBe(runValueWrites.length);
    const settledWriteCount = runValueWrites.length;
    expect(runValueWriteResponses[0]).toMatchObject({
      value: 777,
      status: 200,
      responseKind: "partial-fallback",
    });
    for (let reload = 0; reload < 2; reload += 1) {
      const revisionBeforeReload = Number((await getToday(page)).canonicalRevision);
      expect(Number.isSafeInteger(revisionBeforeReload)).toBe(true);
      const responsesBeforeReload = runValueWriteResponses.length;
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
      await page.getByTestId("tab-run").click();
      await expect(casesNeeded).toHaveValue("999", { timeout: 20_000 });
      await expect(page.getByTestId("input-pizzasPerCase")).toHaveValue("8");
      await expect(page.getByTestId("input-casesPerSkid")).toHaveValue("16");
      await expect.poll(() => page.evaluate((id) => {
        const raw = localStorage.getItem(`run-calc-run-${id}`);
        const values = JSON.parse(raw ?? "{}") as {
          casesNeeded?: number;
          pizzasPerCase?: number;
          casesPerSkid?: number;
        };
        return {
          casesNeeded: values.casesNeeded,
          pizzasPerCase: values.pizzasPerCase,
          casesPerSkid: values.casesPerSkid,
        };
      }, runId)).toEqual({
        casesNeeded: 999,
        pizzasPerCase: 8,
        casesPerSkid: 16,
      });
      await expect(page.getByTestId("sync-status-button")).toHaveAttribute(
        "title",
        "Sync connected",
        { timeout: 20_000 },
      );

      await page.getByTestId("sync-status-button").click();
      await expect(conflictActivity).toBeVisible({ timeout: 10_000 });
      await expect(conflictActivity).toContainText("kept the server value for 1 conflict");
       await expect(conflictActivity).toContainText(/reapplied \d+ changes/);
      await expect(conflictActivity).toContainText("browser storage did not save this rebase for reload");
      await expect(pendingWrites).toBeVisible();
      await expect.poll(async () => Number(await pendingWrites.evaluate(
        (element) => element.nextElementSibling?.textContent?.trim() ?? "NaN",
      ))).toBe(0);
      expectCanonicalConflictSequence();
      expect(runValueWrites).toHaveLength(settledWriteCount);
      const revisionAfterReload = Number((await getToday(page)).canonicalRevision);
      expect(revisionAfterReload).toBe(revisionBeforeReload);
      await expect.poll(() => runValueWriteResponses.length)
        .toBe(runValueWrites.length);
      expect(runValueWriteResponses.slice(responsesBeforeReload).every((result) =>
        result.value === 999 && result.status === 200,
      )).toBe(true);
    }
    expect(runValueWriteResponses.slice(1).every((result) =>
      result.value === 999 && result.status === 200 &&
      result.canonicalRevision !== null,
    )).toBe(true);

    const finalServer = await getToday(page) as unknown as SyncPayload;
    expect(finalServer.runValues[runId]?.casesNeeded).toBe(999);
    expect(finalServer.runValues[runId]?.pizzasPerCase).toBe(8);
    expect(finalServer.runValues[runId]?.casesPerSkid).toBe(16);
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
  "queued Target Cases edits survive a tab restart in browser emulation",
  async ({ page }: { page: Page }) => {
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
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/sync/schedule-move" &&
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

      const futureDay = page.getByTestId(`schedule-day-${fixture.futureDate}`);
      await expect(futureDay).toBeVisible();
      await futureDay.locator("button").first().click();
      const moveRun = futureDay.getByTestId(`move-run-${fixture.futureRunId}`);
      await moveRun.click();
      const moveDate = futureDay.getByTestId(`move-date-${fixture.futureRunId}`);
      await moveDate.fill(fixture.currentDate);

      await page.route("**/api/sync/**", destinationFailureRoute);
      await futureDay.getByRole("button", { name: "Move", exact: true }).last().click();

      const destinationWriteError = page.getByRole("alert")
        .filter({ hasText: "The move result is uncertain." });
      await expect(destinationWriteError).toContainText(
        "Refresh both dates before retrying; do not repeat it until confirmed.",
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
      await expect(page.getByTestId("schedule-today-card")).toContainText("2 runs on today's plan");
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
  "reload after a lost move acknowledgement confirms one canonical copy without replay",
  async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const username = uid();
    users.add(username);
    const fixture = scheduleMoveFixture();
    const evidence = observeScheduleMoveEvidence(page);
    let committedResponsesHidden = 0;
    const lostAcknowledgementRoute = async (route: Route) => {
      const request = route.request();
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/sync/schedule-move" &&
        request.postData()?.includes(fixture.futureRunId)
      ) {
        const committed = await route.fetch();
        if (committed.ok()) {
          committedResponsesHidden += 1;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "simulated lost response after commit" }),
          });
        } else await route.fulfill({ response: committed });
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

      const futureDay = page.getByTestId(`schedule-day-${fixture.futureDate}`);
      await expect(futureDay).toBeVisible();
      await futureDay.locator("button").first().click();
      const moveRun = futureDay.getByTestId(`move-run-${fixture.futureRunId}`);
      await moveRun.click();
      const moveDate = futureDay.getByTestId(`move-date-${fixture.futureRunId}`);
      await moveDate.fill(fixture.currentDate);

      await page.route("**/api/sync/**", lostAcknowledgementRoute);
      await futureDay.getByRole("button", { name: "Move", exact: true }).last().click();

      await expect(page.getByRole("alert")).toContainText("The move result is uncertain.");
      expect(committedResponsesHidden).toBe(1);
      await page.screenshot({
        path: testInfo.outputPath("05-lost-move-acknowledgement.png"),
        fullPage: true,
      });

      // The response was lost after commit. Reloading reads canonical state;
      // the client does not blindly replay the command.
      await page.unroute("**/api/sync/**", lostAcknowledgementRoute);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      await dismissOnboardingIfPresent(page);
      await page.getByTitle("More").click();
      await page.getByRole("menuitem", { name: /^Schedule/ }).click();
      const reloadedDialog = page.getByRole("dialog", { name: "Scheduled Days" });
      await expect(reloadedDialog.getByTestId("schedule-today-card")).toContainText("2 runs on today's plan");
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
      await page.screenshot({
        path: testInfo.outputPath("06-lost-move-after-reload.png"),
        fullPage: true,
      });
    } finally {
      await page.unroute("**/api/sync/**", lostAcknowledgementRoute).catch(() => {});
      await attachScheduleMoveEvidence(testInfo, evidence);
      await cleanupScheduleMoveFixture(fixture);
    }
  },
);

test(
  "manager can cancel, swap two schedules, and append without losing source runs",
  async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const username = uid();
    users.add(username);
    const fixture = scheduleMoveFixture();
    const secondDate = (() => {
      const date = new Date(`${fixture.futureDate}T12:00:00`);
      date.setDate(date.getDate() + 1);
      return date.toISOString().slice(0, 10);
    })();
    const appendDate = (() => {
      const date = new Date(`${fixture.futureDate}T12:00:00`);
      date.setDate(date.getDate() + 2);
      return date.toISOString().slice(0, 10);
    })();
    const secondRunId = `${fixture.futureRunId}-second`;
    const appendRunId = `${fixture.futureRunId}-append`;
    const evidence = observeScheduleMoveEvidence(page);
    const readRunIds = (date: string) => page.evaluate(async (targetDate) => {
      const response = await fetch(`/api/sync/${targetDate}`, { cache: "no-store" });
      const data = await response.json() as { dayState?: { runs?: Array<{ id?: string }> } } | null;
      return data?.dayState?.runs?.map((run) => run.id) ?? [];
    }, date);

    try {
      await signUp(page, username);
      await promoteToManager(page);
      await seedScheduleMoveFixture(page, fixture);
      await seedAdditionalScheduleDay(page, fixture.currentDate, secondDate, secondRunId);
      await seedAdditionalScheduleDay(page, fixture.currentDate, appendDate, appendRunId);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      await page.getByTitle("More").click();
      await page.getByRole("menuitem", { name: /^Schedule/ }).click();

      const sourceDay = page.getByTestId(`schedule-day-${fixture.futureDate}`);
      const beforeCancel = await Promise.all([readRunIds(fixture.futureDate), readRunIds(secondDate)]);
      await sourceDay.getByTestId(`move-day-${fixture.futureDate}`).click();
      const targetDateInput = sourceDay.locator('input[type="date"]');
      await targetDateInput.fill(secondDate);
      await expect(sourceDay.getByRole("button", { name: "Swap day schedules" })).toBeVisible();
      await expect(sourceDay.getByRole("button", { name: "Append runs" })).toBeVisible();
      await expect(sourceDay.getByRole("button", { name: "Cancel" })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("schedule-existing-destination-choices.png"), fullPage: true });
      await sourceDay.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(await Promise.all([readRunIds(fixture.futureDate), readRunIds(secondDate)])).toEqual(beforeCancel);

      await sourceDay.getByTestId(`move-day-${fixture.futureDate}`).click();
      await sourceDay.locator('input[type="date"]').fill(secondDate);
      await expect(sourceDay.getByRole("button", { name: "Swap day schedules" })).toBeVisible();
      await sourceDay.getByRole("button", { name: "Swap day schedules" }).click();
      await expect.poll(() => readRunIds(fixture.futureDate)).toEqual([secondRunId]);
      await expect.poll(() => readRunIds(secondDate)).toEqual([fixture.futureRunId]);

      await page.getByTestId(`move-day-${fixture.futureDate}`).click();
      await sourceDay.locator('input[type="date"]').fill(appendDate);
      await expect(sourceDay.getByRole("button", { name: "Append runs" })).toBeVisible();
      await sourceDay.getByRole("button", { name: "Append runs" }).click();
      await expect.poll(() => readRunIds(fixture.futureDate)).toEqual([]);
      await expect.poll(() => readRunIds(appendDate)).toEqual([appendRunId, secondRunId]);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      await page.getByTitle("More").click();
      await page.getByRole("menuitem", { name: /^Schedule/ }).click();
      await expect(page.getByTestId(`schedule-day-${fixture.futureDate}`)).toHaveCount(0);
      expect(await readRunIds(appendDate)).toEqual([appendRunId, secondRunId]);
      expect(evidence.pageErrors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("schedule-append-after-reload.png"), fullPage: true });
    } finally {
      await attachScheduleMoveEvidence(testInfo, evidence);
      await cleanupScheduleMoveFixture(fixture, [secondDate, appendDate]);
    }
  },
);

test(
  "manager can append when the server reports a started-today swap is unavailable",
  async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const username = uid();
    users.add(username);
    const fixture = scheduleMoveFixture();
    const evidence = observeScheduleMoveEvidence(page);
    let eligibilityChecks = 0;
    // API integration coverage checks the real started-run/time boundary.
    // This browser fixture isolates the UI branch from wall-clock timing.
    const blockTodaySwapRoute = async (route: Route) => {
      const request = route.request();
      if (
        request.method() === "GET"
        && new URL(request.url()).pathname === "/api/sync/schedule-swap-eligibility"
      ) {
        eligibilityChecks += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            today: fixture.currentDate,
            sourceScheduled: true,
            destinationScheduled: true,
            canSwap: false,
            reason: "today-started-after-6am",
          }),
        });
        return;
      }
      await route.continue();
    };
    const readRunIds = (date: string) => page.evaluate(async (targetDate) => {
      const response = await fetch(`/api/sync/${targetDate}`, { cache: "no-store" });
      const data = await response.json() as { dayState?: { runs?: Array<{ id?: string }> } } | null;
      return data?.dayState?.runs?.map((run) => run.id) ?? [];
    }, date);

    try {
      await signUp(page, username);
      await promoteToManager(page);
      await seedScheduleMoveFixture(page, fixture);
      await page.route("**/api/sync/schedule-swap-eligibility**", blockTodaySwapRoute);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      await page.getByTitle("More").click();
      await page.getByRole("menuitem", { name: /^Schedule/ }).click();

      const sourceDay = page.getByTestId(`schedule-day-${fixture.futureDate}`);
      const beforeCancel = await Promise.all([
        readRunIds(fixture.currentDate),
        readRunIds(fixture.futureDate),
      ]);
      await sourceDay.getByTestId(`move-day-${fixture.futureDate}`).click();
      await sourceDay.locator('input[type="date"]').fill(fixture.currentDate);
      await expect(sourceDay.getByRole("status")).toContainText(
        "Today’s plan has started; swaps are unavailable after 6:59 a.m.",
      );
      await expect(sourceDay.getByRole("button", { name: "Swap day schedules" })).toHaveCount(0);
      await expect(sourceDay.getByRole("button", { name: "Append runs" })).toBeVisible();
      await expect(sourceDay.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
      expect(eligibilityChecks).toBeGreaterThan(0);

      await sourceDay.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(await Promise.all([
        readRunIds(fixture.currentDate),
        readRunIds(fixture.futureDate),
      ])).toEqual(beforeCancel);

      await sourceDay.getByTestId(`move-day-${fixture.futureDate}`).click();
      await sourceDay.locator('input[type="date"]').fill(fixture.currentDate);
      await sourceDay.getByRole("button", { name: "Append runs" }).click();
      await expect.poll(() => readRunIds(fixture.currentDate)).toEqual([
        fixture.liveRunId,
        fixture.futureRunId,
      ]);
      await expect.poll(() => readRunIds(fixture.futureDate)).toEqual([]);

      await page.reload({ waitUntil: "domcontentloaded" });
      const canonical = await page.evaluate(async (date) => {
        const response = await fetch(`/api/sync/today?today=${date}`, { cache: "no-store" });
        return await response.json() as {
          dayState?: { runs?: Array<{ id?: string; startedAt?: number }> };
        };
      }, fixture.currentDate);
      expect(canonical.dayState?.runs?.map((run) => run.id)).toEqual([
        fixture.liveRunId,
        fixture.futureRunId,
      ]);
      expect(evidence.pageErrors).toEqual([]);
    } finally {
      await page.unroute("**/api/sync/schedule-swap-eligibility**", blockTodaySwapRoute).catch(() => {});
      await attachScheduleMoveEvidence(testInfo, evidence);
      await cleanupScheduleMoveFixture(fixture);
    }
  },
);

test(
  "manager classification of a premade crust persists across reload",
  async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const username = uid();
    users.add(username);
    const recipeId = `e2e-premade-${Date.now()}`;

    const openDoughManager = async () => {
      await page.getByTitle("More").click();
      await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Manage Lists & Settings" });
      await dialog.getByRole("button", { name: "Recipes", exact: true }).click();
      const editor = dialog.getByTestId("dough-recipe-editor");
      await expect(editor).toBeVisible();
      await expect(editor.getByRole("button", { name: /E2E Premade Crust/ }))
        .toBeVisible({ timeout: 15_000 });
      return editor;
    };

    try {
      await signUp(page, username);
      await promoteToManager(page);
      const seededStatus = await page.evaluate(async (id) => {
        const response = await fetch("/api/dough-recipes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            items: [{
              id,
              name: "E2E Premade Crust",
              notes: "",
              components: [],
              enabled: true,
              isPremadeCrust: false,
              brand: "",
              flavors: [],
            }],
          }),
        });
        return response.status;
      }, recipeId);
      expect(seededStatus).toBe(200);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      let editor = await openDoughManager();
      const recipe = editor.getByRole("button", { name: /E2E Premade Crust/ });
      await recipe.click();
      const classification = editor.getByRole("checkbox", { name: "Premade crust" });
      await expect(classification).not.toBeChecked();
      await expect(editor.getByText(
        "No formula recorded. Manager review is needed before treating this as premade.",
      )).toBeVisible();
      await classification.check();
      await expect(editor.getByText(
        "No in-house dough formula is needed for this premade crust.",
      )).toBeVisible();
      await expect.poll(() => page.evaluate(async (id) => {
        const response = await fetch("/api/dough-recipes", { cache: "no-store" });
        const data = await response.json() as { items: Array<{ id: string; isPremadeCrust?: boolean }> };
        return data.items.find((item) => item.id === id)?.isPremadeCrust;
      }, recipeId)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("manager-premade-crust-status.png"),
        fullPage: true,
      });

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      editor = await openDoughManager();
      const reopenedRecipe = editor.getByRole("button", { name: /E2E Premade Crust/ });
      await expect(reopenedRecipe).toContainText("Premade crust");
      await reopenedRecipe.click();
      await expect(editor.getByRole("checkbox", { name: "Premade crust" })).toBeChecked();
      await expect(editor.getByText(
        "Manager classification. No in-house dough formula is needed; linked setup selects Crust mode. Existing runs are not changed.",
      )).toBeVisible();
    } finally {
      const db = new Client({
        connectionString: requireIsolatedTestDatabase("premade crust e2e cleanup"),
      });
      try {
        await db.connect();
        await db.query("DELETE FROM dough_recipes WHERE id = $1", [recipeId]);
      } finally {
        await db.end().catch(() => {});
      }
    }
  },
);