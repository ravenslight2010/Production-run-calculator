import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DayState, FormValues, RunMeta } from "../types";
import { useRunLifecycleManager } from "./useRunLifecycleManager";

const values = { casesNeeded: 100, casesPerSkid: 10, skidsCompleted: 0, casesOnCurrentSkid: 0, batchesReady: 0 } as FormValues;
const run = (id: string, extra: Partial<RunMeta> = {}) => ({ id, brand: "Brand", flavor: "Flavor", ...extra }) as RunMeta;
const day = (runs: RunMeta[], currentIndex = 0) => ({ date: "2026-01-01", runs, currentIndex }) as DayState;

function setup(state: DayState) {
  const formValues = { ...values };
  const form = {
    getValues: vi.fn((key?: keyof FormValues) => key ? formValues[key] : formValues),
    setValue: vi.fn((key: keyof FormValues, value: never) => { formValues[key] = value; }),
    reset: vi.fn(),
  } as never;
  const dayStateRef = { current: state };
  const spies = {
    queue: vi.fn(), save: vi.fn(), push: vi.fn(), resetArrays: vi.fn(),
    overlay: vi.fn((runs: RunMeta[]) => runs),
    inventory: vi.fn(() => [{ itemKey: "flour", qty: 3 }]),
    foregroundNotice: vi.fn(), syncEvent: vi.fn(),
  };
  const deps = {
    dayStateRef, setDayState: vi.fn(), saveDayState: spies.save, form,
    lastFormRunIdRef: { current: "" }, currentRun: state.runs[state.currentIndex],
    currentRunId: state.runs[state.currentIndex]?.id ?? "", flushFormWrites: vi.fn(),
    loadRunValues: vi.fn(() => ({ ...values })), saveRunValues: vi.fn(), markRunValuesUpdated: vi.fn(),
    canManageProfiles: false, saveProfile: vi.fn(() => false), propagateProfileToPendingRuns: vi.fn(async () => {}),
    resetFieldArrays: spies.resetArrays, setDoughSubTab: vi.fn(), setActiveStopId: vi.fn(), setConfirmDeleteStopId: vi.fn(), setActiveTab: vi.fn(),
    foregroundSyncBarrierRef: { current: false }, formHandoffRef: { current: false }, foregroundStopIntentRef: { current: null as { action: "stop"; runId: string } | null },
    setPendingForegroundStopRunId: vi.fn(), showForegroundRecoveryNotice: spies.foregroundNotice, recordSyncEvent: spies.syncEvent,
    queueOperationalIntent: spies.queue, flushOperationalIntentOutbox: vi.fn(async () => {}), browserIsOnline: vi.fn(() => true),
    capturePreEndLifecycle: vi.fn((x: RunMeta) => ({ startedAt: x.startedAt })), computeRunConsumptionLines: spies.inventory,
    effectiveValuesForRun: vi.fn((_run: RunMeta, x: FormValues) => x), overlayRunMetaStamps: spies.overlay,
    isolatePendingRunPackagingProgress: vi.fn((_run: RunMeta, x: FormValues) => x), recordManualPackagingProgress: vi.fn(), persistManualPackagingProgress: vi.fn(),
    calcTotalTimeSec: vi.fn(() => 0), initialFinishTimestampRef: { current: 0 },
    summarizeCarriedInCases: vi.fn(() => 0), startRunAndQueueCompetingCompletions: vi.fn(({ runs }) => ({ runs, autoEnded: [] })),
    todayStr: vi.fn(() => "2026-01-01"), reportRunInsightsAfterFinalize: vi.fn(async () => {}), getRunInsightsSignal: vi.fn(() => new AbortController().signal),
    genId: vi.fn(() => "pause-1"), applyResumeToRun: vi.fn((x: RunMeta) => ({ ...x, pausedAt: undefined })),
    canChoosePauseTunnelPolicy: vi.fn(() => true), pauseDecisionRemainingMs: vi.fn(() => 10_000), shouldClosePauseDecision: vi.fn(() => false),
    schedulePush: spies.push,
  };
  return { deps, spies, form };
}

describe("useRunLifecycleManager", () => {
  it("does not mutate when a foreground barrier blocks Start", () => {
    const { deps, spies } = setup(day([run("a")]));
    deps.foregroundSyncBarrierRef.current = true;
    const { result } = renderHook(() => useRunLifecycleManager(deps));
    act(() => result.current.startRun());
    expect(spies.queue).not.toHaveBeenCalled();
    expect(spies.save).not.toHaveBeenCalled();
  });

  it("blocks every lifecycle command while form ownership is handing off", () => {
    const { deps, spies } = setup(day([run("a", { startedAt: 10, pausedAt: 20 })]));
    deps.formHandoffRef.current = true;
    const { result } = renderHook(() => useRunLifecycleManager(deps));
    act(() => {
      result.current.switchToRun(0);
      result.current.startRun();
      result.current.pauseRun();
      result.current.setPauseTunnelPolicy(false);
      result.current.resumeRun();
      result.current.endRun(undefined, true);
    });
    expect(spies.queue).not.toHaveBeenCalled();
    expect(spies.save).not.toHaveBeenCalled();
  });

  it("attributes a switched form only to its settled form owner", () => {
    const { deps } = setup(day([run("day-current"), run("form-owner")]));
    deps.lastFormRunIdRef.current = "form-owner";
    const { result } = renderHook(() => useRunLifecycleManager(deps));
    act(() => result.current.switchToRun(0));
    expect(deps.saveRunValues).toHaveBeenCalledWith("form-owner", expect.anything());
    expect(deps.saveRunValues).not.toHaveBeenCalledWith("day-current", expect.anything());
  });

  it("uses overlay generations for Start, Pause, Resume, and competing End", () => {
    const { deps, spies } = setup(day([
      run("a", { startedAt: 10 }), run("b", { startedAt: 20 }),
    ]));
    deps.overlayRunMetaStamps.mockReturnValue([
      run("a", { startedAt: 10, metaUpdatedAt: 101 }),
      run("b", { startedAt: 20, metaUpdatedAt: 202 }),
    ]);
    const { result, rerender } = renderHook(() => useRunLifecycleManager(deps));
    act(() => result.current.startRun());
    expect(spies.queue).toHaveBeenCalledWith(expect.objectContaining({ runId: "a", lifecycle: "start", observedGeneration: "a:101" }));
    expect(spies.queue).toHaveBeenCalledWith(expect.objectContaining({ runId: "b", lifecycle: "end", observedGeneration: "b:202" }));
    deps.dayStateRef.current = day([run("a", { startedAt: 10 })]);
    deps.currentRun = deps.dayStateRef.current.runs[0];
    rerender();
    act(() => result.current.pauseRun());
    expect(spies.queue).toHaveBeenCalledWith(expect.objectContaining({ action: "pause", observedGeneration: "a:101" }));
    deps.dayStateRef.current = day([run("a", { startedAt: 10, pausedAt: 30 })]);
    deps.currentRun = deps.dayStateRef.current.runs[0];
    rerender();
    act(() => result.current.resumeRun());
    expect(spies.queue).toHaveBeenCalledWith(expect.objectContaining({ action: "resume", observedGeneration: "a:101" }));
  });

  it("keeps action identities stable while observing latest dependencies", () => {
    const { deps } = setup(day([run("a")]));
    const { result, rerender } = renderHook(() => useRunLifecycleManager(deps));
    const first = result.current.startRun;
    deps.foregroundSyncBarrierRef.current = true;
    rerender();
    expect(result.current.startRun).toBe(first);
    act(() => result.current.startRun());
    expect(deps.queueOperationalIntent).not.toHaveBeenCalled();
  });

  it("reads the current insights controller signal when finalization launches", () => {
    const { deps } = setup(day([run("a"), run("b", { startedAt: 20 })]));
    const controllers = { current: new AbortController() };
    deps.getRunInsightsSignal = vi.fn(() => controllers.current.signal);
    deps.startRunAndQueueCompetingCompletions.mockImplementation(({ runs }) => ({
      runs,
      autoEnded: [run("b", { startedAt: 20, endedAt: 30 })],
    }));
    const { result, rerender } = renderHook(() => useRunLifecycleManager(deps));
    const initial = controllers.current;
    initial.abort();
    controllers.current = new AbortController();
    act(() => result.current.startRun());
    expect(deps.reportRunInsightsAfterFinalize.mock.calls[0][2]).toBe(controllers.current.signal);

    controllers.current.abort();
    controllers.current = new AbortController();
    deps.dayStateRef.current = day([run("a", { startedAt: 10 })]);
    deps.currentRun = deps.dayStateRef.current.runs[0];
    rerender();
    act(() => result.current.endRun());
    expect(deps.reportRunInsightsAfterFinalize.mock.calls.at(-1)?.[2]).toBe(controllers.current.signal);
  });

  it("persists conservative pause tunnel policy before prompt and push", () => {
    const { deps, spies } = setup(day([run("a", { startedAt: 10 })]));
    const { result } = renderHook(() => useRunLifecycleManager(deps));
    act(() => result.current.pauseRun());
    expect(deps.dayStateRef.current.runs[0].stoppages?.[0]).toMatchObject({ type: "pause", stopTunnel: true });
    expect(spies.save).toHaveBeenCalledBefore(spies.push);
  });

  it("applies resume adapter then persists and pushes", () => {
    const { deps, spies } = setup(day([run("a", { startedAt: 10, pausedAt: 20 })]));
    const { result } = renderHook(() => useRunLifecycleManager(deps));
    act(() => result.current.resumeRun());
    expect(deps.applyResumeToRun).toHaveBeenCalled();
    expect(deps.dayStateRef.current.runs[0].pausedAt).toBeUndefined();
    expect(spies.save).toHaveBeenCalledBefore(spies.push);
  });

  it("ends with overlay stamp, frozen inventory, and next-run reset", () => {
    const { deps, spies, form } = setup(day([run("a", { startedAt: 10 }), run("b")]));
    deps.overlayRunMetaStamps.mockReturnValue([run("a", { startedAt: 10, metaUpdatedAt: 77 })]);
    const { result } = renderHook(() => useRunLifecycleManager(deps));
    act(() => result.current.endRun());
    expect(spies.overlay).toHaveBeenCalled();
    expect(spies.queue).toHaveBeenCalledWith(expect.objectContaining({
      lifecycle: "end", observedGeneration: "a:77", inventoryLines: [{ itemKey: "flour", qty: 3 }],
    }));
    expect(deps.lastFormRunIdRef.current).toBe("b");
    expect(form.reset).toHaveBeenCalled();
  });

  it("queues foreground End without mutating the run", () => {
    const { deps, spies } = setup(day([run("a", { startedAt: 10 })]));
    deps.foregroundSyncBarrierRef.current = true;
    const { result } = renderHook(() => useRunLifecycleManager(deps));
    act(() => result.current.endRun());
    expect(deps.foregroundStopIntentRef.current).toEqual({ action: "stop", runId: "a" });
    expect(deps.dayStateRef.current.runs[0].endedAt).toBeUndefined();
    expect(spies.queue).not.toHaveBeenCalled();
  });
});