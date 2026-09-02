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
  cleanupTestUsers,
  requireIsolatedTestDatabase,
} from "./isolation";
import {
  MultiDeviceSession,
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

        await session.setOffline("device-b", false);
        session.mark("device-b", "wake/reconnect requested");
        await session.page("device-b").goto("/", { waitUntil: "domcontentloaded" });
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