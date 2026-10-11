/**
 * Standard two-device convergence matrix.
 *
 * This is intentionally separate from focused unit/API suites. Each test uses
 * one throwaway account in two independent browser contexts: desktop device A
 * and phone-sized device B. The harness labels requests and captures both
 * devices when a boundary diverges.
 */

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  cleanupTestUsers,
  requireIsolatedTestDatabase,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";
import {
  MultiDeviceSession,
  type DeviceDefinition,
  type SyncPayload,
  today,
  uniqueRunId,
} from "./multi-device-harness";
import { signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const users = new Set<string>();

async function signUp(page: Page, username: string): Promise<void> {
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    onboarding: {
      afterComplete: async (currentPage) => {
        await currentPage
          .locator('[data-state="open"][aria-hidden="true"]')
          .waitFor({ state: "detached", timeout: 5_000 })
          .catch(() => {});
      },
    },
  });
}

async function clearToday(): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("multi-device convergence beforeEach"),
  });
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date = $1", [today()]);
  } finally {
    await db.end().catch(() => {});
  }
}

async function promoteToManager(page: Page): Promise<void> {
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/me");
    return response.ok ? await response.json() as { userId?: string } : null;
  });
  if (!identity?.userId) throw new Error("[device-a] signed-in user identity was unavailable");
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("multi-device manager fixture"),
  });
  try {
    await db.connect();
    await db.query("UPDATE user_roles SET role = 'manager' WHERE user_id = $1", [identity.userId]);
  } finally {
    await db.end().catch(() => {});
  }
}

function seededPayload(runId: string, casesNeeded = 40): SyncPayload {
  return {
    dayState: {
      date: today(),
      currentIndex: 0,
      runs: [{ id: runId, brand: "Multi-device", flavor: "Convergence" }],
    },
    runValues: {
      [runId]: { casesNeeded, casesPerSkid: 12 },
    },
    runValuesUpdatedAt: { [runId]: 1 },
  };
}

test.beforeEach(clearToday);

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

test.describe("multi-device convergence", () => {
  test("simultaneous edits converge to one canonical value on both devices", async ({
    browser,
  }, testInfo) => {
    const username = `e2e_multi_${Math.random().toString(36).slice(2, 10)}`;
    users.add(username);
    const session = await MultiDeviceSession.create(browser, (page) => signUp(page, username));
    const runId = uniqueRunId("simultaneous");
    try {
      await session.putToday("device-a", today(), seededPayload(runId));
      await session.page("device-a").reload({ waitUntil: "domcontentloaded" });
      await session.page("device-b").reload({ waitUntil: "domcontentloaded" });
      await session.page("device-a").getByTestId("tab-run").click();
      await session.page("device-b").getByTestId("tab-run").click();
      await expect(session.page("device-a").getByTestId("input-casesNeeded")).toHaveValue("40");
      await expect(session.page("device-b").getByTestId("input-casesNeeded")).toHaveValue("40");

      await session.withDiagnostics(testInfo, async () => {
        const heldA = await session.holdFirstSyncWrite("device-a");
        const heldB = await session.holdFirstSyncWrite("device-b");
        await session.page("device-a").getByTestId("input-casesNeeded").fill("17");
        await session.page("device-b").getByTestId("input-casesNeeded").fill("17");
        await Promise.all([heldA.observed, heldB.observed]);
        session.mark("device-a", "manual edit 17 coordinated");
        session.mark("device-b", "manual edit 17 coordinated");
        await Promise.all([heldA.release(), heldB.release()]);

        let canonicalCasesNeeded: number | undefined;
        await expect.poll(async () => {
          const body = await session.getToday("device-a", today());
          const values = body.runValues as Record<string, { casesNeeded?: number }> | undefined;
          canonicalCasesNeeded = values?.[runId]?.casesNeeded;
          return canonicalCasesNeeded === 17;
        }, { timeout: 15_000, message: "server did not commit the coordinated edit" }).toBe(true);

        await expect.poll(
          () => session.localRunValue("device-a", runId, "casesNeeded"),
          { timeout: 15_000, message: "device-a did not adopt canonical casesNeeded" },
        ).toBe(17);
        await expect.poll(
          () => session.localRunValue("device-b", runId, "casesNeeded"),
          { timeout: 15_000, message: "device-b did not adopt canonical casesNeeded" },
        ).toBe(17);
        await Promise.all([
          session.page("device-a").reload({ waitUntil: "domcontentloaded" }),
          session.page("device-b").reload({ waitUntil: "domcontentloaded" }),
        ]);
        await Promise.all([
          session.page("device-a").getByTestId("tab-run").waitFor({ state: "attached" }),
          session.page("device-b").getByTestId("tab-run").waitFor({ state: "attached" }),
        ]);
        await Promise.all([
          session.page("device-a").getByTestId("tab-run").click(),
          session.page("device-b").getByTestId("tab-run").click(),
        ]);
        await expect(session.page("device-a").getByTestId("input-casesNeeded"))
          .toHaveValue("17");
        await expect(session.page("device-b").getByTestId("input-casesNeeded"))
          .toHaveValue("17");
      });
    } finally {
      await session.close();
    }
  });

  test("offline peer adopts the active edit after wake and reload", async ({
    browser,
  }, testInfo) => {
    const username = `e2e_multi_${Math.random().toString(36).slice(2, 10)}`;
    users.add(username);
    const session = await MultiDeviceSession.create(browser, (page) => signUp(page, username));
    const runId = uniqueRunId("wake");
    try {
      await session.putToday("device-a", today(), seededPayload(runId));
      await session.page("device-a").reload({ waitUntil: "domcontentloaded" });
      await session.page("device-b").reload({ waitUntil: "domcontentloaded" });
      await session.page("device-a").getByTestId("tab-run").click();
      await session.page("device-b").getByTestId("tab-run").click();
      await expect(session.page("device-b").getByTestId("input-casesNeeded")).toHaveValue("40");

      await session.withDiagnostics(testInfo, async () => {
        await session.page("device-b").goto("/sign-in", { waitUntil: "domcontentloaded" });
        await session.setOffline("device-b", true);
        await session.page("device-a").getByTestId("input-casesNeeded").fill("31");
        await expect.poll(async () => {
          const body = await session.getToday("device-a", today());
          const values = body.runValues as Record<string, { casesNeeded?: number }> | undefined;
          return values?.[runId]?.casesNeeded;
        }, { timeout: 15_000, message: "server did not commit device-a edit" }).toBe(31);
        await expect.poll(
          () => session.localRunValue("device-b", runId, "casesNeeded"),
          { timeout: 5_000, message: "offline device changed before wake" },
        ).toBe(40);

        // Make the first foreground recovery pull fail after reconnecting.
        // The retry must adopt A's newer canonical value before B can publish
        // its cached snapshot, and a later refresh must keep that convergence.
        let allowRecoveryPull = false;
        const blockRecoveryPulls = async (route: import("@playwright/test").Route) => {
          if (!allowRecoveryPull && route.request().method() === "GET") {
            session.mark("device-b", "failed foreground recovery pull");
            await route.abort("failed");
            return;
          }
          await route.continue();
        };
        await session.page("device-b").route("**/api/sync/today**", blockRecoveryPulls);
        await session.page("device-b").route("**/api/sync/events**", blockRecoveryPulls);
        await session.setOffline("device-b", false);
        session.mark("device-b", "wake/reconnect requested");
        await session.page("device-b").goto("/", { waitUntil: "domcontentloaded" });
        await session.page("device-b").evaluate(() => {
          window.dispatchEvent(new Event("focus"));
        });
        await expect(session.page("device-b").getByTestId("foreground-recovery-status"))
          .toContainText("Couldn't confirm", { timeout: 15_000 });
        allowRecoveryPull = true;
        await session.page("device-b").unroute("**/api/sync/today**", blockRecoveryPulls);
        await session.page("device-b").unroute("**/api/sync/events**", blockRecoveryPulls);
        await session.page("device-b").getByTestId("button-retry-foreground-recovery").click();
        await expect.poll(
          () => session.localRunValue("device-b", runId, "casesNeeded"),
          { timeout: 15_000, message: "device-b did not adopt after reconnect" },
        ).toBe(31);
        await expect(session.page("device-a").getByTestId("input-casesNeeded")).toHaveValue("31");
        await expect(session.page("device-b").getByTestId("input-casesNeeded")).toHaveValue("31");

        await session.page("device-b").reload({ waitUntil: "domcontentloaded" });
        await session.page("device-b").getByTestId("tab-run").waitFor({ state: "attached" });
        await expect.poll(
          () => session.localRunValue("device-b", runId, "casesNeeded"),
          { timeout: 15_000, message: "device-b lost the adopted value after reload" },
        ).toBe(31);
        const canonical = await session.getToday("device-a", today());
        const values = canonical.runValues as Record<string, { casesNeeded?: number }>;
        expect(values[runId]?.casesNeeded, "server canonical casesNeeded").toBe(31);
      });
    } finally {
      await session.close();
    }
  });

  test("read-only station display adopts canonical state after reconnect @focused-only", async ({
    browser,
    playwright,
  }, testInfo) => {
    const username = `e2e_multi_${Math.random().toString(36).slice(2, 10)}`;
    const fixtures = await AuthorizedBrowserFixtures.create(
      playwright,
      requireLocalFixtureApiOrigin("station display reconnect fixtures"),
      SIGNUP_CODE,
    );
    const runId = uniqueRunId("station-reconnect");
    let session: MultiDeviceSession | undefined;
    let blockedSyncTraffic: { release: () => Promise<void> } | undefined;
    try {
      const account = await fixtures.createAccount({
        username,
        password: PASSWORD,
        capabilities: [],
        onboardingSeen: true,
      });
      const stationWrites: string[] = [];
      let mainFrameNavigations = 0;
      const stationDevices: DeviceDefinition[] = [
        { name: "device-a", viewport: { width: 1280, height: 900 } },
        {
          name: "device-b",
          viewport: { width: 390, height: 844 },
          isMobile: true,
          initialPath: "/?screen=dashboard",
          readyTestId: "screen-sync-status",
        },
      ];
      const activeSession = await MultiDeviceSession.create(browser, async (page) => {
        await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
        await page.context().addCookies([{
          name: "rc_auth",
          value: account.token,
          url: new URL(page.url()).origin,
        }]);
        await page.goto("/", { waitUntil: "domcontentloaded" });
      }, stationDevices, {
        beforeNavigate: (page, device) => {
          if (device !== "device-b") return;
          page.on("request", (request) => {
            if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
              stationWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
            }
          });
          page.on("framenavigated", (frame) => {
            if (frame === page.mainFrame()) mainFrameNavigations += 1;
          });
        },
      });
      session = activeSession;
      const station = activeSession.page("device-b");
      const operator = activeSession.page("device-a");
      const status = station.getByTestId("screen-sync-status");
      const surface = station.locator(".screen-mode-surface");

      await activeSession.withDiagnostics(testInfo, async () => {
        await activeSession.putToday("device-a", today(), seededPayload(runId, 40));

        await operator.reload({ waitUntil: "domcontentloaded" });
        await operator.getByTestId("tab-run").waitFor({ state: "attached" });
        await operator.getByTestId("tab-run").click();
        const casesNeededInput = operator.getByTestId("input-casesNeeded");
        await expect(casesNeededInput).toHaveValue("40");

        await expect(status).toHaveAttribute("data-status", "live", { timeout: 20_000 });
        await expect(surface).toContainText("Multi-device");
        await expect(surface.getByText("/ 40", { exact: true })).toBeVisible();
        let stationNavigationCount = mainFrameNavigations;

        // A normal operator edit must reach the station over live sync, without
        // reloading the display page.
        await casesNeededInput.fill("31");
        await casesNeededInput.press("Tab");
        await expect.poll(async () => {
          const body = await activeSession.getToday("device-a", today());
          const values = body.runValues as Record<string, { casesNeeded?: number }> | undefined;
          return values?.[runId]?.casesNeeded;
        }, { timeout: 15_000, message: "operator edit did not reach canonical sync state" })
          .toBe(31);
        await expect(surface.getByText("/ 31", { exact: true })).toBeVisible({
          timeout: 15_000,
        });
        await expect(status).toHaveAttribute("data-status", "live");
        expect(mainFrameNavigations).toBe(stationNavigationCount);

        // BrowserContext.setOffline() can leave an established EventSource
        // alive, so block sync and reload once to create a controlled offline
        // baseline. The subsequent wake must recover without another reload.
        blockedSyncTraffic = await activeSession.blockSyncTraffic("device-b");
        await station.reload({ waitUntil: "domcontentloaded" });
        await expect(surface.getByText("/ 31", { exact: true })).toBeVisible();
        stationNavigationCount = mainFrameNavigations;

        await station.evaluate(() => {
          const history: Array<{ status: string | null; text: string }> = [];
          const pageWindow = window as Window & {
            __screenSyncHistory?: Array<{ status: string | null; text: string }>;
            __screenSyncObserver?: MutationObserver;
          };
          pageWindow.__screenSyncHistory = history;
          const capture = () => {
            const next = {
              status: document.querySelector('[data-testid="screen-sync-status"]')
                ?.getAttribute("data-status") ?? null,
              text: document.querySelector(".screen-mode-surface")?.textContent ?? "",
            };
            const previous = history[history.length - 1];
            if (!previous || previous.status !== next.status || previous.text !== next.text) {
              history.push(next);
            }
          };
          const observer = new MutationObserver(capture);
          const statusElement = document.querySelector('[data-testid="screen-sync-status"]');
          const surfaceElement = document.querySelector(".screen-mode-surface");
          if (statusElement) observer.observe(statusElement, {
            attributes: true,
            attributeFilter: ["data-status"],
          });
          if (surfaceElement) observer.observe(surfaceElement, {
            childList: true,
            characterData: true,
            subtree: true,
          });
          pageWindow.__screenSyncObserver = observer;
          capture();
        });
        const historyStart = await station.evaluate(() => {
          const pageWindow = window as Window & {
            __screenSyncHistory?: Array<{ status: string | null; text: string }>;
          };
          return pageWindow.__screenSyncHistory?.length ?? 0;
        });
        let observeRecovery = false;
        let recoveryReadResponses = 0;
        station.on("response", (response) => {
          if (!observeRecovery || response.request().method() !== "GET") return;
          if (
            new URL(response.url()).pathname === "/api/sync/today" &&
            response.ok()
          ) {
            recoveryReadResponses += 1;
          }
        });

        await activeSession.setOffline("device-b", true);
        await expect(status).toHaveAttribute("data-status", "stale");
        await casesNeededInput.fill("27");
        await casesNeededInput.press("Tab");
        await expect.poll(async () => {
          const body = await activeSession.getToday("device-a", today());
          const values = body.runValues as Record<string, { casesNeeded?: number }> | undefined;
          return values?.[runId]?.casesNeeded;
        }, { timeout: 15_000, message: "second operator edit did not reach canonical sync state" })
          .toBe(27);
        await expect(status).toHaveAttribute("data-status", "stale");
        await expect(surface.getByText("/ 31", { exact: true })).toBeVisible();
        await expect(surface.getByText("/ 27", { exact: true })).toHaveCount(0);

        observeRecovery = true;
        await activeSession.setOffline("device-b", false);
        await expect.poll(() => station.evaluate(() => navigator.onLine)).toBe(true);
        await station.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect.poll(async () => {
          const history = await station.evaluate((offset) => {
            const pageWindow = window as Window & {
              __screenSyncHistory?: Array<{ status: string | null; text: string }>;
            };
            return pageWindow.__screenSyncHistory?.slice(offset) ?? [];
          }, historyStart);
          return history.some((entry) => entry.status === "reconnecting");
        }, {
          timeout: 10_000,
          message: "station did not report reconnecting while sync traffic was blocked",
        }).toBe(true);
        await blockedSyncTraffic.release();
        blockedSyncTraffic = undefined;
        await station.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect.poll(() => recoveryReadResponses, {
          timeout: 15_000,
          message: "station did not complete a canonical recovery read after wake",
        }).toBeGreaterThan(0);
        await expect(surface.getByText("/ 27", { exact: true })).toBeVisible({
          timeout: 20_000,
        });
        await expect(status).toHaveAttribute("data-status", "live", {
          timeout: 20_000,
        });

        const wakeHistory = await station.evaluate((offset) => {
          const pageWindow = window as Window & {
            __screenSyncHistory?: Array<{ status: string | null; text: string }>;
          };
          return pageWindow.__screenSyncHistory?.slice(offset) ?? [];
        }, historyStart);
        expect(wakeHistory.some((entry) => entry.status === "stale")).toBe(true);
        expect(wakeHistory.some((entry) => entry.status === "reconnecting")).toBe(true);
        const firstLiveAfterWake = wakeHistory.find((entry) => entry.status === "live");
        expect(firstLiveAfterWake?.text).toContain("/ 27");
        expect(firstLiveAfterWake?.text).not.toContain("/ 31");
        expect(mainFrameNavigations).toBe(stationNavigationCount);

        expect(stationWrites, "the station context must not issue write requests").toEqual([]);
      });
    } finally {
      await blockedSyncTraffic?.release();
      await session?.close();
      await fixtures.cleanup({ syncDates: [today()] });
    }
  });

  test("offline peer cannot resurrect a deleted run after reconnect and reload", async ({
    browser,
  }, testInfo) => {
    const username = `e2e_multi_${Math.random().toString(36).slice(2, 10)}`;
    users.add(username);
    const session = await MultiDeviceSession.create(browser, (page) => signUp(page, username));
    const runId = uniqueRunId("delete");
    try {
      const seeded = seededPayload(runId);
      await session.putToday("device-a", today(), seeded);
      await session.page("device-a").reload({ waitUntil: "domcontentloaded" });
      await session.page("device-b").reload({ waitUntil: "domcontentloaded" });
      await expect.poll(() => session.localRunExists("device-b", runId)).toBe(true);

      await session.withDiagnostics(testInfo, async () => {
        await session.page("device-b").goto("/sign-in", { waitUntil: "domcontentloaded" });
        await session.setOffline("device-b", true);
        const deleted: SyncPayload = {
          ...seeded,
          dayState: { ...seeded.dayState, runs: [], currentIndex: 0 },
          deletedItems: { runs: [runId] },
          runValues: {},
          runValuesUpdatedAt: {},
        };
        const write = await session.putToday("device-a", today(), deleted);
        const canonical = write.data as SyncPayload;
        expect(canonical.dayState.runs, "server run list after deletion").toEqual([]);
        expect(canonical.deletedItems?.runs, "server deletion tombstone").toContain(runId);
        await expect.poll(
          () => session.localRunExists("device-a", runId),
          { timeout: 15_000, message: "device-a did not apply its deletion" },
        ).toBe(false);

        await session.setOffline("device-b", false);
        session.mark("device-b", "wake/reconnect requested after deletion");
        await session.page("device-b").goto("/", { waitUntil: "domcontentloaded" });
        await expect.poll(
          () => session.localRunExists("device-b", runId),
          { timeout: 15_000, message: "device-b resurrected a deleted run after wake" },
        ).toBe(false);
        await session.page("device-b").reload({ waitUntil: "domcontentloaded" });
        await session.page("device-b").getByTestId("tab-run").waitFor({ state: "attached" });
        await expect.poll(
          () => session.localRunExists("device-b", runId),
          { timeout: 15_000, message: "device-b resurrected a deleted run after reload" },
        ).toBe(false);

        const final = await session.getToday("device-a", today());
        const finalDay = final.dayState as SyncPayload["dayState"];
        const finalValues = final.runValues as Record<string, unknown> | undefined;
        expect(finalDay.runs.some((run) => run.id === runId), "server resurrected deleted run")
          .toBe(false);
        expect(finalValues?.[runId], "server resurrected deleted run values").toBeUndefined();
      });
    } finally {
      await session.close();
    }
  });

  test("reset epoch prevents an offline peer from re-adopting cleared state", async ({
    browser,
  }, testInfo) => {
    const username = `e2e_multi_${Math.random().toString(36).slice(2, 10)}`;
    users.add(username);
    const session = await MultiDeviceSession.create(browser, (page) => signUp(page, username));
    const runId = uniqueRunId("reset");
    try {
      await promoteToManager(session.page("device-a"));
      const seeded = seededPayload(runId);
      await session.putToday("device-a", today(), seeded);
      await session.page("device-a").reload({ waitUntil: "domcontentloaded" });
      await session.page("device-b").reload({ waitUntil: "domcontentloaded" });
      await expect.poll(() => session.localRunExists("device-b", runId)).toBe(true);

      await session.withDiagnostics(testInfo, async () => {
        await session.page("device-b").goto("/sign-in", { waitUntil: "domcontentloaded" });
        await session.setOffline("device-b", true);
        const response = await session.page("device-a").request.post("/api/sync/reset", {
          data: { reason: "multi-device convergence fixture" },
        });
        expect(response.status(), "manager reset response").toBe(200);
        const resetBody = await response.json() as { epoch?: number };
        expect(resetBody.epoch, "reset epoch").toBeGreaterThan(0);
        await session.page("device-a").getByTestId("tab-run")
          .waitFor({ state: "attached", timeout: 15_000 });
        await expect.poll(
          () => session.localRunExists("device-a", runId),
          { timeout: 15_000, message: "device-a did not apply its reset" },
        ).toBe(false);

        await session.setOffline("device-b", false);
        session.mark("device-b", "wake/reconnect requested after reset");
        await session.page("device-b").goto("/", { waitUntil: "domcontentloaded" });
        await expect.poll(
          () => session.localRunExists("device-b", runId),
          { timeout: 15_000, message: "device-b re-adopted pre-reset state after wake" },
        ).toBe(false);
        await session.page("device-b").reload({ waitUntil: "domcontentloaded" });
        await session.page("device-b").getByTestId("tab-run").waitFor({ state: "attached" });
        await expect.poll(
          () => session.localRunExists("device-b", runId),
          { timeout: 15_000, message: "device-b re-adopted pre-reset state after reload" },
        ).toBe(false);

        const final = await session.getToday("device-a", today());
        const finalDay = final.dayState as SyncPayload["dayState"];
        const finalValues = final.runValues as Record<string, unknown> | undefined;
        expect(finalDay.runs.some((run) => run.id === runId), "server resurrected reset run")
          .toBe(false);
        expect(finalValues?.[runId], "server resurrected reset run values").toBeUndefined();
      });
    } finally {
      await session.close();
    }
  });
});