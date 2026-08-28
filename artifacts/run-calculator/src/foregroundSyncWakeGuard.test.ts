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

const HOME_FILE = path.join(__dirname, "pages", "home.tsx");
const HOOK_FILE = path.join(__dirname, "hooks", "useAutoTrack.ts");
const homeSource = fs.readFileSync(HOME_FILE, "utf8");
const hookSource = fs.readFileSync(HOOK_FILE, "utf8");

describe("foreground wake sync barrier", () => {
  it("pulls the date-scoped row through the established inbound merge before releasing auto-track", () => {
    expect(homeSource).toContain("createForegroundSyncWakeGuard");
    expect(homeSource).toContain("setAutoTrackBlocked(true)");
    expect(homeSource).toContain("`/api/sync/today?today=${todayStr()}`");
    expect(homeSource).toContain('cache: "no-store"');
    expect(homeSource).toContain("applySyncCallbackRef.current(payload)");
    expect(homeSource).toContain("setAutoTrackBlocked(false)");
    expect(homeSource).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(homeSource).toContain('window.addEventListener("focus", onFocus)');
    expect(homeSource).toContain('window.addEventListener("online", onOnline)');
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

  it("reconciles profile and factory domains only after the live row lands", () => {
    const liveApply = homeSource.indexOf("applySyncCallbackRef.current(payload)");
    const profiles = homeSource.indexOf("reconcileProfilesFromServerDetailed()", liveApply);
    const factory = homeSource.indexOf("fetchFactoryData()", profiles);
    expect(liveApply).toBeGreaterThan(-1);
    expect(profiles).toBeGreaterThan(liveApply);
    expect(factory).toBeGreaterThan(profiles);
    expect(homeSource).toContain("applyProfileReconcileRef.current(profileResult)");
    expect(homeSource).toContain("refreshFactoryDataConsumers()");
    expect(homeSource).toContain("await flushFactoryQueue()");
  });

  it("fences stale lifecycle taps until foreground adoption completes", () => {
    for (const name of ["startRun", "pauseRun", "resumeRun", "endRun"]) {
      const start = homeSource.indexOf(`function ${name}(`);
      expect(start, `${name} exists`).toBeGreaterThan(-1);
      expect(homeSource.slice(start, start + 700)).toContain("foregroundSyncBarrierRef.current");
    }
    expect(homeSource).toContain("foregroundStopIntentRef.current = { action: \"stop\", runId: activeRun.id }");
    expect(homeSource).toContain("resolveForegroundStopIntent(");
    expect(homeSource).toContain("No other run was stopped.");
  });

  it("holds queued pushes and keeps recovery fenced after a failed pull", () => {
    expect(homeSource).toContain("if (foregroundSyncBarrierRef.current)");
    expect(homeSource).toContain("foregroundPushPendingRef.current = true");
    expect(homeSource).toContain("syncPushGenerationRef.current += 1");
    expect(homeSource).toContain("controller.abort()");
    expect(homeSource).toContain("generation !== syncPushGenerationRef.current");
    expect(homeSource).toContain("if (!res.ok) throw new Error(`foreground sync GET failed: ${res.status}`)");
    expect(homeSource).toContain("reconciled = true");
    expect(homeSource).toContain("if (shouldPush)");
    expect(homeSource).toContain("foregroundRecoveryNotice");
    expect(homeSource).toContain("Retry recovery");
    expect(homeSource).toContain("tracking is paused");

    const catchBlock = homeSource.match(
      /catch \{\s*\/\/ Failed pulls are not successful reconciliation[\s\S]*?return false;\s*\}/,
    )?.[0] ?? "";
    expect(catchBlock).toContain("return false");
    expect(catchBlock).not.toContain("reconciled = true");
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

  it("durably adopts a newer lifecycle before releasing recovery work", () => {
    const resetGate = homeSource.indexOf("const acceptsRemoteLifecycle = shouldAcceptSyncDaySnapshot({");
    const adopt = homeSource.indexOf("adoptStrictlyNewerRemoteLifecycles(");
    const persist = homeSource.indexOf(
      "saveDayState(lifecycleAdoption.dayState, { stampMeta: false })",
      adopt,
    );
    const updateRef = homeSource.indexOf(
      "dayStateRef.current = lifecycleAdoption.dayState",
      persist,
    );
    const generalMerge = homeSource.indexOf("applySyncCallbackRef.current(payload)", updateRef);
    const release = homeSource.indexOf("foregroundSyncBarrierRef.current = false", generalMerge);
    expect(resetGate).toBeGreaterThan(-1);
    expect(adopt).toBeGreaterThan(resetGate);
    expect(persist).toBeGreaterThan(adopt);
    expect(updateRef).toBeGreaterThan(persist);
    expect(generalMerge).toBeGreaterThan(updateRef);
    expect(release).toBeGreaterThan(generalMerge);
  });
});