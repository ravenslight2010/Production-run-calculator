/**
 * Foreground sync wiring guard.
 *
 * The counter-level regression lives in useAutoTrack.screenWake.test.ts. This
 * companion guard protects the Home orchestration that makes that rebase safe:
 * it must pull the client-date row, route it through the established inbound
 * merge, coalesce focus + visibility wake events, and never call a failed pull
 * "reconciled".
 */
import fs from "fs";
import path from "path";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createForegroundSyncWakeGuard } from "./foregroundSyncWakeGuard";
import {
  coordinateForegroundAdoption,
  createForegroundSyncTodayRequest,
  releaseCancelledForegroundRecovery,
  releaseForegroundRecovery,
  useHomeSyncCoordination,
} from "./hooks/useHomeSyncCoordination";
import { consumeForegroundRecoveryResponse } from "./foregroundRecoveryResponse";
import { syncPayloadSnapshotId } from "./syncWriteResponse";
import type { SyncPayload } from "./types";
import { todayStr } from "./utils";
import { VisibleTabScheduler } from "./visibleTabScheduler";

const HOME_FILE = path.join(__dirname, "pages", "home.tsx");
const SYNC_MANAGER_FILE = path.join(__dirname, "hooks", "useHomeSyncCoordination.ts");
const HOOK_FILE = path.join(__dirname, "hooks", "useAutoTrack.ts");
const RECOVERY_STATUS_FILE = path.join(__dirname, "components", "ForegroundRecoveryStatus.tsx");
const RECOVERY_RESPONSE_FILE = path.join(__dirname, "foregroundRecoveryResponse.ts");
const homeSource = fs.readFileSync(HOME_FILE, "utf8");
const syncManagerSource = fs.readFileSync(SYNC_MANAGER_FILE, "utf8");
const hookSource = fs.readFileSync(HOOK_FILE, "utf8");
const recoveryStatusSource = fs.readFileSync(RECOVERY_STATUS_FILE, "utf8");
const recoveryResponseSource = fs.readFileSync(RECOVERY_RESPONSE_FILE, "utf8");

describe("foreground wake sync barrier", () => {
  it("dispatches focus, visibility, and online to the registered date-scoped recovery", async () => {
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const signals: Array<{
      name: string;
      dispatch: () => void;
    }> = [
      { name: "focus", dispatch: () => window.dispatchEvent(new Event("focus")) },
      { name: "visibility", dispatch: () => document.dispatchEvent(new Event("visibilitychange")) },
      { name: "online", dispatch: () => window.dispatchEvent(new Event("online")) },
    ];

    try {
      for (const { name, dispatch } of signals) {
        const fetchRecovery = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
        const recover = vi.fn(async () => {
          const request = createForegroundSyncTodayRequest("snapshot-a", "2026-09-15");
          await fetchRecovery(request.url, request.init);
          return true;
        });
        const scheduler = new VisibleTabScheduler();
        const registration = result.current.registerForegroundRecovery(scheduler, recover);
        scheduler.start();

        await act(async () => {
          dispatch();
          await Promise.resolve();
          await Promise.resolve();
        });

        expect(recover, `${name} should trigger recovery`).toHaveBeenCalledTimes(1);
        expect(fetchRecovery).toHaveBeenCalledWith(
          "/api/sync/today?today=2026-09-15&snapshot=snapshot-a",
          { cache: "no-store" },
        );

        registration.dispose();
        scheduler.stop();
      }
    } finally {
      unmount();
    }
  });

  it("adopts the facility-local day after waking across midnight, never yesterday's state", async () => {
    vi.useFakeTimers();
    let hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    vi.setSystemTime(new Date("2026-09-14T23:59:59Z"));

    const yesterday = "2026-09-14";
    const today = "2026-09-15";
    const yesterdayPayload = {
      syncVersion: 1,
      completeness: "complete",
      dayState: {
        date: yesterday,
        currentIndex: 0,
        runs: [{ id: "yesterday-run", brand: "Yesterday", flavor: "Run" }],
      },
      runValues: { "yesterday-run": { casesNeeded: 7 } },
    } as unknown as SyncPayload;
    const todayPayload = {
      syncVersion: 1,
      completeness: "complete",
      dayState: {
        date: today,
        currentIndex: 0,
        runs: [{ id: "today-run", brand: "Today", flavor: "Run" }],
      },
      runValues: { "today-run": { casesNeeded: 11 } },
    } as unknown as SyncPayload;
    const responseFor = async (payload: SyncPayload) => {
      const snapshotId = await syncPayloadSnapshotId(payload, { stripReadModel: true });
      return new Response(JSON.stringify({ ...payload, resetEpoch: 0, rollover: false }), {
        status: 200,
        headers: {
          "X-Sync-Response": "complete",
          "X-Sync-Snapshot": snapshotId,
        },
      });
    };
    const fetchRecovery = vi.fn(async (url: string) => {
      const requestedDate = new URL(url, "https://factory.test").searchParams.get("today");
      return responseFor(requestedDate === today ? todayPayload : yesterdayPayload);
    });
    const adoptedDates: string[] = [];
    let recoveryPromise!: Promise<boolean>;
    const recover = () => {
      recoveryPromise = (async () => {
        const clientDate = todayStr();
        const request = createForegroundSyncTodayRequest("snapshot-a", clientDate);
        const response = await fetchRecovery(request.url);
        const recovery = await consumeForegroundRecoveryResponse({
          response,
          expectedDate: clientDate,
          requestedSnapshotId: "snapshot-a",
          isCurrent: () => true,
          adoptUnchanged: vi.fn(),
          adoptReset: vi.fn(() => false),
          adoptCanonical: (payload) => {
            coordinateForegroundAdoption({
              payload,
              prepareLifecycle: () => ({ value: payload.dayState, adopted: false }),
              persistLifecycle: vi.fn(),
              applyGeneralMerge: (canonicalPayload) => {
                adoptedDates.push(canonicalPayload.dayState.date);
              },
              reconcileProfiles: async () => ({}),
              applyProfiles: vi.fn(),
              fetchFactory: async () => ({}),
              applyFactory: vi.fn(),
              isCurrent: () => true,
            });
          },
        });
        return recovery.accepted;
      })();
      return recoveryPromise;
    };
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const scheduler = new VisibleTabScheduler();
    const registration = result.current.registerForegroundRecovery(scheduler, recover);

    try {
      scheduler.start();
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      vi.setSystemTime(new Date("2026-09-15T00:00:02Z"));
      await act(async () => {
        hidden = false;
        document.dispatchEvent(new Event("visibilitychange"));
        await recoveryPromise;
      });

      expect(fetchRecovery).toHaveBeenCalledWith(
        "/api/sync/today?today=2026-09-15&snapshot=snapshot-a",
      );
      expect(adoptedDates).toEqual([today]);
      expect(adoptedDates).not.toContain(yesterday);
      expect(homeSource).toContain("const clientDate = todayStr();");
      expect(homeSource).toContain("expectedDate: clientDate");
      expect(homeSource).toContain("localDate: clientDate");
    } finally {
      registration.dispose();
      scheduler.stop();
      unmount();
      hidden = false;
      vi.useRealTimers();
    }
  });

  it("coalesces overlapping wake signals into one pull, then allows a later wake", async () => {
    let activePulls = 0;
    let totalPulls = 0;
    let resolvePull!: (result: boolean) => void;
    const pull = vi.fn(() => {
      activePulls += 1;
      totalPulls += 1;
      return new Promise<boolean>((resolve) => {
        resolvePull = (result) => {
          activePulls -= 1;
          resolve(result);
        };
      });
    });
    const reconcile = createForegroundSyncWakeGuard(pull);
    const events = new EventTarget();
    const wake = () => void reconcile();
    events.addEventListener("focus", wake);
    events.addEventListener("visibilitychange", wake);
    events.addEventListener("online", wake);

    events.dispatchEvent(new Event("focus"));
    events.dispatchEvent(new Event("visibilitychange"));
    events.dispatchEvent(new Event("online"));

    expect(pull).toHaveBeenCalledTimes(1);
    expect(activePulls).toBe(1);
    resolvePull(true);
    await vi.waitFor(() => expect(activePulls).toBe(0));

    events.dispatchEvent(new Event("focus"));
    expect(pull).toHaveBeenCalledTimes(2);
    expect(activePulls).toBe(1);
    resolvePull(true);
    await vi.waitFor(() => expect(activePulls).toBe(0));
    expect(totalPulls).toBe(2);
  });

  it("retries a failed client-date pull after a later online wake", async () => {
    const pullClientDateRow = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const reconcile = createForegroundSyncWakeGuard(pullClientDateRow);
    const events = new EventTarget();
    let retryPromise: Promise<boolean> | undefined;
    events.addEventListener("online", () => {
      retryPromise = reconcile();
    });

    await expect(reconcile()).resolves.toBe(false);
    expect(pullClientDateRow).toHaveBeenCalledTimes(1);

    events.dispatchEvent(new Event("online"));

    expect(retryPromise).toBeDefined();
    await expect(retryPromise!).resolves.toBe(true);
    expect(pullClientDateRow).toHaveBeenCalledTimes(2);
  });

  it("retries every five seconds while visible and stops after canonical recovery", async () => {
    vi.useFakeTimers();
    let hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    const recover = vi.fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const scheduler = new VisibleTabScheduler();
    const registration = result.current.registerForegroundRecovery(scheduler, recover);
    try {
      scheduler.start();
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      expect(recover).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(recover).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(recover).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(recover).toHaveBeenCalledTimes(3);

      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(recover).toHaveBeenCalledTimes(3);
    } finally {
      registration.dispose();
      scheduler.stop();
      unmount();
      hidden = false;
      vi.useRealTimers();
    }
  });

  it("cleans up the visible retry timer when recovery registration is disposed", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    const recover = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const scheduler = new VisibleTabScheduler();
    const registration = result.current.registerForegroundRecovery(scheduler, recover);
    scheduler.start();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(recover).toHaveBeenCalledTimes(1);
    registration.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recover).toHaveBeenCalledTimes(1);
    scheduler.stop();
    unmount();
    vi.useRealTimers();
  });

  it("records successful wake recovery with its trigger and duration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const recover = vi.fn(async () => {
      vi.setSystemTime(1_250);
      return true;
    });
    const diagnostics = vi.fn();
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const scheduler = new VisibleTabScheduler();
    const registration = result.current.registerForegroundRecovery(scheduler, recover, diagnostics);
    scheduler.start();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(diagnostics).toHaveBeenCalledWith({
      attempts: 1,
      durationMs: 250,
      trigger: "online",
      outcome: "success",
    });
    registration.dispose();
    scheduler.stop();
    unmount();
    vi.useRealTimers();
  });

  it("records connectivity retries as one recovery episode", async () => {
    vi.useFakeTimers();
    const recover = vi.fn(async ({ classify }) => {
      if (recover.mock.calls.length === 1) {
        classify("connectivity-retry");
        return false;
      }
      return true;
    });
    const diagnostics = vi.fn();
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const scheduler = new VisibleTabScheduler();
    const registration = result.current.registerForegroundRecovery(scheduler, recover, diagnostics);
    scheduler.start();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      attempts: 2,
      trigger: "foreground",
      outcome: "success",
    }));
    registration.dispose();
    scheduler.stop();
    unmount();
    vi.useRealTimers();
  });

  it("records cancellation without treating it as a connectivity retry", async () => {
    const recover = vi.fn(async ({ classify }) => {
      classify("cancelled");
      return false;
    });
    const diagnostics = vi.fn();
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const scheduler = new VisibleTabScheduler();
    const registration = result.current.registerForegroundRecovery(scheduler, recover, diagnostics);

    await registration.reconcile();

    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      attempts: 1,
      trigger: "manual",
      outcome: "cancelled",
    }));
    registration.dispose();
    unmount();
  });

  it("records a non-retryable HTTP outcome without entering the retry cadence", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    const recover = vi.fn(async ({ classify }) => {
      classify("non-retryable-http");
      return false;
    });
    const diagnostics = vi.fn();
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const scheduler = new VisibleTabScheduler();
    const registration = result.current.registerForegroundRecovery(scheduler, recover, diagnostics);
    scheduler.start();

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(recover).toHaveBeenCalledTimes(1);
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      attempts: 1,
      trigger: "online",
      outcome: "non-retryable-http",
    }));
    registration.dispose();
    scheduler.stop();
    unmount();
    vi.useRealTimers();
  });

  it("records a background stop for an unfinished connectivity recovery", async () => {
    const recover = vi.fn(async ({ classify }) => {
      classify("connectivity-retry");
      return false;
    });
    const diagnostics = vi.fn();
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const scheduler = new VisibleTabScheduler();
    const registration = result.current.registerForegroundRecovery(scheduler, recover, diagnostics);

    await registration.reconcile();
    registration.dispose();

    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      attempts: 1,
      trigger: "manual",
      outcome: "background-stop",
    }));
    unmount();
  });

  it("retries once when online arrives while a client-date pull is failing", async () => {
    let rejectFirst!: (reason?: unknown) => void;
    let resolveSecond!: (result: boolean) => void;
    const pullClientDateRow = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((_resolve, reject) => {
        rejectFirst = reject;
      }))
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        resolveSecond = resolve;
      }));
    const reconcile = createForegroundSyncWakeGuard(pullClientDateRow);

    const first = reconcile();
    const overlappingWake = reconcile();
    expect(overlappingWake).toBe(first);
    expect(pullClientDateRow).toHaveBeenCalledTimes(1);

    rejectFirst(new Error("network failed"));
    // Flush the rejection handler and bounded retry directly instead of
    // polling; the full client suite may have fake timers active in another
    // test file, which makes vi.waitFor's timer-driven polling flaky here.
    await Promise.resolve();
    await Promise.resolve();
    expect(pullClientDateRow).toHaveBeenCalledTimes(2);

    const wakeDuringRetry = reconcile();
    expect(wakeDuringRetry).toBe(first);
    expect(pullClientDateRow).toHaveBeenCalledTimes(2);

    resolveSecond(true);
    await expect(first).resolves.toBe(true);
    await expect(overlappingWake).resolves.toBe(true);
    await expect(wakeDuringRetry).resolves.toBe(true);
    await vi.waitFor(() => expect(pullClientDateRow).toHaveBeenCalledTimes(2));
  });

  it("reconciles profile and factory domains only after the live row lands", async () => {
    const order: string[] = [];
    const result = coordinateForegroundAdoption({
      payload: { canonical: true },
      prepareLifecycle: () => ({ value: { lifecycle: "remote" }, adopted: false }),
      persistLifecycle: () => order.push("persist-lifecycle"),
      applyGeneralMerge: () => order.push("general-merge"),
      reconcileProfiles: async () => {
        order.push("fetch-profiles");
        return { changed: true };
      },
      applyProfiles: () => order.push("apply-profiles"),
      fetchFactory: async () => {
        order.push("fetch-factory");
        return { recipes: [] };
      },
      applyFactory: async () => {
        order.push("apply-factory");
        order.push("flush-factory-queue");
      },
      isCurrent: () => true,
    });

    expect(order).toEqual(["general-merge", "fetch-profiles"]);
    await result.masterDataRefresh;
    expect(order).toEqual([
      "general-merge",
      "fetch-profiles",
      "apply-profiles",
      "fetch-factory",
      "apply-factory",
      "flush-factory-queue",
    ]);
  });

  it("holds queued pushes until recovery releases its fence", () => {
    let fenced = true;
    let queued = true;
    const replay = vi.fn(() => expect(fenced).toBe(false));

    expect(replay).not.toHaveBeenCalled();
    releaseForegroundRecovery({
      releaseFence: () => { fenced = false; },
      acknowledgeRelease: vi.fn(),
      takeQueuedWrite: () => {
        const pending = queued;
        queued = false;
        return pending;
      },
      replayQueuedWrite: replay,
    });

    expect(fenced).toBe(false);
    expect(queued).toBe(false);
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("adopts canonical breaks before replaying a queued stale snapshot", () => {
    const canonicalBreaks = [
      { slot: 1, enabled: true, mode: "at-time", atTime: "08:15", durationMin: 30 },
      { slot: 2, enabled: false, mode: "after-run", durationMin: 30 },
      { slot: 3, enabled: true, mode: "after-run", runId: "run-2", durationMin: 30 },
    ];
    const staleBreaks = [
      { slot: 1, enabled: true, mode: "at-time", atTime: "06:00", durationMin: 5 },
      { slot: 2, enabled: true, mode: "after-run", runId: "run-1", durationMin: 90 },
    ];
    let localBreaks = staleBreaks;
    let queued = true;
    const order: string[] = [];
    const replay = vi.fn(() => {
      order.push("replay");
      expect(localBreaks).toEqual(canonicalBreaks);
    });

    releaseForegroundRecovery({
      releaseFence: () => {
        order.push("adopt-canonical");
        localBreaks = canonicalBreaks;
      },
      acknowledgeRelease: () => order.push("acknowledge"),
      takeQueuedWrite: () => {
        const pending = queued;
        queued = false;
        return pending;
      },
      replayQueuedWrite: replay,
    });

    expect(order).toEqual(["adopt-canonical", "acknowledge", "replay"]);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(localBreaks).toHaveLength(3);
    expect(localBreaks.every((breakSlot) => breakSlot.durationMin === 30)).toBe(true);
  });

  it("releases a cancelled completed recovery without replaying its queued write", () => {
    let fenced = true;
    let queued = true;
    const order: string[] = [];
    const replay = vi.fn();

    releaseCancelledForegroundRecovery({
      discardQueuedWrite: () => {
        order.push("discard");
        queued = false;
      },
      releaseFence: () => {
        order.push("release");
        fenced = false;
      },
    });

    expect(order).toEqual(["discard", "release"]);
    expect(fenced).toBe(false);
    expect(queued).toBe(false);
    expect(replay).not.toHaveBeenCalled();
  });

  it("keeps recovery fenced after a failed pull", () => {
    expect(homeSource).toContain("syncPushGenerationRef.current += 1");
    expect(homeSource).toContain("controller.abort()");
    expect(homeSource).toContain("generation !== syncPushGenerationRef.current");
    expect(recoveryResponseSource).toContain(
      "if (!response.ok) throw new Error(`foreground sync GET failed: ${response.status}`)",
    );
    expect(homeSource).toContain("reconciled = true");
    expect(homeSource).toContain("foregroundRecoveryNotice");
    expect(recoveryStatusSource).toContain("Retry recovery");
    expect(homeSource).toContain("tracking is paused");

    const catchBlock = homeSource.match(
      /catch(?:\s*\([^)]*\))? \{\s*classify\([\s\S]*?\/\/ Failed pulls are not successful reconciliation[\s\S]*?return false;\s*\}/,
    )?.[0] ?? "";
    expect(catchBlock).toContain("return false");
    expect(catchBlock).not.toContain("reconciled = true");
    expect(homeSource).toContain("releaseCancelledForegroundRecovery");
  });

  it("rejects malformed unchanged recovery responses and fences superseded responses", () => {
    expect(homeSource).toContain("consumeForegroundRecoveryResponse");
    expect(recoveryResponseSource).toContain("malformed unchanged response");
    expect(recoveryResponseSource).toContain("malformed canonical response");
    expect(homeSource).toContain("const isCurrentRecovery = ()");
    expect(recoveryResponseSource).toContain('reason: "obsolete"');
    expect(recoveryResponseSource).toContain("isUnchangedSyncResponse(body)");
    expect(syncManagerSource).toContain("foregroundRecoveryRequestRef");
  });

  it("prevents the first released clock tick from writing the hidden-time delta", () => {
    expect(hookSource).toContain("autoTrackBlocked");
    expect(hookSource).toContain("autoTrackBlockedRef?.current");
    expect(homeSource).toContain("setAutoTrackBlocked(true)");
    expect(homeSource).toContain("autoTrackBlockedRef={foregroundSyncBarrierRef}");
    expect(homeSource).toContain('setAutoTrackWakeRebaseReason("lifecycle-replacement")');
    expect(hookSource).toContain("rebaseAfterForegroundSync");
    expect(hookSource).toContain("lastExpectedCasesRef.current = autoTrackSuggestion?.expectedCasesRaw ?? -1");
    expect(hookSource).toContain("autoTrackBlockedRef?.current");
  });

  it("durably adopts a newer lifecycle before the general merge", () => {
    const order: string[] = [];
    const local = { lifecycle: "local" };
    const remote = { lifecycle: "remote" };
    let durable = local;

    const result = coordinateForegroundAdoption({
      payload: { lifecycle: remote.lifecycle },
      prepareLifecycle: () => {
        order.push("adopt-lifecycle");
        return { value: remote, adopted: true };
      },
      persistLifecycle: (value) => {
        order.push("persist-lifecycle");
        durable = value;
      },
      applyGeneralMerge: () => {
        order.push("general-merge");
        expect(durable).toBe(remote);
      },
      reconcileProfiles: async () => ({}),
      applyProfiles: vi.fn(),
      fetchFactory: async () => ({}),
      applyFactory: vi.fn(),
      isCurrent: () => true,
    });

    expect(result.lifecycleAdopted).toBe(true);
    expect(order.slice(0, 3)).toEqual([
      "adopt-lifecycle",
      "persist-lifecycle",
      "general-merge",
    ]);
  });
});