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
  try {
    await getStarted.waitFor({ state: "visible", timeout: 8_000 });
    await getStarted.click();
    await page.locator('[data-state="open"][aria-hidden="true"]')
      .waitFor({ state: "detached", timeout: 5_000 });
    await page.waitForTimeout(300);
  } catch {
    // The dialog may already have been dismissed for this account.
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
    await page.route("**/api/sync/today**", async (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        syncWriteAttempts += 1;
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
    blocked = false;
    await expect.poll(() => syncWriteAttempts, { timeout: 15_000 }).toBeGreaterThan(1);
    await expect(page.getByText(
      "Your latest changes are retained on this device, but the server has not acknowledged them. Other devices cannot see them until sync succeeds.",
      { exact: true },
    )).toBeHidden();
    await expect.poll(async () => {
      const server = await getToday(page);
      const values = server.runValues as Record<string, { casesNeeded?: number }> | undefined;
      return Object.values(values ?? {})[0]?.casesNeeded;
    }, { timeout: 15_000 }).toBe(17);
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

      // Use the context request client so the reset broadcast can navigate the
      // page without destroying an in-flight page.evaluate execution context.
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
      await peerContext.setOffline(false);
      await peer.waitForTimeout(1_000);
      await expect.poll(async () => (await localRuns(peer)).some((run) => run.id === runId), {
        timeout: 15_000,
      }).toBe(false);
      await peer.waitForLoadState("domcontentloaded").catch(() => {});
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
      await futureDay.getByRole("button", { name: "Move", exact: true }).last().click();

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
      expect(canonical.runValuesUpdatedAt?.[futureRunId]).toBe(200);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      const getStarted = page.getByRole("button", { name: /^get.?started$/i });
      if (await getStarted.isVisible().catch(() => false)) {
        await getStarted.click();
      }
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

      await expect(page.getByRole("alert")).toContainText(
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