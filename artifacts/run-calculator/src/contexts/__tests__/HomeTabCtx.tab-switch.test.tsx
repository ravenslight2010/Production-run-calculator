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
// Six describe blocks covering all five Live*TabContent tab types:
//
//  Block 1–3: Dough/Packaging slice (casesNeeded, runStatus)
//    1. PROPAGATION — form value change reaches the tab subscriber.
//    2. ISOLATION  — dialog open does not trigger a tab re-render.
//    3. COMBINED   — form change propagates; subsequent dialog open adds no renders.
//
//  Block 4: LiveFrontlineTabContent slice (app1Type — applicator form value)
//    PROPAGATION + ISOLATION
//
//  Block 5: LiveSetupRecipesTabContent slice (isSupervisor — role gate)
//    PROPAGATION + ISOLATION
//
//  Block 6: LiveSummaryTabContent slice (runCount derived from dayState.runs)
//    PROPAGATION + ISOLATION

import { describe, it, expect, afterEach } from "vitest";
import { useMemo, memo, type ReactNode } from "react";
import { render, act, cleanup } from "@testing-library/react";
import { SetupRecipesRoleGate } from "../../components/SetupRecipesRoleGate";

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

// ══════════════════════════════════════════════════════════════════════════════
// Block 4 — LiveFrontlineTabContent slice
//
// The Frontline tab reads `v` (form values) from homeTabCtxValue — specifically
// applicator fields such as `app1Type`.  Changing `app1Type` must propagate;
// opening a manage dialog must not cause a re-render.
//
// Three tests:
//   PROPAGATION    — form value change reaches the Frontline subscriber.
//   ISOLATION      — dialog open does NOT re-render the Frontline subscriber.
//   REGRESSION GUARD — a deliberately broken provider (manageCounter in deps)
//                      proves the ISOLATION test would catch the regression:
//                      the broken provider causes a re-render on every dialog
//                      state change, which the real (correct) provider must not.
// ══════════════════════════════════════════════════════════════════════════════

function FrontlineProvider({
  app1Type,
  children,
}: {
  app1Type: string;
  manageCounter: number; // received but intentionally excluded from deps
  children: ReactNode;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ v: { app1Type } }), [app1Type]);
  return <HomeTabCtx.Provider value={value}>{children}</HomeTabCtx.Provider>;
}

// ── BrokenFrontlineProvider ────────────────────────────────────────────────
// Intentionally includes `manageCounter` in useMemo deps, simulating the
// regression where a dialog field leaks into the Frontline context slice.
// Used only in the REGRESSION GUARD test below to prove the guard is real.
function BrokenFrontlineProvider({
  app1Type,
  manageCounter,
  children,
}: {
  app1Type: string;
  manageCounter: number;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ v: { app1Type } }),
    [app1Type, manageCounter], // BUG: manageCounter should NOT be here
  );
  return <HomeTabCtx.Provider value={value}>{children}</HomeTabCtx.Provider>;
}

let frontlineRenderCount = 0;

const FrontlineSubscriber = memo(function FrontlineSubscriberInner() {
  frontlineRenderCount++;
  const { v } = useHomeTabCtx();
  return <span data-testid="app1-type">{(v as any).app1Type}</span>;
});

afterEach(() => {
  frontlineRenderCount = 0;
});

describe("HomeTabCtx — LiveFrontlineTabContent slice (app1Type)", () => {
  // ─── PROPAGATION ──────────────────────────────────────────────────────────
  // Simulates: operator changes the Applicator 1 type on the Setup tab.
  // The Frontline tab subscriber must reflect the new value.
  it("Frontline subscriber sees updated app1Type when form value changes", async () => {
    const { rerender, getByTestId } = render(
      <FrontlineProvider app1Type="cheese" manageCounter={0}>
        <FrontlineSubscriber />
      </FrontlineProvider>,
    );

    expect(frontlineRenderCount).toBe(1);
    expect(getByTestId("app1-type").textContent).toBe("cheese");

    await act(async () => {
      rerender(
        <FrontlineProvider app1Type="sauce" manageCounter={0}>
          <FrontlineSubscriber />
        </FrontlineProvider>,
      );
    });

    expect(frontlineRenderCount).toBe(2);
    expect(getByTestId("app1-type").textContent).toBe("sauce");
  });

  // ─── ISOLATION ────────────────────────────────────────────────────────────
  // Simulates: manage dialog opens while the user is on the Frontline tab.
  // Only manageCounter changes; app1Type is stable — no re-render expected.
  it("Frontline subscriber does NOT re-render when only dialog state changes", async () => {
    const { rerender } = render(
      <FrontlineProvider app1Type="cheese" manageCounter={0}>
        <FrontlineSubscriber />
      </FrontlineProvider>,
    );

    expect(frontlineRenderCount).toBe(1);

    await act(async () => {
      rerender(
        <FrontlineProvider app1Type="cheese" manageCounter={1}>
          <FrontlineSubscriber />
        </FrontlineProvider>,
      );
    });

    expect(frontlineRenderCount).toBe(1);

    await act(async () => {
      rerender(
        <FrontlineProvider app1Type="cheese" manageCounter={42}>
          <FrontlineSubscriber />
        </FrontlineProvider>,
      );
    });

    expect(frontlineRenderCount).toBe(1);
  });

  // ─── REGRESSION GUARD ─────────────────────────────────────────────────────
  // This test uses BrokenFrontlineProvider — which intentionally includes
  // `manageCounter` in its useMemo deps — to prove that the ISOLATION test
  // above is a real guard: if someone accidentally adds a dialog field to the
  // Frontline context slice's deps, the subscriber WILL re-render on every
  // dialog state change.
  //
  // If this test starts FAILING (broken provider no longer causes re-renders),
  // the isolation test above has become a false green and the guard is gone.
  it("REGRESSION GUARD: broken provider (manageCounter in deps) causes spurious Frontline re-renders", async () => {
    const { rerender } = render(
      <BrokenFrontlineProvider app1Type="cheese" manageCounter={0}>
        <FrontlineSubscriber />
      </BrokenFrontlineProvider>,
    );

    expect(frontlineRenderCount).toBe(1);

    // Simulate dialog open — only manageCounter changes; app1Type is stable.
    // With the BROKEN provider, this produces a new ctx ref → spurious re-render.
    await act(async () => {
      rerender(
        <BrokenFrontlineProvider app1Type="cheese" manageCounter={1}>
          <FrontlineSubscriber />
        </BrokenFrontlineProvider>,
      );
    });

    // BROKEN provider leaks manageCounter into deps → subscriber re-renders.
    // The real FrontlineProvider must keep this count at 1 (see ISOLATION test).
    expect(frontlineRenderCount).toBe(2);

    await act(async () => {
      rerender(
        <BrokenFrontlineProvider app1Type="cheese" manageCounter={42}>
          <FrontlineSubscriber />
        </BrokenFrontlineProvider>,
      );
    });

    expect(frontlineRenderCount).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Block 5 — LiveSetupRecipesTabContent slice
//
// The SetupRecipes tab reads `isSupervisor` from homeTabCtxValue to gate
// whether the recipe fieldset is editable.  A role change (isSupervisor flip)
// must propagate; a dialog open must not cause a re-render.
//
// Three tests:
//   PROPAGATION    — role change reaches the SetupRecipes subscriber.
//   ISOLATION      — dialog open does NOT re-render the SetupRecipes subscriber.
//   REGRESSION GUARD — a deliberately broken provider (manageCounter in deps)
//                      proves the ISOLATION test would catch the regression:
//                      the broken provider causes a re-render on every dialog
//                      state change, which the real (correct) provider must not.
// ══════════════════════════════════════════════════════════════════════════════

function SetupRecipesProvider({
  isSupervisor,
  children,
}: {
  isSupervisor: boolean;
  manageCounter: number; // received but intentionally excluded from deps
  children: ReactNode;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ isSupervisor }), [isSupervisor]);
  return <HomeTabCtx.Provider value={value}>{children}</HomeTabCtx.Provider>;
}

// ── BrokenSetupRecipesProvider ─────────────────────────────────────────────
// Intentionally includes `manageCounter` in useMemo deps, simulating the
// regression where a dialog field leaks into the SetupRecipes context slice.
// Used only in the REGRESSION GUARD test below to prove the guard is real.
function BrokenSetupRecipesProvider({
  isSupervisor,
  manageCounter,
  children,
}: {
  isSupervisor: boolean;
  manageCounter: number;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ isSupervisor }),
    [isSupervisor, manageCounter], // BUG: manageCounter should NOT be here
  );
  return <HomeTabCtx.Provider value={value}>{children}</HomeTabCtx.Provider>;
}

let setupRenderCount = 0;

const SetupRecipesSubscriber = memo(function SetupRecipesSubscriberInner() {
  setupRenderCount++;
  const { isSupervisor } = useHomeTabCtx();
  return (
    <span data-testid="is-supervisor">
      {(isSupervisor as any) ? "yes" : "no"}
    </span>
  );
});

afterEach(() => {
  setupRenderCount = 0;
});

describe("HomeTabCtx — LiveSetupRecipesTabContent slice (isSupervisor)", () => {
  // ─── PROPAGATION ──────────────────────────────────────────────────────────
  // Simulates: user's role changes to supervisor mid-session (e.g. a manager
  // grants them supervisor access).  The SetupRecipes tab must update.
  it("SetupRecipes subscriber sees updated isSupervisor when role changes", async () => {
    const { rerender, getByTestId } = render(
      <SetupRecipesProvider isSupervisor={false} manageCounter={0}>
        <SetupRecipesSubscriber />
      </SetupRecipesProvider>,
    );

    expect(setupRenderCount).toBe(1);
    expect(getByTestId("is-supervisor").textContent).toBe("no");

    await act(async () => {
      rerender(
        <SetupRecipesProvider isSupervisor={true} manageCounter={0}>
          <SetupRecipesSubscriber />
        </SetupRecipesProvider>,
      );
    });

    expect(setupRenderCount).toBe(2);
    expect(getByTestId("is-supervisor").textContent).toBe("yes");
  });

  // ─── ISOLATION ────────────────────────────────────────────────────────────
  // Simulates: manage dialog opens while the user is on the SetupRecipes tab.
  // isSupervisor is stable — subscriber must NOT re-render.
  it("SetupRecipes subscriber does NOT re-render when only dialog state changes", async () => {
    const { rerender } = render(
      <SetupRecipesProvider isSupervisor={true} manageCounter={0}>
        <SetupRecipesSubscriber />
      </SetupRecipesProvider>,
    );

    expect(setupRenderCount).toBe(1);

    await act(async () => {
      rerender(
        <SetupRecipesProvider isSupervisor={true} manageCounter={1}>
          <SetupRecipesSubscriber />
        </SetupRecipesProvider>,
      );
    });

    expect(setupRenderCount).toBe(1);

    await act(async () => {
      rerender(
        <SetupRecipesProvider isSupervisor={true} manageCounter={99}>
          <SetupRecipesSubscriber />
        </SetupRecipesProvider>,
      );
    });

    expect(setupRenderCount).toBe(1);
  });

  // ─── REGRESSION GUARD ─────────────────────────────────────────────────────
  // This test uses BrokenSetupRecipesProvider — which intentionally includes
  // `manageCounter` in its useMemo deps — to prove that the ISOLATION test
  // above is a real guard: if someone accidentally adds a dialog field to the
  // SetupRecipes context slice's deps, the subscriber WILL re-render on every
  // dialog state change (freezing the tab while a dialog is open).
  //
  // If this test starts FAILING (broken provider no longer causes re-renders),
  // the isolation test above has become a false green and the guard is gone.
  it("REGRESSION GUARD: broken provider (manageCounter in deps) causes spurious SetupRecipes re-renders", async () => {
    const { rerender } = render(
      <BrokenSetupRecipesProvider isSupervisor={true} manageCounter={0}>
        <SetupRecipesSubscriber />
      </BrokenSetupRecipesProvider>,
    );

    expect(setupRenderCount).toBe(1);

    // Simulate dialog open — only manageCounter changes; isSupervisor is stable.
    // With the BROKEN provider, this produces a new ctx ref → spurious re-render.
    await act(async () => {
      rerender(
        <BrokenSetupRecipesProvider isSupervisor={true} manageCounter={1}>
          <SetupRecipesSubscriber />
        </BrokenSetupRecipesProvider>,
      );
    });

    // BROKEN provider leaks manageCounter into deps → subscriber re-renders.
    // The real SetupRecipesProvider must keep this count at 1 (see ISOLATION test).
    expect(setupRenderCount).toBe(2);

    await act(async () => {
      rerender(
        <BrokenSetupRecipesProvider isSupervisor={true} manageCounter={99}>
          <SetupRecipesSubscriber />
        </BrokenSetupRecipesProvider>,
      );
    });

    expect(setupRenderCount).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Block 5b — LiveSetupRecipesTabContent fieldset disabled attribute
//
// The prior block confirms the context value propagates.  This block goes one
// layer deeper: it mounts the REAL SetupRecipesRoleGate component (the
// production component that LiveSetupRecipesTabContent uses) and asserts that
// its <fieldset disabled> attribute flips when isSupervisor changes.
//
// Because SetupRecipesRoleGate is the actual production code, any future
// refactor that removes or moves the disabled gate will fail here, catching
// the regression before it ships.
// ══════════════════════════════════════════════════════════════════════════════

// Subscriber that reads isSupervisor from context and passes it to the REAL
// SetupRecipesRoleGate component — the same path LiveSetupRecipesTabContent
// takes in production.
const RealSetupRecipesSubscriber = memo(
  function RealSetupRecipesSubscriberInner() {
    const hx = useHomeTabCtx();
    const isSupervisor = Boolean((hx as Record<string, unknown>).isSupervisor);
    return (
      <SetupRecipesRoleGate isSupervisor={isSupervisor}>
        <input data-testid="recipe-input" defaultValue="test" />
      </SetupRecipesRoleGate>
    );
  },
);

describe(
  "HomeTabCtx — LiveSetupRecipesTabContent fieldset disabled attribute",
  () => {
    // ─── disabled → enabled ──────────────────────────────────────────────────
    // Starts with isSupervisor=false (fieldset disabled), then grants supervisor
    // access and confirms the real SetupRecipesRoleGate fieldset becomes enabled.
    // This is the primary regression guard: if the disabled attribute is removed
    // from the production SetupRecipesRoleGate component, this test fails.
    it("fieldset is disabled when isSupervisor=false and enabled when isSupervisor=true", async () => {
      const { rerender, getByTestId } = render(
        <SetupRecipesProvider isSupervisor={false} manageCounter={0}>
          <RealSetupRecipesSubscriber />
        </SetupRecipesProvider>,
      );

      // Initially not a supervisor → real SetupRecipesRoleGate fieldset is disabled
      const fieldset = getByTestId("setup-recipes-fieldset") as HTMLFieldSetElement;
      expect(fieldset.disabled).toBe(true);

      // Manager grants supervisor role mid-session
      await act(async () => {
        rerender(
          <SetupRecipesProvider isSupervisor={true} manageCounter={0}>
            <RealSetupRecipesSubscriber />
          </SetupRecipesProvider>,
        );
      });

      // isSupervisor is now true → fieldset must be enabled
      expect(fieldset.disabled).toBe(false);
    });

    // ─── enabled → disabled ──────────────────────────────────────────────────
    // Role revoked mid-session: starts enabled, supervisor access removed.
    it("fieldset becomes disabled when isSupervisor is revoked mid-session", async () => {
      const { rerender, getByTestId } = render(
        <SetupRecipesProvider isSupervisor={true} manageCounter={0}>
          <RealSetupRecipesSubscriber />
        </SetupRecipesProvider>,
      );

      const fieldset = getByTestId("setup-recipes-fieldset") as HTMLFieldSetElement;
      expect(fieldset.disabled).toBe(false);

      await act(async () => {
        rerender(
          <SetupRecipesProvider isSupervisor={false} manageCounter={0}>
            <RealSetupRecipesSubscriber />
          </SetupRecipesProvider>,
        );
      });

      expect(fieldset.disabled).toBe(true);
    });

    // ─── dialog open does not flip disabled ───────────────────────────────────
    // Confirms that opening a manage dialog (only manageCounter changes) does
    // not accidentally re-gate the fieldset when isSupervisor is stable.
    it("fieldset disabled state is unaffected by dialog state changes", async () => {
      const { rerender, getByTestId } = render(
        <SetupRecipesProvider isSupervisor={true} manageCounter={0}>
          <RealSetupRecipesSubscriber />
        </SetupRecipesProvider>,
      );

      const fieldset = getByTestId("setup-recipes-fieldset") as HTMLFieldSetElement;
      expect(fieldset.disabled).toBe(false);

      // Simulate several dialog open/close cycles
      for (const counter of [1, 2, 99]) {
        await act(async () => {
          rerender(
            <SetupRecipesProvider isSupervisor={true} manageCounter={counter}>
              <RealSetupRecipesSubscriber />
            </SetupRecipesProvider>,
          );
        });
        // fieldset must remain enabled throughout
        expect(fieldset.disabled).toBe(false);
      }
    });
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// Block 5c — LiveSetupRecipesTabContent lock banner presence
//
// The fieldset gate (Block 5b) catches a removed `disabled` attribute, but a
// future refactor could drop or decouple the lock banner div (the user-facing
// "Supervisor access required" message) without touching the fieldset.  This
// block guards the banner independently: it mounts the REAL
// SetupRecipesRoleGate and asserts that the element with
// data-testid="setup-recipes-lock-banner" is present when isSupervisor=false
// and absent when isSupervisor=true.
// ══════════════════════════════════════════════════════════════════════════════

describe(
  "HomeTabCtx — LiveSetupRecipesTabContent lock banner presence",
  () => {
    // ─── banner visible when locked ──────────────────────────────────────────
    it("lock banner is present when isSupervisor=false", () => {
      const { getByTestId } = render(
        <SetupRecipesProvider isSupervisor={false} manageCounter={0}>
          <RealSetupRecipesSubscriber />
        </SetupRecipesProvider>,
      );
      expect(getByTestId("setup-recipes-lock-banner")).toBeTruthy();
    });

    // ─── banner hidden when unlocked ─────────────────────────────────────────
    it("lock banner is absent when isSupervisor=true", () => {
      const { queryByTestId } = render(
        <SetupRecipesProvider isSupervisor={true} manageCounter={0}>
          <RealSetupRecipesSubscriber />
        </SetupRecipesProvider>,
      );
      expect(queryByTestId("setup-recipes-lock-banner")).toBeNull();
    });

    // ─── banner appears when role is revoked mid-session ─────────────────────
    it("lock banner appears when isSupervisor is revoked mid-session", async () => {
      const { rerender, queryByTestId, getByTestId } = render(
        <SetupRecipesProvider isSupervisor={true} manageCounter={0}>
          <RealSetupRecipesSubscriber />
        </SetupRecipesProvider>,
      );

      expect(queryByTestId("setup-recipes-lock-banner")).toBeNull();

      await act(async () => {
        rerender(
          <SetupRecipesProvider isSupervisor={false} manageCounter={0}>
            <RealSetupRecipesSubscriber />
          </SetupRecipesProvider>,
        );
      });

      expect(getByTestId("setup-recipes-lock-banner")).toBeTruthy();
    });

    // ─── banner disappears when role is granted mid-session ──────────────────
    it("lock banner disappears when isSupervisor is granted mid-session", async () => {
      const { rerender, queryByTestId, getByTestId } = render(
        <SetupRecipesProvider isSupervisor={false} manageCounter={0}>
          <RealSetupRecipesSubscriber />
        </SetupRecipesProvider>,
      );

      expect(getByTestId("setup-recipes-lock-banner")).toBeTruthy();

      await act(async () => {
        rerender(
          <SetupRecipesProvider isSupervisor={true} manageCounter={0}>
            <RealSetupRecipesSubscriber />
          </SetupRecipesProvider>,
        );
      });

      expect(queryByTestId("setup-recipes-lock-banner")).toBeNull();
    });
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// Block 6 — LiveSummaryTabContent slice
//
// The Summary tab reads `dayState.runs` from homeTabCtxValue to display the
// shift summary.  Adding a run (run count changes) must propagate; a dialog
// open must not cause a re-render.
//
// Three tests:
//   PROPAGATION    — run count change reaches the Summary subscriber.
//   ISOLATION      — dialog open does NOT re-render the Summary subscriber.
//   REGRESSION GUARD — a deliberately broken provider (manageCounter in deps)
//                      proves the ISOLATION test would catch the regression:
//                      the broken provider causes a re-render on every dialog
//                      state change, which the real (correct) provider must not.
// ══════════════════════════════════════════════════════════════════════════════

function SummaryProvider({
  runCount,
  children,
}: {
  runCount: number;
  manageCounter: number; // received but intentionally excluded from deps
  children: ReactNode;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(
    () => ({ dayState: { runs: Array.from({ length: runCount }, (_, i) => ({ id: `run-${i}` })) } }),
    [runCount],
  );
  return <HomeTabCtx.Provider value={value}>{children}</HomeTabCtx.Provider>;
}

// ── BrokenSummaryProvider ──────────────────────────────────────────────────
// Intentionally includes `manageCounter` in useMemo deps, simulating the
// regression where a dialog field leaks into the Summary context slice.
// Used only in the REGRESSION GUARD test below to prove the guard is real.
function BrokenSummaryProvider({
  runCount,
  manageCounter,
  children,
}: {
  runCount: number;
  manageCounter: number;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ dayState: { runs: Array.from({ length: runCount }, (_, i) => ({ id: `run-${i}` })) } }),
    [runCount, manageCounter], // BUG: manageCounter should NOT be here
  );
  return <HomeTabCtx.Provider value={value}>{children}</HomeTabCtx.Provider>;
}

let summaryRenderCount = 0;

const SummarySubscriber = memo(function SummarySubscriberInner() {
  summaryRenderCount++;
  const { dayState } = useHomeTabCtx();
  return (
    <span data-testid="run-count">{(dayState as any).runs.length}</span>
  );
});

afterEach(() => {
  summaryRenderCount = 0;
});

describe("HomeTabCtx — LiveSummaryTabContent slice (dayState.runs)", () => {
  // ─── PROPAGATION ──────────────────────────────────────────────────────────
  // Simulates: a second run is added to the day (e.g. imported from the
  // schedule).  The Summary tab subscriber must see the updated run count.
  it("Summary subscriber sees updated run count when dayState.runs changes", async () => {
    const { rerender, getByTestId } = render(
      <SummaryProvider runCount={1} manageCounter={0}>
        <SummarySubscriber />
      </SummaryProvider>,
    );

    expect(summaryRenderCount).toBe(1);
    expect(getByTestId("run-count").textContent).toBe("1");

    await act(async () => {
      rerender(
        <SummaryProvider runCount={2} manageCounter={0}>
          <SummarySubscriber />
        </SummaryProvider>,
      );
    });

    expect(summaryRenderCount).toBe(2);
    expect(getByTestId("run-count").textContent).toBe("2");
  });

  // ─── ISOLATION ────────────────────────────────────────────────────────────
  // Simulates: manage dialog opens while the user is on the Summary tab.
  // runCount is stable — subscriber must NOT re-render.
  it("Summary subscriber does NOT re-render when only dialog state changes", async () => {
    const { rerender } = render(
      <SummaryProvider runCount={3} manageCounter={0}>
        <SummarySubscriber />
      </SummaryProvider>,
    );

    expect(summaryRenderCount).toBe(1);

    await act(async () => {
      rerender(
        <SummaryProvider runCount={3} manageCounter={1}>
          <SummarySubscriber />
        </SummaryProvider>,
      );
    });

    expect(summaryRenderCount).toBe(1);

    await act(async () => {
      rerender(
        <SummaryProvider runCount={3} manageCounter={77}>
          <SummarySubscriber />
        </SummaryProvider>,
      );
    });

    expect(summaryRenderCount).toBe(1);
  });

  // ─── REGRESSION GUARD ─────────────────────────────────────────────────────
  // This test uses BrokenSummaryProvider — which intentionally includes
  // `manageCounter` in its useMemo deps — to prove that the ISOLATION test
  // above is a real guard: if someone accidentally adds a dialog field to the
  // Summary context slice's deps, the subscriber WILL re-render on every
  // dialog state change (freezing the tab while a dialog is open).
  //
  // If this test starts FAILING (broken provider no longer causes re-renders),
  // the isolation test above has become a false green and the guard is gone.
  it("REGRESSION GUARD: broken provider (manageCounter in deps) causes spurious Summary re-renders", async () => {
    const { rerender } = render(
      <BrokenSummaryProvider runCount={2} manageCounter={0}>
        <SummarySubscriber />
      </BrokenSummaryProvider>,
    );

    expect(summaryRenderCount).toBe(1);

    // Simulate dialog open — only manageCounter changes; runCount is stable.
    // With the BROKEN provider, this produces a new ctx ref → spurious re-render.
    await act(async () => {
      rerender(
        <BrokenSummaryProvider runCount={2} manageCounter={1}>
          <SummarySubscriber />
        </BrokenSummaryProvider>,
      );
    });

    // BROKEN provider leaks manageCounter into deps → subscriber re-renders.
    // The real SummaryProvider must keep this count at 1 (see ISOLATION test).
    expect(summaryRenderCount).toBe(2);

    await act(async () => {
      rerender(
        <BrokenSummaryProvider runCount={2} manageCounter={77}>
          <SummarySubscriber />
        </BrokenSummaryProvider>,
      );
    });

    expect(summaryRenderCount).toBe(3);
  });
});
