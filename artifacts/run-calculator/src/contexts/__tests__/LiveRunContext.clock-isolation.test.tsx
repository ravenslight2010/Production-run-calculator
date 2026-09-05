// @vitest-environment jsdom
//
// Structural guarantee: components that do NOT call useLiveRun() must not
// re-render when the LiveRunContext clock ticks. This prevents the per-second
// clock from leaking render work into non-live tabs (Setup, Inventory, Manage,
// Mixes, Warehouse, AI, etc.) via the context. The refactor that isolated
// nowTime inside LiveRunProvider is verified here so it cannot silently
// regress.
//
// Two tests:
//  1. "non-live child" — does NOT subscribe → render count stays at 1.
//  2. "live child"     — DOES subscribe     → render count increments (counter-
//                        proof that the clock is actually ticking and the
//                        isolation test above is meaningful).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { useState, type ReactNode } from "react";
import { type FormValues, DEFAULT_VALUES } from "../../types";
import { LiveRunProvider, useLiveRun } from "../../contexts/LiveRunContext";
import { useNotifications } from "../../hooks/useNotifications";
import { useAutoTrack } from "../../hooks/useAutoTrack";
import { mockAutoTrackState } from "../../hooks/__mocks__/useAutoTrack";
// ── Stub hooks that are not under test ──────────────────────────────────────
// useNotifications uses browser Audio / Notification APIs unavailable in jsdom;
// useAutoTrack does form writes and localStorage that add noise. Both are
// correct in production — we mock them here only to keep this test focused on
// the render-isolation guarantee.
//
// The closure-level stability guarantee (all refs/fns allocated once at module
// scope, never inline) is enforced STRUCTURALLY by the shared manual mocks in:
//   src/hooks/__mocks__/useAutoTrack.ts
//   src/hooks/__mocks__/useNotifications.ts
// Vitest resolves those files automatically from the no-factory vi.mock() calls
// below.  See those files for the full explanation of why inline vi.fn() inside
// a vi.mock factory silently defeats the liveSlice useMemo in LiveRunProvider.
//
// The describe block at the bottom of this file verifies the contract with
// reference-identity assertions so a drift in the shared mocks is caught immediately.

vi.mock("../../hooks/useNotifications");
vi.mock("../../hooks/useAutoTrack");

// ── Minimal provider wrapper ─────────────────────────────────────────────────
// Uses real useClock (controlled via vi.useFakeTimers) so the clock tick is
// genuine. Only the two heavy side-effect hooks are stubbed above.
function TestProviderWrapper({ children }: { children: ReactNode }) {
  const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES });
  return (
    <LiveRunProvider
      v={DEFAULT_VALUES}
      ve={DEFAULT_VALUES}
      runStatus="running"
      currentRun={undefined}
      currentRunId="test-run-1"
      form={form}
      dayState={{ runs: [], currentIndex: 0 }}
      doughSubTab="dough"
      upcomingRunLabels={[]}
      prefs={undefined}
      screenMode={null}
      machine={{ spinSec: 0, hopperSec: 0 }}
    >
      {children}
    </LiveRunProvider>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("LiveRunProvider — clock isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    mockAutoTrackState.enabled = false;
    vi.useRealTimers();
    cleanup();
  });

  it("a component that does NOT call useLiveRun() is not re-rendered when the clock ticks", async () => {
    let renderCount = 0;

    // This component mimics a non-live tab (Setup, Inventory, Manage, etc.)
    // that lives inside LiveRunProvider's children but never subscribes to
    // the clock context.
    function NonLiveChild() {
      renderCount++;
      return null;
    }

    render(
      <TestProviderWrapper>
        <NonLiveChild />
      </TestProviderWrapper>,
    );

    // One render on mount.
    expect(renderCount).toBe(1);

    // Advance by 1.1 s — useClock fires its 1-second interval and calls
    // setNowTime(), causing LiveRunProvider to re-render with a fresh context
    // value (nowTime, calc, etc. all update).
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });

    // NonLiveChild did NOT subscribe to LiveRunContext, so it must NOT have
    // re-rendered. Any regression that leaks nowTime into a parent component
    // (e.g. adding useLiveRun() to a wrapper, or including nowTime in the
    // HomeCtx value) will break this assertion and surface the regression
    // immediately.
    expect(renderCount).toBe(1);
  });

  it("keeps speed feedback alive when the active live tab changes", async () => {
    const activeValues: FormValues = {
      ...DEFAULT_VALUES,
      crustsPerCycle: 10,
      cycleSpeed: 1,
      pizzasPerCase: 10,
      casesPerSkid: 100,
    };
    mockAutoTrackState.enabled = true;

    function SpeedFeedbackProbe() {
      const {
        detectPackagingSpeedDrift,
        speedNudge,
        speedNudgeStatus,
      } = useLiveRun();
      return (
        <button
          type="button"
          data-testid="speed-feedback-probe"
          data-status={speedNudgeStatus ? "pending-feedback" : "no-feedback"}
          data-has-nudge={speedNudge ? "yes" : "no"}
          onClick={() => detectPackagingSpeedDrift(5)}
        />
      );
    }

    function SpeedFeedbackTabs() {
      const [tab, setTab] = useState<"packaging" | "sauce">("packaging");
      return (
        <>
          <button type="button" onClick={() => setTab("sauce")}>Sauce</button>
          <span data-testid="active-speed-tab">{tab}</span>
          <SpeedFeedbackProbe />
        </>
      );
    }

    const currentRun = { id: "speed-run", startedAt: 1_700_000_000_000 } as any;
    function SpeedFeedbackProvider({ children }: { children: ReactNode }) {
      const form = useForm<FormValues>({ defaultValues: activeValues });
      return (
        <LiveRunProvider
          v={activeValues}
          ve={activeValues}
          runStatus="running"
          currentRun={currentRun}
          currentRunId={currentRun.id}
          form={form}
          dayState={{ runs: [], currentIndex: 0 }}
          doughSubTab="dough"
          upcomingRunLabels={[]}
          prefs={undefined}
          screenMode={null}
          machine={{ spinSec: 0, hopperSec: 0 }}
        >
          {children}
        </LiveRunProvider>
      );
    }

    render(
      <SpeedFeedbackProvider>
        <SpeedFeedbackTabs />
      </SpeedFeedbackProvider>,
    );

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    fireEvent.click(screen.getByTestId("speed-feedback-probe"));
    expect(screen.getByTestId("speed-feedback-probe").getAttribute("data-has-nudge")).toBe("yes");

    fireEvent.click(screen.getByText("Sauce"));
    expect(screen.getByTestId("active-speed-tab").textContent).toBe("sauce");
    expect(screen.getByTestId("speed-feedback-probe").getAttribute("data-has-nudge")).toBe("yes");
  });

  it("uses adjusted dough PPM but keeps crust PPM independent of the dough multiplier", () => {
    const doughValues: FormValues = {
      ...DEFAULT_VALUES,
      crustsPerCycle: 10,
      cycleSpeed: 8,
      speedAdjustment: 0.5,
      doughBatchYield: 100,
      doughballsPerTray: 50,
      pizzasPerCase: 10,
    };
    const crustValues: FormValues = {
      ...doughValues,
      approxLineSpeed: 40,
      speedAdjustment: 1.5,
      crustsPerCase: 10,
    };
    let observed: { ppm: number; batchSec: number } | null = null;

    function Probe() {
      const { calc } = useLiveRun();
      observed = { ppm: calc.ppm, batchSec: calc.timePerBatchSec };
      return null;
    }

    function Provider({
      values,
      mode,
    }: {
      values: FormValues;
      mode: "dough" | "crusts";
    }) {
      const form = useForm<FormValues>({ defaultValues: values });
      return (
        <LiveRunProvider
          v={values}
          ve={values}
          runStatus="running"
          currentRun={undefined}
          currentRunId="speed-basis-run"
          form={form}
          dayState={{ runs: [], currentIndex: 0 }}
          doughSubTab={mode}
          upcomingRunLabels={[]}
          prefs={undefined}
          screenMode={null}
          machine={{ spinSec: 45, hopperSec: 20 }}
        >
          <Probe />
        </LiveRunProvider>
      );
    }

    const { rerender } = render(<Provider values={doughValues} mode="dough" />);
    expect(observed).toEqual({ ppm: 40, batchSec: 150 });

    rerender(<Provider values={crustValues} mode="crusts" />);
    expect(observed).toEqual({ ppm: 40, batchSec: 15 });
  });

  it("a component that DOES call useLiveRun() IS re-rendered when the clock ticks (counter-proof)", async () => {
    let renderCount = 0;

    // This component mimics a live tab (LiveRunTabContent, LiveDoughTabContent,
    // etc.) that subscribes to the clock via useLiveRun().
    function LiveChild() {
      useLiveRun(); // subscribes to LiveRunContext
      renderCount++;
      return null;
    }

    render(
      <TestProviderWrapper>
        <LiveChild />
      </TestProviderWrapper>,
    );

    const countAfterMount = renderCount;

    await act(async () => {
      vi.advanceTimersByTime(1100);
    });

    // The subscriber MUST have re-rendered — this confirms the clock actually
    // ticked and makes the isolation test above meaningful (it is not passing
    // vacuously because the clock was silent).
    expect(renderCount).toBeGreaterThan(countAfterMount);
  });
});

// ── Mock reference stability ──────────────────────────────────────────────────
//
// LiveRunContext clock-isolation — Mock stability: useAutoTrack and
//   useNotifications return the SAME object/function references on every call
// ═══════════════════════════════════════════════════════════════════════════════
//
// LiveRunProvider builds its `value` with a useMemo whose deps include the
// individual fields returned by useAutoTrack() and useNotifications().  If any
// field is an inline literal (vi.fn() or { current: 0 } written inside the
// factory's return body) a NEW reference is produced on every hook call, the
// useMemo fires on every render, and FloorModeView's memo() isolation is
// silently defeated.
//
// These tests call each mock hook TWICE and assert that every returned
// object/function field is the exact same reference (===) across both calls.
// If a future developer moves a closure-level constant inline, the reference
// changes and the relevant assertion fails here — catching the regression
// before it silently freezes the live-tab display.
//
// See the STABILITY CONTRACT comment block above the vi.mock factories for the
// full explanation of WHY closure-level refs are mandatory.
// ═══════════════════════════════════════════════════════════════════════════════

describe("LiveRunProvider clock-isolation — mock stability: useAutoTrack and useNotifications return stable references across calls", () => {
  it("useNotifications: setShowBatchDue is the same function reference on every call", () => {
    const call1 = useNotifications();
    const call2 = useNotifications();
    // If setShowBatchDue were defined inline (`vi.fn()` inside the return body),
    // call1.setShowBatchDue !== call2.setShowBatchDue and this would fail.
    expect(call1.setShowBatchDue).toBe(call2.setShowBatchDue);
  });

  it("useNotifications: the returned object is structurally consistent across calls", () => {
    const call1 = useNotifications();
    const call2 = useNotifications();
    expect(call1.showBatchDue).toBe(call2.showBatchDue);
  });

  it("useAutoTrack: all function references are stable across calls", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    // Each of these would fail if the corresponding constant were moved inline.
    expect(call1.setAutoTrackProgress).toBe(call2.setAutoTrackProgress);
    expect(call1.fireAutoTrackNow).toBe(call2.fireAutoTrackNow);
  });

  it("useAutoTrack: autoSuppressUntilRef is the same object reference across calls", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    // autoSuppressUntilRef is used as a useMemo dep inside LiveRunProvider.
    // An inline `{ current: 0 }` would produce a new object each call and
    // defeat the memo — this assertion catches that regression.
    expect(call1.autoSuppressUntilRef).toBe(call2.autoSuppressUntilRef);
  });

  it("useAutoTrack: tickDueRefs is the same object reference across calls", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    // tickDueRefs is also used as a useMemo dep.  An inline object literal
    // would produce a new ref per call; this test catches that drift.
    expect(call1.tickDueRefs).toBe(call2.tickDueRefs);
  });

  it("useAutoTrack: each tickDueRef slot is the same object reference across calls", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    const slots = ["case", "tray", "trayProd", "batch", "batchProd"] as const;
    for (const slot of slots) {
      expect(call1.tickDueRefs[slot]).toBe(call2.tickDueRefs[slot]);
    }
  });

  it("useAutoTrack: non-ref fields are value-stable across calls", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    expect(call1.autoTrackProgress).toBe(call2.autoTrackProgress);
    expect(call1.autoTrackSuggestion).toBe(call2.autoTrackSuggestion);
  });
});
