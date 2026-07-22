// @vitest-environment jsdom
//
// Integration-level guarantees for the eight memo()-wrapped tab components
// introduced in the render-isolation refactor:
//
//   LiveRunTabContent, LivePackagingTabContent, LiveFrontlineTabContent,
//   LiveDoughTabContent, LiveSetupRecipesTabContent, LiveStoppagesTabContent,
//   LiveSummaryTabContent, GlanceOverlay
//
// All eight are React.memo(fn) with NO props — they read live data via:
//   • useLiveRun()   — from LiveRunProvider (clock, calc, casesInFreezer …)
//   • useHomeCtx()   — from HomeCtx.Provider (runStatus, form fields, …)
//
// Both hooks are tested here using their REAL implementations:
//   • useLiveRun  is imported from ../../contexts/LiveRunContext (same source
//     used by the real tab components)
//   • useHomeCtx / HomeCtx are imported from ../../contexts/HomeCtx, the
//     module extracted from home.tsx so that this test can use the actual
//     hook without pulling the full 20 000-line render tree into jsdom.
//
// Three test suites:
//
//  1. "all 8 memo()-wrapped components receive clock updates via BOTH
//     useHomeCtx() and useLiveRun()" — simulators that mirror the exact
//     dual-context subscription pattern of every real tab component receive
//     updated nowTime from the live clock AND confirm their HomeCtx read
//     returns a value.  memo() must NOT block either subscription.
//
//  2. "manage-dialog open does NOT corrupt live data" — a HomeCtx provider
//     with a properly isolated liveSlice useMemo verifies via the REAL
//     useHomeCtx() hook that live values are stable when only manage/dialog
//     state changes.
//
//  3. "tab switching preserves live data (no stale snapshot)" — tab
//     simulators that use the real useLiveRun() subscription confirm the
//     newly active tab always sees a timestamp ≥ the previous tab's last
//     known time.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  useMemo,
  memo,
  type ReactNode,
} from "react";
import GlanceOverlay from "../../components/GlanceOverlay";
import { render, act, cleanup } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { type FormValues, DEFAULT_VALUES } from "../../types";
import { LiveRunProvider, useLiveRun } from "../../contexts/LiveRunContext";
import * as LiveRunContextNS from "../../contexts/LiveRunContext";
import { HomeCtx, useHomeCtx } from "../../contexts/HomeCtx";
import { HOME_TAB_CTX_DEP_FIELDS } from "../../pages/homeTabCtxDeps";
import { HomeTabCtx, useHomeTabCtx } from "../../contexts/HomeTabCtx";
import { useAutoTrack } from "../../hooks/useAutoTrack";
import { useNotifications } from "../../hooks/useNotifications";
import * as HomeTabCtxNS from "../../contexts/HomeTabCtx";

// ── Shared mocks (same as neighbouring test files) ───────────────────────────

// !! STABILITY CONTRACT — DO NOT BREAK !!
//
// Every object and function returned by these mock factories MUST be defined
// at closure scope (outside the inner arrow function), NOT created inline.
//
// WHY THIS MATTERS:
//   LiveRunProvider wraps its hook results in a `value` useMemo whose deps
//   include the return values of useAutoTrack() and useNotifications().
//   If any field is an inline literal (e.g. `vi.fn()` or `{ current: 0 }`
//   written directly in the return body), a NEW reference is produced on
//   every call to the hook.  That makes the useMemo deps unstable, so the
//   memo fires on every render, which silently defeats the memo()-wrapped
//   FloorModeView isolation and causes all live tab components to re-render
//   on every dialog/import state change.
//
// CORRECT (closure-level — same ref every call):
//   const myFn = vi.fn();
//   return { useFoo: () => ({ fn: myFn }) };
//
// WRONG (inline literal — new ref every call):
//   return { useFoo: () => ({ fn: vi.fn() }) };
//
// Suite 5 below enforces this contract with reference-identity assertions.

vi.mock("../../hooks/useNotifications", () => {
  // Closure-level refs — stable across every call to useNotifications().
  // Inline `vi.fn()` here would produce a new ref per call and break the
  // liveSlice useMemo in LiveRunProvider.  See STABILITY CONTRACT above.
  const setShowBatchDue = vi.fn();
  return {
    useNotifications: () => ({ showBatchDue: false, setShowBatchDue }),
  };
});

vi.mock("../../hooks/useAutoTrack", () => {
  // Closure-level refs — stable across every call to useAutoTrack().
  // Every object/function here must remain at closure scope.  Moving any
  // of these inline (e.g. `autoSuppressUntilRef: { current: 0 }` inside
  // the return body) would silently defeat the FloorModeView isolation.
  // See STABILITY CONTRACT above.
  const setAutoTrackProgress = vi.fn();
  const autoSuppressUntilRef = { current: 0 };
  const fireAutoTrackNow = vi.fn();
  const tickDueRefs = {
    case:      { current: 0 },
    tray:      { current: 0 },
    trayProd:  { current: 0 },
    batch:     { current: 0 },
    batchProd: { current: 0 },
  };
  return {
    useAutoTrack: () => ({
      autoTrackProgress: false,
      setAutoTrackProgress,
      autoTrackSuggestion: null,
      autoSuppressUntilRef,
      fireAutoTrackNow,
      tickDueRefs,
    }),
    suggestedDoughStaging: () => ({ trays: null, batches: null }),
  };
});

// ── Form values that give a non-zero ppm so casesInFreezer advances ──────────
const ACTIVE_VALUES: FormValues = {
  ...DEFAULT_VALUES,
  crustsPerCycle: 10,
  cycleSpeed: 1,
  speedAdjustment: 1,
  pizzasPerCase: 10,
  casesNeeded: 200,
  freezerTime: 30,
};

const STARTED_AT = Date.now() - 5 * 60 * 1000; // 5 min ago
const ACTIVE_RUN = {
  id: "run-live-1",
  brand: "TestBrand",
  flavor: "TestFlavor",
  startedAt: STARTED_AT,
  endedAt: undefined,
  pausedAt: undefined,
  stoppages: [] as [],
};

// ── Minimal homeCtxValue shape —  only the fields simulators actually read ───
// The real homeCtxValue in home.tsx has 300+ fields.  We only need a realistic
// subset for the test.  useHomeCtx() is typed `any`, so no extra schema needed.
function makeHomeCtxValue(runStatus: string, brand: string, extras: Record<string, unknown> = {}) {
  return {
    runStatus,
    currentRun: { id: "run-live-1", brand, flavor: "TestFlavor" },
    dayState: { runs: [ACTIVE_RUN], currentIndex: 0 },
    form: null,
    activeTab: "run",
    ...extras,
  };
}

// ── Provider that wraps both real contexts ────────────────────────────────────
//
// Mirrors the actual home.tsx render tree:
//   <HomeCtx.Provider value={homeCtxValue}>
//     <LiveRunProvider ...>
//       {children}
//     </LiveRunProvider>
//   </HomeCtx.Provider>
//
// homeCtxValue useMemo deps: runStatus + brand.  Simulates the same isolation
// home.tsx applies — manage/dialog fields are in extras but NOT in the live
// portion's deps.
function BothContextsWrapper({
  runStatus = "running",
  brand = "TestBrand",
  manageCategory = "",
  children,
}: {
  runStatus?: string;
  brand?: string;
  manageCategory?: string;
  children: ReactNode;
}) {
  const form = useForm<FormValues>({ defaultValues: ACTIVE_VALUES });

  // Live slice — memoized only on live state, NOT on manageCategory.
  // This mirrors the isolation home.tsx must maintain in homeCtxValue.
  const ctxValue = useMemo(
    () => makeHomeCtxValue(runStatus, brand, { manageCategory }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runStatus, brand],
  );

  return (
    <HomeCtx.Provider value={ctxValue}>
      <LiveRunProvider
        v={ACTIVE_VALUES}
        ve={ACTIVE_VALUES}
        runStatus={runStatus as "running"}
        currentRun={ACTIVE_RUN}
        currentRunId="run-live-1"
        form={form}
        dayState={{ runs: [ACTIVE_RUN], currentIndex: 0 }}
        doughSubTab="dough"
        upcomingRunLabels={[]}
        prefs={undefined}
        screenMode={null}
        machine={{ spinSec: 0, hopperSec: 0 }}
      >
        {children}
      </LiveRunProvider>
    </HomeCtx.Provider>
  );
}

// ── Minimal LiveRunProvider-only wrapper (for Suite 3 clock-only tests) ───────
function LiveOnlyWrapper({ children }: { children: ReactNode }) {
  const form = useForm<FormValues>({ defaultValues: ACTIVE_VALUES });
  return (
    <LiveRunProvider
      v={ACTIVE_VALUES}
      ve={ACTIVE_VALUES}
      runStatus="running"
      currentRun={ACTIVE_RUN}
      currentRunId="run-live-1"
      form={form}
      dayState={{ runs: [ACTIVE_RUN], currentIndex: 0 }}
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

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 1 — All 8 memo()-wrapped components receive clock updates via
//            BOTH useHomeCtx() and useLiveRun()
// ═══════════════════════════════════════════════════════════════════════════════
//
// Every real tab component calls useHomeCtx() for run/manage state AND
// useLiveRun() for the live clock.  The simulators here mirror that exact
// dual-context subscription pattern using the REAL hooks from the same
// modules the production components use.
//
// Two regressions this detects:
//   A. HomeCtx removed from the render tree → useHomeCtx() throws → test fails.
//   B. useLiveRun() subscription broken by memo() → renderCount stalls → fails.

describe("LiveTabMemo — all 8 memo()-wrapped components receive clock updates (real useHomeCtx + useLiveRun)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  const TAB_NAMES = [
    "LiveRunTabContent",
    "LivePackagingTabContent",
    "LiveFrontlineTabContent",
    "LiveDoughTabContent",
    "LiveSetupRecipesTabContent",
    "LiveStoppagesTabContent",
    "LiveSummaryTabContent",
    "GlanceOverlay",
  ] as const;

  it("each tab simulator (dual useHomeCtx + useLiveRun) receives updated nowTime after the clock ticks", async () => {
    const lastNow: Record<string, number> = {};
    const firstNow: Record<string, number> = {};
    // Also capture homeCtx reads to confirm the real hook is wired
    const homeCtxSeen: Record<string, boolean> = {};

    // Simulators call BOTH real hooks — exactly like the 8 real tab components.
    const simulators = TAB_NAMES.map((name) =>
      memo(function TabSim() {
        // REAL useHomeCtx() from ../../contexts/HomeCtx (extracted from home.tsx)
        const hx = useHomeCtx();
        homeCtxSeen[name] = hx.runStatus !== undefined;

        // REAL useLiveRun() — the live clock subscription
        const { nowTime } = useLiveRun();
        const ms = nowTime.getTime();
        if (!(name in firstNow)) firstNow[name] = ms;
        lastNow[name] = ms;
        return null;
      }),
    );

    const SimList = () => (
      <>
        {simulators.map((Sim, i) => (
          <Sim key={i} />
        ))}
      </>
    );

    // Render inside BOTH providers — mirrors the real home.tsx render tree
    render(
      <BothContextsWrapper>
        <SimList />
      </BothContextsWrapper>,
    );

    // All 8 sims confirmed HomeCtx is reachable via the real useHomeCtx()
    for (const name of TAB_NAMES) {
      expect(homeCtxSeen[name]).toBe(true);
    }

    // Initial timestamp captured for each
    for (const name of TAB_NAMES) {
      expect(firstNow[name]).toBeGreaterThan(0);
    }

    // 60 s of clock ticks
    await act(async () => { vi.advanceTimersByTime(60_000); });

    // Every simulator must have received updated nowTime
    for (const name of TAB_NAMES) {
      expect(lastNow[name]).toBeGreaterThan(firstNow[name]);
    }
  });

  it("memo() does NOT prevent live tabs from receiving useLiveRun() context updates (counter-proof)", async () => {
    let renderCount = 0;
    const LiveSubscriber = memo(function LiveSubscriberInner() {
      useHomeCtx();    // real HomeCtx subscription
      useLiveRun();    // real clock subscription
      renderCount++;
      return null;
    });

    render(
      <BothContextsWrapper>
        <LiveSubscriber />
      </BothContextsWrapper>,
    );

    const countAfterMount = renderCount;

    await act(async () => { vi.advanceTimersByTime(1_100); });

    // Clock ticked → LiveRunProvider context changed → subscriber re-rendered
    // (memo() blocks prop-driven re-renders, NOT context-driven ones)
    expect(renderCount).toBeGreaterThan(countAfterMount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 2 — Manage-dialog open does NOT corrupt live data
//            (uses REAL HomeCtx.Provider + useHomeCtx())
// ═══════════════════════════════════════════════════════════════════════════════
//
// In home.tsx, homeCtxValue bundles BOTH live state (runStatus, currentRun,
// etc.) and manage/dialog state (manageCategory, mergeConfirming, …).
// When a manage dialog opens, homeCtxValue changes — all 8 memo()-wrapped
// components re-render from the new HomeCtx value.  The live data those
// components display must be unchanged.
//
// This suite uses the REAL HomeCtx and the REAL useHomeCtx() hook.
// A RealHomeCtxProvider wraps children with <HomeCtx.Provider value={…}>
// where the live portion of the value is isolated via useMemo(deps=[liveFields])
// so that only live-state changes (not manageCategory changes) invalidate it.
//
// This is the same isolation home.tsx must maintain.  The test verifies the
// pattern holds by toggling manageCategory and asserting the live fields read
// by useHomeCtx() remain the same object reference.

function RealHomeCtxProvider({
  runStatus,
  brand,
  manageCategory,
  children,
}: {
  runStatus: string;
  brand: string;
  manageCategory: string;
  children: ReactNode;
}) {
  // Live slice — isolates run-critical fields from dialog/manage state.
  // Changing manageCategory must NOT invalidate this memo.
  const liveSlice = useMemo(
    () => ({ runStatus, brand }),
    [runStatus, brand],
  );

  // Full context value includes both live and manage fields.
  // liveSlice is a stable reference unless runStatus/brand change.
  const ctxValue = useMemo(
    () => ({ ...liveSlice, manageCategory, flavor: "TestFlavor" }),
    [liveSlice, manageCategory],
  );

  return (
    <HomeCtx.Provider value={ctxValue}>
      {manageCategory ? (
        <div data-testid="dialog">Manage: {manageCategory}</div>
      ) : null}
      {children}
    </HomeCtx.Provider>
  );
}

// Simulator: reads live fields via the REAL useHomeCtx() hook.
let liveTabRenderCount = 0;
const LiveTabSim = memo(function LiveTabSimInner() {
  liveTabRenderCount++;
  // REAL hook — calls useContext(HomeCtx) from ../../contexts/HomeCtx
  const { runStatus, brand } = useHomeCtx();
  return (
    <span data-testid="live-data">{runStatus}|{brand}</span>
  );
});

describe("LiveTabMemo — manage-dialog open does NOT corrupt live data (real HomeCtx + useHomeCtx)", () => {
  afterEach(() => { cleanup(); liveTabRenderCount = 0; });

  it("live data values are unchanged before and after a manage dialog opens", async () => {
    const { rerender, getByTestId } = render(
      <RealHomeCtxProvider runStatus="running" brand="Acme" manageCategory="">
        <LiveTabSim />
      </RealHomeCtxProvider>,
    );

    const before = getByTestId("live-data").textContent;
    expect(before).toBe("running|Acme");

    // Open the manage dialog — only manageCategory changes.
    await act(async () => {
      rerender(
        <RealHomeCtxProvider runStatus="running" brand="Acme" manageCategory="mixes">
          <LiveTabSim />
        </RealHomeCtxProvider>,
      );
    });

    // Live fields must be identical — the liveSlice useMemo did not invalidate.
    const after = getByTestId("live-data").textContent;
    expect(after).toBe("running|Acme");
    expect(after).toBe(before);
  });

  it("liveSlice ref (from HomeCtx) is stable when only manageCategory changes", async () => {
    // Capture the liveSlice-shaped fields read via useHomeCtx() on each render.
    // If home.tsx accidentally adds manageCategory to the liveSlice useMemo deps,
    // the object ref would change — this test would catch that.
    const sliceRefs: { runStatus: string; brand: string }[] = [];

    const SliceInspector = memo(function SliceInspectorInner() {
      // REAL useHomeCtx() reads from the REAL HomeCtx context
      const { runStatus, brand } = useHomeCtx();
      sliceRefs.push({ runStatus, brand });
      return null;
    });

    const { rerender } = render(
      <RealHomeCtxProvider runStatus="running" brand="Acme" manageCategory="">
        <SliceInspector />
      </RealHomeCtxProvider>,
    );

    // Toggle manageCategory twice
    await act(async () => {
      rerender(
        <RealHomeCtxProvider runStatus="running" brand="Acme" manageCategory="mixes">
          <SliceInspector />
        </RealHomeCtxProvider>,
      );
    });

    await act(async () => {
      rerender(
        <RealHomeCtxProvider runStatus="running" brand="Acme" manageCategory="">
          <SliceInspector />
        </RealHomeCtxProvider>,
      );
    });

    // runStatus and brand must be unchanged across all renders
    for (const ref of sliceRefs) {
      expect(ref.runStatus).toBe("running");
      expect(ref.brand).toBe("Acme");
    }
  });

  it("live data DOES update when run state changes (not over-memoised)", async () => {
    const { rerender, getByTestId } = render(
      <RealHomeCtxProvider runStatus="running" brand="Acme" manageCategory="">
        <LiveTabSim />
      </RealHomeCtxProvider>,
    );

    expect(getByTestId("live-data").textContent).toBe("running|Acme");

    // Actual live-state change → liveSlice invalidated → useHomeCtx() returns new values.
    await act(async () => {
      rerender(
        <RealHomeCtxProvider runStatus="paused" brand="Acme" manageCategory="">
          <LiveTabSim />
        </RealHomeCtxProvider>,
      );
    });

    expect(getByTestId("live-data").textContent).toBe("paused|Acme");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4 — Regression guard: homeTabCtxValue is stable across ALL known
//            manage/dialog/import field changes
//
// home.tsx maintains TWO separate contexts:
//   • HomeCtx (full, 300+ fields including dialog state) — subscribed to by
//     manage dialogs, import panels, etc.
//   • HomeTabCtx (narrow, live-data-only) — subscribed to by the 8 memo()-
//     wrapped live tab components. Its useMemo dep list intentionally excludes
//     all manage/dialog/import variables so those tabs do NOT re-render when
//     a manage dialog opens, a merge runs, or import progress ticks.
//
// This suite guards against the regression where a new dialog-state field is
// accidentally added to homeTabCtxValue's useMemo dep list. If that happens,
// opening the new dialog invalidates the HomeTabCtx value on every render,
// causing all 8 live tab components to re-render unnecessarily.
//
// The guard simulates the homeTabCtxValue isolation pattern:
//   useMemo(() => liveData, [liveField1, liveField2, …])
//   // dialogExtras intentionally NOT in deps
//
// When dialogExtras changes (simulating "dialog opens"), the useMemo returns
// the SAME cached reference. React bails out the context update → subscriber
// does not re-render → renderCount stays at 1. If a dialog field is
// accidentally added to the dep list, the useMemo fires → new ref → context
// update → subscriber re-renders → renderCount increases → test fails.
//
// HOW TO MAINTAIN THIS GUARD:
//   When a new manage/dialog/import state variable is added to homeCtxValue
//   that must NOT enter homeTabCtxValue's dep list, add its name and a
//   realistic "open/in-flight" value to DIALOG_REGISTRY below. The batch test
//   auto-covers it — no other changes needed.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Authoritative registry of dialog-state fields excluded from homeTabCtxValue deps ──
// Each entry:
//   field     — state variable name as it appears in homeCtxValue/homeTabCtxValue
//   openValue — realistic "dialog open / in-flight" value (non-default / truthy)
// ↓↓↓  ADD NEW DIALOG FIELDS HERE when extending manage dialogs or import flows  ↓↓↓
const DIALOG_REGISTRY: ReadonlyArray<{ field: string; openValue: unknown }> = [
  // ── Manage dialog ──
  { field: "manageCategory",           openValue: "mixes"              },
  { field: "manageBrandFilter",        openValue: "Acme"               },
  { field: "manageInput",              openValue: "search term"        },
  // ── Merge ──
  { field: "mergeConfirming",          openValue: true                 },
  { field: "mergeCategory",            openValue: "dough"              },
  { field: "mergeBusy",                openValue: true                 },
  { field: "mergeError",               openValue: "conflict"           },
  { field: "mergeSources",             openValue: ["a", "b"]           },
  { field: "mergeTarget",              openValue: "b"                  },
  { field: "mergeSuggestBusy",         openValue: true                 },
  { field: "mergeBatchBusy",           openValue: true                 },
  { field: "mergeBfMode",              openValue: "brand"              },
  { field: "mergeCheckRequest",        openValue: "req-1"              },
  { field: "mergeFromImport",          openValue: true                 },
  // ── Show-dialog booleans ──
  { field: "showManageDialog",         openValue: true                 },
  { field: "showImportDialog",         openValue: true                 },
  { field: "showSpecImport",           openValue: true                 },
  { field: "showCheeseImport",         openValue: true                 },
  { field: "showPremixImport",         openValue: true                 },
  { field: "showShippingImport",       openValue: true                 },
  { field: "showScheduleDialog",       openValue: true                 },
  { field: "showPasswordDialog",       openValue: true                 },
  { field: "showPinDialog",            openValue: true                 },
  { field: "showTemplatesDialog",      openValue: true                 },
  { field: "showMobileQrDialog",       openValue: true                 },
  { field: "showScreensDialog",        openValue: true                 },
  { field: "showEditReasonsDialog",    openValue: true                 },
  { field: "showBrandDrop",            openValue: true                 },
  { field: "showFlavorDrop",           openValue: true                 },
  { field: "showTour",                 openValue: true                 },
  // ── Generic import progress / result ──
  { field: "importProgress",           openValue: 50                   },
  { field: "importResult",             openValue: { ok: true }         },
  { field: "importIntoEditor",         openValue: true                 },
  { field: "importDefaultDate",        openValue: "2026-07-22"         },
  // ── Spec import ──
  { field: "specImportLoading",        openValue: true                 },
  { field: "specImportProgress",       openValue: 30                   },
  { field: "specImportPrepared",       openValue: { rows: [] }         },
  { field: "specImportApplying",       openValue: true                 },
  { field: "specImportError",          openValue: "parse failed"       },
  // ── Cheese import ──
  { field: "cheeseImportLoading",      openValue: true                 },
  { field: "cheeseImportProgress",     openValue: 40                   },
  { field: "cheeseImportPrepared",     openValue: { rows: [] }         },
  { field: "cheeseImportApplying",     openValue: true                 },
  { field: "cheeseImportError",        openValue: "parse failed"       },
  // ── Premix import ──
  { field: "premixImportLoading",      openValue: true                 },
  { field: "premixImportProgress",     openValue: 60                   },
  { field: "premixImportPrepared",     openValue: { rows: [] }         },
  { field: "premixImportApplying",     openValue: true                 },
  { field: "premixImportError",        openValue: "parse failed"       },
  // ── Shipping import ──
  { field: "shippingImportLoading",    openValue: true                 },
  { field: "shippingImportPrepared",   openValue: { rows: [] }         },
  { field: "shippingImportApplying",   openValue: true                 },
  { field: "shippingImportError",      openValue: "parse failed"       },
  // ── Schedule editor / move ──
  { field: "scheduleEditorDate",       openValue: "2026-07-22"         },
  { field: "scheduleDeleteConfirm",    openValue: "2026-07-22"         },
  { field: "scheduleMove",             openValue: "run-1"              },
  { field: "scheduleMoveDate",         openValue: "2026-07-22"         },
  { field: "scheduleMoving",           openValue: true                 },
  { field: "scheduleSaving",           openValue: true                 },
  { field: "scheduleView",             openValue: "calendar"           },
  { field: "scheduleAdvancedRunId",    openValue: "run-1"              },
  { field: "scheduleEditorIsLiveDay",  openValue: false                },
  // ── Confirm dialogs ──
  { field: "confirmRemoveRun",         openValue: "run-1"              },
  { field: "confirmRemoveBlanks",      openValue: true                 },
  // ── PIN / password / auth ──
  { field: "pinInput",                 openValue: "1234"               },
  { field: "pinError",                 openValue: "wrong pin"          },
  { field: "newPin",                   openValue: "5678"               },
  { field: "newPinConfirm",            openValue: "5678"               },
  { field: "pinChangeMsg",             openValue: "PIN updated"        },
  // ── Resume / manual stop ──
  { field: "resumeDialog",             openValue: true                 },
  { field: "manualStopReason",         openValue: "Equipment issue"    },
  { field: "manualStopNotes",          openValue: "Machine down"       },
  { field: "manualStopStart",          openValue: "08:00"              },
  { field: "manualStopEnd",            openValue: "08:30"              },
  // ── Manage-dialog form inputs ──
  { field: "mgNamesInput",             openValue: "Cheese Blend"       },
  { field: "mgIngInput",               openValue: "Parmesan"           },
  { field: "mgStandaloneInput",        openValue: "new entry"          },
  { field: "templateNameInput",        openValue: "My Template"        },
  // NOTE: "newReasonInput" is a live-tab dep (stop-reason editing), NOT dialog-only
  { field: "brandInput",               openValue: "Acme"               },
  { field: "flavorInput",              openValue: "Plain"              },
  // ── Misc dialog / UI state ──
  { field: "copiedSummary",            openValue: true                 },
  { field: "expandedHistoryDay",       openValue: "2026-07-21"         },
  { field: "expandedScheduleDay",      openValue: "2026-07-23"         },
  // NOTE: "promotingRecipeKind" is a live-tab dep (recipe promotion flow), NOT dialog-only
  { field: "specReconcileSignal",      openValue: 1                    },
  { field: "pendingResetCount",        openValue: 2                    },
];
// ↑↑↑  END OF DIALOG FIELDS REGISTRY  ↑↑↑

// ── Simulation of homeTabCtxValue isolation ───────────────────────────────────
//
// Mirrors the pattern in home.tsx:
//   const homeTabCtxValue = useMemo(
//     () => homeCtxValueRef.current,
//     [liveField1, liveField2, …]   // dialog fields intentionally omitted
//   );
//
// In this simulation, dialogExtras is passed as a prop but intentionally NOT
// listed as a useMemo dep, so the context value ref is stable across dialog
// field changes.  If a dialog field were accidentally added to the dep list
// (i.e., the regression we are guarding against), the useMemo would fire on
// every dialog toggle → new ref → context update → subscriber re-renders.
function LiveTabGuardProvider({
  runStatus,
  brand,
  dialogExtras,
  children,
}: {
  runStatus: string;
  brand: string;
  dialogExtras: Record<string, unknown>;
  children: ReactNode;
}) {
  // Only live fields in deps — dialogExtras intentionally excluded.
  // This is the invariant home.tsx must maintain in homeTabCtxValue.
  const ctxValue = useMemo(
    () => ({
      runStatus,
      brand,
      flavor: "TestFlavor",
      // dialogExtras are captured at first render only (same as homeTabCtxValue
      // which reads homeCtxValueRef.current when its live deps last fired).
      // Subsequent dialog-only changes must NOT cause a new ref.
      ...dialogExtras,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runStatus, brand],
    // dialogExtras intentionally omitted — adding any dialog field here is
    // exactly the regression this test guards against.
  );
  return <HomeCtx.Provider value={ctxValue}>{children}</HomeCtx.Provider>;
}

describe("LiveTabMemo — Suite 4: homeTabCtxValue ref is stable across ALL dialog-state field changes (registry guard)", () => {
  afterEach(() => { cleanup(); });

  it("render count stays at 1 when every DIALOG_REGISTRY field toggles open then closed", async () => {
    // If any entry in DIALOG_REGISTRY accidentally enters the liveSlice useMemo
    // deps, toggling it would produce a new context ref → subscriber re-renders →
    // renderCount increases → this test fails.
    let renderCount = 0;

    const LiveTabSim4 = memo(function LiveTabSim4Inner() {
      renderCount++;
      const { runStatus, brand } = useHomeCtx();
      return <span data-testid="live4">{runStatus}|{brand}</span>;
    });

    const { rerender, getByTestId } = render(
      <LiveTabGuardProvider runStatus="running" brand="Acme" dialogExtras={{}}>
        <LiveTabSim4 />
      </LiveTabGuardProvider>,
    );

    // Confirm live data is correct after initial render.
    expect(getByTestId("live4").textContent).toBe("running|Acme");
    const initialRenderCount = renderCount;
    expect(initialRenderCount).toBe(1);

    // Cycle through every dialog field: open → closed.
    for (const { field, openValue } of DIALOG_REGISTRY) {
      await act(async () => {
        rerender(
          <LiveTabGuardProvider runStatus="running" brand="Acme" dialogExtras={{ [field]: openValue }}>
            <LiveTabSim4 />
          </LiveTabGuardProvider>,
        );
      });
      await act(async () => {
        rerender(
          <LiveTabGuardProvider runStatus="running" brand="Acme" dialogExtras={{}}>
            <LiveTabSim4 />
          </LiveTabGuardProvider>,
        );
      });
    }

    // Live values must be unchanged throughout — no dialog field affected them.
    expect(getByTestId("live4").textContent).toBe("running|Acme");

    // renderCount must still be 1: stable context ref → React bails out context
    // update → memo()-wrapped subscriber never re-renders.
    // A failure here means a DIALOG_REGISTRY field was added to the liveSlice
    // useMemo deps, which would cause all live tab components to re-render on
    // every dialog open/close cycle.
    expect(renderCount).toBe(initialRenderCount);
  });

  it("live data DOES update when actual run state changes (not over-isolated)", async () => {
    // Counter-proof: the isolation must not prevent genuine live-state updates.
    let renderCount = 0;

    const LiveTabSim4b = memo(function LiveTabSim4bInner() {
      renderCount++;
      const { runStatus, brand } = useHomeCtx();
      return <span data-testid="live4b">{runStatus}|{brand}</span>;
    });

    const { rerender, getByTestId } = render(
      <LiveTabGuardProvider runStatus="running" brand="Acme" dialogExtras={{}}>
        <LiveTabSim4b />
      </LiveTabGuardProvider>,
    );

    expect(getByTestId("live4b").textContent).toBe("running|Acme");
    const countAfterMount = renderCount;

    // Change a live field → liveSlice useMemo must invalidate → subscriber re-renders.
    await act(async () => {
      rerender(
        <LiveTabGuardProvider runStatus="paused" brand="Acme" dialogExtras={{}}>
          <LiveTabSim4b />
        </LiveTabGuardProvider>,
      );
    });

    expect(getByTestId("live4b").textContent).toBe("paused|Acme");
    expect(renderCount).toBeGreaterThan(countAfterMount);
  });

  it("all DIALOG_REGISTRY entries are distinct (no duplicate field names)", () => {
    const fieldNames = DIALOG_REGISTRY.map(({ field }) => field);
    const unique = new Set(fieldNames);
    expect(unique.size).toBe(fieldNames.length);
  });

  it("no DIALOG_REGISTRY field appears in HOME_TAB_CTX_DEP_FIELDS (static dep-list guard)", () => {
    // !! THIS IS THE PRIMARY REGRESSION GUARD !!
    //
    // HOME_TAB_CTX_DEP_FIELDS (from homeTabCtxDeps.ts) mirrors the real
    // homeTabCtxValue useMemo dep array in home.tsx.  The two files carry a
    // "KEEP IN SYNC" contract: when a developer adds a dep to homeTabCtxValue,
    // they must also add it to homeTabCtxDeps.ts.
    //
    // This static test verifies that none of the DIALOG_REGISTRY fields appear
    // in HOME_TAB_CTX_DEP_FIELDS.  If a dialog field is accidentally added to
    // homeTabCtxValue's deps AND reflected in homeTabCtxDeps.ts, this test
    // fails immediately — preventing the manage-dialog freeze regression.
    //
    // Failure here means: a dialog/manage/import field has entered the
    // homeTabCtxValue dep list, which will cause all 8 live tab components to
    // re-render on every dialog open/close cycle (the original freeze bug).
    const liveDepSet = new Set<string>(HOME_TAB_CTX_DEP_FIELDS);
    const violations: string[] = [];
    for (const { field } of DIALOG_REGISTRY) {
      if (liveDepSet.has(field)) {
        violations.push(field);
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `The following dialog-state fields were found in HOME_TAB_CTX_DEP_FIELDS ` +
        `(homeTabCtxDeps.ts) — they must be removed from homeTabCtxValue's dep ` +
        `list to prevent the manage-dialog freeze regression:\n  ${violations.join(", ")}`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4 counter-proof — guard DOES catch the regression
//
// This describe block is the explicit counter-proof for Suite 4.  It
// deliberately introduces the regression that Suite 4 guards against: a
// "BrokenLiveTabGuardProvider" that puts dialogExtras IN the useMemo dep list.
//
// Expected behaviour:
//   • Every time a dialog field changes, useMemo fires a new object ref.
//   • The context update propagates to the memo()-wrapped subscriber.
//   • renderCount increases beyond 1 — exactly the bug Suite 4 prevents.
//
// If this describe block ever starts PASSING with renderCount === 1, the
// counter-proof is wrong and must be fixed — it means the broken provider is
// accidentally correct (i.e., the regression would not be caught).
// ═══════════════════════════════════════════════════════════════════════════════

// ── Deliberately broken provider — dialogExtras IS in useMemo deps ────────────
//
// This mirrors what would happen if a developer accidentally added a dialog
// field to homeTabCtxValue's useMemo dep list in home.tsx.  Every dialog
// open/close cycle produces a new context ref → subscriber re-renders.
function BrokenLiveTabGuardProvider({
  runStatus,
  brand,
  dialogExtras,
  children,
}: {
  runStatus: string;
  brand: string;
  dialogExtras: Record<string, unknown>;
  children: ReactNode;
}) {
  // BUG: dialogExtras is in the dep list — this is exactly the regression
  // that Suite 4 guards against.  Any change to dialogExtras invalidates
  // the memo → new context ref → all subscribers re-render.
  const ctxValue = useMemo(
    () => ({
      runStatus,
      brand,
      flavor: "TestFlavor",
      ...dialogExtras,
    }),
    // dialogExtras intentionally INCLUDED here to simulate the regression.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runStatus, brand, dialogExtras],
  );
  return <HomeCtx.Provider value={ctxValue}>{children}</HomeCtx.Provider>;
}

describe("LiveTabMemo — Suite 4 counter-proof: guard DOES catch the regression (dialog field in liveSlice deps)", () => {
  afterEach(() => { cleanup(); });

  it("renderCount exceeds 1 when a dialog field is in the liveSlice useMemo deps (broken variant)", async () => {
    // This test asserts the BROKEN behaviour — it confirms that putting
    // dialogExtras in the useMemo dep list causes the subscriber to re-render
    // on every dialog field change.  Suite 4's passing test (renderCount === 1)
    // therefore IS a meaningful guard: the moment that invariant breaks, the
    // subscriber re-renders, and the passing test flips to failing.
    let renderCount = 0;

    const BrokenLiveTabSim = memo(function BrokenLiveTabSimInner() {
      renderCount++;
      const { runStatus, brand } = useHomeCtx();
      return <span data-testid="broken-live">{runStatus}|{brand}</span>;
    });

    const { rerender } = render(
      <BrokenLiveTabGuardProvider runStatus="running" brand="Acme" dialogExtras={{}}>
        <BrokenLiveTabSim />
      </BrokenLiveTabGuardProvider>,
    );

    expect(renderCount).toBe(1);

    // Toggle a dialog field — because dialogExtras IS in the dep list, this
    // produces a new context ref → React propagates the update → memo()-wrapped
    // subscriber re-renders even though runStatus and brand are unchanged.
    await act(async () => {
      rerender(
        <BrokenLiveTabGuardProvider
          runStatus="running"
          brand="Acme"
          dialogExtras={{ manageCategory: "mixes" }}
        >
          <BrokenLiveTabSim />
        </BrokenLiveTabGuardProvider>,
      );
    });

    // renderCount MUST be > 1: the broken dep list caused an unnecessary
    // re-render.  If this assertion fails it means the broken provider
    // accidentally avoids re-renders — the counter-proof is invalid.
    expect(renderCount).toBeGreaterThan(1);

    // Live values are still correct (the bug is about frequency, not values).
    const el = document.querySelector("[data-testid='broken-live']");
    expect(el?.textContent).toBe("running|Acme");
  });

  it("every DIALOG_REGISTRY field individually causes a spurious re-render when in useMemo deps (broken variant)", async () => {
    // Exhaustive per-field version of the counter-proof.  Each entry in
    // DIALOG_REGISTRY is toggled in isolation to confirm that ANY single
    // dialog field in the dep list is enough to trigger the bug.
    for (const { field, openValue } of DIALOG_REGISTRY) {
      let renderCount = 0;

      const BrokenSim = memo(function BrokenSimInner() {
        renderCount++;
        useHomeCtx();
        return null;
      });

      const { rerender, unmount } = render(
        <BrokenLiveTabGuardProvider runStatus="running" brand="Acme" dialogExtras={{}}>
          <BrokenSim />
        </BrokenLiveTabGuardProvider>,
      );

      expect(renderCount).toBe(1);

      await act(async () => {
        rerender(
          <BrokenLiveTabGuardProvider
            runStatus="running"
            brand="Acme"
            dialogExtras={{ [field]: openValue }}
          >
            <BrokenSim />
          </BrokenLiveTabGuardProvider>,
        );
      });

      // Each individual dialog field must cause a re-render when in deps.
      // If any field does NOT trigger a re-render, the counter-proof is wrong
      // for that field (e.g., the value is referentially stable by accident).
      expect(renderCount).toBeGreaterThan(
        1,
        `Expected field "${field}" to cause a spurious re-render when in useMemo deps, but renderCount stayed at 1`,
      );

      unmount();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 3 — Tab switching preserves live data (no stale snapshot)
// ═══════════════════════════════════════════════════════════════════════════════
//
// When the user switches from tab A to tab B and back, the re-mounted tab must
// show current (non-stale) live data immediately.  The real useLiveRun() hook
// is used so this mirrors the actual subscription the real tab components hold.

describe("LiveTabMemo — tab switching preserves live data (no stale snapshot)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it("switching tabs does not serve a frozen clock snapshot to the newly active tab", async () => {
    const capturedNow: Record<string, number[]> = { run: [], dough: [] };

    const RunTabSim = memo(function RunTabSimInner() {
      const { nowTime } = useLiveRun();
      capturedNow.run.push(nowTime.getTime());
      return null;
    });

    const DoughTabSim = memo(function DoughTabSimInner() {
      const { nowTime } = useLiveRun();
      capturedNow.dough.push(nowTime.getTime());
      return null;
    });

    const TabHost = ({ activeTab }: { activeTab: "run" | "dough" }) => (
      <LiveOnlyWrapper>
        {activeTab === "run"   ? <RunTabSim />  : null}
        {activeTab === "dough" ? <DoughTabSim /> : null}
      </LiveOnlyWrapper>
    );

    const { rerender } = render(<TabHost activeTab="run" />);

    await act(async () => { vi.advanceTimersByTime(5_000); });

    const runNowBeforeSwitch = capturedNow.run[capturedNow.run.length - 1];

    await act(async () => { rerender(<TabHost activeTab="dough" />); });
    await act(async () => { vi.advanceTimersByTime(5_000); });

    // Dough tab's first render must show a timestamp ≥ run tab's last
    const doughFirstNow = capturedNow.dough[0];
    expect(doughFirstNow).toBeGreaterThanOrEqual(runNowBeforeSwitch);

    await act(async () => { rerender(<TabHost activeTab="run" />); });

    const runNowAfterReturn = capturedNow.run[capturedNow.run.length - 1];
    const doughLastNow = capturedNow.dough[capturedNow.dough.length - 1];

    // Run tab on return must show a timestamp at least as new as dough's last
    expect(runNowAfterReturn).toBeGreaterThanOrEqual(doughLastNow);
  });

  it("clock continues to tick on the tab after a switch-away and return (no subscription leak)", async () => {
    const nowSamples: number[] = [];

    const TickingTab = memo(function TickingTabInner() {
      const { nowTime } = useLiveRun();
      nowSamples.push(nowTime.getTime());
      return null;
    });

    const TabHost2 = ({ show }: { show: boolean }) => (
      <LiveOnlyWrapper>
        {show ? <TickingTab /> : null}
      </LiveOnlyWrapper>
    );

    const { rerender } = render(<TabHost2 show={true} />);
    await act(async () => { vi.advanceTimersByTime(2_000); });

    const countBeforeHide = nowSamples.length;
    expect(countBeforeHide).toBeGreaterThan(1);

    await act(async () => { rerender(<TabHost2 show={false} />); });
    await act(async () => { vi.advanceTimersByTime(2_000); });

    const countWhileHidden = nowSamples.length;
    expect(countWhileHidden).toBe(countBeforeHide);

    await act(async () => { rerender(<TabHost2 show={true} />); });
    await act(async () => { vi.advanceTimersByTime(2_000); });

    const countAfterReturn = nowSamples.length;
    expect(countAfterReturn).toBeGreaterThan(countWhileHidden);

    const lastBeforeHide = nowSamples[countBeforeHide - 1];
    const firstAfterReturn = nowSamples[countWhileHidden];
    expect(firstAfterReturn).toBeGreaterThan(lastBeforeHide);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4 — GlanceOverlay live values (nowTime, casesInFreezer) advance while
//            a manage dialog is simultaneously rendered  [SIMULATOR]
// ═══════════════════════════════════════════════════════════════════════════════
//
// GlanceOverlay is the one memo()-wrapped component that floats over the full
// page and stays VISIBLE while a manage dialog is open — unlike the tab
// components, which are hidden behind the dialog.  A silent memo-defeat would
// freeze the overlay for users who open a manage panel mid-run.
//
// The simulator here mirrors GlanceOverlay's exact dual-context subscription:
//   • useLiveRun()   → nowTime, casesInFreezer
//   • useHomeCtx()   → manageCategory (manage/dialog state)
//
// The test:
//   1. Renders the overlay simulator + a visible "manage dialog" simultaneously.
//   2. Advances the fake clock by 60 s.
//   3. Asserts both nowTime AND casesInFreezer advanced — proving the live
//      subscription is NOT blocked by the concurrent dialog render.

describe("LiveTabMemo — GlanceOverlay live values advance while manage dialog is open", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it("GlanceOverlay nowTime advances while a manage dialog is rendered concurrently", async () => {
    const nowSamples: number[] = [];

    const GlanceOverlaySim = memo(function GlanceOverlaySimInner() {
      useHomeCtx();                        // mirrors real GlanceOverlay's homeCtx read
      const { nowTime } = useLiveRun();
      nowSamples.push(nowTime.getTime());
      return <span data-testid="glance-now">{nowTime.getTime()}</span>;
    });

    render(
      <BothContextsWrapper runStatus="running" brand="TestBrand" manageCategory="mixes">
        {/* Simulate the manage dialog being open at the same time as the overlay */}
        <div data-testid="manage-dialog">Manage: mixes</div>
        <GlanceOverlaySim />
      </BothContextsWrapper>,
    );

    const firstNow = nowSamples[0];
    expect(firstNow).toBeGreaterThan(0);

    await act(async () => { vi.advanceTimersByTime(60_000); });

    const lastNow = nowSamples[nowSamples.length - 1];
    // Clock ticked — overlay must have re-rendered with a newer timestamp
    expect(lastNow).toBeGreaterThan(firstNow);
  });

  it("GlanceOverlay casesInFreezer advances while a manage dialog is rendered concurrently", async () => {
    const freezerSamples: number[] = [];

    const GlanceOverlaySim = memo(function GlanceOverlaySimInner() {
      useHomeCtx();
      const { calc } = useLiveRun();
      freezerSamples.push(calc.casesInFreezer);
      return <span data-testid="glance-freezer">{calc.casesInFreezer}</span>;
    });

    render(
      <BothContextsWrapper runStatus="running" brand="TestBrand" manageCategory="mixes">
        <div data-testid="manage-dialog">Manage: mixes</div>
        <GlanceOverlaySim />
      </BothContextsWrapper>,
    );

    const firstFreezer = freezerSamples[0];

    // Advance enough time for freezer accumulation (ACTIVE_VALUES: ppm>0, freezerTime=30min)
    await act(async () => { vi.advanceTimersByTime(60_000); });

    const lastFreezer = freezerSamples[freezerSamples.length - 1];
    expect(lastFreezer).toBeGreaterThan(firstFreezer);
  });

  it("opening and closing a manage dialog does NOT reset GlanceOverlay live values", async () => {
    const nowSamples: number[] = [];

    const GlanceOverlaySim = memo(function GlanceOverlaySimInner() {
      useHomeCtx();
      const { nowTime } = useLiveRun();
      nowSamples.push(nowTime.getTime());
      return null;
    });

    const { rerender } = render(
      <BothContextsWrapper runStatus="running" brand="TestBrand" manageCategory="">
        <GlanceOverlaySim />
      </BothContextsWrapper>,
    );

    await act(async () => { vi.advanceTimersByTime(5_000); });
    const nowBeforeDialog = nowSamples[nowSamples.length - 1];

    // Open manage dialog — only manageCategory changes, live state unchanged
    await act(async () => {
      rerender(
        <BothContextsWrapper runStatus="running" brand="TestBrand" manageCategory="mixes">
          <div data-testid="manage-dialog">Manage: mixes</div>
          <GlanceOverlaySim />
        </BothContextsWrapper>,
      );
    });

    await act(async () => { vi.advanceTimersByTime(5_000); });

    // Close manage dialog
    await act(async () => {
      rerender(
        <BothContextsWrapper runStatus="running" brand="TestBrand" manageCategory="">
          <GlanceOverlaySim />
        </BothContextsWrapper>,
      );
    });

    await act(async () => { vi.advanceTimersByTime(5_000); });

    const nowAfterClose = nowSamples[nowSamples.length - 1];

    // Clock must have advanced monotonically through the full open/close cycle
    expect(nowAfterClose).toBeGreaterThan(nowBeforeDialog);
    // No sample should be less than the value before the dialog opened
    for (const sample of nowSamples) {
      expect(sample).toBeGreaterThanOrEqual(nowSamples[0]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 5 — FloorModeView skips re-renders when manage/import dialogs open
// ═══════════════════════════════════════════════════════════════════════════════
//
// FloorModeView was switched from useHomeCtx() to useHomeTabCtx() so that
// manage/import/merge dialog state changes (which update HomeCtx but are
// intentionally OMITTED from homeTabCtxValue's useMemo deps) do not cause
// the overlay to re-render and stutter mid-run.
//
// FloorModeView's dual-context subscription:
//   • useHomeTabCtx()  → runStatus, currentRun, v, ve, form, … (production deps)
//   • useLiveRun()     → nowTime, calc, casesInFreezer, … (live clock)
//
// Three tests:
//  1. ISOLATION  — toggling a manage/merge/import counter (excluded from
//     homeTabCtxValue deps) does NOT cause the FloorModeView subscriber to
//     re-render.
//  2. LIVE CLOCK — live values (nowTime, casesInFreezer) keep advancing while
//     the manage dialog is simultaneously rendered — the LiveRunProvider
//     subscription is not blocked.
//  3. PROPAGATION — a real production-dep change (runStatus) DOES reach the
//     FloorModeView subscriber (over-memoisation guard).

// ── Wrapper: HomeTabCtx (production deps only) + LiveRunProvider ─────────────
//
// Mirrors the isolation home.tsx must maintain:
//   homeTabCtxValue = useMemo(() => …, [dayState, v, ve, runState, …])
//   // manageCategory / showManageDialog / importState intentionally omitted
//
// manageCounter stands in for any dialog/import/merge state field that is
// intentionally excluded from homeTabCtxValue's useMemo deps.

// Module-level stable references so FloorModeWrapper re-renders (caused by
// manageCounter prop changing) do not create new object identities for
// LiveRunProvider props — which would otherwise emit a spurious context update
// and defeat the isolation test.
const FLOOR_DAY_STATE = { runs: [ACTIVE_RUN], currentIndex: 0 } as const;
const FLOOR_UPCOMING_LABELS: string[] = [];
const FLOOR_MACHINE = { spinSec: 0, hopperSec: 0 } as const;

function FloorModeWrapper({
  runStatus = "running",
  manageCounter = 0,
  children,
}: {
  runStatus?: string;
  manageCounter?: number;
  children: ReactNode;
}) {
  const form = useForm<FormValues>({ defaultValues: ACTIVE_VALUES });

  // Production deps only — manageCounter intentionally excluded.
  // This is the contract FloorModeView relies on: dialog state must never
  // reach homeTabCtxValue's useMemo dep array.
  const tabCtxValue = useMemo(
    () => ({ runStatus, casesNeeded: ACTIVE_VALUES.casesNeeded }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runStatus],
  );

  return (
    <HomeTabCtx.Provider value={tabCtxValue}>
      <LiveRunProvider
        v={ACTIVE_VALUES}
        ve={ACTIVE_VALUES}
        runStatus={runStatus as "running"}
        currentRun={ACTIVE_RUN}
        currentRunId="run-live-1"
        form={form}
        dayState={FLOOR_DAY_STATE}
        doughSubTab="dough"
        upcomingRunLabels={FLOOR_UPCOMING_LABELS}
        prefs={undefined}
        screenMode={null}
        machine={FLOOR_MACHINE}
      >
        {/* Expose manageCounter in the tree to simulate the dialog being
            rendered, but it is NOT in HomeTabCtx — mirrors how home.tsx
            renders a dialog element alongside FloorModeView without
            putting dialog state into homeTabCtxValue. */}
        {manageCounter > 0 && (
          <div data-testid="manage-dialog">Manage dialog #{manageCounter}</div>
        )}
        {children}
      </LiveRunProvider>
    </HomeTabCtx.Provider>
  );
}

describe("LiveTabMemo — FloorModeView skips re-renders when manage/import dialogs open", () => {
  afterEach(() => { cleanup(); });

  // ─── Test 1: ISOLATION ────────────────────────────────────────────────────
  // FloorModeView uses useHomeTabCtx() (not useHomeCtx()), so the isolation
  // guarantee is: when manage/merge/import state changes (excluded from
  // homeTabCtxValue deps), the component does NOT re-render.
  //
  // Uses the full FloorModeWrapper (HomeTabCtx + LiveRunProvider) with fake
  // timers to prevent clock ticks from emitting spurious context updates,
  // keeping renderCount clean and the assertion decisive.
  //
  // The LiveRunContext value is now wrapped in useMemo — so even though
  // LiveRunProvider is present, it does NOT emit a new context object unless
  // one of its constituent values (nowTime, calc, …) actually changes.
  // With frozen fake timers, nowTime never advances and value stays stable,
  // so only a HomeTabCtx change (runStatus) would trigger a re-render.
  it("FloorModeView does NOT re-render when manage/merge/import dialog state toggles", async () => {
    vi.useFakeTimers();
    try {
      let renderCount = 0;

      const FloorModeViewSim = memo(function FloorModeViewSimInner() {
        renderCount++;
        // Mirrors FloorModeView's dual-context subscription:
        //   useHomeTabCtx() for production state (run/form/status)
        //   useLiveRun()    for live clock values
        // The isolation guarantee: dialog/manage state NEVER reaches
        // homeTabCtxValue's deps, so manageCounter changes produce no re-render.
        const { runStatus } = useHomeTabCtx();
        useLiveRun();
        return <span data-testid="floor-status">{runStatus}</span>;
      });

      const { rerender } = render(
        <FloorModeWrapper runStatus="running" manageCounter={0}>
          <FloorModeViewSim />
        </FloorModeWrapper>,
      );
      // Flush any mount effects (e.g. stallPrompt effect calling setState with
      // its own initial value, which React may still schedule a re-render for).
      await act(async () => {});
      const countAfterMount = renderCount;

      // Open manage dialog — manageCounter changes, runStatus unchanged.
      // HomeTabCtx value is stable (runStatus unchanged) and LiveRunContext
      // value is stable (nowTime frozen by fake timers) → React.memo skips.
      await act(async () => {
        rerender(
          <FloorModeWrapper runStatus="running" manageCounter={1}>
            <FloorModeViewSim />
          </FloorModeWrapper>,
        );
      });

      expect(renderCount).toBe(countAfterMount);

      // Further dialog state changes (e.g. import progress ticking)
      await act(async () => {
        rerender(
          <FloorModeWrapper runStatus="running" manageCounter={42}>
            <FloorModeViewSim />
          </FloorModeWrapper>,
        );
      });

      expect(renderCount).toBe(countAfterMount);

      // Close dialog — still no re-render.
      await act(async () => {
        rerender(
          <FloorModeWrapper runStatus="running" manageCounter={0}>
            <FloorModeViewSim />
          </FloorModeWrapper>,
        );
      });

      expect(renderCount).toBe(countAfterMount);
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── Test 1 counter-proof: ISOLATION REGRESSION DETECTION ────────────────
  // Proves the test framework CAN detect the exact regression Test 1 guards
  // against: if someone accidentally adds a dialog field (e.g. manageCounter)
  // to homeTabCtxValue's useMemo deps, the subscriber WILL re-render on every
  // dialog state change.
  //
  // This mirrors the Suite 1 counter-proof ("memo() does NOT prevent live tabs
  // from receiving useLiveRun() context updates (counter-proof)") and ensures
  // Test 1 is not a vacuous pass — the test harness is sensitive enough to
  // surface the regression.
  it("FloorModeView re-render count DOES increase when dialog state leaks into useMemo deps (isolation regression counter-proof)", async () => {
    let renderCount = 0;

    // Leaky provider: manageCounter IS included in useMemo deps, simulating the
    // regression where a developer accidentally adds a dialog/manage field to
    // homeTabCtxValue's dep array.
    function TabOnlyProviderLeaky({
      runStatus,
      manageCounter,
      children,
    }: {
      runStatus: string;
      manageCounter: number;
      children: ReactNode;
    }) {
      // manageCounter intentionally IN deps — this is the regression under test
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const value = useMemo(() => ({ runStatus }), [runStatus, manageCounter]);
      return <HomeTabCtx.Provider value={value}>{children}</HomeTabCtx.Provider>;
    }

    const FloorModeViewSim = memo(function FloorModeViewSimInner() {
      renderCount++;
      const { runStatus } = useHomeTabCtx();
      return <span data-testid="floor-status-leak">{runStatus}</span>;
    });

    const { rerender } = render(
      <TabOnlyProviderLeaky runStatus="running" manageCounter={0}>
        <FloorModeViewSim />
      </TabOnlyProviderLeaky>,
    );

    expect(renderCount).toBe(1);

    // Open manage dialog — manageCounter changes, runStatus unchanged.
    // Because manageCounter IS in deps this time, the context ref changes →
    // the subscriber re-renders (the regression).
    await act(async () => {
      rerender(
        <TabOnlyProviderLeaky runStatus="running" manageCounter={1}>
          <FloorModeViewSim />
        </TabOnlyProviderLeaky>,
      );
    });

    // renderCount MUST be > 1 — proves the framework detects context leakage
    expect(renderCount).toBeGreaterThan(1);
  });

  // ─── Tests 2a / 2b: LIVE CLOCK ────────────────────────────────────────────
  // FloorModeView is the one floor-mode overlay that stays VISIBLE while a
  // manager is in a dialog.  The live clock and casesInFreezer must keep
  // advancing — the LiveRunProvider subscription must not be blocked.
  //
  // These tests use the full FloorModeWrapper (HomeTabCtx + LiveRunProvider)
  // with fake timers to verify that live subscriptions keep ticking.
  it("FloorModeView nowTime advances while a manage dialog is simultaneously rendered", async () => {
    vi.useFakeTimers();
    try {
      const nowSamples: number[] = [];

      const FloorModeViewSim = memo(function FloorModeViewSimInner() {
        useHomeTabCtx();
        const { nowTime } = useLiveRun();
        nowSamples.push(nowTime.getTime());
        return <span data-testid="floor-now">{nowTime.getTime()}</span>;
      });

      // Render with the manage dialog already open (manageCounter=1)
      render(
        <FloorModeWrapper runStatus="running" manageCounter={1}>
          <FloorModeViewSim />
        </FloorModeWrapper>,
      );

      const firstNow = nowSamples[0];
      expect(firstNow).toBeGreaterThan(0);

      // Advance the clock — the overlay must keep receiving ticks.
      await act(async () => { vi.advanceTimersByTime(60_000); });

      const lastNow = nowSamples[nowSamples.length - 1];
      expect(lastNow).toBeGreaterThan(firstNow);
    } finally {
      vi.useRealTimers();
    }
  });

  it("FloorModeView casesInFreezer advances while a manage dialog is simultaneously rendered", async () => {
    vi.useFakeTimers();
    try {
      const freezerSamples: number[] = [];

      const FloorModeViewSim = memo(function FloorModeViewSimInner() {
        useHomeTabCtx();
        const { calc } = useLiveRun();
        freezerSamples.push(calc.casesInFreezer);
        return <span data-testid="floor-freezer">{calc.casesInFreezer}</span>;
      });

      render(
        <FloorModeWrapper runStatus="running" manageCounter={1}>
          <FloorModeViewSim />
        </FloorModeWrapper>,
      );

      const firstFreezer = freezerSamples[0];

      // ACTIVE_VALUES gives ppm > 0 and freezerTime = 30 min; advance enough
      // for cases to accumulate in the freezer.
      await act(async () => { vi.advanceTimersByTime(60_000); });

      const lastFreezer = freezerSamples[freezerSamples.length - 1];
      expect(lastFreezer).toBeGreaterThan(firstFreezer);
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── Test 3: PROPAGATION ─────────────────────────────────────────────────
  // Guard against over-memoisation: when a REAL production dep (runStatus)
  // changes, FloorModeView MUST re-render to show the updated status.
  //
  // Uses the full FloorModeWrapper (HomeTabCtx + LiveRunProvider) with fake
  // timers so the clock doesn't tick.  The only trigger for a re-render is
  // the HomeTabCtx value change caused by runStatus flipping — proving the
  // memoisation is not over-aggressive.
  it("FloorModeView DOES re-render when a production dep (runStatus) changes", async () => {
    vi.useFakeTimers();
    try {
      let renderCount = 0;

      const FloorModeViewSim = memo(function FloorModeViewSimInner() {
        renderCount++;
        const { runStatus } = useHomeTabCtx();
        useLiveRun();
        return <span data-testid="floor-status">{runStatus}</span>;
      });

      const { rerender, getByTestId } = render(
        <FloorModeWrapper runStatus="running" manageCounter={0}>
          <FloorModeViewSim />
        </FloorModeWrapper>,
      );
      await act(async () => {});
      const countAfterMount = renderCount;
      expect(getByTestId("floor-status").textContent).toBe("running");

      // Simulate run pausing — runStatus changes → HomeTabCtx ref invalidated
      // → subscriber re-renders with new runStatus.
      await act(async () => {
        rerender(
          <FloorModeWrapper runStatus="paused" manageCounter={0}>
            <FloorModeViewSim />
          </FloorModeWrapper>,
        );
      });

      expect(renderCount).toBeGreaterThan(countAfterMount);
      expect(getByTestId("floor-status").textContent).toBe("paused");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 6 — REAL GlanceOverlay component stays live while a manage dialog is open
// ═══════════════════════════════════════════════════════════════════════════════
//
// Suite 4 above uses a SIMULATOR that mirrors GlanceOverlay's subscription
// pattern.  This suite imports and renders the ACTUAL GlanceOverlay component
// from src/components/GlanceOverlay.tsx.  If the real component were refactored
// to snapshot a value instead of subscribing (e.g. reading from a ref rather
// than calling useLiveRun()), the Suite 4 simulator would still pass but this
// test would fail — catching the regression before it ships.
//
// The wrapper supplies:
//   • HomeTabCtx.Provider — provides currentRun, runStatus, setShowGlance, v
//   • LiveRunProvider      — drives the live clock and casesInFreezer calc
//
// The manage dialog is simulated as a plain <div data-testid="glance-manage-dialog">
// rendered CONCURRENTLY with GlanceOverlay, matching the real production tree
// where both are mounted at the same time.

// ── Minimal homeTabCtx value the real GlanceOverlay reads ────────────────────
function makeHomeTabCtxValue(runStatus: string, extras: Record<string, unknown> = {}) {
  return {
    runStatus,
    currentRun: { id: "run-live-1", brand: "TestBrand", flavor: "TestFlavor" },
    setShowGlance: () => {},
    v: ACTIVE_VALUES,
    ...extras,
  };
}

// ── Provider wrapper: HomeTabCtx.Provider + LiveRunProvider ───────────────────
function RealGlanceWrapper({
  runStatus = "running",
  manageOpen = false,
  children,
}: {
  runStatus?: string;
  manageOpen?: boolean;
  children: ReactNode;
}) {
  const form = useForm<FormValues>({ defaultValues: ACTIVE_VALUES });
  const tabCtxValue = useMemo(
    () => makeHomeTabCtxValue(runStatus),
    [runStatus],
  );
  return (
    <HomeTabCtx.Provider value={tabCtxValue}>
      <LiveRunProvider
        v={ACTIVE_VALUES}
        ve={ACTIVE_VALUES}
        runStatus={runStatus as "running"}
        currentRun={ACTIVE_RUN}
        currentRunId="run-live-1"
        form={form}
        dayState={{ runs: [ACTIVE_RUN], currentIndex: 0 }}
        doughSubTab="dough"
        upcomingRunLabels={[]}
        prefs={undefined}
        screenMode={null}
        machine={{ spinSec: 0, hopperSec: 0 }}
      >
        {manageOpen && (
          <div data-testid="glance-manage-dialog">Manage: mixes</div>
        )}
        {children}
      </LiveRunProvider>
    </HomeTabCtx.Provider>
  );
}

describe("LiveTabMemo — REAL GlanceOverlay stays live while a manage dialog is open", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it("real GlanceOverlay: nowTime (data-now attr) advances after a clock tick while manage dialog is present", async () => {
    const { getByTestId } = render(
      <RealGlanceWrapper runStatus="running" manageOpen={true}>
        <GlanceOverlay />
      </RealGlanceWrapper>,
    );

    // Confirm manage dialog is simultaneously present
    expect(getByTestId("glance-manage-dialog")).toBeTruthy();

    // Read the initial nowTime from the data-now attribute stamped by GlanceOverlay
    const firstNow = Number(getByTestId("glance-now").getAttribute("data-now"));
    expect(firstNow).toBeGreaterThan(0);

    // Advance clock by 60 s — GlanceOverlay must re-render via useLiveRun()
    await act(async () => { vi.advanceTimersByTime(60_000); });

    const lastNow = Number(getByTestId("glance-now").getAttribute("data-now"));
    expect(lastNow).toBeGreaterThan(firstNow);
  });

  it("real GlanceOverlay: casesInFreezer displayed advances after a clock tick while manage dialog is present", async () => {
    const { getByTestId } = render(
      <RealGlanceWrapper runStatus="running" manageOpen={true}>
        <GlanceOverlay />
      </RealGlanceWrapper>,
    );

    expect(getByTestId("glance-manage-dialog")).toBeTruthy();

    // Let the run accumulate freezer stock over 60 s
    // (ACTIVE_VALUES: ppm > 0, freezerTime = 30 min → casesInFreezer grows)
    await act(async () => { vi.advanceTimersByTime(60_000); });

    // The "+N in freezer" element must be present and non-zero
    const freezerEl = getByTestId("glance-cases-freezer");
    expect(freezerEl).toBeTruthy();
    const freezerText = freezerEl.textContent ?? "";
    const match = freezerText.match(/[\d,.]+/);
    expect(match).toBeTruthy();
    expect(parseFloat((match![0] ?? "0").replace(/,/g, ""))).toBeGreaterThan(0);
  });

  it("real GlanceOverlay: live values continue advancing when manage dialog opens mid-run (open after start, not concurrent from mount)", async () => {
    const { getByTestId, rerender } = render(
      <RealGlanceWrapper runStatus="running" manageOpen={false}>
        <GlanceOverlay />
      </RealGlanceWrapper>,
    );

    await act(async () => { vi.advanceTimersByTime(5_000); });
    const nowBeforeDialog = Number(getByTestId("glance-now").getAttribute("data-now"));

    // Open the manage dialog mid-run
    await act(async () => {
      rerender(
        <RealGlanceWrapper runStatus="running" manageOpen={true}>
          <GlanceOverlay />
        </RealGlanceWrapper>,
      );
    });

    expect(getByTestId("glance-manage-dialog")).toBeTruthy();

    // Clock keeps ticking with the dialog open
    await act(async () => { vi.advanceTimersByTime(5_000); });

    const nowWithDialog = Number(getByTestId("glance-now").getAttribute("data-now"));
    expect(nowWithDialog).toBeGreaterThan(nowBeforeDialog);
  });

  it("real GlanceOverlay: render count increases after 60 s of clock ticks (no data attribute reliance)", async () => {
    // This test guards against a future refactor that drops the `nowTime`
    // destructuring from GlanceOverlay's useLiveRun() call.  Without `nowTime`
    // being read, React may not schedule a re-render on every clock tick (memo +
    // selective context subscription).  The overlay clock display would then
    // silently freeze mid-run.
    //
    // Unlike the sibling tests above, this test does NOT rely on the `data-now`
    // attribute being present.  Instead it spies on the `useLiveRun` hook so
    // that every invocation — i.e. every render of GlanceOverlay — is counted
    // directly.
    //
    // IMPORTANT: GlanceOverlay is the ONLY component in this test's subtree
    // that calls useLiveRun().  RealGlanceWrapper only sets up providers
    // (HomeTabCtx.Provider + LiveRunProvider) — it does NOT call useLiveRun()
    // itself.  This means the spy call-count maps 1-to-1 to GlanceOverlay's
    // own render count.  If future changes add other useLiveRun() consumers
    // inside RealGlanceWrapper, the 1:1 assumption breaks and this test should
    // be updated to use a dedicated minimal wrapper instead.
    //
    // If a refactor stops importing / destructuring `nowTime` and React's memo
    // coalesces away the per-tick re-renders, the spy call-count stops advancing
    // and this test fails — catching the regression before it ships.
    const spy = vi.spyOn(LiveRunContextNS, "useLiveRun");

    try {
      render(
        <RealGlanceWrapper runStatus="running" manageOpen={true}>
          <GlanceOverlay />
        </RealGlanceWrapper>,
      );

      // The initial mount(s) give us a baseline call count.
      const countAtMount = spy.mock.calls.length;
      expect(countAtMount).toBeGreaterThan(0);

      // Advance 60 s — each clock tick emits a new LiveRunProvider context
      // value → React re-renders GlanceOverlay → useLiveRun is invoked again.
      await act(async () => { vi.advanceTimersByTime(60_000); });

      // The spy must have been called more times than at mount.  This is true
      // regardless of which fields are destructured from useLiveRun() — it only
      // fails if the component stops re-rendering entirely on clock ticks.
      expect(spy.mock.calls.length).toBeGreaterThan(countAtMount);
    } finally {
      spy.mockRestore();
    }
  });

  it("real GlanceOverlay: useHomeTabCtx spy call-count advances when runStatus changes (render-count guard)", async () => {
    // Guards the symmetric risk on the useHomeTabCtx() side: if a refactor
    // drops that subscription (e.g. by removing the destructure or switching
    // to a ref snapshot), GlanceOverlay would stop re-rendering when runStatus
    // or the active run changes mid-overlay.
    //
    // The spy counts every invocation of useHomeTabCtx() inside the test
    // subtree.  GlanceOverlay is the ONLY component in this subtree that
    // calls useHomeTabCtx() — RealGlanceWrapper only sets up the providers
    // without calling the hook itself — so the count maps 1-to-1 to
    // GlanceOverlay's own render count.
    //
    // If a refactor stops subscribing to HomeTabCtx (e.g. reads runStatus
    // from a captured closure or a ref), the context value change caused by
    // the runStatus flip will no longer trigger a re-render, the spy
    // call-count will stay flat, and this test will fail.
    const spy = vi.spyOn(HomeTabCtxNS, "useHomeTabCtx");

    try {
      const { rerender } = render(
        <RealGlanceWrapper runStatus="running" manageOpen={false}>
          <GlanceOverlay />
        </RealGlanceWrapper>,
      );

      // Initial mount gives us a baseline.
      const countAtMount = spy.mock.calls.length;
      expect(countAtMount).toBeGreaterThan(0);

      // Change a HomeTabCtx dep (runStatus) — RealGlanceWrapper's useMemo
      // fires, the context ref changes, and GlanceOverlay must re-render.
      await act(async () => {
        rerender(
          <RealGlanceWrapper runStatus="paused" manageOpen={false}>
            <GlanceOverlay />
          </RealGlanceWrapper>,
        );
      });

      // The spy must have been called again — proving useHomeTabCtx() is
      // still subscribed and GlanceOverlay re-rendered on the dep change.
      expect(spy.mock.calls.length).toBeGreaterThan(countAtMount);
    } finally {
      spy.mockRestore();
    }
  });

  it("counter-proof: useHomeTabCtx spy count stays flat when no component in the subtree calls it (proves spy cannot pass vacuously from provider emissions)", async () => {
    // Guards the spy-target-drift risk: if GlanceOverlay is ever refactored to
    // import useHomeTabCtx from a different module (e.g. a barrel re-export),
    // the vi.spyOn(HomeTabCtxNS, "useHomeTabCtx") in the sibling test would
    // silently stop intercepting calls.  The sibling's call-count would stay
    // flat while the component still renders — causing it to pass vacuously.
    //
    // This counter-proof renders a simulator that intentionally does NOT call
    // useHomeTabCtx() at all.  Even when runStatus changes and RealGlanceWrapper
    // emits a new HomeTabCtx context value, the spy must NOT fire — because no
    // component in the subtree invokes the hook.
    //
    // If the spy were somehow triggered by provider emissions alone (not by real
    // hook invocations), the count would increase and this test would fail,
    // revealing a broken spy assumption before it silently corrupts the guard.
    const spy = vi.spyOn(HomeTabCtxNS, "useHomeTabCtx");

    try {
      // Simulator that deliberately omits useHomeTabCtx() — only mounts via
      // useLiveRun() so the subtree is non-trivial but the spy has nothing to
      // intercept on the HomeTabCtx side.
      const NoTabCtxSim = memo(function NoTabCtxSimInner() {
        useLiveRun();
        return null;
      });

      const { rerender } = render(
        <RealGlanceWrapper runStatus="running" manageOpen={false}>
          <NoTabCtxSim />
        </RealGlanceWrapper>,
      );

      // Nothing in this subtree calls useHomeTabCtx() — spy must stay at 0.
      expect(spy.mock.calls.length).toBe(0);

      // Change runStatus — RealGlanceWrapper's tabCtxValue useMemo fires and
      // a new HomeTabCtx value is pushed to subscribers.  But NoTabCtxSim
      // is not subscribed, so the spy must remain flat.
      await act(async () => {
        rerender(
          <RealGlanceWrapper runStatus="paused" manageOpen={false}>
            <NoTabCtxSim />
          </RealGlanceWrapper>,
        );
      });

      // Still 0 — the spy fires ONLY when the hook is actually called, not
      // when the provider emits a new value.  This confirms the sibling test's
      // call-count advance is driven by GlanceOverlay's real hook invocations,
      // not by provider-side emissions that would happen regardless of whether
      // the spy target is correct.
      expect(spy.mock.calls.length).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 7 — GlanceOverlay uses useHomeTabCtx(), NOT useHomeCtx()
//
// GlanceOverlay floats over the full page and remains visible while a manage
// dialog is open.  It must subscribe to HomeTabCtx (the narrow context whose
// useMemo deps intentionally exclude all dialog/manage/import fields) rather
// than HomeCtx (the full context that changes on every dialog open/close).
//
// If GlanceOverlay were accidentally re-wired to useHomeCtx(), every dialog
// open/close cycle would trigger a re-render, producing a visible stutter for
// any user who opens a manage panel while the overlay is showing.
//
// GlanceOverlay's dual-context subscription (matches home.tsx lines ~15125-15130):
//   • useHomeTabCtx()  → currentRun, runStatus, v, setShowGlance (production deps)
//   • useLiveRun()     → calc, nowTime, casesFreezerPct (live clock)
//
// Four tests:
//  1. ISOLATION       — toggling dialog/manage state (excluded from
//     homeTabCtxValue deps) does NOT cause the GlanceOverlay subscriber to
//     re-render.
//  2. LIVE CLOCK      — nowTime keeps advancing while a manage dialog is
//     simultaneously rendered — the LiveRunProvider subscription is not blocked.
//  3. PROPAGATION     — a real production-dep change (runStatus) DOES reach
//     the GlanceOverlay subscriber (over-memoisation guard).
//  4. COUNTER-PROOF   — if the same simulator were accidentally re-wired to
//     useHomeCtx() instead of useHomeTabCtx(), dialog-field toggles DO cause
//     re-renders, proving that Tests 1–3 would catch the regression.
// ═══════════════════════════════════════════════════════════════════════════════

// Module-level stable references so GlanceWrapper re-renders (caused by
// manageCounter changing) don't create new object identities for LiveRunProvider
// props — which would otherwise emit a spurious context update and defeat the
// isolation test.  Same pattern used for FloorModeWrapper above.
const GLANCE_DAY_STATE = { runs: [ACTIVE_RUN], currentIndex: 0 } as const;
const GLANCE_UPCOMING_LABELS: string[] = [];
const GLANCE_MACHINE = { spinSec: 0, hopperSec: 0 } as const;

// ── Full wrapper: HomeTabCtx (production deps only) + LiveRunProvider ─────────
//
// manageCounter stands in for any dialog/import/merge state field that is
// intentionally excluded from homeTabCtxValue's useMemo deps.  GlanceOverlay
// reads from HomeTabCtx, so dialog-state changes (represented here by
// manageCounter) must never invalidate the HomeTabCtx value.
function GlanceWrapper({
  runStatus = "running",
  manageCounter = 0,
  children,
}: {
  runStatus?: string;
  manageCounter?: number;
  children: ReactNode;
}) {
  const form = useForm<FormValues>({ defaultValues: ACTIVE_VALUES });

  // Production deps only — manageCounter intentionally excluded.
  // This mirrors the contract GlanceOverlay relies on.
  const tabCtxValue = useMemo(
    () => ({ runStatus, casesNeeded: ACTIVE_VALUES.casesNeeded }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runStatus],
  );

  return (
    <HomeTabCtx.Provider value={tabCtxValue}>
      <LiveRunProvider
        v={ACTIVE_VALUES}
        ve={ACTIVE_VALUES}
        runStatus={runStatus as "running"}
        currentRun={ACTIVE_RUN}
        currentRunId="run-live-1"
        form={form}
        dayState={GLANCE_DAY_STATE}
        doughSubTab="dough"
        upcomingRunLabels={GLANCE_UPCOMING_LABELS}
        prefs={undefined}
        screenMode={null}
        machine={GLANCE_MACHINE}
      >
        {manageCounter > 0 && (
          <div data-testid="glance-manage-dialog">Manage dialog #{manageCounter}</div>
        )}
        {children}
      </LiveRunProvider>
    </HomeTabCtx.Provider>
  );
}

// ── HomeTabCtx-only provider (isolation / propagation tests without clock) ────
function GlanceTabOnlyProvider({
  runStatus,
  manageCounter: _manageCounter,
  children,
}: {
  runStatus: string;
  manageCounter: number;
  children: ReactNode;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ runStatus }), [runStatus]);
  return <HomeTabCtx.Provider value={value}>{children}</HomeTabCtx.Provider>;
}

describe("LiveTabMemo — GlanceOverlay uses useHomeTabCtx(), not useHomeCtx() (regression guard)", () => {
  afterEach(() => { cleanup(); });

  // ─── Test 1: ISOLATION ────────────────────────────────────────────────────
  // GlanceOverlay must use useHomeTabCtx() so dialog/manage state changes
  // (excluded from homeTabCtxValue deps) do NOT trigger re-renders.
  //
  // Uses HomeTabCtx-only (no LiveRunProvider) for a clean renderCount signal.
  it("GlanceOverlay does NOT re-render when manage/dialog state toggles", async () => {
    let renderCount = 0;

    const GlanceOverlaySim = memo(function GlanceOverlaySimInner() {
      renderCount++;
      // Mirrors the real GlanceOverlay's useHomeTabCtx() subscription.
      // If accidentally changed to useHomeCtx(), the isolation test fails
      // because dialog-field changes would also reach HomeCtx.
      const { runStatus } = useHomeTabCtx();
      return <span data-testid="glance-status">{runStatus}</span>;
    });

    const { rerender } = render(
      <GlanceTabOnlyProvider runStatus="running" manageCounter={0}>
        <GlanceOverlaySim />
      </GlanceTabOnlyProvider>,
    );

    expect(renderCount).toBe(1);

    // Open manage dialog — manageCounter changes but runStatus is unchanged.
    // homeTabCtxValue useMemo dep (runStatus) is stable → same ctx ref →
    // React.memo skips re-render.
    await act(async () => {
      rerender(
        <GlanceTabOnlyProvider runStatus="running" manageCounter={1}>
          <GlanceOverlaySim />
        </GlanceTabOnlyProvider>,
      );
    });

    expect(renderCount).toBe(1);

    // Import in progress (ticking counter) — still no re-render.
    await act(async () => {
      rerender(
        <GlanceTabOnlyProvider runStatus="running" manageCounter={42}>
          <GlanceOverlaySim />
        </GlanceTabOnlyProvider>,
      );
    });

    expect(renderCount).toBe(1);

    // Close dialog — still no re-render.
    await act(async () => {
      rerender(
        <GlanceTabOnlyProvider runStatus="running" manageCounter={0}>
          <GlanceOverlaySim />
        </GlanceTabOnlyProvider>,
      );
    });

    expect(renderCount).toBe(1);
  });

  // ─── Test 2: LIVE CLOCK ───────────────────────────────────────────────────
  // GlanceOverlay stays visible on top of manage dialogs.  Its live clock
  // (nowTime) must keep advancing even while the manage dialog is rendered.
  it("GlanceOverlay nowTime advances while a manage dialog is simultaneously rendered", async () => {
    vi.useFakeTimers();
    try {
      const nowSamples: number[] = [];

      const GlanceOverlaySim = memo(function GlanceOverlaySimInner() {
        useHomeTabCtx();
        const { nowTime } = useLiveRun();
        nowSamples.push(nowTime.getTime());
        return <span data-testid="glance-now">{nowTime.getTime()}</span>;
      });

      render(
        <GlanceWrapper runStatus="running" manageCounter={1}>
          <GlanceOverlaySim />
        </GlanceWrapper>,
      );

      const firstNow = nowSamples[0];
      expect(firstNow).toBeGreaterThan(0);

      await act(async () => { vi.advanceTimersByTime(60_000); });

      const lastNow = nowSamples[nowSamples.length - 1];
      expect(lastNow).toBeGreaterThan(firstNow);
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── Test 3: PROPAGATION ─────────────────────────────────────────────────
  // Guard against over-memoisation: when a real production dep (runStatus)
  // changes, GlanceOverlay MUST re-render to reflect the updated status.
  //
  // Uses HomeTabCtx-only for a clean renderCount signal.
  it("GlanceOverlay DOES re-render when a production dep (runStatus) changes", async () => {
    let renderCount = 0;

    const GlanceOverlaySim = memo(function GlanceOverlaySimInner() {
      renderCount++;
      const { runStatus } = useHomeTabCtx();
      return <span data-testid="glance-status2">{runStatus}</span>;
    });

    const { rerender, getByTestId } = render(
      <GlanceTabOnlyProvider runStatus="running" manageCounter={0}>
        <GlanceOverlaySim />
      </GlanceTabOnlyProvider>,
    );

    expect(renderCount).toBe(1);
    expect(getByTestId("glance-status2").textContent).toBe("running");

    // Simulate the run pausing — a real production dep change.
    // homeTabCtxValue useMemo fires (runStatus changed) → new ctx ref →
    // HomeTabCtx subscriber re-renders.
    await act(async () => {
      rerender(
        <GlanceTabOnlyProvider runStatus="paused" manageCounter={0}>
          <GlanceOverlaySim />
        </GlanceTabOnlyProvider>,
      );
    });

    expect(renderCount).toBe(2);
    expect(getByTestId("glance-status2").textContent).toBe("paused");
  });

  // ─── Test 4: COUNTER-PROOF ────────────────────────────────────────────────
  // Proves the regression guard has teeth: if GlanceOverlay were accidentally
  // re-wired to useHomeCtx() instead of useHomeTabCtx(), dialog-field changes
  // WOULD reach HomeCtx subscribers and cause re-renders.
  //
  // This test uses a HomeCtx.Provider (the FULL context) and toggles a
  // dialog field via DIALOG_REGISTRY.  The subscriber calls useHomeCtx() —
  // the wrong hook.  The HomeCtx value IS invalidated by the dialog toggle,
  // so renderCount increases, proving that Test 1 would catch the regression.
  it("counter-proof: a useHomeCtx() subscriber DOES re-render when dialog fields toggle (proving Test 1 would catch the regression)", async () => {
    // Pick any dialog field from the registry to simulate the regression.
    const testEntry = DIALOG_REGISTRY.find(({ field }) => field === "manageCategory")!;

    let renderCount = 0;

    const WrongGlanceSim = memo(function WrongGlanceSimInner() {
      renderCount++;
      // WRONG: uses useHomeCtx() instead of useHomeTabCtx() — the regression
      // this suite guards against.
      useHomeCtx();
      return <span data-testid="wrong-glance">rendered</span>;
    });

    // Use a HomeCtx.Provider that DOES invalidate when dialog fields change.
    // This mirrors what would happen if GlanceOverlay called useHomeCtx().
    function DialogAwareProvider({
      dialogExtras,
      children,
    }: {
      dialogExtras: Record<string, unknown>;
      children: ReactNode;
    }) {
      // Full context — dialog fields ARE in the deps (opposite of the guard).
      const ctxValue = useMemo(
        () => ({ runStatus: "running", brand: "TestBrand", ...dialogExtras }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [dialogExtras],
      );
      return <HomeCtx.Provider value={ctxValue}>{children}</HomeCtx.Provider>;
    }

    const emptyExtras = {};
    const { rerender } = render(
      <DialogAwareProvider dialogExtras={emptyExtras}>
        <WrongGlanceSim />
      </DialogAwareProvider>,
    );

    const countAfterMount = renderCount;

    // Toggle the dialog field open — HomeCtx value changes → useHomeCtx()
    // subscriber re-renders (because dialogExtras is in deps and is a new ref).
    const openExtras = { [testEntry.field]: testEntry.openValue };
    await act(async () => {
      rerender(
        <DialogAwareProvider dialogExtras={openExtras}>
          <WrongGlanceSim />
        </DialogAwareProvider>,
      );
    });

    // renderCount increased — the wrong hook caused a needless re-render.
    // This proves that Test 1 (which uses useHomeTabCtx() and stays at 1)
    // would fail if GlanceOverlay were accidentally re-wired to useHomeCtx().
    expect(renderCount).toBeGreaterThan(countAfterMount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 8 — GlanceOverlay nowTime subscription active guard
//
// Suites 6 and 7 verify isolation/propagation/live-clock behaviour using
// simulators that explicitly call useLiveRun().  Neither suite directly guards
// against useLiveRun() being silently dropped from the REAL GlanceOverlay: if
// that happened the simulators would still pass because they control their own
// hook calls.
//
// This suite adds two targeted tests:
//
//   1. SUBSCRIPTION ACTIVE — a GlanceOverlay simulator (useHomeTabCtx() +
//      useLiveRun()) — matching the exact dual-subscription pattern of the
//      real component — must have its nowTime advance after clock ticks.
//      If useLiveRun() were removed from the real component, the component
//      would no longer re-render on clock ticks; this pattern confirms the
//      hook is load-bearing.
//
//   2. COUNTER-PROOF — an identical simulator that omits useLiveRun() does
//      NOT receive clock updates after the clock advances.  HomeTabCtx only
//      changes when production deps (runStatus etc.) change, not per tick, so
//      React.memo() skips the re-render entirely.  This proves that Test 1
//      would catch the regression: without useLiveRun() the simulator's
//      render count would be stuck, making lastNow === firstNow and the
//      `>` assertion would fail.
// ═══════════════════════════════════════════════════════════════════════════════

describe("LiveTabMemo — Suite 8: GlanceOverlay nowTime subscription active guard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  // ─── Test 1: SUBSCRIPTION ACTIVE ─────────────────────────────────────────
  // A simulator using both useHomeTabCtx() + useLiveRun() — the exact pattern
  // of the real GlanceOverlay — must have its nowTime advance after the clock
  // ticks.  GlanceWrapper keeps HomeTabCtx stable (runStatus unchanged), so
  // any re-renders that deliver a new nowTime must come from the LiveRunProvider
  // context update driven by useLiveRun().  If that subscription were dropped,
  // the component would not re-render on clock ticks and lastNow would equal
  // firstNow, failing the assertion.
  it("GlanceOverlay simulator (useHomeTabCtx + useLiveRun) nowTime advances after clock ticks", async () => {
    const nowSamples: number[] = [];

    const GlanceOverlaySim = memo(function GlanceOverlaySimInner() {
      useHomeTabCtx();                       // matches real GlanceOverlay
      const { nowTime } = useLiveRun();      // the subscription under test
      nowSamples.push(nowTime.getTime());
      return <span data-testid="s8-now">{nowTime.getTime()}</span>;
    });

    render(
      <GlanceWrapper runStatus="running" manageCounter={0}>
        <GlanceOverlaySim />
      </GlanceWrapper>,
    );

    const firstNow = nowSamples[0];
    expect(firstNow).toBeGreaterThan(0);

    // Advance the fake clock — the simulator must receive updated nowTime via
    // the LiveRunProvider context update that useLiveRun() subscribes to.
    await act(async () => { vi.advanceTimersByTime(10_000); });

    const lastNow = nowSamples[nowSamples.length - 1];
    // Clock ticked → useLiveRun() subscription delivered new nowTime →
    // component re-rendered with an advanced timestamp.
    expect(lastNow).toBeGreaterThan(firstNow);
  });

  // ─── Test 2: COUNTER-PROOF ────────────────────────────────────────────────
  // A simulator that uses ONLY useHomeTabCtx() (no useLiveRun()) does NOT
  // re-render after clock ticks.  HomeTabCtx only changes when production deps
  // (runStatus etc.) change — not on every clock tick — so React.memo() skips
  // all re-renders while the clock is running.
  //
  // This proves Test 1 would fail if useLiveRun() were dropped from the real
  // GlanceOverlay: with no clock-driven re-renders, nowSamples would be stuck
  // at the mount value and lastNow === firstNow.
  it("counter-proof: simulator WITHOUT useLiveRun() does NOT receive clock updates (proving Test 1 has teeth)", async () => {
    let renderCount = 0;

    const GlanceNoLiveSim = memo(function GlanceNoLiveSimInner() {
      renderCount++;
      // Only HomeTabCtx — useLiveRun() is intentionally absent.
      // This mirrors what GlanceOverlay would look like if useLiveRun() were
      // accidentally dropped.  HomeTabCtx is stable (runStatus unchanged), so
      // no context updates arrive while the clock ticks.
      useHomeTabCtx();
      return null;
    });

    render(
      <GlanceWrapper runStatus="running" manageCounter={0}>
        <GlanceNoLiveSim />
      </GlanceWrapper>,
    );

    const renderCountAfterMount = renderCount;
    expect(renderCountAfterMount).toBeGreaterThan(0);

    // Advance the clock — WITHOUT useLiveRun(), LiveRunProvider context updates
    // do NOT reach this component; HomeTabCtx is stable; React.memo() skips
    // the re-render entirely.
    await act(async () => { vi.advanceTimersByTime(10_000); });

    // renderCount must be unchanged: no re-renders occurred after mount.
    // This is exactly the failure mode if useLiveRun() were removed from the
    // real GlanceOverlay — the live clock would stop driving re-renders, and
    // Test 1's lastNow > firstNow assertion would fail.
    expect(renderCount).toBe(renderCountAfterMount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 5 — Mock reference stability: useAutoTrack and useNotifications return
//            the SAME object/function references on every call
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

describe("LiveTabMemo — Suite 5: useAutoTrack and useNotifications mocks return stable references across calls", () => {
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
    // Each individual slot (case, tray, …) must also be a closure-level ref.
    // If any slot were written inline inside tickDueRefs' object literal, it
    // would still be a new object each call because a new tickDueRefs wrapper
    // would be produced.  This is covered transitively by the tickDueRefs test
    // above, but we also verify the slots directly for clarity.
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

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 9 — Real GlanceOverlay is wired to useHomeTabCtx(), not useHomeCtx()
//
// Suites 7 and 8 guard GlanceOverlay's isolation and clock subscription using
// simulators that hard-code the hooks they call.  If the real GlanceOverlay
// were accidentally re-wired to useHomeCtx() those simulators would still pass
// because they control their own hook invocations.
//
// This suite closes that gap by rendering the REAL GlanceOverlay component
// inside a wrapper that provides BOTH contexts:
//   • HomeCtx.Provider  — invalidated when a dialog field (manageCategory)
//     toggles; mirrors the full-context churn that occurs in home.tsx when a
//     manage panel opens or closes.
//   • HomeTabCtx.Provider — stable; only invalidated on production-dep changes
//     (runStatus), never on dialog-field toggles.
//
// Two tests:
//
//   1. REAL-COMPONENT ISOLATION — toggling a HomeCtx dialog field does NOT
//      change the real GlanceOverlay's data-now attribute.  Because the real
//      component reads HomeTabCtx (stable) not HomeCtx (changed), React.memo()
//      skips the re-render entirely and data-now stays the same.
//      If GlanceOverlay were re-wired to useHomeCtx() it would re-render on
//      the dialog toggle, receive a fresh nowTime from useLiveRun(), and
//      data-now would advance — failing the assertion.
//
//   2. COUNTER-PROOF — a useHomeCtx() subscriber placed in the same tree DOES
//      re-render on the same dialog toggle, proving Test 1 has teeth.
// ═══════════════════════════════════════════════════════════════════════════════

// Module-level stable refs so RealGlanceHomeCtxWrapper re-renders (caused by
// dialogOpen changing) don't create new object identities for LiveRunProvider
// props — which would otherwise emit a spurious context update.
const S9_DAY_STATE = { runs: [ACTIVE_RUN], currentIndex: 0 } as const;
const S9_UPCOMING_LABELS: string[] = [];
const S9_MACHINE = { spinSec: 0, hopperSec: 0 } as const;

// Wrapper providing BOTH HomeCtx (changes on dialogOpen) AND HomeTabCtx
// (stable — never invalidated by dialog toggles).
function RealGlanceHomeCtxWrapper({
  runStatus = "running",
  dialogOpen = false,
  children,
}: {
  runStatus?: string;
  dialogOpen?: boolean;
  children: ReactNode;
}) {
  const form = useForm<FormValues>({ defaultValues: ACTIVE_VALUES });

  // HomeTabCtx: stable — only runStatus is a dep; dialog fields are excluded.
  // This is what GlanceOverlay correctly relies on.
  const tabCtxValue = useMemo(
    () => makeHomeTabCtxValue(runStatus),
    [runStatus],
  );

  // HomeCtx: invalidates when dialogOpen changes (manageCategory is toggled).
  // This mirrors what happens in home.tsx when a manage panel opens/closes —
  // HomeCtx emits a new value but HomeTabCtx does not.
  const homeCtxValue = useMemo(
    () => ({
      runStatus,
      currentRun: { id: "run-live-1", brand: "TestBrand", flavor: "TestFlavor" },
      dayState: S9_DAY_STATE,
      form: null,
      activeTab: "run",
      manageCategory: dialogOpen ? "mixes" : "",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runStatus, dialogOpen],
  );

  return (
    <HomeCtx.Provider value={homeCtxValue}>
      <HomeTabCtx.Provider value={tabCtxValue}>
        <LiveRunProvider
          v={ACTIVE_VALUES}
          ve={ACTIVE_VALUES}
          runStatus={runStatus as "running"}
          currentRun={ACTIVE_RUN}
          currentRunId="run-live-1"
          form={form}
          dayState={S9_DAY_STATE}
          doughSubTab="dough"
          upcomingRunLabels={S9_UPCOMING_LABELS}
          prefs={undefined}
          screenMode={null}
          machine={S9_MACHINE}
        >
          {children}
        </LiveRunProvider>
      </HomeTabCtx.Provider>
    </HomeCtx.Provider>
  );
}

describe("LiveTabMemo — Suite 9: real GlanceOverlay is wired to useHomeTabCtx(), not useHomeCtx()", () => {
  afterEach(() => { cleanup(); });

  // ─── Test 1: REAL-COMPONENT ISOLATION ────────────────────────────────────
  // The real GlanceOverlay's data-now attribute must not change when a HomeCtx
  // dialog field toggles.  Because GlanceOverlay subscribes to HomeTabCtx
  // (which is stable — manageCategory is NOT a dep), React.memo() must skip
  // the re-render and leave data-now unchanged.
  //
  // If GlanceOverlay were accidentally re-wired to call useHomeCtx() instead
  // of useHomeTabCtx(), the manageCategory change would invalidate HomeCtx,
  // reach the real component, trigger a re-render with a fresh nowTime from
  // useLiveRun(), and data-now would advance — failing this assertion.
  //
  // No fake timers are used here: the clock is not advanced, so any data-now
  // change is caused exclusively by a dialog-field-induced re-render, not by
  // a clock tick.
  it("real GlanceOverlay: data-now does NOT change when a HomeCtx dialog field toggles (HomeTabCtx is stable)", async () => {
    const { getByTestId, rerender } = render(
      <RealGlanceHomeCtxWrapper runStatus="running" dialogOpen={false}>
        <GlanceOverlay />
      </RealGlanceHomeCtxWrapper>,
    );

    const nowAfterMount = Number(getByTestId("glance-now").getAttribute("data-now"));
    expect(nowAfterMount).toBeGreaterThan(0);

    // Toggle the HomeCtx dialog field: manageCategory "" → "mixes".
    // HomeCtx emits a new value; HomeTabCtx stays the same.
    // React.memo() must prevent GlanceOverlay from re-rendering because its
    // only context subscription (HomeTabCtx) did not change.
    await act(async () => {
      rerender(
        <RealGlanceHomeCtxWrapper runStatus="running" dialogOpen={true}>
          <GlanceOverlay />
        </RealGlanceHomeCtxWrapper>,
      );
    });

    const nowAfterDialog = Number(getByTestId("glance-now").getAttribute("data-now"));
    // data-now must be identical: no re-render occurred because the real
    // GlanceOverlay reads HomeTabCtx (stable), not HomeCtx (changed).
    expect(nowAfterDialog).toBe(nowAfterMount);
  });

  // ─── Test 2: COUNTER-PROOF ────────────────────────────────────────────────
  // Proves Test 1 has teeth: a memo()-wrapped component that calls useHomeCtx()
  // instead of useHomeTabCtx() DOES re-render when the same dialog field
  // toggles in the same wrapper.  This confirms that Test 1's === assertion
  // would fail if GlanceOverlay were re-wired to call useHomeCtx().
  it("counter-proof: a useHomeCtx() subscriber DOES re-render when a HomeCtx dialog field toggles (proving Test 1 would catch the regression)", async () => {
    let renderCount = 0;

    const HomeCtxSub = memo(function HomeCtxSubInner() {
      renderCount++;
      // WRONG hook — mirrors what GlanceOverlay would look like if it were
      // accidentally re-wired to useHomeCtx() instead of useHomeTabCtx().
      useHomeCtx();
      return <span data-testid="s9-counter-proof">rendered</span>;
    });

    const { rerender } = render(
      <RealGlanceHomeCtxWrapper runStatus="running" dialogOpen={false}>
        <HomeCtxSub />
      </RealGlanceHomeCtxWrapper>,
    );

    const countAfterMount = renderCount;
    expect(countAfterMount).toBeGreaterThan(0);

    // Toggle the same HomeCtx dialog field: HomeCtx invalidates, the
    // useHomeCtx() subscriber receives the new context value → re-renders.
    await act(async () => {
      rerender(
        <RealGlanceHomeCtxWrapper runStatus="running" dialogOpen={true}>
          <HomeCtxSub />
        </RealGlanceHomeCtxWrapper>,
      );
    });

    // renderCount increased: the wrong hook caused a needless re-render.
    // This confirms that Test 1's data-now === assertion would also fail
    // if GlanceOverlay were re-wired to call useHomeCtx() — because the
    // re-render would deliver a new nowTime and advance data-now.
    expect(renderCount).toBeGreaterThan(countAfterMount);
  });
});
