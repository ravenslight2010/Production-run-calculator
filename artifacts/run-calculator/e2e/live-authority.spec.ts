import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { DEFAULT_VALUES } from "../src/types";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";
import {
  capturedManualRequest,
  installManualFetchGate,
  reconnectAtSessionBoundary,
  releaseManualFetchGate,
} from "./operationalRecoveryFixtures";

const PASSWORD = "FixturePass123!";
const usernames = new Set<string>();

function nanoid(size = 21): string {
  const alphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_G5";
  const bytes = randomBytes(size);
  return Array.from(bytes, (byte) => alphabet[byte & 63]).join("");
}

type FixturePage = { context: BrowserContext; page: Page; userId: string };
type Canonical = {
  dayState: { runs: Array<Record<string, unknown>>; currentIndex: number };
  runValues: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

function facilityDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

async function register(
  browser: Browser,
  baseURL: string,
  username: string,
  viewport: { width: number; height: number },
): Promise<FixturePage> {
  const context = await browser.newContext({ baseURL, viewport, timezoneId: "America/Chicago" });
  const page = await context.newPage();
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: process.env.STAFF_SIGNUP_CODE ?? "",
  });
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (!response.ok) throw new Error("Signed-in fixture identity was not available");
    return await response.json() as { userId?: string };
  });
  if (!identity.userId) throw new Error("Signed-in fixture identity was incomplete");
  return { context, page, userId: identity.userId };
}

async function canonical(page: Page, date: string): Promise<Canonical> {
  const response = await page.request.get(`/api/sync/today?today=${date}`, {
    headers: { "cache-control": "no-cache" },
  });
  if (!response.ok()) throw new Error(`Canonical state read returned HTTP ${response.status()}`);
  return await response.json() as Canonical;
}

async function seedPendingRuns(
  pages: Page[],
  date: string,
  runIds: [string, string],
): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("seed pending live authority runs"),
  });
  const at = Date.now();
  const values = {
    ...DEFAULT_VALUES,
    casesNeeded: 500,
    crustsPerCycle: 1,
    cycleSpeed: 60,
    approxLineSpeed: 60,
    freezerTime: 0,
    pizzasPerCase: 1,
    casesPerSkid: 10,
    casesPerLayer: 10,
    doughballsPerTray: 6,
    doughBatchYield: 4,
    targetDoughballWeight: 8,
    traysOnLine: 0,
    batchesReady: 0,
    casesOnCurrentSkid: 0,
    preTunnelMin: 0.2,
    pressOvenMin: 0.2,
    frontlineMin: 0.2,
    postTunnelMin: 0.2,
  };
  const payload = {
    syncVersion: 1,
    completeness: "complete",
    dayState: {
      date,
      currentIndex: 0,
      resetAt: 0,
      runs: runIds.map((id, index) => ({
        id,
        brand: "Synthetic Authority",
        flavor: index === 0 ? "Primary" : "Selection",
        subTab: "dough",
        seeded: false,
        metaUpdatedAt: at,
      })),
    },
    runValues: {
      [runIds[0]]: values,
      [runIds[1]]: { ...values, casesNeeded: 220 },
    },
    runValuesUpdatedAt: { [runIds[0]]: at, [runIds[1]]: at },
  };
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date = $1 AND scope = 'live'", [date]);
    await db.query(
      "INSERT INTO daily_sync (date, scope, data, canonical_revision) VALUES ($1, 'live', $2::jsonb, 0)",
      [date, JSON.stringify(payload)],
    );
  } finally {
    await db.end().catch(() => {});
  }
  for (const page of pages) {
    await page.evaluate(({ date: fixtureDate, ids, configured, stamp }) => {
      localStorage.setItem("run-calc-day", JSON.stringify({
        date: fixtureDate,
        currentIndex: 0,
        resetAt: 0,
        runs: ids.map((id, index) => ({
          id,
          brand: "Synthetic Authority",
          flavor: index === 0 ? "Primary" : "Selection",
          subTab: "dough",
          seeded: false,
          metaUpdatedAt: stamp,
        })),
      }));
      localStorage.setItem(`run-calc-run-${ids[0]}`, JSON.stringify(configured[0]));
      localStorage.setItem(`run-calc-run-${ids[1]}`, JSON.stringify(configured[1]));
    }, {
      date,
      ids: runIds,
      stamp: at,
      configured: [values, { ...values, casesNeeded: 220 }],
    });
  }
}

async function signUpAndPromote(
  browser: Browser,
  baseURL: string,
  viewport: { width: number; height: number },
  date: string,
  runIds: [string, string],
): Promise<{ a: FixturePage; b: FixturePage }> {
  const aName = `live_auth_mgr_${nanoid(12)}`;
  const bName = `live_auth_peer_${nanoid(12)}`;
  usernames.add(aName);
  usernames.add(bName);
  const a = await register(browser, baseURL, aName, viewport);
  const db = new Client({ connectionString: requireIsolatedTestDatabase("live authority manager fixture") });
  try {
    await db.connect();
    await db.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager', updated_at = NOW()`,
      [a.userId],
    );
    await db.query("UPDATE users SET onboarding_seen = true WHERE id = $1", [a.userId]);
  } finally {
    await db.end().catch(() => {});
  }
  await a.page.reload({ waitUntil: "domcontentloaded" });
  await a.page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 25_000 });
  const aRole = await a.page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    return response.ok ? (await response.json() as { role?: string }).role : undefined;
  });
  expect(aRole, "only the synthetic fixture account receives manager role").toBe("manager");

  const b = await register(browser, baseURL, bName, viewport);
  await seedPendingRuns([a.page, b.page], date, runIds);
  await Promise.all([
    a.page.reload({ waitUntil: "domcontentloaded" }),
    b.page.reload({ waitUntil: "domcontentloaded" }),
  ]);
  await Promise.all([
    a.page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 25_000 }),
    b.page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 25_000 }),
  ]);
  return { a, b };
}

async function close(page?: FixturePage): Promise<void> {
  await page?.context.close().catch(() => {});
}

async function addSanitizedDiagnostics(
  page: Page,
  errors: string[],
  consoleErrorCounts: { value: number },
): Promise<void> {
  page.on("pageerror", () => errors.push("pageerror"));
  page.on("console", (message) => {
    // Offline recovery intentionally causes browser network-console errors.
    // Keep only a count; never retain raw messages or URLs.
    if (message.type() === "error") consoleErrorCounts.value += 1;
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      try { errors.push(`http-${response.status()} ${new URL(response.url()).pathname}`); } catch {}
    }
  });
}

test.afterAll(async () => {
  const url = requireIsolatedTestDatabase("live authority fixture cleanup");
  const db = new Client({ connectionString: url });
  try {
    await db.connect();
    await cleanupTestUsers(db, usernames);
    await db.query("DELETE FROM daily_sync WHERE date = $1 AND scope = 'live'", [facilityDate()]);
  } finally {
    await db.end().catch(() => {});
  }
});

test("server-authoritative live controls converge across two accounts, stale/offline recovery and run switch", async ({
  browser,
  baseURL,
}, testInfo) => {
  const viewport = testInfo.project.use.viewport as { width: number; height: number };
  const date = facilityDate();
  const runIds: [string, string] = [uniqueTestId("authority-primary"), uniqueTestId("authority-selection")];
  const errors: string[] = [];
  const consoleErrorCounts = { value: 0 };
  let a: FixturePage | undefined;
  let b: FixturePage | undefined;

  try {
    const accounts = await signUpAndPromote(browser, baseURL!, viewport, date, runIds);
    a = accounts.a;
    b = accounts.b;
    await addSanitizedDiagnostics(a.page, errors, consoleErrorCounts);
    await addSanitizedDiagnostics(b.page, errors, consoleErrorCounts);
    const pageA = a.page;
    const pageB = b.page;

    await pageA.getByTestId("tab-run").click();
    await pageB.getByTestId("tab-run").click();
    await expect(pageA.getByTestId("input-casesNeeded")).toHaveValue("500");
    await expect(pageB.getByTestId("input-casesNeeded")).toHaveValue("500");
    if (testInfo.project.name === "chromium-desktop") {
      await pageA.screenshot({ path: testInfo.outputPath("authenticated-before-live-controls.png"), fullPage: true });
    }

    // This is the real lifecycle Start action; the fixture itself is only pending.
    await pageA.getByTestId("button-start-run").click();
    await expect.poll(async () => (await canonical(pageA, date)).dayState.runs[0]?.startedAt)
      .toBeTruthy();
    const started = await canonical(pageA, date);
    const primaryStartedAt = Number(started.dayState.runs[0]?.startedAt);
    expect(started.dayState.runs[0]?.endedAt).toBeFalsy();
    await pageB.reload({ waitUntil: "domcontentloaded" });
    await pageB.getByTestId("tab-run").waitFor({ state: "visible" });
    await expect(pageB.getByTestId("input-casesNeeded")).toHaveValue("500");

    // Dough supply correction is an acknowledged manual-section command.
    await pageA.getByTestId("tab-dough").click();
    await expect.poll(async () => Number((await canonical(pageA, date)).runValues[runIds[0]]?.traysOnLine))
      .toBeGreaterThan(0);
    const priorTrays = Number((await canonical(pageA, date)).runValues[runIds[0]]?.traysOnLine);
    const firstDoughCorrection = pageA.waitForResponse((response) =>
      response.url().includes("/api/sync/manual-section")
      && response.request().method() === "POST", { timeout: 15_000 });
    await pageA.getByTestId("btn-dec-traysOnLine").click();
    const firstCorrectionResponse = await firstDoughCorrection;
    expect(firstCorrectionResponse.status(), "real Dough correction response").toBe(200);
    const acceptedDough = await canonical(pageA, date);
    const acceptedTrays = Number(acceptedDough.runValues[runIds[0]]?.traysOnLine);
    expect(acceptedTrays).toBe(priorTrays - 1);
    await expect.poll(async () => Number(await pageB.getByTestId("input-casesNeeded").inputValue()))
      .toBe(500);
    await expect.poll(async () => {
      const state = await canonical(pageB, date);
      return Number(state.runValues[runIds[0]]?.traysOnLine);
    }).toBe(acceptedTrays);

    // Global Pause/Resume must use canonical lifecycle anchors on both contexts.
    await pageA.getByTestId("tab-run").click();
    await pageA.getByRole("button", { name: /PAUSE RUN/i }).click();
    await expect.poll(async () => (await canonical(pageA, date)).dayState.runs[0]?.pausedAt)
      .toBeTruthy();
    const pausedAt = Number((await canonical(pageA, date)).dayState.runs[0]?.pausedAt);
    await expect.poll(async () => (await canonical(pageB, date)).dayState.runs[0]?.pausedAt)
      .toBe(pausedAt);
    await pageA.getByTestId("resume-run").click();
    await expect.poll(async () => Boolean((await canonical(pageA, date)).dayState.runs[0]?.pausedAt))
      .toBe(false);
    const resumed = await canonical(pageA, date);
    expect(Number(resumed.dayState.runs[0]?.startedAt)).toBeGreaterThanOrEqual(primaryStartedAt);
    await expect.poll(async () => Boolean((await canonical(pageB, date)).dayState.runs[0]?.pausedAt))
      .toBe(false);

    // Exercise the real Dough-only timer hold and explicit Resume control.
    await pageA.getByTestId("tab-dough").click();
    const doughTimerPauseResponse = pageA.waitForResponse((response) =>
      response.url().includes("/api/sync/operational-intents")
      && response.request().method() === "POST", { timeout: 15_000 });
    await pageA.getByTestId("btn-pause-dough-timers").click();
    await expect(pageA.getByTestId("dough-timers-paused-banner")).toBeVisible();
    expect((await doughTimerPauseResponse).status(), "Dough timer pause must be server-acknowledged").toBe(200);
    const doughTimerResumeResponse = pageA.waitForResponse((response) =>
      response.url().includes("/api/sync/operational-intents")
      && response.request().method() === "POST", { timeout: 15_000 });
    await pageA.getByTestId("btn-resume-dough-timers").click();
    await expect(pageA.getByTestId("dough-timers-paused-banner")).toBeHidden();
    expect((await doughTimerResumeResponse).status(), "Dough timer resume must be server-acknowledged").toBe(200);

    // Packaging correction and its acknowledged "Resume auto tracking" action.
    await pageA.getByTestId("tab-packaging").click();
    const packagingBefore = Number((await canonical(pageA, date)).runValues[runIds[0]]?.casesOnCurrentSkid);
    const packagingCorrection = pageA.waitForResponse((response) =>
      response.url().includes("/api/sync/manual-section")
      && response.request().method() === "POST", { timeout: 15_000 });
    await pageA.getByTestId("btn-inc-casesOnCurrentSkid").click();
    expect((await packagingCorrection).status(), "real Packaging correction response").toBe(200);
    await expect.poll(async () =>
      Number((await canonical(pageA, date)).runValues[runIds[0]]?.casesOnCurrentSkid),
    ).toBeGreaterThan(packagingBefore);
    const resumeAuto = pageA.getByTestId("btn-resume-now");
    if (await resumeAuto.isVisible().catch(() => false)) {
      const resumeResponse = pageA.waitForResponse((response) =>
        response.url().includes("/api/sync/manual-section")
        && response.request().method() === "POST", { timeout: 15_000 });
      await resumeAuto.click();
      const response = await resumeResponse;
      expect(response.status(), "Packaging Resume must receive an HTTP success, not a local-only click").toBeLessThan(300);
    }

    // Retain B's complete pre-correction snapshot and submit it through the
    // real sync API after A accepts a newer Dough command.
    const staleSnapshotResponse = await pageB.request.get(`/api/sync/today?today=${date}`, {
      headers: { "cache-control": "no-cache" },
    });
    expect(staleSnapshotResponse.ok()).toBe(true);
    const staleSnapshot = await staleSnapshotResponse.json() as Canonical;
    const staleSnapshotId = staleSnapshotResponse.headers()["x-sync-snapshot"];
    expect(staleSnapshotId).toBeTruthy();
    await pageA.getByTestId("tab-dough").click();
    const newerDough = pageA.waitForResponse((response) =>
      response.url().includes("/api/sync/manual-section")
      && response.request().method() === "POST", { timeout: 15_000 });
    await pageA.getByTestId("btn-dec-traysOnLine").click();
    expect((await newerDough).status(), "newer A correction must be accepted").toBe(200);
    const newerCanonical = await canonical(pageA, date);
    const newerTrayTotal = Number(newerCanonical.runValues[runIds[0]]?.traysOnLine);
    const resetResponse = await pageB.request.get("/api/sync/reset-epoch");
    expect(resetResponse.ok()).toBe(true);
    const { epoch = 0 } = await resetResponse.json() as { epoch?: number };
    const deliveredSnapshot = await pageB.request.put(
      `/api/sync/today?today=${date}&epoch=${epoch}`,
      {
        data: {
          senderId: "synthetic-stale-snapshot",
          snapshotId: staleSnapshotId,
          payload: {
            ...staleSnapshot,
            syncVersion: 1,
            completeness: "complete",
            baseSnapshotId: staleSnapshotId,
          },
        },
      },
    );
    expect(deliveredSnapshot.status(), "stale snapshot API write is safely recovered").toBe(200);
    expect(deliveredSnapshot.headers()["x-sync-response"]).toBe("partial-fallback");
    const afterStaleSnapshot = await canonical(pageA, date);
    expect(afterStaleSnapshot.runValues[runIds[0]]?.traysOnLine).toBe(newerTrayTotal);
    expect(afterStaleSnapshot.dayState.runs[0]?.startedAt).toBe(newerCanonical.dayState.runs[0]?.startedAt);

    // Retain a competing stale manual correction in B, switch selection while
    // the response is delayed, and require a genuine server rejection/review.
    await installManualFetchGate(pageB);
    await pageB.getByTestId("tab-dough").click();
    await expect(pageB.getByTestId("input-traysOnLine")).toHaveValue(String(newerTrayTotal));
    const bRequested = Number(await pageB.getByTestId("input-traysOnLine").inputValue()) + 1;
    await pageB.getByTestId("btn-inc-traysOnLine").click();
    await capturedManualRequest(pageB);
    const finalACommand = pageA.waitForResponse((response) =>
      response.url().includes("/api/sync/manual-section")
      && response.request().method() === "POST", { timeout: 15_000 });
    await pageA.getByTestId("btn-dec-traysOnLine").click();
    expect((await finalACommand).status()).toBe(200);
    await pageB.getByTestId("tab-run").click();
    await pageB.getByRole("button", { name: "Select run 2" }).click();
    await expect(pageB.getByTestId("input-casesNeeded")).toHaveValue("220");
    const rejectedResponse = pageB.waitForResponse((response) =>
      response.url().includes("/api/sync/manual-section")
      && response.request().method() === "POST", { timeout: 15_000 });
    await releaseManualFetchGate(pageB);
    const rejectedManual = await rejectedResponse;
    expect(rejectedManual, "held stale correction must reach the real API").toBeTruthy();
    expect(rejectedManual!.status(), "stale manual correction must be visibly rejected, not silently accepted")
      .toBe(409);
    await expect(pageB.getByTestId("input-casesNeeded")).toHaveValue("220");
    const canonicalFinalDough = await canonical(pageA, date);
    expect(canonicalFinalDough.runValues[runIds[0]]?.traysOnLine).not.toBe(bRequested);
    await pageB.getByTestId("tab-run").click();
    await pageB.getByRole("button", { name: "Select run 1" }).click();
    await pageB.getByTestId("tab-dough").click();
    await expect(pageB.getByTestId("input-traysOnLine"))
      .toHaveValue(String(canonicalFinalDough.runValues[runIds[0]]?.traysOnLine));
    await pageB.getByRole("button", { name: /sync/i }).first().click().catch(() => {});
    const reviewPanel = pageB.getByText(/Saved manual corrections|Review required/i).first();
    await expect(reviewPanel).toBeVisible({ timeout: 10_000 });

    // Offline lifecycle command stays visibly unconfirmed; reload is attempted
    // only under the browser's installed PWA cache, then canonical state wins.
    await pageA.getByTestId("tab-run").click();
    await a.context.setOffline(true);
    await pageA.getByRole("button", { name: /PAUSE RUN/i }).click();
    await pageA.getByTestId("sync-status-button").click();
    await expect(pageA.getByText(/Your local change is retained on this device\. It is not shared until the server acknowledges it\./i))
      .toBeVisible();
    await expect(pageA.getByText("Offline actions", { exact: true })).toBeVisible();
    await expect.poll(async () => (await canonical(pageB, date)).dayState.runs[0]?.pausedAt)
      .toBeFalsy();
    if (testInfo.project.name === "chromium-desktop") {
      await pageA.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await pageA.getByTestId("tab-run").waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
    }
    await reconnectAtSessionBoundary(a);
    await expect.poll(async () => (await canonical(pageB, date)).dayState.runs[0]?.pausedAt, {
      timeout: 30_000,
    }).toBeTruthy();
    const afterReconnect = await canonical(pageB, date);
    expect(afterReconnect.dayState.runs[0]?.pausedAt).toBeTruthy();
    await pageA.getByTestId("resume-run").click();
    await expect.poll(async () => (await canonical(pageA, date)).dayState.runs[0]?.pausedAt)
      .toBeFalsy();

    // End through the user control to validate the existing Freeze drain view.
    await pageA.getByRole("button", { name: /STOP RUN/i }).click();
    const confirmComplete = pageA.getByTestId("floor-confirm-complete-run");
    if (await confirmComplete.isVisible().catch(() => false)) await confirmComplete.click();
    await pageA.getByTestId("tab-packaging").click();
    const drainDisplay = pageA.getByText(/Freeze Tunnel Draining|Freeze Tunnel Clear/i).first();
    await expect(drainDisplay).toBeVisible({ timeout: 15_000 });

    if (testInfo.project.name === "chromium-desktop") {
      await pageA.screenshot({ path: testInfo.outputPath("authenticated-after-canonical-recovery.png"), fullPage: true });
      await testInfo.attach("allowlisted-diagnostics.json", {
        body: JSON.stringify({
          project: testInfo.project.name,
          browserErrors: errors,
          acceptedDoughTotal: acceptedTrays,
          newerCanonicalDoughTotal: newerTrayTotal,
          staleSnapshotStatus: deliveredSnapshot.status(),
          staleManualStatus: rejectedManual!.status(),
          serverRevision: afterReconnect.canonicalRevision ?? null,
          consoleErrorCount: consoleErrorCounts.value,
        }),
        contentType: "application/json",
      });
    }
    expect(errors, "page errors and HTTP 5xx must be absent").toEqual([]);
  } finally {
    if (b) await releaseManualFetchGate(b.page).catch(() => {});
    await Promise.all([close(a), close(b)]);
  }
});
