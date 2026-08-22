/**
 * Operational sync convergence matrix.
 *
 * This suite deliberately uses two real browser contexts sharing one account:
 * one context is the sleeping/offline device and the other is the active
 * operator.  The assertions check both the rendered/local state and the
 * canonical server response after wake.
 */

import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
} from "./isolation";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const users = new Set<string>();

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
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.locator("#accessCode").fill(SIGNUP_CODE);
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const getStarted = page.getByRole("button", { name: /^get.?started$/i });
  if (await getStarted.isVisible().catch(() => false)) {
    await getStarted.click();
  }
}

async function promoteToManager(page: Page): Promise<void> {
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/me");
    return response.ok ? await response.json() as { userId?: string } : null;
  });
  expect(identity?.userId, "signed-in test user id").toBeTruthy();
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("sync-convergence promotion"),
  });
  try {
    await db.connect();
    await db.query("UPDATE user_roles SET role = 'manager' WHERE user_id = $1", [identity?.userId]);
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
    const epochResponse = await fetch("/api/sync/reset-epoch", { cache: "no-store" });
    const epochBody = await epochResponse.json() as { epoch?: number };
    const epoch = typeof epochBody.epoch === "number" ? epochBody.epoch : 0;
    const response = await fetch(`/api/sync/today?today=${date}&epoch=${epoch}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ senderId: "sync-matrix", payload }),
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
  return page.evaluate(() => {
    const raw = localStorage.getItem("run-calc-day");
    return ((JSON.parse(raw ?? "{}") as { runs?: Array<{ id?: string; endedAt?: number }> }).runs ?? []);
  });
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
      await expect.poll(async () => (await localRuns(peer)).some((run) => run.id === runId), {
        timeout: 15_000,
      }).toBe(false);

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
  async ({ page, browser }: { page: Page; browser: Browser }) => {
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

    const peerContext = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    const peer = await peerContext.newPage();
    try {
      await peer.goto("/", { waitUntil: "domcontentloaded" });
      await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
      await peerContext.setOffline(true);

      const unchanged = await page.evaluate(async ({ date, payload, snapshotId }) => {
        const epochResponse = await fetch("/api/sync/reset-epoch", { cache: "no-store" });
        const epoch = (await epochResponse.json() as { epoch?: number }).epoch ?? 0;
        const response = await fetch(`/api/sync/today?today=${date}&epoch=${epoch}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ senderId: "unchanged-wake", payload, snapshotId }),
        });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      }, { date: today(), payload: seeded, snapshotId: firstSnapshot });
      expect(unchanged.status).toBe(200);
      expect(unchanged.body).toMatchObject({ unchanged: true, snapshotId: firstSnapshot });
      expect(unchanged.body.data).toBeUndefined();

      const reset = await page.evaluate(async () => {
        const response = await fetch("/api/sync/reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "sync convergence test" }),
        });
        return { status: response.status, body: await response.json() as { epoch?: number } };
      });
      expect(reset.status).toBe(200);
      expect(reset.body.epoch).toBeGreaterThan(0);

      // The stale device must reconcile the new epoch on wake, not republish
      // its pre-reset run.  Failed/reset-stale responses are safe no-ops.
      await peerContext.setOffline(false);
      await peer.waitForTimeout(1_000);
      await expect.poll(async () => (await localRuns(peer)).some((run) => run.id === runId), {
        timeout: 15_000,
      }).toBe(false);
      await peer.reload({ waitUntil: "domcontentloaded" });
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