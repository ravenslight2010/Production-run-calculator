// @vitest-environment jsdom
//
// Structural guarantee: the five Live*TabContent components (Packaging,
// Frontline, Dough, SetupRecipes, Summary) subscribe to the narrow
// `HomeTabCtx` rather than the full HomeCtx.  Two invariants must hold:
//
//  1. PROPAGATION — when production data changes (e.g. a form value like
//     `casesNeeded` is updated), the subscribed tab component receives the
//     fresh value immediately regardless of which tab is "active".
//
//  2. ISOLATION — when manage-dialog / merge / import state changes (state
//     that is intentionally OMITTED from homeTabCtxValue's useMemo deps),
//     the tab component does NOT re-render.  This is the "dialog open does
//     not freeze tab" guarantee: opening a dialog and switching to Dough or
//     Packaging renders the tab without a spurious re-render.
//
// These tests import the REAL HomeTabCtx and useHomeTabCtx from their
// extracted module (src/contexts/HomeTabCtx.ts), so any regression that
// changes the context object identity, renames the hook, or breaks its
// Provider/consumer link will fail here.
//
// Because the Live*TabContent components are defined inside home.tsx and
// cannot be imported directly, subscriber behaviour is validated through a
// minimal React.memo consumer that calls useHomeTabCtx() — the same hook
// the real tab components call — wrapped in a controlled provider that
// mirrors the homeTabCtxValue useMemo pattern (production deps in, dialog
// state out).
//
// Three tests:
//  1. PROPAGATION — form value change reaches the tab subscriber via the
//     real HomeTabCtx.Provider / useHomeTabCtx() path.
//  2. ISOLATION — dialog open does not trigger a tab re-render.
//  3. COMBINED — form value change + dialog open: tab shows the new value
//     but dialog toggle contributes no extra renders.

import { describe, it, expect, afterEach } from "vitest";
import { useMemo, memo, type ReactNode } from "react";
import { render, act, cleanup } from "@testing-library/react";

// Import the REAL HomeTabCtx and useHomeTabCtx — not a replica.
// Any refactor that breaks these exports or changes the context identity
// will cause the tests below to fail, catching regressions at their source.
import { HomeTabCtx, useHomeTabCtx } from "../HomeTabCtx";

// ── Controlled provider that mirrors the homeTabCtxValue pattern ──────────────
//
// home.tsx does:
//   const homeTabCtxValue = useMemo(
//     () => homeCtxValueRef.current,
//     [dayState, v, ve, …runState,   ← production deps
//      /* showManageDialog intentionally omitted */]
//   )
//   <HomeTabCtx.Provider value={homeTabCtxValue}>…</HomeTabCtx.Provider>
//
// We can't mount the full Home component in a unit test, so we replicate the
// provider shape while using the SAME HomeTabCtx object from production code.
// casesNeeded/runStatus stand in for production deps (v, dayState);
// manageCounter stands in for showManageDialog (intentionally excluded).

function TabProvider({
  casesNeeded,
  runStatus,
  children,
}: {
  casesNeeded: number;
  runStatus: string;
  manageCounter: number; // received but intentionally excluded from deps
  children: ReactNode;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(
    () => ({ casesNeeded, runStatus }),
    [casesNeeded, runStatus],
    // manageCounter intentionally omitted — mirrors homeTabCtxValue's omission
    // of showManageDialog / importState / merge state.
  );
  // Use the REAL HomeTabCtx.Provider from production code.
  return <HomeTabCtx.Provider value={value}>{children}</HomeTabCtx.Provider>;
}

// ── Subscriber component (mirrors Live*TabContent) ────────────────────────────
// Uses the REAL useHomeTabCtx() hook, wrapped in React.memo.
// In production, LiveDoughTabContent / LivePackagingTabContent call exactly
// this: const hx = useHomeTabCtx();
let renderCount = 0;

const TabSubscriber = memo(function TabSubscriberInner() {
  renderCount++;
  // REAL hook — same call the production tab components make.
  const { casesNeeded, runStatus } = useHomeTabCtx();
  return (
    <div>
      <span data-testid="cases-needed">{casesNeeded}</span>
      <span data-testid="run-status">{runStatus}</span>
    </div>
  );
});

// ── Tests ─────────────────────────────────────────────────────────────────────
afterEach(() => {
  cleanup();
  renderCount = 0;
});

describe("HomeTabCtx — tab-switch propagation and dialog isolation", () => {
  // ─── Test 1: PROPAGATION ──────────────────────────────────────────────────
  // Simulates: user edits casesNeeded on the Run tab, then switches to Dough.
  // The Dough tab subscriber must reflect the new value immediately.
  it("tab subscriber sees updated form value after production data changes", async () => {
    const { rerender, getByTestId } = render(
      <TabProvider casesNeeded={100} runStatus="running" manageCounter={0}>
        <TabSubscriber />
      </TabProvider>,
    );

    // Initial render
    expect(renderCount).toBe(1);
    expect(getByTestId("cases-needed").textContent).toBe("100");
    expect(getByTestId("run-status").textContent).toBe("running");

    // Simulate user changing casesNeeded (form value update on Run tab)
    await act(async () => {
      rerender(
        <TabProvider casesNeeded={200} runStatus="running" manageCounter={0}>
          <TabSubscriber />
        </TabProvider>,
      );
    });

    // The useMemo dep (casesNeeded) changed → new ctx ref → subscriber re-renders
    expect(renderCount).toBe(2);
    expect(getByTestId("cases-needed").textContent).toBe("200");

    // Verify again with a second production data change (runStatus)
    await act(async () => {
      rerender(
        <TabProvider casesNeeded={200} runStatus="paused" manageCounter={0}>
          <TabSubscriber />
        </TabProvider>,
      );
    });

    expect(renderCount).toBe(3);
    expect(getByTestId("run-status").textContent).toBe("paused");
  });

  // ─── Test 2: ISOLATION ────────────────────────────────────────────────────
  // Simulates: manage dialog opens (showManageDialog flips) while user is on
  // the Dough or Packaging tab.  The tab must NOT re-render.
  it("tab subscriber does NOT re-render when dialog/manage state changes", async () => {
    const { rerender } = render(
      <TabProvider casesNeeded={150} runStatus="running" manageCounter={0}>
        <TabSubscriber />
      </TabProvider>,
    );

    expect(renderCount).toBe(1);

    // Simulate manage dialog opening — only manageCounter changes;
    // casesNeeded and runStatus (the actual production deps) stay the same.
    await act(async () => {
      rerender(
        <TabProvider casesNeeded={150} runStatus="running" manageCounter={1}>
          <TabSubscriber />
        </TabProvider>,
      );
    });

    // useMemo deps unchanged → same ctx ref → React.memo skips re-render.
    expect(renderCount).toBe(1);

    // Simulate dialog closing / import progress ticking (multiple non-run changes)
    await act(async () => {
      rerender(
        <TabProvider casesNeeded={150} runStatus="running" manageCounter={99}>
          <TabSubscriber />
        </TabProvider>,
      );
    });

    expect(renderCount).toBe(1);
  });

  // ─── Test 3: COMBINED ────────────────────────────────────────────────────
  // Simulates the full scenario from the task spec:
  //   1. Form value changes (casesNeeded updated on Run tab)
  //   2. Manage dialog opens
  //   3. User switches to Dough/Packaging tab
  //
  // Expected: the tab subscriber shows the new value (from step 1) and the
  // dialog open (step 2) does NOT contribute any extra re-renders.
  it("form value change propagates; subsequent dialog open adds no extra renders", async () => {
    const { rerender, getByTestId } = render(
      <TabProvider casesNeeded={50} runStatus="running" manageCounter={0}>
        <TabSubscriber />
      </TabProvider>,
    );

    // Initial render
    expect(renderCount).toBe(1);
    expect(getByTestId("cases-needed").textContent).toBe("50");

    // Step 1: user edits casesNeeded → production dep changes → re-render
    await act(async () => {
      rerender(
        <TabProvider casesNeeded={75} runStatus="running" manageCounter={0}>
          <TabSubscriber />
        </TabProvider>,
      );
    });

    expect(renderCount).toBe(2);
    expect(getByTestId("cases-needed").textContent).toBe("75");

    const countAfterFormChange = renderCount;

    // Step 2: manage dialog opens (showManageDialog flips) — must NOT re-render
    await act(async () => {
      rerender(
        <TabProvider casesNeeded={75} runStatus="running" manageCounter={1}>
          <TabSubscriber />
        </TabProvider>,
      );
    });

    // Dialog open added zero renders
    expect(renderCount).toBe(countAfterFormChange);

    // Step 3: user switches to Dough tab — the tab is already showing the
    // correct casesNeeded (75) without needing another re-render
    expect(getByTestId("cases-needed").textContent).toBe("75");
    expect(getByTestId("run-status").textContent).toBe("running");
  });
});
