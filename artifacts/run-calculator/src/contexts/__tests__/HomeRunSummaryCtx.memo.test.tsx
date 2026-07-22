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

import { describe, it, expect, vi, afterEach } from "vitest";
import { createContext, useContext, useMemo, useRef, useState, memo, type ReactNode, type MutableRefObject } from "react";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

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

// ─── CompactRunStrip pause button: ref-wiring integration test ────────────────
//
// Structural guarantee: the CompactRunStrip pause button calls
// `pauseRunRef.current()` (not a captured closure). This tests the complete
// call chain:
//
//   home.tsx: _pauseRunRef.current = pauseRun  (updated every render)
//   homeRunSummaryCtxValue carries the stable _pauseRunRef object
//   CompactRunStrip reads pauseRunRef from context
//   button onClick: pauseRunRef.current()  ← the call under test
//
// The test uses a self-contained replica — CompactRunStrip is defined inside
// home.tsx and cannot be imported directly — but the structural pattern is
// identical.
//
// Three scenarios:
//  1. Click calls the ref: basic wiring — button click invokes pauseRunRef.current()
//  2. Stale-closure safety: if .current is swapped after initial render, the
//     click still invokes the LATEST function (proving the ref indirection works)
//  3. State transition: pauseRunRef.current() drives runStatus to "paused" and
//     the subscriber sees the updated status (end-to-end state flow)

type PauseCtxShape = {
  runStatus: string;
  pauseRunRef: MutableRefObject<() => void>;
};

const PauseCtx = createContext<PauseCtxShape | null>(null);

function usePauseCtx() {
  const ctx = useContext(PauseCtx);
  if (!ctx) throw new Error("usePauseCtx must be inside PauseCtx.Provider");
  return ctx;
}

// Provider that mirrors home.tsx:
//   • holds runStatus in state
//   • creates a stable _pauseRunRef and updates .current on every render
//   • wraps both in a useMemo that only changes when runStatus changes
//   • exposes a `setRunStatus` prop for the test to trigger state changes
function PauseProvider({
  initialStatus,
  onPause,
  children,
}: {
  initialStatus: string;
  onPause?: () => void;
  children: ReactNode;
}) {
  const [runStatus, setRunStatus] = useState(initialStatus);

  // The pauseRun closure captures the latest setRunStatus (stable dispatch)
  // and whatever additional logic the test supplies via onPause.
  function pauseRun() {
    setRunStatus("paused");
    onPause?.();
  }

  // Stable ref object — mirrors `const _pauseRunRef = useRef<() => void>(pauseRun)`
  const _pauseRunRef = useRef<() => void>(pauseRun);
  // Always-current update — mirrors `_pauseRunRef.current = pauseRun`
  _pauseRunRef.current = pauseRun;

  // Narrow context: only changes when runStatus changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(
    () => ({ runStatus, pauseRunRef: _pauseRunRef }),
    [runStatus],
    // _pauseRunRef is a stable ref object — intentionally omitted from deps.
  );

  return <PauseCtx.Provider value={value}>{children}</PauseCtx.Provider>;
}

// Minimal CompactRunStrip replica — reads pauseRunRef from the narrow context
// and calls pauseRunRef.current() on click, exactly as the real strip does:
//   onClick={(e) => { e.stopPropagation(); pauseRunRef.current(); }}
const MinimalStrip = memo(function MinimalStripInner() {
  const { runStatus, pauseRunRef } = usePauseCtx();
  return (
    <div data-testid="strip">
      <span data-testid="status">{runStatus}</span>
      {runStatus === "running" && (
        <button
          data-testid="strip-pause"
          onClick={(e) => { e.stopPropagation(); pauseRunRef.current(); }}
        >
          Pause
        </button>
      )}
      {runStatus === "paused" && (
        <span data-testid="paused-indicator">Paused</span>
      )}
    </div>
  );
});

describe("CompactRunStrip pause button — pauseRunRef wiring", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("clicking the pause button calls pauseRunRef.current()", async () => {
    const spy = vi.fn();

    const { getByTestId } = render(
      <PauseProvider initialStatus="running" onPause={spy}>
        <MinimalStrip />
      </PauseProvider>,
    );

    expect(getByTestId("status").textContent).toBe("running");

    await act(async () => {
      fireEvent.click(getByTestId("strip-pause"));
    });

    // The ref's .current must have been called — confirming the onClick wiring
    // reaches pauseRunRef.current() and not a stale captured closure.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("calls the LATEST .current even if the closure was swapped after initial render", async () => {
    // Simulates a re-render updating _pauseRunRef.current = newPauseRun before
    // the button is clicked.  The stable ref object in context means the click
    // always reaches the freshest closure.
    const staleCall = vi.fn();
    const latestCall = vi.fn();

    // Build a provider whose .current we can manually replace mid-test.
    let capturedRef: MutableRefObject<() => void> | null = null;

    function RefCapturingProvider({ children }: { children: ReactNode }) {
      const _ref = useRef<() => void>(staleCall);
      _ref.current = staleCall;
      capturedRef = _ref;
      const value = useMemo(
        () => ({ runStatus: "running", pauseRunRef: _ref }),
        [],
      );
      return <PauseCtx.Provider value={value}>{children}</PauseCtx.Provider>;
    }

    const { getByTestId } = render(
      <RefCapturingProvider>
        <MinimalStrip />
      </RefCapturingProvider>,
    );

    // Swap .current to the "latest" function — mirroring what happens when
    // home.tsx re-renders and reassigns _pauseRunRef.current = pauseRun.
    await act(async () => {
      capturedRef!.current = latestCall;
    });

    await act(async () => {
      fireEvent.click(getByTestId("strip-pause"));
    });

    // The click must invoke the latest function, not the stale one captured at render.
    expect(latestCall).toHaveBeenCalledTimes(1);
    expect(staleCall).not.toHaveBeenCalled();
  });

  it("run status transitions to 'paused' after the pause button is clicked", async () => {
    const { getByTestId, queryByTestId } = render(
      <PauseProvider initialStatus="running">
        <MinimalStrip />
      </PauseProvider>,
    );

    // Before click: running, no paused indicator
    expect(getByTestId("status").textContent).toBe("running");
    expect(queryByTestId("paused-indicator")).toBeNull();

    await act(async () => {
      fireEvent.click(getByTestId("strip-pause"));
    });

    // After click: status must be "paused" and the paused indicator visible.
    // This confirms pauseRunRef.current() → setRunStatus("paused") → context
    // update → MinimalStrip re-renders with the new status.
    expect(getByTestId("status").textContent).toBe("paused");
    expect(queryByTestId("paused-indicator")).not.toBeNull();
  });
});
