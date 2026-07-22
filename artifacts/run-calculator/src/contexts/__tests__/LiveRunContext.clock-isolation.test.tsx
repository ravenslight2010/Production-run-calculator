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
import { render, act, cleanup } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ReactNode } from "react";
import { type FormValues, DEFAULT_VALUES } from "../../types";
import { LiveRunProvider, useLiveRun } from "../../contexts/LiveRunContext";

// ── Stub hooks that are not under test ──────────────────────────────────────
// useNotifications uses browser Audio / Notification APIs unavailable in jsdom;
// useAutoTrack does form writes and localStorage that add noise. Both are
// correct in production — we mock them here only to keep this test focused on
// the render-isolation guarantee.

vi.mock("../../hooks/useNotifications", () => ({
  useNotifications: () => ({ showBatchDue: false, setShowBatchDue: vi.fn() }),
}));

vi.mock("../../hooks/useAutoTrack", () => ({
  useAutoTrack: () => ({
    autoTrackProgress: false,
    setAutoTrackProgress: vi.fn(),
    autoTrackSuggestion: null,
    autoSuppressUntilRef: { current: 0 },
    fireAutoTrackNow: vi.fn(),
    tickDueRefs: {
      case:      { current: 0 },
      tray:      { current: 0 },
      trayProd:  { current: 0 },
      batch:     { current: 0 },
      batchProd: { current: 0 },
    },
  }),
  suggestedDoughStaging: () => ({ trays: null, batches: null }),
}));

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
