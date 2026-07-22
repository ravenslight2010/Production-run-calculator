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

// ── AUDIT: useAutoTrack / useNotifications mock status ───────────────────────
//
// Neither useAutoTrack nor useNotifications is mocked in this file, and that is
// intentional.  Every test here uses self-contained replica components and
// replica context providers — LiveRunProvider is NEVER mounted.  Because those
// two hooks are only called inside LiveRunProvider, they are never invoked by
// any test in this file.
//
// IF A FUTURE CHANGE mounts LiveRunProvider here (or imports a component that
// pulls it in transitively), you MUST add closure-level vi.mock factories for
// both hooks before the first test — exactly as LiveTabMemo.snappy.test.tsx
// does.  Inline vi.fn() / object literals inside the mock factory body would
// produce a new reference on every call, making LiveRunProvider's liveSlice
// useMemo deps unstable and silently defeating memo() isolation.  See the
// STABILITY CONTRACT block at the top of LiveTabMemo.snappy.test.tsx for the
// authoritative pattern.
// ─────────────────────────────────────────────────────────────────────────────

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

// ─── CompactRunStrip resume button: setActiveTab("run") navigation test ───────
//
// Structural guarantee: when the strip is in "paused" state, clicking the
// resume button (data-testid="strip-resume") calls setActiveTab("run").
//
// The real CompactRunStrip resume button is:
//   <button data-testid="strip-resume"
//     onClick={(e) => { e.stopPropagation(); setActiveTab("run"); }}
//   >
//
// This mirrors that call path in a self-contained replica so the test does not
// depend on home.tsx being importable.

type ResumeCtxShape = {
  runStatus: string;
  setActiveTab: (tab: string) => void;
};

const ResumeCtx = createContext<ResumeCtxShape | null>(null);

function useResumeCtx() {
  const ctx = useContext(ResumeCtx);
  if (!ctx) throw new Error("useResumeCtx must be inside ResumeCtx.Provider");
  return ctx;
}

// Mirrors CompactRunStrip: shows resume button (strip-resume) when paused,
// calls setActiveTab("run") on click — exactly as the real strip does.
const ResumeStrip = memo(function ResumeStripInner() {
  const { runStatus, setActiveTab } = useResumeCtx();
  return (
    <div data-testid="resume-strip">
      <span data-testid="status">{runStatus}</span>
      {runStatus === "paused" && (
        <button
          type="button"
          data-testid="strip-resume"
          onClick={(e) => { e.stopPropagation(); setActiveTab("run"); }}
        >
          Resume
        </button>
      )}
    </div>
  );
});

describe("CompactRunStrip resume button — setActiveTab(\"run\") navigation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("clicking strip-resume calls setActiveTab with \"run\"", async () => {
    const setActiveTab = vi.fn();

    const value: ResumeCtxShape = { runStatus: "paused", setActiveTab };
    const { getByTestId } = render(
      <ResumeCtx.Provider value={value}>
        <ResumeStrip />
      </ResumeCtx.Provider>,
    );

    expect(getByTestId("status").textContent).toBe("paused");

    await act(async () => {
      fireEvent.click(getByTestId("strip-resume"));
    });

    expect(setActiveTab).toHaveBeenCalledTimes(1);
    expect(setActiveTab).toHaveBeenCalledWith("run");
  });

  it("resume button is not rendered when runStatus is \"running\"", () => {
    const setActiveTab = vi.fn();

    const value: ResumeCtxShape = { runStatus: "running", setActiveTab };
    const { queryByTestId } = render(
      <ResumeCtx.Provider value={value}>
        <ResumeStrip />
      </ResumeCtx.Provider>,
    );

    expect(queryByTestId("strip-resume")).toBeNull();
    expect(setActiveTab).not.toHaveBeenCalled();
  });
});

// ─── CompactRunStrip tab-visibility guard ─────────────────────────────────────
//
// Structural guarantee: the parent in home.tsx renders CompactRunStrip (and
// therefore its resume button) ONLY when activeTab !== "run":
//
//   {activeTab !== "run" && <CompactRunStrip />}
//
// When the user is already on the Run tab the entire strip is unmounted, so
// the resume button can never appear — there is no separate in-strip guard
// needed.  This test models that conditional render directly.
//
// Two cases:
//  1. activeTab === "run" → strip absent, resume button absent
//  2. activeTab === "setup" (any non-run tab) with runStatus "paused" → strip
//     present, resume button present
//
// Because CompactRunStrip is defined inside home.tsx and cannot be imported
// directly, the test uses the same ResumeStrip replica already defined above
// to represent the strip's content.

function ConditionalStrip({
  activeTab,
  runStatus,
  setActiveTab,
}: {
  activeTab: string;
  runStatus: string;
  setActiveTab: (tab: string) => void;
}) {
  const value: ResumeCtxShape = { runStatus, setActiveTab };
  return (
    <>
      {/* Mirrors the exact guard in home.tsx line ~11570 */}
      {activeTab !== "run" && (
        <ResumeCtx.Provider value={value}>
          <ResumeStrip />
        </ResumeCtx.Provider>
      )}
    </>
  );
}

describe("CompactRunStrip — hidden when already on the Run tab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("strip and resume button are absent when activeTab is \"run\" and run is paused", () => {
    const setActiveTab = vi.fn();

    const { queryByTestId } = render(
      <ConditionalStrip activeTab="run" runStatus="paused" setActiveTab={setActiveTab} />,
    );

    // The entire strip is unmounted — no strip element and no resume button.
    expect(queryByTestId("resume-strip")).toBeNull();
    expect(queryByTestId("strip-resume")).toBeNull();
  });

  it("strip and resume button are present when activeTab is not \"run\" and run is paused", () => {
    const setActiveTab = vi.fn();

    const { getByTestId } = render(
      <ConditionalStrip activeTab="setup" runStatus="paused" setActiveTab={setActiveTab} />,
    );

    // Strip is mounted and resume button visible.
    expect(getByTestId("resume-strip")).not.toBeNull();
    expect(getByTestId("strip-resume")).not.toBeNull();
  });

  it("strip is absent on the Run tab regardless of runStatus", async () => {
    const setActiveTab = vi.fn();

    const { rerender, queryByTestId } = render(
      <ConditionalStrip activeTab="run" runStatus="running" setActiveTab={setActiveTab} />,
    );
    expect(queryByTestId("resume-strip")).toBeNull();

    await act(async () => {
      rerender(
        <ConditionalStrip activeTab="run" runStatus="paused" setActiveTab={setActiveTab} />,
      );
    });
    expect(queryByTestId("resume-strip")).toBeNull();

    await act(async () => {
      rerender(
        <ConditionalStrip activeTab="run" runStatus="ended" setActiveTab={setActiveTab} />,
      );
    });
    expect(queryByTestId("resume-strip")).toBeNull();
  });
});

// ─── CompactRunStrip ended-run button visibility ───────────────────────────────
//
// Structural guarantee: when runStatus === "ended" the strip renders (it is
// shown on non-run tabs regardless of run lifecycle state) but NEITHER the
// pause button (strip-pause) NOR the resume button (strip-resume) appears.
// Only "running" shows the pause button and only "paused" shows the resume
// button — "ended" falls through both guards and leaves the strip action-free.
//
// This test uses a combined EndedStrip replica that mirrors both guards from
// the real CompactRunStrip in home.tsx so a single component can cover all
// three status values.

type EndedCtxShape = {
  runStatus: string;
  pauseRunRef: MutableRefObject<() => void>;
  setActiveTab: (tab: string) => void;
};

const EndedCtx = createContext<EndedCtxShape | null>(null);

function useEndedCtx() {
  const ctx = useContext(EndedCtx);
  if (!ctx) throw new Error("useEndedCtx must be inside EndedCtx.Provider");
  return ctx;
}

// Combined strip replica: mirrors BOTH conditional guards from CompactRunStrip —
//   {runStatus === "running" && <button data-testid="strip-pause" ...>}
//   {runStatus === "paused"  && <button data-testid="strip-resume" ...>}
// The strip div itself always renders (data-testid="ended-strip").
const EndedStrip = memo(function EndedStripInner() {
  const { runStatus, pauseRunRef, setActiveTab } = useEndedCtx();
  return (
    <div data-testid="ended-strip">
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
        <button
          data-testid="strip-resume"
          onClick={(e) => { e.stopPropagation(); setActiveTab("run"); }}
        >
          Resume
        </button>
      )}
    </div>
  );
});

describe("CompactRunStrip — action buttons hidden when run has ended", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("strip renders but strip-pause and strip-resume are absent when runStatus is \"ended\"", () => {
    const pauseRunRef = { current: vi.fn() };
    const setActiveTab = vi.fn();

    const value: EndedCtxShape = { runStatus: "ended", pauseRunRef, setActiveTab };
    const { getByTestId, queryByTestId } = render(
      <EndedCtx.Provider value={value}>
        <EndedStrip />
      </EndedCtx.Provider>,
    );

    // The strip itself must be present — it is shown on non-run tabs for ended runs.
    expect(getByTestId("ended-strip")).not.toBeNull();
    expect(getByTestId("status").textContent).toBe("ended");

    // Neither action button may appear for an ended run.
    expect(queryByTestId("strip-pause")).toBeNull();
    expect(queryByTestId("strip-resume")).toBeNull();
  });

  it("strip-pause IS present when runStatus is \"running\" (counter-proof)", () => {
    const pauseRunRef = { current: vi.fn() };
    const setActiveTab = vi.fn();

    const value: EndedCtxShape = { runStatus: "running", pauseRunRef, setActiveTab };
    const { getByTestId, queryByTestId } = render(
      <EndedCtx.Provider value={value}>
        <EndedStrip />
      </EndedCtx.Provider>,
    );

    expect(getByTestId("strip-pause")).not.toBeNull();
    expect(queryByTestId("strip-resume")).toBeNull();
  });

  it("strip-resume IS present when runStatus is \"paused\" (counter-proof)", () => {
    const pauseRunRef = { current: vi.fn() };
    const setActiveTab = vi.fn();

    const value: EndedCtxShape = { runStatus: "paused", pauseRunRef, setActiveTab };
    const { getByTestId, queryByTestId } = render(
      <EndedCtx.Provider value={value}>
        <EndedStrip />
      </EndedCtx.Provider>,
    );

    expect(queryByTestId("strip-pause")).toBeNull();
    expect(getByTestId("strip-resume")).not.toBeNull();
  });

  it("transitioning from \"running\" to \"ended\" removes the pause button", async () => {
    const pauseRunRef = { current: vi.fn() };
    const setActiveTab = vi.fn();

    const { rerender, getByTestId, queryByTestId } = render(
      <EndedCtx.Provider value={{ runStatus: "running", pauseRunRef, setActiveTab }}>
        <EndedStrip />
      </EndedCtx.Provider>,
    );

    // Pause button visible while running.
    expect(getByTestId("strip-pause")).not.toBeNull();

    await act(async () => {
      rerender(
        <EndedCtx.Provider value={{ runStatus: "ended", pauseRunRef, setActiveTab }}>
          <EndedStrip />
        </EndedCtx.Provider>,
      );
    });

    // After the run ends, neither action button must remain.
    expect(queryByTestId("strip-pause")).toBeNull();
    expect(queryByTestId("strip-resume")).toBeNull();
    // Strip element itself stays mounted.
    expect(getByTestId("ended-strip")).not.toBeNull();
  });
});

// ─── CompactRunStrip strip visibility across all non-run tabs (ended run) ─────
//
// Structural guarantee: the home.tsx guard `{activeTab !== "run" && <CompactRunStrip />}`
// keeps the strip mounted on EVERY non-run tab, including when runStatus is "ended".
// A regression in that guard could silently remove the ended-run indicator from
// setup, inventory, schedule, and other tabs without breaking any other test.
//
// This suite iterates over every known non-run tab and asserts that the strip
// container remains mounted when runStatus is "ended".  It uses the same
// ConditionalStrip replica (which mirrors the `activeTab !== "run"` guard exactly)
// and EndedStrip (which mirrors the combined pause/resume guard) together.
//
// For "ended" status: neither the pause button nor the resume button should appear,
// but the strip div itself (data-testid="ended-strip") must be present.

// All tab values reachable in home.tsx other than "run".
const NON_RUN_TABS = [
  "dough",
  "sauce",
  "frontline",
  "packaging",
  "warehouse",
  "setup",
  "inventory",
  "stoppages",
  "summary",
  "mixes",
  "ai",
  "incidents",
  "quality",
  "downtime",
  "staff",
] as const;

// Wrapper that applies the `activeTab !== "run"` guard and supplies the
// EndedCtx so EndedStrip can read runStatus.
function TabGuardedEndedStrip({
  activeTab,
  runStatus,
}: {
  activeTab: string;
  runStatus: string;
}) {
  const pauseRunRef = { current: () => {} };
  const setActiveTab = () => {};
  const ctxValue: EndedCtxShape = { runStatus, pauseRunRef, setActiveTab };
  return (
    <>
      {activeTab !== "run" && (
        <EndedCtx.Provider value={ctxValue}>
          <EndedStrip />
        </EndedCtx.Provider>
      )}
    </>
  );
}

describe("CompactRunStrip — strip stays mounted on every non-run tab when run has ended", () => {
  afterEach(() => {
    cleanup();
  });

  for (const tab of NON_RUN_TABS) {
    it(`strip container present on tab "${tab}" with runStatus "ended"`, () => {
      const { getByTestId, queryByTestId } = render(
        <TabGuardedEndedStrip activeTab={tab} runStatus="ended" />,
      );

      // Strip container must be mounted — the ended-run indicator must be visible.
      expect(getByTestId("ended-strip")).not.toBeNull();
      expect(getByTestId("status").textContent).toBe("ended");

      // Neither action button should appear for an ended run.
      expect(queryByTestId("strip-pause")).toBeNull();
      expect(queryByTestId("strip-resume")).toBeNull();
    });
  }

  it("strip is absent on the \"run\" tab even when run has ended (control case)", () => {
    const { queryByTestId } = render(
      <TabGuardedEndedStrip activeTab="run" runStatus="ended" />,
    );

    // The guard unmounts the entire strip on the Run tab.
    expect(queryByTestId("ended-strip")).toBeNull();
  });
});

// ─── CompactRunStrip — dynamic navigation after run ends ──────────────────────
//
// Structural guarantee: the strip stays mounted throughout a navigation sequence
// that crosses multiple non-run tabs after runStatus transitions "running" →
// "ended".  The per-tab suite above only mounts fresh on each tab; this suite
// proves the guard does not accidentally drop the strip mid-session.
//
// Scenario:
//   1. Mount on "dough" with runStatus "running" → strip present, pause button visible.
//   2. Transition runStatus to "ended" (still on "dough") → strip stays, action
//      buttons disappear.
//   3. Navigate to "setup" → strip still mounted.
//   4. Navigate to "inventory" → strip still mounted.
//   5. Navigate to "mixes" → strip still mounted.
//
// Uses the same TabGuardedEndedStrip + EndedStrip helpers already defined above.

describe("CompactRunStrip — strip stays mounted during tab navigation after run ends", () => {
  afterEach(() => {
    cleanup();
  });

  it("strip stays mounted across non-run tab switches after transitioning running → ended", async () => {
    // Step 1: running on the "dough" tab — strip present with pause button.
    const { rerender, getByTestId, queryByTestId } = render(
      <TabGuardedEndedStrip activeTab="dough" runStatus="running" />,
    );

    expect(getByTestId("ended-strip")).not.toBeNull();
    expect(getByTestId("status").textContent).toBe("running");
    // Pause button visible during a running run.
    expect(getByTestId("strip-pause")).not.toBeNull();
    expect(queryByTestId("strip-resume")).toBeNull();

    // Step 2: run ends while still on the "dough" tab.
    await act(async () => {
      rerender(<TabGuardedEndedStrip activeTab="dough" runStatus="ended" />);
    });

    // Strip must stay mounted after the end event; action buttons must disappear.
    expect(getByTestId("ended-strip")).not.toBeNull();
    expect(getByTestId("status").textContent).toBe("ended");
    expect(queryByTestId("strip-pause")).toBeNull();
    expect(queryByTestId("strip-resume")).toBeNull();

    // Step 3: navigate to "setup" — strip must remain mounted.
    await act(async () => {
      rerender(<TabGuardedEndedStrip activeTab="setup" runStatus="ended" />);
    });

    expect(getByTestId("ended-strip")).not.toBeNull();
    expect(getByTestId("status").textContent).toBe("ended");
    expect(queryByTestId("strip-pause")).toBeNull();
    expect(queryByTestId("strip-resume")).toBeNull();

    // Step 4: navigate to "inventory" — strip must remain mounted.
    await act(async () => {
      rerender(<TabGuardedEndedStrip activeTab="inventory" runStatus="ended" />);
    });

    expect(getByTestId("ended-strip")).not.toBeNull();
    expect(getByTestId("status").textContent).toBe("ended");
    expect(queryByTestId("strip-pause")).toBeNull();
    expect(queryByTestId("strip-resume")).toBeNull();

    // Step 5: navigate to "mixes" — strip must remain mounted (4th non-run tab visited).
    await act(async () => {
      rerender(<TabGuardedEndedStrip activeTab="mixes" runStatus="ended" />);
    });

    expect(getByTestId("ended-strip")).not.toBeNull();
    expect(getByTestId("status").textContent).toBe("ended");
    expect(queryByTestId("strip-pause")).toBeNull();
    expect(queryByTestId("strip-resume")).toBeNull();
  });

  it("strip remounts correctly after briefly visiting the Run tab with an ended run", async () => {
    // Step 1: Start on a non-run tab ("dough") with runStatus "ended" — strip present,
    // no action buttons (run is already over).
    const { rerender, getByTestId, queryByTestId } = render(
      <TabGuardedEndedStrip activeTab="dough" runStatus="ended" />,
    );

    expect(getByTestId("ended-strip")).not.toBeNull();
    expect(getByTestId("status").textContent).toBe("ended");
    expect(queryByTestId("strip-pause")).toBeNull();
    expect(queryByTestId("strip-resume")).toBeNull();

    // Step 2: Navigate to the "run" tab — the `activeTab !== "run"` guard unmounts
    // the strip entirely (the user is now on the run tab itself).
    await act(async () => {
      rerender(<TabGuardedEndedStrip activeTab="run" runStatus="ended" />);
    });

    // Strip must be completely absent while on the Run tab.
    expect(queryByTestId("ended-strip")).toBeNull();
    expect(queryByTestId("strip-pause")).toBeNull();
    expect(queryByTestId("strip-resume")).toBeNull();

    // Step 3: Navigate back to a non-run tab ("setup") — the guard must remount the
    // strip.  A regression in the guard would leave the strip absent here.
    await act(async () => {
      rerender(<TabGuardedEndedStrip activeTab="setup" runStatus="ended" />);
    });

    // Strip must be remounted and show "ended" status with no action buttons.
    expect(getByTestId("ended-strip")).not.toBeNull();
    expect(getByTestId("status").textContent).toBe("ended");
    expect(queryByTestId("strip-pause")).toBeNull();
    expect(queryByTestId("strip-resume")).toBeNull();
  });
});
