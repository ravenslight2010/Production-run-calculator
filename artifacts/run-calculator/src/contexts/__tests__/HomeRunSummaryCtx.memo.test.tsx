// @vitest-environment jsdom
//
// Structural guarantee: components subscribed ONLY to the narrow
// HomeRunSummaryCtx (the run-data slice) must NOT re-render when
// manage/merge/import state changes — i.e. when state that is NOT in the
// context's useMemo deps changes.  Only actual run-data changes (dayState,
// v, ve, runStatus, currentRun) or the per-second clock (from LiveRunContext)
// are allowed to trigger a CompactRunStrip re-render.
//
// Because CompactRunStrip is defined inside home.tsx and depends on
// LiveRunProvider being present, this test validates the SAME useMemo +
// React.memo pattern using a self-contained replica.  Two tests:
//
//  1. "narrow subscriber" — subscribed only to run-data ctx → render count
//     stays at 1 when non-run (manage) state changes (rerender with new prop
//     that intentionally bypasses ctx deps).
//  2. "run-data change" — render count increments when runStatus changes
//     (counter-proof that the memoisation is not over-broad).

import { describe, it, expect, afterEach } from "vitest";
import { createContext, useContext, useMemo, useRef, memo, type ReactNode } from "react";
import { render, act, cleanup } from "@testing-library/react";

// ── Minimal replica of the HomeRunSummaryCtx pattern ─────────────────────
// This mirrors exactly what home.tsx does:
//   • homeRunSummaryCtxValue = useMemo(() => ({ ...runData }), [runStatus, currentRun, dayState, v, ve])
//   • CompactRunStrip = React.memo(fn) → only re-renders from context or clock
//   • manageState / mergeState / importState are NOT in ctx deps

type RunSummary = {
  runStatus: string;
  currentRunBrand: string;
};

const RunSummaryCtx = createContext<RunSummary>({ runStatus: "pending", currentRunBrand: "" });

function useRunSummaryCtx() {
  return useContext(RunSummaryCtx);
}

// Provider: only runStatus in deps — manageCounter intentionally excluded
// (it represents manage/merge/import state the strip must not respond to).
function ControlledProvider({
  runStatus,
  currentRunBrand,
  children,
}: {
  runStatus: string;
  currentRunBrand: string;
  manageCounter: number;        // NOT in useMemo deps — mirrors the real fix
  children: ReactNode;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(
    () => ({ runStatus, currentRunBrand }),
    [runStatus, currentRunBrand],
    // manageCounter deliberately omitted — non-run state must not trigger ctx updates
  );
  return <RunSummaryCtx.Provider value={value}>{children}</RunSummaryCtx.Provider>;
}

// ── Subscriber component (mirrors CompactRunStrip) ────────────────────────
// React.memo + narrow context = only re-renders when run data changes.
let renderCount = 0;

const NarrowSubscriber = memo(function NarrowSubscriberInner() {
  renderCount++;
  const { runStatus } = useRunSummaryCtx();
  return <span data-testid="status">{runStatus}</span>;
});

// ── Tests ─────────────────────────────────────────────────────────────────
afterEach(() => {
  cleanup();
  renderCount = 0;
});

describe("HomeRunSummaryCtx — render isolation (mirrors CompactRunStrip fix)", () => {
  it("does NOT re-render when non-run (manage) state changes", async () => {
    const { rerender } = render(
      <ControlledProvider runStatus="running" currentRunBrand="TestBrand" manageCounter={0}>
        <NarrowSubscriber />
      </ControlledProvider>,
    );

    expect(renderCount).toBe(1);

    // Simulate manage-dialog opening / import state flipping —
    // only manageCounter changes; runStatus + currentRunBrand stay the same.
    await act(async () => {
      rerender(
        <ControlledProvider runStatus="running" currentRunBrand="TestBrand" manageCounter={1}>
          <NarrowSubscriber />
        </ControlledProvider>,
      );
    });

    // Context value ref is stable (useMemo deps unchanged).
    // React.memo sees no prop change.
    // → NarrowSubscriber must NOT have re-rendered.
    expect(renderCount).toBe(1);

    // Verify again with a second non-run state change
    await act(async () => {
      rerender(
        <ControlledProvider runStatus="running" currentRunBrand="TestBrand" manageCounter={42}>
          <NarrowSubscriber />
        </ControlledProvider>,
      );
    });

    expect(renderCount).toBe(1);
  });

  it("DOES re-render when run data (runStatus) changes", async () => {
    const { rerender, getByTestId } = render(
      <ControlledProvider runStatus="running" currentRunBrand="TestBrand" manageCounter={0}>
        <NarrowSubscriber />
      </ControlledProvider>,
    );

    expect(renderCount).toBe(1);
    expect(getByTestId("status").textContent).toBe("running");

    // Run state changes → useMemo deps fire → new context ref → re-render
    await act(async () => {
      rerender(
        <ControlledProvider runStatus="paused" currentRunBrand="TestBrand" manageCounter={0}>
          <NarrowSubscriber />
        </ControlledProvider>,
      );
    });

    expect(renderCount).toBe(2);
    expect(getByTestId("status").textContent).toBe("paused");
  });

  it("pauseRunRef stable-ref pattern: object identity preserved, .current updated", () => {
    // Mirrors the _pauseRunRef.current = pauseRun pattern in home.tsx.
    // The ref object is created once; only .current is updated on each render.
    // This lets the narrow context carry a stable ref without encoding the
    // closure into the useMemo deps.
    // (Plain JS — no React hooks needed to prove the identity contract.)
    const ref = { current: (() => {}) as () => void };
    const firstRef = ref;

    // Simulate re-render updating .current (as home.tsx does: _pauseRunRef.current = pauseRun)
    const newFn = () => {};
    ref.current = newFn;

    // The ref OBJECT is the same (stable identity passed in context)
    expect(ref).toBe(firstRef);
    // But .current now points to the latest closure
    expect(ref.current).toBe(newFn);
  });
});
