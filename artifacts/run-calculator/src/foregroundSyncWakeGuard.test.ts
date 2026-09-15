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
import { describe, expect, it, vi } from "vitest";
import { createForegroundSyncWakeGuard } from "./foregroundSyncWakeGuard";
import {
  coordinateForegroundAdoption,
  releaseForegroundRecovery,
} from "./hooks/useHomeSyncCoordination";

const HOME_FILE = path.join(__dirname, "pages", "home.tsx");
const SYNC_MANAGER_FILE = path.join(__dirname, "hooks", "useHomeSyncCoordination.ts");
const HOOK_FILE = path.join(__dirname, "hooks", "useAutoTrack.ts");
const SCHEDULER_FILE = path.join(__dirname, "visibleTabScheduler.ts");
const RECOVERY_STATUS_FILE = path.join(__dirname, "components", "ForegroundRecoveryStatus.tsx");
const RECOVERY_RESPONSE_FILE = path.join(__dirname, "foregroundRecoveryResponse.ts");
const homeSource = fs.readFileSync(HOME_FILE, "utf8");
const syncManagerSource = fs.readFileSync(SYNC_MANAGER_FILE, "utf8");
const hookSource = fs.readFileSync(HOOK_FILE, "utf8");
const schedulerSource = fs.readFileSync(SCHEDULER_FILE, "utf8");
const recoveryStatusSource = fs.readFileSync(RECOVERY_STATUS_FILE, "utf8");
const recoveryResponseSource = fs.readFileSync(RECOVERY_RESPONSE_FILE, "utf8");

describe("foreground wake sync barrier", () => {
  it("pulls the date-scoped row through the established inbound merge", () => {
    expect(syncManagerSource).toContain("createForegroundSyncWakeGuard");
    expect(homeSource).toContain("setAutoTrackBlocked(true)");
    expect(homeSource).toContain("`/api/sync/today?today=${todayStr()}`");
    expect(homeSource).toContain('cache: "no-store"');
    expect(homeSource).toContain("applySyncCallbackRef.current(payload)");
    expect(syncManagerSource).toContain('id: "foreground-reconcile"');
    expect(schedulerSource).toContain('document.addEventListener("visibilitychange", this.onVisibility)');
    expect(schedulerSource).toContain('window.addEventListener("focus", this.onFocus)');
    expect(syncManagerSource).toContain('window.addEventListener("online", onOnline)');
    expect(homeSource).toContain("registerForegroundRecovery(visibleTabScheduler");
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
      /catch \{\s*\/\/ Failed pulls are not successful reconciliation[\s\S]*?return false;\s*\}/,
    )?.[0] ?? "";
    expect(catchBlock).toContain("return false");
    expect(catchBlock).not.toContain("reconciled = true");
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
    expect(homeSource).toContain("setAutoTrackRebaseAfterBlock(true)");
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