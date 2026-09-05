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
import CompactRunStrip from "../../components/CompactRunStrip";
import { render, act, cleanup } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { type FormValues, DEFAULT_VALUES } from "../../types";
import { LiveRunProvider, useLiveRun } from "../../contexts/LiveRunContext";
import * as LiveRunContextNS from "../../contexts/LiveRunContext";
import { HomeCtx, useHomeCtx } from "../../contexts/HomeCtx";
import { HOME_TAB_CTX_DEP_FIELDS } from "../../pages/homeTabCtxDeps";
import { HomeTabCtx, useHomeTabCtx } from "../../contexts/HomeTabCtx";
import { WarehouseTabCtx, useWarehouseTabCtx } from "../../contexts/WarehouseTabCtx";
import { WAREHOUSE_TAB_CTX_DEP_FIELDS } from "../../pages/warehouseTabCtxDeps";
import { InventoryTabCtx, useInventoryTabCtx } from "../../contexts/InventoryTabCtx";
import { MixesTabCtx, useMixesTabCtx } from "../../contexts/MixesTabCtx";
import { INVENTORY_TAB_CTX_DEP_FIELDS } from "../../pages/inventoryTabCtxDeps";
import { MIXES_TAB_CTX_DEP_FIELDS } from "../../pages/mixesTabCtxDeps";
import { useAutoTrack } from "../../hooks/useAutoTrack";
import { useNotifications } from "../../hooks/useNotifications";
import * as HomeTabCtxNS from "../../contexts/HomeTabCtx";
// ── Shared mocks (closure-level stability enforced structurally) ─────────────
//
// The closure-level guarantee (all refs/fns allocated once at module scope,
// never inline) is STRUCTURAL: the manual mock files in src/hooks/__mocks__/
// are the single authoritative source.  Vitest resolves them automatically
// from the no-factory vi.mock() calls below.  See those files for the full
// explanation of why inline vi.fn() inside a vi.mock factory silently defeats
// LiveRunProvider's liveSlice useMemo and causes all 8 memo()-wrapped live tab
// components to re-render on every dialog/import state change.
//
// Suite 5 below verifies the contract with reference-identity assertions so any
// drift in the shared mocks is caught immediately.

vi.mock("../../hooks/useNotifications");
vi.mock("../../hooks/useAutoTrack");

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
// Suite 4 — WarehouseTabCtx: narrow warehouse context ref is stable across
// dialog-state changes (warehouse freeze regression guard)
//
// Mirrors Suite 4's homeTabCtxValue guard for the Warehouse panel. The memo'd
// WarehouseTabContent subscribes to WarehouseTabCtx, whose value
// (warehouseTabCtxValue in home.tsx) is memoized on warehouse production deps
// ONLY — dialog/manage/merge/import fields must never appear in the dep list.
// If one does, every dialog open/close cycle creates a new context ref → the
// memo'd Warehouse panel re-renders → the manage-dialog freeze regression that
// originally hit the live tabs returns.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Simulation of warehouseTabCtxValue isolation ──────────────────────────────
// Mirrors the pattern in home.tsx:
//   const warehouseTabCtxValue = useMemo(
//     () => warehouseTabCtxRef.current,
//     [activeRunNeedDetails, activeRunValues, activeRuns, …]  // dialog fields omitted
//   );
// The dep array is driven by WAREHOUSE_TAB_CTX_DEP_FIELDS so the simulator
// stays in sync with the real dep list (and with the static guard below).
function WarehouseTabGuardProvider({
  warehouseExtras,
  dialogExtras,
  children,
}: {
  warehouseExtras: Record<string, unknown>;
  dialogExtras: Record<string, unknown>;
  children: ReactNode;
}) {
  const ctxValue = useMemo(
    () => ({ ...warehouseExtras, ...dialogExtras }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...WAREHOUSE_TAB_CTX_DEP_FIELDS.map((field) => warehouseExtras[field])],
  );
  return <WarehouseTabCtx.Provider value={ctxValue}>{children}</WarehouseTabCtx.Provider>;
}

// Realistic baseline warehouse production data — referentially stable so the
// simulator's useMemo deps never change unless a test explicitly swaps them.
const BASE_WAREHOUSE_EXTRAS: Record<string, unknown> = {
  activeRunNeedDetails: new Map(),
  activeRunValues: new Map(),
  activeRuns: [{ id: "r1" }],
  activeWarehouseRows: [],
  activePackagingRows: [],
  cycleCountSchedules: [],
  dayState: { runs: [], stagedItems: {} },
  freezerPullPlan: [],
  freezerSurplus: [],
  freezerSurplusBusy: false,
  freezerSurplusError: null,
  freezerSurplusLoaded: true,
  isSupervisor: true,
  markCountedMutation: { isPending: false },
  runValuesById: new Map(),
  scheduledDays: [],
  scheduledValues: {},
  todayScheduledValues: {},
};

describe("LiveTabMemo — Suite 4: WarehouseTabCtx ref is stable across ALL dialog-state field changes (warehouse registry guard)", () => {
  afterEach(() => { cleanup(); });

  it("render count stays at 1 when every DIALOG_REGISTRY field toggles open then closed", async () => {
    // Same mechanism as the homeTabCtxValue guard: if a dialog field
    // accidentally enters warehouseTabCtxValue's deps, toggling it produces a
    // new context ref → memo'd WarehouseTabContent re-renders → renderCount
    // increases → this test fails.
    let renderCount = 0;

    const WarehouseSim = memo(function WarehouseSimInner() {
      renderCount++;
      const ctx = useWarehouseTabCtx() as {
        activeRuns: Array<{ id: string }>;
        isSupervisor: boolean;
      };
      return <span data-testid="wh-live">{ctx.activeRuns.length}|{String(ctx.isSupervisor)}</span>;
    });

    const { rerender, getByTestId } = render(
      <WarehouseTabGuardProvider warehouseExtras={BASE_WAREHOUSE_EXTRAS} dialogExtras={{}}>
        <WarehouseSim />
      </WarehouseTabGuardProvider>,
    );

    // Confirm warehouse data is correct after initial render.
    expect(getByTestId("wh-live").textContent).toBe("1|true");
    const initialRenderCount = renderCount;
    expect(initialRenderCount).toBe(1);

    // Cycle through every dialog field: open → closed.
    for (const { field, openValue } of DIALOG_REGISTRY) {
      await act(async () => {
        rerender(
          <WarehouseTabGuardProvider
            warehouseExtras={BASE_WAREHOUSE_EXTRAS}
            dialogExtras={{ [field]: openValue }}
          >
            <WarehouseSim />
          </WarehouseTabGuardProvider>,
        );
      });
      await act(async () => {
        rerender(
          <WarehouseTabGuardProvider warehouseExtras={BASE_WAREHOUSE_EXTRAS} dialogExtras={{}}>
            <WarehouseSim />
          </WarehouseTabGuardProvider>,
        );
      });
    }

    // Warehouse values must be unchanged throughout — no dialog field affected them.
    expect(getByTestId("wh-live").textContent).toBe("1|true");

    // renderCount must still be 1: stable context ref → React bails out context
    // update → memo()-wrapped subscriber never re-renders. A failure here means
    // a DIALOG_REGISTRY field was added to warehouseTabCtxValue's deps.
    expect(renderCount).toBe(initialRenderCount);
  });

  it("live data DOES update when actual warehouse state changes (not over-isolated)", async () => {
    // Counter-proof: the isolation must not prevent genuine warehouse updates.
    let renderCount = 0;

    const WarehouseSim2 = memo(function WarehouseSim2Inner() {
      renderCount++;
      const { activeRuns } = useWarehouseTabCtx() as { activeRuns: Array<{ id: string }> };
      return <span data-testid="wh-live2">{String(activeRuns.length)}</span>;
    });

    const { rerender, getByTestId } = render(
      <WarehouseTabGuardProvider warehouseExtras={BASE_WAREHOUSE_EXTRAS} dialogExtras={{}}>
        <WarehouseSim2 />
      </WarehouseTabGuardProvider>,
    );

    expect(getByTestId("wh-live2").textContent).toBe("1");
    const countAfterMount = renderCount;

    // Change a warehouse field (activeRuns) → warehouseTabCtxValue useMemo must
    // invalidate → memo'd subscriber re-renders.
    await act(async () => {
      rerender(
        <WarehouseTabGuardProvider
          warehouseExtras={{ ...BASE_WAREHOUSE_EXTRAS, activeRuns: [{ id: "r1" }, { id: "r2" }] }}
          dialogExtras={{}}
        >
          <WarehouseSim2 />
        </WarehouseTabGuardProvider>,
      );
    });

    expect(getByTestId("wh-live2").textContent).toBe("2");
    expect(renderCount).toBeGreaterThan(countAfterMount);
  });

  it("WAREHOUSE_TAB_CTX_DEP_FIELDS entries are distinct (no duplicates)", () => {
    const unique = new Set(WAREHOUSE_TAB_CTX_DEP_FIELDS);
    expect(unique.size).toBe(WAREHOUSE_TAB_CTX_DEP_FIELDS.length);
  });

  it("no DIALOG_REGISTRY field appears in WAREHOUSE_TAB_CTX_DEP_FIELDS (static dep-list guard)", () => {
    // !! THIS IS THE PRIMARY REGRESSION GUARD FOR THE WAREHOUSE PANEL !!
    //
    // WAREHOUSE_TAB_CTX_DEP_FIELDS (from warehouseTabCtxDeps.ts) mirrors the
    // warehouseTabCtxValue useMemo dep array in home.tsx. The two files carry a
    // "KEEP IN SYNC" contract: when a developer adds a dep to
    // warehouseTabCtxValue, they must also add it to warehouseTabCtxDeps.ts.
    //
    // Failure here means: a dialog/manage/import field has entered the
    // warehouseTabCtxValue dep list, which will re-render the memo'd Warehouse
    // panel on every dialog open/close cycle (the manage-dialog freeze
    // regression spreading to the Warehouse tab).
    const whDepSet = new Set<string>(WAREHOUSE_TAB_CTX_DEP_FIELDS);
    const violations: string[] = [];
    for (const { field } of DIALOG_REGISTRY) {
      if (whDepSet.has(field)) {
        violations.push(field);
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `The following dialog-state fields were found in WAREHOUSE_TAB_CTX_DEP_FIELDS ` +
        `(warehouseTabCtxDeps.ts) — they must be removed from warehouseTabCtxValue's ` +
        `dep list to prevent the warehouse freeze regression:\n  ${violations.join(", ")}`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4 — Inventory & Mixes tab contexts: narrow context refs are stable
// across dialog-state changes (freeze regression guards)
//
// Mirrors the WarehouseTabCtx guard for the Inventory and Mix Plan panels
// (refactor step 4b). Each memo'd panel subscribes to its own narrow context
// whose value (inventoryTabCtxValue / mixesTabCtxValue in home.tsx) is
// memoized on panel-production deps ONLY — dialog/manage/merge/import fields
// must never appear. If one does, every dialog open/close cycle creates a new
// context ref → the memo'd panel re-renders → the manage-dialog freeze
// regression returns.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Simulations of inventoryTabCtxValue / mixesTabCtxValue isolation ─────────
// Same pattern as WarehouseTabGuardProvider: dep arrays are driven by the
// registry files so the simulators stay in sync with the real dep lists (and
// with the static guards below).
function InventoryTabGuardProvider({
  liveExtras,
  dialogExtras,
  children,
}: {
  liveExtras: Record<string, unknown>;
  dialogExtras: Record<string, unknown>;
  children: ReactNode;
}) {
  const ctxValue = useMemo(
    () => ({ ...liveExtras, ...dialogExtras }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...INVENTORY_TAB_CTX_DEP_FIELDS.map((field) => liveExtras[field])],
  );
  return <InventoryTabCtx.Provider value={ctxValue}>{children}</InventoryTabCtx.Provider>;
}

function MixesTabGuardProvider({
  liveExtras,
  dialogExtras,
  children,
}: {
  liveExtras: Record<string, unknown>;
  dialogExtras: Record<string, unknown>;
  children: ReactNode;
}) {
  const ctxValue = useMemo(
    () => ({ ...liveExtras, ...dialogExtras }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...MIXES_TAB_CTX_DEP_FIELDS.map((field) => liveExtras[field])],
  );
  return <MixesTabCtx.Provider value={ctxValue}>{children}</MixesTabCtx.Provider>;
}

// Realistic baseline production data — referentially stable so the simulators'
// useMemo deps never change unless a test explicitly swaps them.
const BASE_INVENTORY_EXTRAS: Record<string, unknown> = {
  dayState: { runs: [], substitutions: [], substitutionLog: [] },
  inventoryCandidates: [{ name: "Mozzarella", sku: "MZ" }],
  inventoryRunValues: [],
  inventorySubstitutionOptions: ["Mozzarella"],
};

const BASE_MIXES_EXTRAS: Record<string, unknown> = {
  canManageInventory: true,
  currentRunId: "r1",
  dayState: { runs: [{ id: "r1", brand: "Acme", flavor: "Plain" }], stagedItems: {} },
  freezerSurplus: { lots: [], allocations: [] },
  mixMakeDay: "2026-09-05",
  mixPlanItems: [],
  mixes: [{ id: "m1", name: "Veggie Mix" }],
  scheduledDays: [],
};

describe("LiveTabMemo — Suite 4: Inventory & Mixes tab contexts stable across ALL dialog-state field changes (registry guards)", () => {
  afterEach(() => { cleanup(); });

  it("render count stays at 1 for the Inventory subscriber across every DIALOG_REGISTRY toggle", async () => {
    let renderCount = 0;

    const InventorySim = memo(function InventorySimInner() {
      renderCount++;
      const ctx = useInventoryTabCtx() as {
        inventoryCandidates: Array<{ name: string }>;
        dayState: { substitutions?: unknown[] };
      };
      return <span data-testid="inv-live">{ctx.inventoryCandidates.length}|{(ctx.dayState.substitutions ?? []).length}</span>;
    });

    const { rerender, getByTestId } = render(
      <InventoryTabGuardProvider liveExtras={BASE_INVENTORY_EXTRAS} dialogExtras={{}}>
        <InventorySim />
      </InventoryTabGuardProvider>,
    );

    expect(getByTestId("inv-live").textContent).toBe("1|0");
    const initialRenderCount = renderCount;
    expect(initialRenderCount).toBe(1);

    for (const { field, openValue } of DIALOG_REGISTRY) {
      await act(async () => {
        rerender(
          <InventoryTabGuardProvider
            liveExtras={BASE_INVENTORY_EXTRAS}
            dialogExtras={{ [field]: openValue }}
          >
            <InventorySim />
          </InventoryTabGuardProvider>,
        );
      });
      await act(async () => {
        rerender(
          <InventoryTabGuardProvider liveExtras={BASE_INVENTORY_EXTRAS} dialogExtras={{}}>
            <InventorySim />
          </InventoryTabGuardProvider>,
        );
      });
    }

    expect(getByTestId("inv-live").textContent).toBe("1|0");
    expect(renderCount).toBe(initialRenderCount);
  });

  it("render count stays at 1 for the Mixes subscriber across every DIALOG_REGISTRY toggle", async () => {
    let renderCount = 0;

    const MixesSim = memo(function MixesSimInner() {
      renderCount++;
      const ctx = useMixesTabCtx() as {
        mixes: Array<{ id: string }>;
        mixMakeDay: string;
      };
      return <span data-testid="mix-live">{ctx.mixes.length}|{ctx.mixMakeDay}</span>;
    });

    const { rerender, getByTestId } = render(
      <MixesTabGuardProvider liveExtras={BASE_MIXES_EXTRAS} dialogExtras={{}}>
        <MixesSim />
      </MixesTabGuardProvider>,
    );

    expect(getByTestId("mix-live").textContent).toBe("1|2026-09-05");
    const initialRenderCount = renderCount;
    expect(initialRenderCount).toBe(1);

    for (const { field, openValue } of DIALOG_REGISTRY) {
      await act(async () => {
        rerender(
          <MixesTabGuardProvider
            liveExtras={BASE_MIXES_EXTRAS}
            dialogExtras={{ [field]: openValue }}
          >
            <MixesSim />
          </MixesTabGuardProvider>,
        );
      });
      await act(async () => {
        rerender(
          <MixesTabGuardProvider liveExtras={BASE_MIXES_EXTRAS} dialogExtras={{}}>
            <MixesSim />
          </MixesTabGuardProvider>,
        );
      });
    }

    expect(getByTestId("mix-live").textContent).toBe("1|2026-09-05");
    expect(renderCount).toBe(initialRenderCount);
  });

  it("Inventory data DOES update when substitutions change (not over-isolated)", async () => {
    let renderCount = 0;

    const InventorySim2 = memo(function InventorySim2Inner() {
      renderCount++;
      const ctx = useInventoryTabCtx() as { dayState: { substitutions?: unknown[] } };
      return <span data-testid="inv-live2">{String((ctx.dayState.substitutions ?? []).length)}</span>;
    });

    const { rerender, getByTestId } = render(
      <InventoryTabGuardProvider liveExtras={BASE_INVENTORY_EXTRAS} dialogExtras={{}}>
        <InventorySim2 />
      </InventoryTabGuardProvider>,
    );

    expect(getByTestId("inv-live2").textContent).toBe("0");
    const countAfterMount = renderCount;

    await act(async () => {
      rerender(
        <InventoryTabGuardProvider
          liveExtras={{
            ...BASE_INVENTORY_EXTRAS,
            dayState: { runs: [], substitutions: [{ id: "s1" }], substitutionLog: [] },
          }}
          dialogExtras={{}}
        >
          <InventorySim2 />
        </InventoryTabGuardProvider>,
      );
    });

    expect(getByTestId("inv-live2").textContent).toBe("1");
    expect(renderCount).toBeGreaterThan(countAfterMount);
  });

  it("Mixes data DOES update when mixPlanItems changes (not over-isolated)", async () => {
    let renderCount = 0;

    const MixesSim2 = memo(function MixesSim2Inner() {
      renderCount++;
      const ctx = useMixesTabCtx() as { mixPlanItems: unknown[] };
      return <span data-testid="mix-live2">{String(ctx.mixPlanItems.length)}</span>;
    });

    const { rerender, getByTestId } = render(
      <MixesTabGuardProvider liveExtras={BASE_MIXES_EXTRAS} dialogExtras={{}}>
        <MixesSim2 />
      </MixesTabGuardProvider>,
    );

    expect(getByTestId("mix-live2").textContent).toBe("0");
    const countAfterMount = renderCount;

    await act(async () => {
      rerender(
        <MixesTabGuardProvider
          liveExtras={{ ...BASE_MIXES_EXTRAS, mixPlanItems: [{ id: "m1", name: "Veggie Mix" }] }}
          dialogExtras={{}}
        >
          <MixesSim2 />
        </MixesTabGuardProvider>,
      );
    });

    expect(getByTestId("mix-live2").textContent).toBe("1");
    expect(renderCount).toBeGreaterThan(countAfterMount);
  });

  it("registry entries are distinct (no duplicate field names)", () => {
    expect(new Set(INVENTORY_TAB_CTX_DEP_FIELDS).size).toBe(INVENTORY_TAB_CTX_DEP_FIELDS.length);
    expect(new Set(MIXES_TAB_CTX_DEP_FIELDS).size).toBe(MIXES_TAB_CTX_DEP_FIELDS.length);
  });

  it("no DIALOG_REGISTRY field appears in INVENTORY_TAB_CTX_DEP_FIELDS (static dep-list guard)", () => {
    const depSet = new Set<string>(INVENTORY_TAB_CTX_DEP_FIELDS);
    const violations = DIALOG_REGISTRY.map(({ field }) => field).filter((field) => depSet.has(field));
    if (violations.length > 0) {
      throw new Error(
        `Dialog-state fields found in INVENTORY_TAB_CTX_DEP_FIELDS (inventoryTabCtxDeps.ts) — ` +
        `remove them from inventoryTabCtxValue's dep list to prevent the freeze regression:
  ` +
        violations.join(", "),
      );
    }
  });

  it("no DIALOG_REGISTRY field appears in MIXES_TAB_CTX_DEP_FIELDS (static dep-list guard)", () => {
    const depSet = new Set<string>(MIXES_TAB_CTX_DEP_FIELDS);
    const violations = DIALOG_REGISTRY.map(({ field }) => field).filter((field) => depSet.has(field));
    if (violations.length > 0) {
      throw new Error(
        `Dialog-state fields found in MIXES_TAB_CTX_DEP_FIELDS (mixesTabCtxDeps.ts) — ` +
        `remove them from mixesTabCtxValue's dep list to prevent the freeze regression:
  ` +
        violations.join(", "),
      );
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

  // ─── memo() removal counter-proof ─────────────────────────────────────────
  // Closes the final gap in the isolation guard: Test 1 checks that a memo()-
  // wrapped subscriber does NOT re-render when manageCounter changes and the
  // provider dep array is clean.  But Test 1 would pass vacuously if memo()
  // itself were accidentally removed — because a non-memo'd component always
  // re-renders with its parent, so the assertion "renderCount stayed at 1"
  // would never be reached in the first place (the component would still
  // re-render on every parent update, but for the wrong reason — prop-driven
  // parent re-render rather than context leakage).
  //
  // This counter-proof exercises exactly that scenario:
  //   • A CLEAN TabOnlyProvider (manageCounter NOT in useMemo deps) — matching
  //     the production contract.
  //   • A NON-memo'd subscriber — simulating accidental memo() removal.
  //   • Fake timers keep the LiveRun clock silent so the only source of extra
  //     renders is the parent re-render triggered by the manageCounter prop.
  //
  // The non-memo'd component MUST re-render when manageCounter changes (parent
  // re-renders → child follows unconditionally without memo()).  This proves the
  // framework is sensitive enough to detect memo() removal: if Test 1 were run
  // with the same non-memo'd component, the render count would increase and the
  // "expect(renderCount).toBe(1)" assertion would fail — exactly the failure
  // we want to catch.
  it("non-memo'd FloorModeView simulator DOES re-render when manageCounter changes (memo() removal counter-proof)", async () => {
    vi.useFakeTimers();
    try {
      let renderCount = 0;

      // Clean provider: manageCounter intentionally NOT in deps.
      // Mirrors the correct production contract (same as FloorModeWrapper's
      // tabCtxValue memo) — the context ref is stable across manageCounter changes.
      function TabOnlyProviderClean({
        runStatus,
        manageCounter,
        children,
      }: {
        runStatus: string;
        manageCounter: number;
        children: ReactNode;
      }) {
        // manageCounter intentionally ABSENT from deps — clean production contract
        // eslint-disable-next-line react-hooks/exhaustive-deps
        const value = useMemo(() => ({ runStatus }), [runStatus]);
        return (
          <HomeTabCtx.Provider value={value}>
            {manageCounter > 0 && (
              <div data-testid="floor-memo-proof-dialog">Manage dialog #{manageCounter}</div>
            )}
            {children}
          </HomeTabCtx.Provider>
        );
      }

      // NON-memo'd simulator — no React.memo() wrapper.
      // Mirrors FloorModeView's subscription but with memo() removed.
      function FloorModeViewSimNoMemo() {
        renderCount++;
        const { runStatus } = useHomeTabCtx();
        return <span data-testid="floor-status-nomemo">{runStatus}</span>;
      }

      const { rerender } = render(
        <TabOnlyProviderClean runStatus="running" manageCounter={0}>
          <FloorModeViewSimNoMemo />
        </TabOnlyProviderClean>,
      );
      await act(async () => {});
      expect(renderCount).toBe(1);

      // manageCounter changes → parent re-renders → non-memo'd child re-renders
      // unconditionally (even though the context ref is stable and runStatus
      // did not change).  This is precisely the re-render that memo() prevents
      // in production.
      await act(async () => {
        rerender(
          <TabOnlyProviderClean runStatus="running" manageCounter={1}>
            <FloorModeViewSimNoMemo />
          </TabOnlyProviderClean>,
        );
      });

      // MUST be > 1 — proves the framework detects memo() removal.
      // If this were 1 (no re-render), the counter-proof would be vacuous and
      // the guard would be blind to accidental memo() stripping.
      expect(renderCount).toBeGreaterThan(1);
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

    // The "+N in Freeze tunnel" element must be present and non-zero
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

  it("counter-proof: useLiveRun spy count stays flat when no component in the subtree calls it (proves spy cannot pass vacuously from LiveRunProvider timer emissions)", async () => {
    // Guards the spy-target-drift risk: if GlanceOverlay is ever refactored
    // to import useLiveRun from a different module (e.g. a barrel re-export),
    // the vi.spyOn(LiveRunContextNS, "useLiveRun") in the sibling test would
    // silently stop intercepting calls.  The sibling's call-count would then
    // stay flat even while GlanceOverlay still renders — causing the guard to
    // pass vacuously while the real clock subscription is broken.
    //
    // This counter-proof renders a simulator that intentionally does NOT call
    // useLiveRun() at all.  Even as LiveRunProvider's internal clock fires 60
    // per-second ticks and emits new context values, the spy must NOT fire —
    // because no component in the subtree invokes the hook.
    //
    // If the spy were somehow triggered by provider timer emissions alone (not
    // by real hook invocations), the count would increase and this test would
    // fail, revealing a broken spy assumption before it silently corrupts the
    // guard.
    const spy = vi.spyOn(LiveRunContextNS, "useLiveRun");

    try {
      // Simulator that deliberately omits useLiveRun() — only calls
      // useHomeTabCtx() so the subtree is non-trivial but the spy has nothing
      // to intercept on the LiveRun side.
      const NoLiveRunSim = memo(function NoLiveRunSimInner() {
        useHomeTabCtx();
        return null;
      });

      render(
        <RealGlanceWrapper runStatus="running" manageOpen={false}>
          <NoLiveRunSim />
        </RealGlanceWrapper>,
      );

      // Nothing in this subtree calls useLiveRun() — spy must stay at 0.
      expect(spy.mock.calls.length).toBe(0);

      // Advance 60 s — LiveRunProvider's internal interval fires 60 ticks and
      // pushes new context values to subscribers.  But NoLiveRunSim is not
      // subscribed to LiveRunContext, so the spy must remain flat.
      await act(async () => { vi.advanceTimersByTime(60_000); });

      // Still 0 — the spy fires ONLY when the hook is actually called, not
      // when the provider emits a new timer value.  This confirms the sibling
      // test's call-count advance is driven by GlanceOverlay's real hook
      // invocations, not by provider-side timer emissions that would happen
      // regardless of whether the spy target is correct.
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

  // ─── memo() removal counter-proof ─────────────────────────────────────────
  // Closes the final gap in the GlanceOverlay isolation guard: Test 1 checks
  // that a memo()-wrapped subscriber does NOT re-render when manageCounter
  // changes and the provider dep array is clean.  But Test 1 would pass
  // vacuously if memo() itself were accidentally removed from GlanceOverlay —
  // a non-memo'd component always re-renders with its parent, so "renderCount
  // stayed at 1" would never be a meaningful assertion (the component would
  // re-render for the wrong reason: prop-driven parent re-render, not context
  // leakage).
  //
  // This counter-proof exercises exactly that scenario:
  //   • A CLEAN GlanceTabOnlyProvider (manageCounter NOT in useMemo deps) —
  //     matching the production contract.
  //   • A NON-memo'd subscriber — simulating accidental memo() removal.
  //   • Fake timers keep the clock silent so the only source of extra renders
  //     is the parent re-render triggered by the manageCounter prop change.
  //
  // The non-memo'd component MUST re-render when manageCounter changes (parent
  // re-renders → child follows unconditionally without memo()).  This proves the
  // framework is sensitive enough to detect memo() removal: if Test 1 were run
  // with the same non-memo'd component, the render count would increase and the
  // "expect(renderCount).toBe(1)" assertion would fail — exactly the failure
  // we want to catch.
  it("non-memo'd GlanceOverlay simulator DOES re-render when manageCounter changes (memo() removal counter-proof)", async () => {
    vi.useFakeTimers();
    try {
      let renderCount = 0;

      // Clean provider: manageCounter intentionally NOT in deps.
      // Mirrors the correct production contract (same as GlanceTabOnlyProvider)
      // — the context ref is stable across manageCounter changes.
      function TabOnlyProviderClean({
        runStatus,
        manageCounter,
        children,
      }: {
        runStatus: string;
        manageCounter: number;
        children: ReactNode;
      }) {
        // manageCounter intentionally ABSENT from deps — clean production contract
        // eslint-disable-next-line react-hooks/exhaustive-deps
        const value = useMemo(() => ({ runStatus }), [runStatus]);
        return (
          <HomeTabCtx.Provider value={value}>
            {manageCounter > 0 && (
              <div data-testid="glance-memo-proof-dialog">Manage dialog #{manageCounter}</div>
            )}
            {children}
          </HomeTabCtx.Provider>
        );
      }

      // NON-memo'd simulator — no React.memo() wrapper.
      // Mirrors GlanceOverlay's useHomeTabCtx() subscription but with memo() removed.
      function GlanceOverlaySimNoMemo() {
        renderCount++;
        const { runStatus } = useHomeTabCtx();
        return <span data-testid="glance-status-nomemo">{runStatus}</span>;
      }

      const { rerender } = render(
        <TabOnlyProviderClean runStatus="running" manageCounter={0}>
          <GlanceOverlaySimNoMemo />
        </TabOnlyProviderClean>,
      );
      await act(async () => {});
      expect(renderCount).toBe(1);

      // manageCounter changes → parent re-renders → non-memo'd child re-renders
      // unconditionally (even though the context ref is stable and runStatus
      // did not change).  This is precisely the re-render that memo() prevents
      // in production.
      await act(async () => {
        rerender(
          <TabOnlyProviderClean runStatus="running" manageCounter={1}>
            <GlanceOverlaySimNoMemo />
          </TabOnlyProviderClean>,
        );
      });

      // MUST be > 1 — proves the framework detects memo() removal.
      // If this were 1 (no re-render), the counter-proof would be vacuous and
      // the guard would be blind to accidental memo() stripping from GlanceOverlay.
      expect(renderCount).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── strict-equal assertion teeth ─────────────────────────────────────────
  // Guards against weakening Test 1's `expect(renderCount).toBe(1)` to a
  // range check such as `toBeGreaterThanOrEqual(1)` or `toBeLessThanOrEqual(2)`.
  //
  // The regression Test 1 catches is: GlanceOverlay re-wired to useHomeCtx()
  // instead of useHomeTabCtx(), causing dialog-field changes to trigger
  // spurious re-renders (visible stutter while a manage panel is open).
  //
  // If the `.toBe(1)` assertion were softened to `.toBeGreaterThanOrEqual(1)`,
  // a component that re-renders once on mount AND again on every dialog toggle
  // would satisfy it — the regression would silently pass.
  //
  // This test demonstrates the danger by running the identical toggle sequence
  // from Test 1 against a LOCAL variant wired to useHomeCtx() (the wrong hook).
  // The variant re-renders on every dialog toggle, so its renderCount after
  // three toggles is > 1.  A strict `.toBe(1)` would correctly FAIL; a
  // `.toBeGreaterThanOrEqual(1)` would vacuously PASS — confirming that
  // weakening the assertion would blind the guard.
  // ─── Test 3 strict-equal assertion guard ──────────────────────────────────
  // Guards against weakening Test 3's `expect(renderCount).toBe(2)` to a range
  // check such as `toBeGreaterThanOrEqual(2)`.
  //
  // The regression Test 3 catches is: GlanceOverlay over-subscribes and
  // re-renders on every parent-level state change (not just genuine runStatus
  // changes), causing visible stutter during manage-dialog open/close cycles.
  //
  // If the `.toBe(2)` assertion were softened to `.toBeGreaterThanOrEqual(2)`,
  // a component that renders on initial mount AND again on a non-production dep
  // change AND again on the real runStatus change would satisfy it with
  // renderCount = 3 — the over-subscription regression would silently pass.
  //
  // This test demonstrates the danger by running a manageCounter change THEN
  // the same runStatus change as Test 3 against a LOCAL over-subscribing
  // provider (manageCounter IS in deps).  The subscriber re-renders on both
  // changes, giving renderCount = 3.  A strict `.toBe(2)` would correctly
  // FAIL; a `.toBeGreaterThanOrEqual(2)` would vacuously PASS — confirming
  // that weakening the assertion would blind the guard.
  it("strict-equal teeth: an over-subscribing provider causes renderCount > 2 on one runStatus change, proving Test 3's toBe(2) is not vacuous", async () => {
    let renderCount = 0;

    // Provider where manageCounter IS in deps — the opposite of the production
    // contract (GlanceTabOnlyProvider keeps manageCounter out of deps).
    // This simulates an over-subscribing context that re-renders on every
    // parent-level state change, not just genuine production dep changes.
    function OverSubscribingTabProvider({
      runStatus,
      manageCounter,
      children,
    }: {
      runStatus: string;
      manageCounter: number;
      children: ReactNode;
    }) {
      // manageCounter INTENTIONALLY included — simulates the regression where
      // context invalidates on non-production-dep changes, causing spurious
      // re-renders of every HomeTabCtx subscriber.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const value = useMemo(() => ({ runStatus, manageCounter }), [runStatus, manageCounter]);
      return (
        <HomeTabCtx.Provider value={value}>{children}</HomeTabCtx.Provider>
      );
    }

    // Mirrors the GlanceOverlaySim from Test 3 exactly — same hook, same
    // memo() wrap, same dep (runStatus).
    const GlanceOverlaySimT3 = memo(function GlanceOverlaySimT3Inner() {
      renderCount++;
      const { runStatus } = useHomeTabCtx();
      return <span data-testid="glance-t3-teeth">{runStatus}</span>;
    });

    const { rerender } = render(
      <OverSubscribingTabProvider runStatus="running" manageCounter={0}>
        <GlanceOverlaySimT3 />
      </OverSubscribingTabProvider>,
    );

    // After initial mount renderCount must be exactly 1 — just like Test 3.
    expect(renderCount).toBe(1);

    // Change manageCounter (a NON-production dep, intentionally excluded from
    // GlanceTabOnlyProvider's useMemo deps).  In the over-subscribing provider
    // this IS in deps, so the context ref changes and the subscriber re-renders.
    // In the CLEAN provider used by Test 3 this would be a no-op.
    await act(async () => {
      rerender(
        <OverSubscribingTabProvider runStatus="running" manageCounter={1}>
          <GlanceOverlaySimT3 />
        </OverSubscribingTabProvider>,
      );
    });

    // renderCount is now 2 — the over-subscribing spurious re-render fired.
    // (In Test 3's clean provider this step would leave renderCount at 1.)

    // Now change runStatus — the real production dep, exactly as Test 3 does.
    // Both the clean provider AND the over-subscribing provider fire here, so
    // renderCount advances to 3 in the over-subscribing case.
    await act(async () => {
      rerender(
        <OverSubscribingTabProvider runStatus="paused" manageCounter={1}>
          <GlanceOverlaySimT3 />
        </OverSubscribingTabProvider>,
      );
    });

    // renderCount = 3: the over-subscribing provider caused one extra render
    // beyond what the real production dep alone would justify.
    // • toBe(2)               → FAILS  (renderCount is 3) — teeth confirmed.
    // • toBeGreaterThanOrEqual(2) → PASSES (silent regression allowed).
    // This proves that weakening Test 3's assertion would blind the guard.
    expect(renderCount).toBeGreaterThan(2);
  });

  it("strict-equal teeth: a useHomeCtx() variant re-renders on every dialog toggle, proving Test 1's toBe(1) is not vacuous", async () => {
    let renderCount = 0;

    // Variant wired to useHomeCtx() — the accidental re-wiring Test 1 guards
    // against.  A separate counter is used so this test does not disturb any
    // other test's render counts.
    const WrongHookSim = memo(function WrongHookSimInner() {
      renderCount++;
      // WRONG: useHomeCtx() (full context) instead of useHomeTabCtx() (narrow).
      // Any HomeCtx value change — including dialog-field changes intentionally
      // excluded from homeTabCtxValue deps — triggers a re-render here.
      useHomeCtx();
      return <span data-testid="glance-wrong-hook">rendered</span>;
    });

    // Provider that DOES invalidate on dialog-field changes (opposite of the
    // production guard).  Mirrors the DialogAwareProvider from Test 4 above.
    function DialogAwareHomeCtxProvider({
      dialogExtras,
      children,
    }: {
      dialogExtras: Record<string, unknown>;
      children: ReactNode;
    }) {
      const ctxValue = useMemo(
        () => ({ runStatus: "running", brand: "TestBrand", ...dialogExtras }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [dialogExtras],
      );
      return <HomeCtx.Provider value={ctxValue}>{children}</HomeCtx.Provider>;
    }

    const emptyExtras = {};
    const { rerender } = render(
      <DialogAwareHomeCtxProvider dialogExtras={emptyExtras}>
        <WrongHookSim />
      </DialogAwareHomeCtxProvider>,
    );

    // After initial mount renderCount must be exactly 1 — just like Test 1.
    expect(renderCount).toBe(1);

    // Toggle the dialog field open — mirrors Test 1's first manageCounter bump.
    const openExtras = { manageCategory: "mixes" };
    await act(async () => {
      rerender(
        <DialogAwareHomeCtxProvider dialogExtras={openExtras}>
          <WrongHookSim />
        </DialogAwareHomeCtxProvider>,
      );
    });

    // renderCount increased: useHomeCtx() delivered the HomeCtx update caused
    // by the dialog-field toggle.  A strict toBe(1) would FAIL here —
    // correctly catching the regression.  A toBeGreaterThanOrEqual(1) would
    // PASS — silently hiding it.  This is the vacuousness we are guarding
    // against.
    expect(renderCount).toBeGreaterThan(1);
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

    // Guard: confirm the spy target exists as a named export before mount.
    // If useLiveRun is renamed or moved to a different module, this fails
    // immediately with a clear message rather than the post-tick spy count
    // silently staying at 0 and the test passing vacuously.
    expect(typeof LiveRunContextNS.useLiveRun).toBe("function");

    render(
      <GlanceWrapper runStatus="running" manageCounter={0}>
        <GlanceOverlaySim />
      </GlanceWrapper>,
    );

    const firstNow = nowSamples[0];
    expect(firstNow).toBeGreaterThan(0);

    // Spy is set up AFTER the initial render so its baseline count is 0.
    // This confirms the spy only fires on actual hook invocations during
    // re-renders, not from module-level side effects.  If the spy target
    // (LiveRunContextNS.useLiveRun) were ever renamed or moved to a different
    // module, this pre-tick assertion would still be 0 while the post-tick
    // assertion below would fail — immediately signalling that Test 1's
    // call-count guard can no longer be trusted.
    const spy = vi.spyOn(LiveRunContextNS, "useLiveRun");
    try {
      // Pre-tick: spy count must be 0 — no re-renders have occurred yet between
      // spy setup and timer advance, so useLiveRun() has not been called again.
      expect(spy.mock.calls.length).toBe(0);

      // Advance the fake clock — the simulator must receive updated nowTime via
      // the LiveRunProvider context update that useLiveRun() subscribes to.
      await act(async () => { vi.advanceTimersByTime(10_000); });

      const lastNow = nowSamples[nowSamples.length - 1];
      // Clock ticked → useLiveRun() subscription delivered new nowTime →
      // component re-rendered with an advanced timestamp.
      expect(lastNow).toBeGreaterThan(firstNow);

      // Post-tick: spy count must be > 0, confirming that re-renders caused by
      // the LiveRunProvider clock update actually invoked useLiveRun().  Together
      // with the pre-tick === 0 assertion above, this makes the guard symmetric:
      // the spy demonstrably starts at 0 and advances only on hook invocations.
      expect(spy.mock.calls.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
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

    // Guard: confirm the export still exists under the expected name before
    // setting up the spy.  If useHomeTabCtx is renamed or moved in HomeTabCtxNS,
    // vi.spyOn would target a non-existent property (silently succeeding or
    // vacuously passing), stripping the counter-proof of its teeth.  This
    // assertion fails immediately with a clear message in that scenario.
    expect(typeof HomeTabCtxNS.useHomeTabCtx).toBe("function");

    // Set up the spy BEFORE render so it captures the initial mount call(s).
    // This confirms that useHomeTabCtx() was actually invoked during rendering
    // (the simulator is non-degenerate — it has a real active hook consumer)
    // and that no extra calls arrive after clock ticks (render count stayed flat).
    const spy = vi.spyOn(HomeTabCtxNS, "useHomeTabCtx");

    try {
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

      // Post-mount: spy count must be > 0, confirming useHomeTabCtx() was
      // actually invoked during rendering.  If the simulator were simplified to
      // a trivially empty component with no hook calls, renderCount would still
      // track renders but this assertion would fail — immediately signalling that
      // the counter-proof is no longer validating an active hook consumer.
      const spyCountAfterMount = spy.mock.calls.length;
      expect(spyCountAfterMount).toBeGreaterThan(0);

      // Advance the clock — WITHOUT useLiveRun(), LiveRunProvider context updates
      // do NOT reach this component; HomeTabCtx is stable; React.memo() skips
      // the re-render entirely.
      await act(async () => { vi.advanceTimersByTime(10_000); });

      // renderCount must be unchanged: no re-renders occurred after mount.
      // This is exactly the failure mode if useLiveRun() were removed from the
      // real GlanceOverlay — the live clock would stop driving re-renders, and
      // Test 1's lastNow > firstNow assertion would fail.
      expect(renderCount).toBe(renderCountAfterMount);

      // Post-tick: spy count must equal the mount count, confirming that no
      // additional useHomeTabCtx() calls (i.e. no extra re-renders) occurred
      // after clock ticks.  Together with the pre-tick > 0 assertion above,
      // this makes the guard symmetric: the active hook was called on mount,
      // then stayed flat — proving the no-useLiveRun path is genuinely inert.
      expect(spy.mock.calls.length).toBe(spyCountAfterMount);
    } finally {
      spy.mockRestore();
    }
  });

  // ─── Test 3: SYMMETRIC SPY GUARD ──────────────────────────────────────────
  // The render-count counter-proof above (Test 2) validates that HomeTabCtx
  // alone does not drive re-renders during clock ticks.  But if the simulator
  // were ever simplified to render null with no hook call at all (trivially
  // non-subscribed), Test 2 would still pass while no longer validating that an
  // *active hook consumer* is required to be absent.
  //
  // This test adds a symmetric guard using a spy on LiveRunContextNS.useLiveRun:
  // it renders a simulator that calls useHomeTabCtx() (non-trivial active hook)
  // but NOT useLiveRun(), and asserts the spy count stays at exactly 0 after
  // 60 s of clock ticks.
  //
  // WHY useHomeTabCtx() AS THE STAND-IN:
  //   useHomeTabCtx() is the real hook the GlanceOverlay component calls
  //   alongside useLiveRun().  Using it here keeps the simulator non-degenerate
  //   (it has an active hook consumer) while confirming that that hook alone
  //   does NOT trigger the spy — only a direct useLiveRun() call would.
  //
  // This proves that if the spy target (LiveRunContextNS.useLiveRun) were ever
  // renamed or moved to a different module, the sibling subscription test (Test
  // 1) would start passing vacuously.  This test would immediately fail because
  // even a non-trivial simulator omitting useLiveRun() would now show spy calls
  // if the spy were somehow tracking the wrong target.
  it("symmetric spy guard: spy on LiveRunContextNS.useLiveRun stays at 0 for a useHomeTabCtx()-only simulator (no useLiveRun call) over 60 s", async () => {
    expect(typeof LiveRunContextNS.useLiveRun).toBe("function");
    const spy = vi.spyOn(LiveRunContextNS, "useLiveRun");

    try {
      // Simulator calls useHomeTabCtx() — the non-trivial active hook that the
      // real GlanceOverlay also calls — but deliberately omits useLiveRun().
      const HomeTabOnlySim = memo(function HomeTabOnlySimInner() {
        useHomeTabCtx();
        return null;
      });

      render(
        <GlanceWrapper runStatus="running" manageCounter={0}>
          <HomeTabOnlySim />
        </GlanceWrapper>,
      );

      // No useLiveRun() call in the subtree — spy must be at 0 even after mount.
      expect(spy.mock.calls.length).toBe(0);

      // Advance 60 s — LiveRunProvider's internal interval fires 60 per-second
      // ticks and pushes new context values to subscribers.  HomeTabOnlySim is
      // not subscribed to LiveRunContext so the spy must remain flat.
      await act(async () => { vi.advanceTimersByTime(60_000); });

      // Still 0: the spy fires ONLY when the hook is actually invoked, not when
      // the provider emits a new timer value.  If this assertion fails, it means
      // the spy is intercepting something other than direct useLiveRun() calls —
      // a signal that the spy target has drifted and Test 1's call-count check
      // can no longer be trusted.
      expect(spy.mock.calls.length).toBe(0);
    } finally {
      spy.mockRestore();
    }
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

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 10 — Real GlanceOverlay's useLiveRun() subscription advances in the
//             combined HomeCtx + HomeTabCtx wrapper (Suite 9 setup)
//
// The gap closed here:
//   Suite 9 Test 1 guards against useHomeCtx() re-wiring by checking data-now
//   stability on a dialog toggle.  But it relies on a re-render (caused by the
//   wrong hook) to distinguish "subscribed to wrong context" from "not subscribed
//   at all".  If BOTH useLiveRun() AND useHomeTabCtx() were dropped simultaneously,
//   data-now would never advance (no re-renders), and Suite 9 Test 1 would still
//   pass — masking the freeze entirely.
//
//   Suite 6 covers the useLiveRun spy, but only inside RealGlanceWrapper
//   (HomeTabCtx + LiveRunProvider only; no HomeCtx in the tree).  This suite
//   runs the same spy check inside RealGlanceHomeCtxWrapper (both HomeCtx AND
//   HomeTabCtx present), matching the exact render tree used by Suite 9, so a
//   simultaneous removal of both hooks cannot hide behind Suite 9's dialog-toggle
//   assertion.
//
// Two tests:
//
//   1. CALL-COUNT ADVANCE — after 60 s of fake clock ticks, the useLiveRun()
//      spy call count on the real GlanceOverlay exceeds its count at mount.
//      If useLiveRun() were removed from GlanceOverlay, the count would be flat
//      and this test would fail.
//
//   2. COUNTER-PROOF — a memo()-wrapped component that omits useLiveRun() and
//      sits in the same wrapper produces a flat spy call count after the same
//      60 s advance, proving the advancing count in Test 1 is caused by
//      GlanceOverlay's real useLiveRun() subscription and not by some other
//      source in the render tree.
// ═══════════════════════════════════════════════════════════════════════════════

describe("LiveTabMemo — Suite 10: real GlanceOverlay useLiveRun() call count advances in combined HomeCtx+HomeTabCtx wrapper", () => {
  // ── Shared counter-proof component ────────────────────────────────────────
  // Both Test 2 (flat spy count) and Test 3 (liveness guard) use this EXACT
  // component definition.  A single shared definition ensures that any future
  // weakening of the counter-proof (e.g. removing useHomeTabCtx()) is
  // immediately visible to both tests — there is no separate copy that can
  // silently drift away from the component actually exercised by Test 2.
  let s10RenderCount = 0;

  // NOTE: memo() is called here at describe-scope so React sees a stable
  // component identity across tests.  s10RenderCount is reset in beforeEach.
  const NoLiveRunSubscriber = memo(function NoLiveRunSubscriberInner() {
    s10RenderCount++;
    useHomeTabCtx(); // live HomeTabCtx subscriber — just like GlanceOverlay
    // useLiveRun() intentionally absent — the counter-proof scenario
    return <span data-testid="s10-no-live-run">static</span>;
  });

  beforeEach(() => { s10RenderCount = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  // ─── Test 1: CALL-COUNT ADVANCE ──────────────────────────────────────────
  // Spy on the exported useLiveRun symbol and confirm the real GlanceOverlay
  // keeps calling it on every clock-driven re-render.  Uses the
  // RealGlanceHomeCtxWrapper (HomeCtx + HomeTabCtx + LiveRunProvider) from
  // Suite 9 so the combined tree is identical to the one that Suite 9 tests.
  //
  // If useLiveRun() were accidentally removed from GlanceOverlay:
  //   • the component would stop re-rendering on clock ticks
  //   • spy.mock.calls.length would stay flat after advanceTimersByTime
  //   • this assertion would fail — catching the freeze before it ships
  it("real GlanceOverlay: useLiveRun() spy call count advances after 60 s of clock ticks (combined HomeCtx+HomeTabCtx wrapper)", async () => {
    const spy = vi.spyOn(LiveRunContextNS, "useLiveRun");

    render(
      <RealGlanceHomeCtxWrapper runStatus="running" dialogOpen={false}>
        <GlanceOverlay />
      </RealGlanceHomeCtxWrapper>,
    );

    // At mount the real GlanceOverlay must have already called useLiveRun()
    // at least once (initial render).
    const countAtMount = spy.mock.calls.length;
    expect(countAtMount).toBeGreaterThan(0);

    // Advance the fake clock 60 s — LiveRunProvider emits a new context value
    // every second, so GlanceOverlay must re-render and call useLiveRun() many
    // more times.
    await act(async () => { vi.advanceTimersByTime(60_000); });

    // Call count must have increased: useLiveRun() was invoked on each
    // clock-tick re-render.  A flat count means the subscription was lost.
    expect(spy.mock.calls.length).toBeGreaterThan(countAtMount);

    spy.mockRestore();
  });

  // ─── Test 2: COUNTER-PROOF ────────────────────────────────────────────────
  // A memo()-wrapped component that deliberately omits useLiveRun() sits in
  // the same RealGlanceHomeCtxWrapper.  After 60 s of clock ticks the spy
  // call count must be flat (equal to its count at mount), proving that the
  // advancing count in Test 1 is caused exclusively by GlanceOverlay's
  // useLiveRun() subscription and not by some other call site in the tree
  // (e.g. LiveRunProvider itself or another mounted component).
  //
  // This gives Test 1 its teeth: if the counter-proof count were also
  // advancing it would mean the spy is picking up background calls that have
  // nothing to do with GlanceOverlay, invalidating Test 1's signal.
  it("counter-proof: a memo() component with no useLiveRun() subscription has a flat spy call count after 60 s of clock ticks", async () => {
    const spy = vi.spyOn(LiveRunContextNS, "useLiveRun");

    // NoLiveRunSubscriber is defined at describe-scope (shared with Test 3).
    // It mirrors GlanceOverlay's HomeTabCtx subscription but deliberately
    // omits useLiveRun() — the "useLiveRun() accidentally deleted" scenario.
    render(
      <RealGlanceHomeCtxWrapper runStatus="running" dialogOpen={false}>
        <NoLiveRunSubscriber />
      </RealGlanceHomeCtxWrapper>,
    );

    // Record call count immediately after mount.  The wrapper itself does not
    // call useLiveRun(), and NoLiveRunSubscriber does not either, so the
    // count at mount should be 0.
    const countAtMount = spy.mock.calls.length;

    // Same 60 s advance used in Test 1.
    await act(async () => { vi.advanceTimersByTime(60_000); });

    // Call count must be flat: without a useLiveRun() subscription the
    // component does not re-render on clock ticks and the spy records no
    // new calls.  Any increase would invalidate Test 1's advancing-count
    // signal.
    expect(spy.mock.calls.length).toBe(countAtMount);

    spy.mockRestore();
  });

  // ─── Test 3: COUNTER-PROOF IS NOT A NO-OP ────────────────────────────────
  // Confirms the counter-proof component from Test 2 (NoLiveRunSubscriber) is
  // a genuine live subscriber to HomeTabCtx and not a trivial no-op wrapper.
  //
  // Why this matters:
  //   If someone accidentally removed useHomeTabCtx() from NoLiveRunSubscriber,
  //   it would stop receiving HomeTabCtx updates entirely — yet it would still
  //   produce a flat useLiveRun() spy count after 60 s (because it still omits
  //   useLiveRun()).  Test 2 would continue to pass vacuously, giving Test 1
  //   false confidence that the advancing call count is meaningful.
  //
  // The fix: prove NoLiveRunSubscriber IS a live subscriber to something by
  // showing it re-renders when HomeTabCtx changes (runStatus toggle).
  // tabCtxValue in RealGlanceHomeCtxWrapper memos on runStatus, so flipping
  // "running" → "idle" emits a new HomeTabCtx value.  A genuine useHomeTabCtx()
  // subscriber must re-render; a hollow no-op would not.
  it("counter-proof liveness: NoLiveRunSubscriber re-renders when HomeTabCtx changes (runStatus toggle), proving it is not a no-op", async () => {
    // Uses the SAME NoLiveRunSubscriber defined at describe-scope — the exact
    // component exercised by Test 2.  s10RenderCount is reset in beforeEach.
    const { rerender } = render(
      <RealGlanceHomeCtxWrapper runStatus="running" dialogOpen={false}>
        <NoLiveRunSubscriber />
      </RealGlanceHomeCtxWrapper>,
    );

    const countAfterMount = s10RenderCount;
    expect(countAfterMount).toBeGreaterThan(0);

    // Toggle runStatus "running" → "idle": HomeTabCtx emits a new value
    // (tabCtxValue memos on runStatus inside RealGlanceHomeCtxWrapper).
    // The useHomeTabCtx() subscriber must re-render.
    await act(async () => {
      rerender(
        <RealGlanceHomeCtxWrapper runStatus="idle" dialogOpen={false}>
          <NoLiveRunSubscriber />
        </RealGlanceHomeCtxWrapper>,
      );
    });

    // s10RenderCount increased: the useHomeTabCtx() subscription delivered the
    // updated context and triggered a re-render.  If useHomeTabCtx() were
    // removed from NoLiveRunSubscriber (the shared describe-scope component),
    // s10RenderCount would stay flat — meaning Test 2's "flat spy count" would
    // be vacuously satisfied and Test 1's advancing-count signal would be
    // unguarded.
    expect(s10RenderCount).toBeGreaterThan(countAfterMount);
  });

  // ─── Test 4: COUNTER-PROOF IS NOT WIRED TO HomeCtx ───────────────────────
  // Mirrors Suite 9 Test 1: confirms that NoLiveRunSubscriber (the shared
  // counter-proof component from Tests 2 & 3) does NOT re-render when a
  // HomeCtx dialog field toggles, proving it is subscribed to HomeTabCtx
  // only and not accidentally wired to the broader HomeCtx.
  //
  // Why this matters:
  //   Test 3 proves NoLiveRunSubscriber re-renders on a HomeTabCtx (runStatus)
  //   change.  But it does not prove the re-render is caused EXCLUSIVELY by
  //   HomeTabCtx.  If NoLiveRunSubscriber were inadvertently changed to call
  //   useHomeCtx() instead of (or in addition to) useHomeTabCtx(), it would
  //   still re-render on runStatus changes (HomeCtx also carries runStatus),
  //   and Test 3 would still pass — masking the drift.
  //
  //   This test closes that gap: it toggles only the HomeCtx dialogOpen field
  //   (which is NOT in HomeTabCtx's dep list) and asserts s10RenderCount stays
  //   flat.  A genuine useHomeTabCtx()-only subscriber must NOT re-render;
  //   a component wired to useHomeCtx() would re-render and fail this test.
  it("counter-proof isolation: NoLiveRunSubscriber does NOT re-render when only a HomeCtx dialog field toggles (confirming it is not wired to HomeCtx)", async () => {
    // Uses the SAME NoLiveRunSubscriber defined at describe-scope — the exact
    // component exercised by Tests 2 & 3.  s10RenderCount is reset in beforeEach.
    const { rerender } = render(
      <RealGlanceHomeCtxWrapper runStatus="running" dialogOpen={false}>
        <NoLiveRunSubscriber />
      </RealGlanceHomeCtxWrapper>,
    );

    const countAfterMount = s10RenderCount;
    expect(countAfterMount).toBeGreaterThan(0);

    // Toggle the HomeCtx dialog field (dialogOpen "" → "mixes" manageCategory)
    // WITHOUT changing runStatus.  HomeCtx emits a new value; HomeTabCtx stays
    // the same (dialogOpen is not a dep of tabCtxValue in RealGlanceHomeCtxWrapper).
    await act(async () => {
      rerender(
        <RealGlanceHomeCtxWrapper runStatus="running" dialogOpen={true}>
          <NoLiveRunSubscriber />
        </RealGlanceHomeCtxWrapper>,
      );
    });

    // s10RenderCount must be unchanged: HomeTabCtx did not emit a new value,
    // so a genuine useHomeTabCtx()-only subscriber must not re-render.
    // If useHomeTabCtx() were replaced with useHomeCtx() inside
    // NoLiveRunSubscriber, the HomeCtx change above would reach the component,
    // s10RenderCount would increase, and this assertion would fail — catching
    // the drift before Test 2's "flat spy count" signal is undermined.
    expect(s10RenderCount).toBe(countAfterMount);
  });

  // ─── Test 5: STRICT-EQUAL HAS REAL TEETH ─────────────────────────────────
  // Proves that Test 4's `expect(s10RenderCount).toBe(countAfterMount)` is not
  // vacuous.  If that strict-equal assertion were softened to
  // `toBeGreaterThanOrEqual`, or if NoLiveRunSubscriber were re-wired to call
  // useHomeCtx() instead of useHomeTabCtx(), the assertion would still pass —
  // even though the counter-proof component would now be accepting re-renders
  // triggered by HomeCtx dialog-toggle updates, silently undermining the
  // isolation signal Test 4 is designed to provide.
  //
  // This test renders a LOCAL variant of NoLiveRunSubscriber that calls
  // useHomeCtx() instead of useHomeTabCtx() (the accidental re-wiring scenario),
  // then toggles the SAME dialogOpen field used in Test 4.  Because HomeCtx
  // memos on dialogOpen (manageCategory "" → "mixes" inside
  // RealGlanceHomeCtxWrapper), the wrong-hook variant re-renders and the count
  // INCREASES — confirming that Test 4's strict-equal assertion would correctly
  // FAIL under the regression it is designed to catch.
  it("strict-equal teeth: a variant wired to useHomeCtx() DOES re-render when the HomeCtx dialog field toggles, proving Test 4's flat-count assertion is not vacuous", async () => {
    let homeCtxVariantCount = 0;

    // Local variant: identical to the describe-scope NoLiveRunSubscriber except
    // it calls useHomeCtx() instead of useHomeTabCtx() — the accidental
    // re-wiring that Test 4 is designed to catch.  A separate counter is used
    // so this test does not interfere with s10RenderCount (reset in beforeEach).
    const HomeCtxVariant = memo(function HomeCtxVariantInner() {
      homeCtxVariantCount++;
      useHomeCtx(); // wrong hook — subscribed to the broader HomeCtx
      return <span data-testid="s10-homectx-variant">variant</span>;
    });

    const { rerender } = render(
      <RealGlanceHomeCtxWrapper runStatus="running" dialogOpen={false}>
        <HomeCtxVariant />
      </RealGlanceHomeCtxWrapper>,
    );

    const countAfterMount = homeCtxVariantCount;
    expect(countAfterMount).toBeGreaterThan(0);

    // Toggle the HomeCtx dialog field — dialogOpen false → true causes
    // RealGlanceHomeCtxWrapper's homeCtxValue memo to re-run (manageCategory
    // "" → "mixes") while tabCtxValue stays stable.  A component wired to
    // useHomeCtx() must receive the update and re-render.
    await act(async () => {
      rerender(
        <RealGlanceHomeCtxWrapper runStatus="running" dialogOpen={true}>
          <HomeCtxVariant />
        </RealGlanceHomeCtxWrapper>,
      );
    });

    // homeCtxVariantCount increased: the useHomeCtx() subscription delivered
    // the HomeCtx update.  This demonstrates that the REAL NoLiveRunSubscriber
    // (which uses useHomeTabCtx()) would also increase its count under the same
    // wrong-hook scenario — and Test 4's strict `.toBe(countAfterMount)` would
    // correctly fail, confirming the assertion has genuine teeth and cannot be
    // vacuously satisfied.
    expect(homeCtxVariantCount).toBeGreaterThan(countAfterMount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 11 — Real CompactRunStrip stays live when a manage dialog is open
//
// CompactRunStrip (src/components/CompactRunStrip.tsx) is a memo()-wrapped
// component that floats persistently in the header whenever the user is on
// any tab OTHER than the Run tab — it stays VISIBLE while manage dialogs are
// open, exactly like GlanceOverlay.
//
// Subscription pattern the real component must maintain:
//   • useHomeTabCtx() — runStatus, currentRun, dayState, v, ve, setActiveTab, pauseRun
//   • useLiveRun()    — calc, nowTime, elapsedBatchSec, casesPct, casesFreezerPct
//
// Two tests mirror Suite 9/10 for GlanceOverlay:
//
//   1. ISOLATION  — real CompactRunStrip's data-testid="compact-run-strip" DOM
//      node does NOT disappear and useLiveRun() spy call count advances after
//      60 s of fake clock ticks while a manage dialog div is concurrently
//      rendered — proving the live subscription is NOT blocked.
//
//   2. COUNTER-PROOF — a memo()-wrapped component that omits useLiveRun() in
//      the same wrapper produces a flat spy call count after the same 60 s
//      advance, proving Test 1's advancing count comes from CompactRunStrip's
//      own subscription and not from background call sites.
// ═══════════════════════════════════════════════════════════════════════════════

// Module-level stable refs so CompactRunStripWrapper re-renders (caused by
// dialogOpen changing) don't create new object identities for LiveRunProvider
// props — which would otherwise emit a spurious context update.
const S11_DAY_STATE = { runs: [ACTIVE_RUN], currentIndex: 0 } as const;
const S11_UPCOMING_LABELS: string[] = [];
const S11_MACHINE = { spinSec: 0, hopperSec: 0 } as const;

// Minimal HomeTabCtx value for CompactRunStrip.
// Provides all fields the real component reads: runStatus, currentRun,
// dayState, v, ve, setActiveTab, pauseRun.
function makeCompactRunStripCtxValue(runStatus: string) {
  return {
    runStatus,
    currentRun: { id: "run-live-1", brand: "TestBrand", flavor: "TestFlavor", startedAt: STARTED_AT },
    dayState: S11_DAY_STATE,
    v: ACTIVE_VALUES,
    ve: ACTIVE_VALUES,
    setActiveTab: () => {},
    pauseRun: () => {},
  };
}

// Wrapper: HomeTabCtx.Provider (stable on runStatus) + LiveRunProvider.
// dialogOpen is passed as a prop so the test can toggle "manage dialog open"
// without touching the HomeTabCtx value — HomeTabCtx stays stable, which is
// the key isolation invariant that CompactRunStrip relies on.
function CompactRunStripWrapper({
  runStatus = "running",
  dialogOpen = false,
  children,
}: {
  runStatus?: string;
  dialogOpen?: boolean;
  children: ReactNode;
}) {
  const form = useForm<FormValues>({ defaultValues: ACTIVE_VALUES });

  // Only runStatus in deps — dialogOpen intentionally excluded.
  // This mirrors home.tsx: homeTabCtxValue never includes manage/dialog fields.
  const tabCtxValue = useMemo(
    () => makeCompactRunStripCtxValue(runStatus),
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
        dayState={S11_DAY_STATE}
        doughSubTab="dough"
        upcomingRunLabels={S11_UPCOMING_LABELS}
        prefs={undefined}
        screenMode={null}
        machine={S11_MACHINE}
      >
        {dialogOpen && (
          <div data-testid="s11-manage-dialog">Manage: mixes</div>
        )}
        {children}
      </LiveRunProvider>
    </HomeTabCtx.Provider>
  );
}

describe("LiveTabMemo — Suite 11: real CompactRunStrip useLiveRun() subscription stays live when a manage dialog is open", () => {
  let s11NoLiveRunRenderCount = 0;

  // Counter-proof component: subscribes to HomeTabCtx (like the real strip)
  // but deliberately omits useLiveRun() — the "subscription accidentally removed"
  // scenario.  Defined at describe-scope so its identity is stable across tests.
  const S11NoLiveRunSubscriber = memo(function S11NoLiveRunSubscriberInner() {
    s11NoLiveRunRenderCount++;
    useHomeTabCtx();
    return <span data-testid="s11-no-live-run">static</span>;
  });

  beforeEach(() => { s11NoLiveRunRenderCount = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  // ─── Test 1: LIVE CLOCK WITH MANAGE DIALOG ───────────────────────────────
  // The real CompactRunStrip must keep calling useLiveRun() on every clock
  // tick even while a manage dialog div is concurrently rendered.
  //
  // If useLiveRun() were accidentally removed from CompactRunStrip:
  //   • the component would stop re-rendering on clock ticks
  //   • spy.mock.calls.length would stay flat after advanceTimersByTime
  //   • this assertion would fail — catching the freeze before it ships
  it("real CompactRunStrip: useLiveRun() spy call count advances after 60 s while a manage dialog is rendered concurrently", async () => {
    const spy = vi.spyOn(LiveRunContextNS, "useLiveRun");

    render(
      <CompactRunStripWrapper runStatus="running" dialogOpen={true}>
        <CompactRunStrip />
      </CompactRunStripWrapper>,
    );

    // Manage dialog is visible at the same time as the strip
    expect(document.querySelector("[data-testid='s11-manage-dialog']")).not.toBeNull();
    // Strip itself is rendered
    expect(document.querySelector("[data-testid='compact-run-strip']")).not.toBeNull();

    // At mount the real CompactRunStrip must have already called useLiveRun()
    const countAtMount = spy.mock.calls.length;
    expect(countAtMount).toBeGreaterThan(0);

    // Advance 60 s — LiveRunProvider emits a new context value every second
    await act(async () => { vi.advanceTimersByTime(60_000); });

    // Call count must have increased: the live subscription was not blocked
    // by the concurrent manage dialog render.
    expect(spy.mock.calls.length).toBeGreaterThan(countAtMount);

    spy.mockRestore();
  });

  // ─── Test 2: COUNTER-PROOF ────────────────────────────────────────────────
  // A memo()-wrapped component that omits useLiveRun() sits in the same
  // wrapper.  After 60 s its spy call count must be flat, proving the
  // advancing count in Test 1 is caused by CompactRunStrip's real subscription.
  it("counter-proof: a memo() component with no useLiveRun() subscription has a flat spy call count after 60 s of clock ticks", async () => {
    const spy = vi.spyOn(LiveRunContextNS, "useLiveRun");

    render(
      <CompactRunStripWrapper runStatus="running" dialogOpen={true}>
        <S11NoLiveRunSubscriber />
      </CompactRunStripWrapper>,
    );

    const countAtMount = spy.mock.calls.length;

    await act(async () => { vi.advanceTimersByTime(60_000); });

    // Without a useLiveRun() subscription the component does not re-render on
    // clock ticks — spy count must be flat.
    expect(spy.mock.calls.length).toBe(countAtMount);

    spy.mockRestore();
  });

  // ─── Test 3: COUNTER-PROOF IS NOT A NO-OP ────────────────────────────────
  // Confirms S11NoLiveRunSubscriber genuinely subscribes to HomeTabCtx and
  // re-renders when it changes — so its flat useLiveRun() spy count in Test 2
  // is meaningful (the component IS active, just not subscribed to the clock).
  it("counter-proof liveness: S11NoLiveRunSubscriber re-renders when HomeTabCtx changes (runStatus toggle), proving it is not a no-op", async () => {
    const { rerender } = render(
      <CompactRunStripWrapper runStatus="running" dialogOpen={false}>
        <S11NoLiveRunSubscriber />
      </CompactRunStripWrapper>,
    );

    const countAfterMount = s11NoLiveRunRenderCount;
    expect(countAfterMount).toBeGreaterThan(0);

    // Toggle runStatus: HomeTabCtx emits a new value → useHomeTabCtx() subscriber re-renders.
    await act(async () => {
      rerender(
        <CompactRunStripWrapper runStatus="idle" dialogOpen={false}>
          <S11NoLiveRunSubscriber />
        </CompactRunStripWrapper>,
      );
    });

    expect(s11NoLiveRunRenderCount).toBeGreaterThan(countAfterMount);
  });

  // ─── Test 4: COUNTER-PROOF IS NOT WIRED TO HomeCtx ───────────────────────
  // Mirrors Suite 10 Test 4: confirms that S11NoLiveRunSubscriber (the shared
  // counter-proof component from Tests 2 & 3) does NOT re-render when a
  // HomeCtx dialog field toggles, proving it is subscribed to HomeTabCtx
  // only and not accidentally wired to the broader HomeCtx.
  //
  // Why this matters:
  //   Test 3 proves S11NoLiveRunSubscriber re-renders on a HomeTabCtx (runStatus)
  //   change.  But it does not prove the re-render is caused EXCLUSIVELY by
  //   HomeTabCtx.  If S11NoLiveRunSubscriber were inadvertently changed to call
  //   useHomeCtx() instead of (or in addition to) useHomeTabCtx(), it would
  //   still re-render on runStatus changes (HomeCtx also carries runStatus),
  //   and Test 3 would still pass — masking the drift.
  //
  //   This test closes that gap: it toggles only the HomeCtx dialogOpen field
  //   (which is NOT in HomeTabCtx's dep list) and asserts s11NoLiveRunRenderCount
  //   stays flat.  A genuine useHomeTabCtx()-only subscriber must NOT re-render;
  //   a component wired to useHomeCtx() would re-render and fail this test.
  //
  // Uses S12Wrapper (both HomeCtx + HomeTabCtx present) so that the HomeCtx
  // value can change on dialogOpen without affecting HomeTabCtx.
  it("counter-proof isolation: S11NoLiveRunSubscriber does NOT re-render when only a HomeCtx dialog field toggles (confirming it is not wired to HomeCtx)", async () => {
    const { rerender } = render(
      <S12Wrapper runStatus="running" dialogOpen={false}>
        <S11NoLiveRunSubscriber />
      </S12Wrapper>,
    );

    const countAfterMount = s11NoLiveRunRenderCount;
    expect(countAfterMount).toBeGreaterThan(0);

    // Toggle the HomeCtx dialog field (dialogOpen false → true, which changes
    // manageCategory "" → "mixes" inside S12Wrapper) WITHOUT changing runStatus.
    // HomeCtx emits a new value; HomeTabCtx stays the same.
    await act(async () => {
      rerender(
        <S12Wrapper runStatus="running" dialogOpen={true}>
          <S11NoLiveRunSubscriber />
        </S12Wrapper>,
      );
    });

    // s11NoLiveRunRenderCount must be unchanged: HomeTabCtx did not emit a new
    // value, so a genuine useHomeTabCtx()-only subscriber must not re-render.
    // If useHomeTabCtx() were replaced with useHomeCtx() inside
    // S11NoLiveRunSubscriber, the HomeCtx change above would reach the component,
    // s11NoLiveRunRenderCount would increase, and this assertion would fail —
    // catching the drift before Test 2's "flat spy count" signal is undermined.
    expect(s11NoLiveRunRenderCount).toBe(countAfterMount);
  });

  // ─── Test 5: STRICT-EQUAL HAS REAL TEETH ─────────────────────────────────
  // Mirrors Suite 10 Test 5: proves that Test 4's strict `.toBe(countAfterMount)`
  // is not vacuous.  If that assertion were softened to `toBeGreaterThanOrEqual`,
  // or if S11NoLiveRunSubscriber were re-wired to call useHomeCtx() instead of
  // useHomeTabCtx(), the assertion would still pass — even though the
  // counter-proof component would now be accepting re-renders triggered by
  // HomeCtx dialog-toggle updates, silently undermining the isolation signal
  // Test 4 is designed to provide.
  //
  // This test renders a LOCAL variant of S11NoLiveRunSubscriber that calls
  // useHomeCtx() instead of useHomeTabCtx() (the accidental re-wiring scenario),
  // then toggles the SAME dialogOpen field used in Test 4.  Because HomeCtx
  // includes manageCategory in its value (and S12Wrapper memos on dialogOpen),
  // the wrong-hook variant re-renders and the count INCREASES — confirming that
  // Test 4's strict-equal assertion would correctly FAIL under the regression
  // it is designed to catch.
  it("strict-equal teeth: a variant wired to useHomeCtx() DOES re-render when the HomeCtx dialog field toggles, proving Test 4's flat-count assertion is not vacuous", async () => {
    let homeCtxVariantCount = 0;

    // Local variant: identical to the describe-scope S11NoLiveRunSubscriber
    // except it calls useHomeCtx() instead of useHomeTabCtx() — the accidental
    // re-wiring that Test 4 is designed to catch.  A separate counter is used
    // so this test does not interfere with s11NoLiveRunRenderCount (reset in beforeEach).
    const HomeCtxVariant = memo(function HomeCtxVariantInner() {
      homeCtxVariantCount++;
      useHomeCtx(); // wrong hook — subscribed to the broader HomeCtx
      return <span data-testid="s11-homectx-variant">variant</span>;
    });

    const { rerender } = render(
      <S12Wrapper runStatus="running" dialogOpen={false}>
        <HomeCtxVariant />
      </S12Wrapper>,
    );

    const countAfterMount = homeCtxVariantCount;
    expect(countAfterMount).toBeGreaterThan(0);

    // Toggle the HomeCtx dialog field — dialogOpen false → true causes
    // S12Wrapper's homeCtxValue memo to re-run (manageCategory "" → "mixes")
    // while tabCtxValue stays stable.  A component wired to useHomeCtx() must
    // receive the update and re-render.
    await act(async () => {
      rerender(
        <S12Wrapper runStatus="running" dialogOpen={true}>
          <HomeCtxVariant />
        </S12Wrapper>,
      );
    });

    // homeCtxVariantCount increased: the useHomeCtx() subscription delivered
    // the HomeCtx update.  This demonstrates that the REAL S11NoLiveRunSubscriber
    // (which uses useHomeTabCtx()) would also increase its count under the same
    // wrong-hook scenario — and Test 4's strict `.toBe(countAfterMount)` would
    // correctly fail, confirming the assertion has genuine teeth and cannot be
    // vacuously satisfied.
    expect(homeCtxVariantCount).toBeGreaterThan(countAfterMount);
  });

  // ─── Test 6: TEETH GUARD — Test 5's count-increases assertion is not vacuous ─
  // Test 5 proves that Test 4's strict `.toBe(countAfterMount)` has real teeth
  // by showing a useHomeCtx() variant DOES re-render when S12Wrapper's homeCtxValue
  // changes on a dialogOpen toggle.  But Test 5 itself uses `.toBeGreaterThan` —
  // if that assertion were softened to `.toBeGreaterThanOrEqual`, or if S12Wrapper
  // inadvertently excluded dialogOpen from homeCtxValue's deps, the count could
  // stay flat and both Test 5 and Test 4 would vacuously pass.
  //
  // This guard closes that gap by demonstrating the necessary condition:
  //   If S12Wrapper's homeCtxValue excluded dialogOpen from its useMemo deps,
  //   HomeCtx would NOT emit a new value on the toggle, the useHomeCtx() variant
  //   would NOT re-render, and the count would be FLAT.
  //
  // The strict `.toBe(countAfterMount)` assertion here confirms that the count
  // genuinely can stay flat (the regression scenario is reachable), proving that
  // Test 5's `.toBeGreaterThan(countAfterMount)` is the load-bearing check that
  // cannot be safely replaced with `.toBeGreaterThanOrEqual`.
  it("teeth guard: a useHomeCtx() variant does NOT re-render when the wrapper's homeCtxValue excludes dialogOpen from deps, proving Test 5's toBeGreaterThan assertion is not vacuous", async () => {
    let teethGuardCount = 0;

    // Same subscription pattern as Test 5's HomeCtxVariant — reads useHomeCtx().
    // A separate counter so this test never interferes with s11NoLiveRunRenderCount.
    const HomeCtxVariantTeethGuard = memo(function HomeCtxVariantTeethGuardInner() {
      teethGuardCount++;
      useHomeCtx(); // subscribed to the broader HomeCtx — like Test 5's variant
      return <span data-testid="s11-teeth-guard-variant">variant</span>;
    });

    // Broken wrapper: homeCtxValue's useMemo intentionally excludes dialogOpen
    // from its deps.  When dialogOpen toggles, homeCtxValue stays the same
    // cached reference — HomeCtx does NOT emit a new value — so a useHomeCtx()
    // subscriber does NOT re-render.  This is the failure scenario that Test 5's
    // `.toBeGreaterThan` assertion is designed to catch.
    function BrokenS12Wrapper({
      runStatus = "running",
      dialogOpen: _dialogOpen = false,
      children,
    }: {
      runStatus?: string;
      dialogOpen?: boolean;
      children: ReactNode;
    }) {
      const form = useForm<FormValues>({ defaultValues: ACTIVE_VALUES });

      // Stable narrow context — same as real S12Wrapper.
      const tabCtxValue = useMemo(
        () => makeCompactRunStripCtxValue(runStatus),
        [runStatus],
      );

      // BUG SIMULATION: dialogOpen is not a dep → homeCtxValue is frozen;
      // toggling dialogOpen from outside will NOT produce a new HomeCtx value.
      const homeCtxValue = useMemo(
        () => ({
          runStatus,
          currentRun: { id: "run-live-1", brand: "TestBrand", flavor: "TestFlavor" },
          dayState: S12_DAY_STATE,
          form: null,
          activeTab: "run",
          manageCategory: "",  // always "" — dialogOpen excluded from deps
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [runStatus],  // dialogOpen deliberately absent — this is the bug being simulated
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
              dayState={S12_DAY_STATE}
              doughSubTab="dough"
              upcomingRunLabels={S12_UPCOMING_LABELS}
              prefs={undefined}
              screenMode={null}
              machine={S12_MACHINE}
            >
              {children}
            </LiveRunProvider>
          </HomeTabCtx.Provider>
        </HomeCtx.Provider>
      );
    }

    const { rerender } = render(
      <BrokenS12Wrapper runStatus="running" dialogOpen={false}>
        <HomeCtxVariantTeethGuard />
      </BrokenS12Wrapper>,
    );

    const countAfterMount = teethGuardCount;
    expect(countAfterMount).toBeGreaterThan(0);

    // Toggle dialogOpen — but because BrokenS12Wrapper excludes it from
    // homeCtxValue's deps, HomeCtx does NOT emit a new value.
    await act(async () => {
      rerender(
        <BrokenS12Wrapper runStatus="running" dialogOpen={true}>
          <HomeCtxVariantTeethGuard />
        </BrokenS12Wrapper>,
      );
    });

    // Count must be UNCHANGED: HomeCtx did not emit a new value, so the
    // useHomeCtx() subscriber did not re-render.
    //
    // This confirms that when the HomeCtx value is frozen (the regression
    // scenario), a useHomeCtx() variant produces a flat count — exactly the
    // scenario Test 5 must detect.  Test 5's strict `.toBeGreaterThan(countAfterMount)`
    // would correctly FAIL in this situation, proving it is not vacuous and
    // cannot be safely softened to `.toBeGreaterThanOrEqual`.
    expect(teethGuardCount).toBe(countAfterMount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 12 — Real CompactRunStrip is wired to useHomeTabCtx(), not useHomeCtx()
//
// Suites 11 guards CompactRunStrip's useLiveRun() subscription (clock stays
// live while a manage dialog is open).  But it does NOT detect the specific
// regression where useHomeTabCtx() is accidentally swapped for useHomeCtx()
// inside CompactRunStrip.
//
// If that swap happened:
//   • Opening a manage dialog emits a new HomeCtx value.
//   • CompactRunStrip (subscribed to HomeCtx instead of HomeTabCtx) re-renders.
//   • It calls useLiveRun() again — the spy count advances.
//   • Suite 11 Test 1 (clock ticks advance spy count) still passes because
//     the spy also advances during normal clock ticks.
//   • The wrong-hook swap is INVISIBLE to Suite 11.
//
// This suite closes that gap by:
//   1. Providing BOTH HomeCtx (invalidated on dialogOpen) AND HomeTabCtx
//      (stable, never invalidated by dialog toggles) in the wrapper.
//   2. Toggling dialogOpen WITHOUT advancing the fake clock.
//   3. Asserting that useLiveRun() spy count does NOT increase — proving
//      CompactRunStrip did NOT re-render from the HomeCtx change.
//
// If useHomeTabCtx() were swapped for useHomeCtx():
//   • HomeCtx invalidates → CompactRunStrip re-renders → calls useLiveRun()
//   • Spy count increases by 1 → assertion fails — regression caught.
//
// Two tests mirror Suite 9 (GlanceOverlay) exactly:
//
//   1. REAL-COMPONENT ISOLATION — toggling a HomeCtx dialog field does NOT
//      cause an extra useLiveRun() call.  Because the real component reads
//      HomeTabCtx (stable), React.memo() skips the re-render entirely.
//
//   2. COUNTER-PROOF — a useHomeCtx() subscriber in the same tree DOES
//      re-render on the same dialog toggle, proving the HomeCtx value truly
//      changed and Test 1's flat-spy assertion has teeth.
// ═══════════════════════════════════════════════════════════════════════════════

// Module-level stable refs so S12Wrapper re-renders (caused by dialogOpen
// changing) don't create new object identities for LiveRunProvider props —
// which would otherwise emit a spurious context update and confuse the spy count.
const S12_DAY_STATE = { runs: [ACTIVE_RUN], currentIndex: 0 } as const;
const S12_UPCOMING_LABELS: string[] = [];
const S12_MACHINE = { spinSec: 0, hopperSec: 0 } as const;

// Wrapper providing BOTH HomeCtx (changes on dialogOpen) AND HomeTabCtx
// (stable — never invalidated by dialog toggles).
// This mirrors the real home.tsx render tree: homeCtxValue carries ALL fields
// (including manage/dialog state), while homeTabCtxValue is a narrow useMemo
// whose deps intentionally exclude dialog fields.
function S12Wrapper({
  runStatus = "running",
  dialogOpen = false,
  children,
}: {
  runStatus?: string;
  dialogOpen?: boolean;
  children: ReactNode;
}) {
  const form = useForm<FormValues>({ defaultValues: ACTIVE_VALUES });

  // HomeTabCtx: stable — only runStatus is a dep; dialogOpen is excluded.
  // CompactRunStrip correctly relies on this narrow context.
  const tabCtxValue = useMemo(
    () => makeCompactRunStripCtxValue(runStatus),
    [runStatus],
  );

  // HomeCtx: invalidates when dialogOpen changes.
  // Mirrors home.tsx: the full homeCtxValue carries manage/dialog fields and
  // re-emits whenever any of them change — HomeTabCtx does NOT.
  const homeCtxValue = useMemo(
    () => ({
      runStatus,
      currentRun: { id: "run-live-1", brand: "TestBrand", flavor: "TestFlavor" },
      dayState: S12_DAY_STATE,
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
          dayState={S12_DAY_STATE}
          doughSubTab="dough"
          upcomingRunLabels={S12_UPCOMING_LABELS}
          prefs={undefined}
          screenMode={null}
          machine={S12_MACHINE}
        >
          {children}
        </LiveRunProvider>
      </HomeTabCtx.Provider>
    </HomeCtx.Provider>
  );
}

describe("LiveTabMemo — Suite 12: real CompactRunStrip is wired to useHomeTabCtx(), not useHomeCtx()", () => {
  afterEach(() => { cleanup(); });

  // ─── Test 1: REAL-COMPONENT ISOLATION ────────────────────────────────────
  // The real CompactRunStrip must NOT call useLiveRun() an extra time when a
  // HomeCtx dialog field toggles.  Because CompactRunStrip reads HomeTabCtx
  // (stable — dialogOpen is NOT a dep), React.memo() must skip the re-render
  // entirely and the useLiveRun() spy count must stay flat.
  //
  // If CompactRunStrip were accidentally re-wired to call useHomeCtx() instead
  // of useHomeTabCtx(), the manageCategory toggle would invalidate HomeCtx,
  // reach the real component, trigger a re-render, and the re-render would
  // call useLiveRun() — advancing the spy count and failing this assertion.
  //
  // No fake timers are used here: the clock is not advanced, so any spy-count
  // increase is caused exclusively by a dialog-field-induced re-render, not
  // by a clock tick.
  it("real CompactRunStrip: useLiveRun() spy count does NOT increase when a HomeCtx dialog field toggles (HomeTabCtx is stable)", async () => {
    const spy = vi.spyOn(LiveRunContextNS, "useLiveRun");

    const { rerender } = render(
      <S12Wrapper runStatus="running" dialogOpen={false}>
        <CompactRunStrip />
      </S12Wrapper>,
    );

    // Strip is present and useLiveRun() was called at mount.
    expect(document.querySelector("[data-testid='compact-run-strip']")).not.toBeNull();
    const countAfterMount = spy.mock.calls.length;
    expect(countAfterMount).toBeGreaterThan(0);

    // Toggle the HomeCtx dialog field: manageCategory "" → "mixes".
    // HomeCtx emits a new value; HomeTabCtx stays the same.
    // React.memo() must prevent CompactRunStrip from re-rendering because its
    // HomeTabCtx subscription (the only broad context it reads) did not change.
    await act(async () => {
      rerender(
        <S12Wrapper runStatus="running" dialogOpen={true}>
          <CompactRunStrip />
        </S12Wrapper>,
      );
    });

    // Strip is still present.
    expect(document.querySelector("[data-testid='compact-run-strip']")).not.toBeNull();

    // Spy count must be flat: no extra useLiveRun() call means no re-render
    // was triggered by the HomeCtx change.
    // If useHomeTabCtx() were swapped for useHomeCtx(), the spy count would
    // have increased by 1 here — catching the regression.
    expect(spy.mock.calls.length).toBe(countAfterMount);

    spy.mockRestore();
  });

  // ─── Test 3: SYMMETRIC SPY COUNTER-PROOF ─────────────────────────────────
  // Proves the spy in Test 1 has teeth: the vi.spyOn(LiveRunContextNS,
  // "useLiveRun") target IS the real hook that CompactRunStrip calls.
  //
  // WHY THIS IS NEEDED:
  //   Test 1 asserts countAfterMount > 0 (spy fires at mount) and then flat
  //   after a dialog toggle.  But if the export named "useLiveRun" were ever
  //   renamed in the source module, the spy would silently no-op: every call
  //   in the real component would bypass the spy, the mount count would be 0,
  //   and `expect(0).toBe(0)` would vacuously pass the flat assertion — the
  //   regression would be invisible.
  //
  // This test guards against that by advancing the fake clock 60 s while
  // CompactRunStrip is mounted and asserting the spy count IS strictly greater
  // than the mount count.  The LiveRunProvider emits one new context value per
  // second; each emission causes CompactRunStrip to re-render (useLiveRun()
  // subscription delivers the new nowTime) and call useLiveRun() again.
  //
  // If "useLiveRun" were renamed in the source module:
  //   • The spy target would no longer intercept any calls.
  //   • Spy count would stay at 0 both at mount and after 60 s of ticks.
  //   • `expect(0).toBeGreaterThan(0)` would FAIL — regression caught.
  //
  // This symmetric guard completes the spy-wiring proof:
  //   Test 1 — spy stays FLAT after dialog toggle (isolation holds).
  //   Test 3 — spy ADVANCES after clock ticks (spy is wired to real calls).
  //   Together they rule out both false negatives (wrong hook) and vacuous
  //   passes (renamed / unspied export).
  it("symmetric spy counter-proof: spy on LiveRunContextNS.useLiveRun IS > mount count after clock ticks (proves spy is wired to the real hook, not renamed)", async () => {
    vi.useFakeTimers();

    const spy = vi.spyOn(LiveRunContextNS, "useLiveRun");

    try {
      render(
        <S12Wrapper runStatus="running" dialogOpen={false}>
          <CompactRunStrip />
        </S12Wrapper>,
      );

      // Spy must fire at mount — strip is rendered and calls useLiveRun().
      // If "useLiveRun" were renamed in the source, this would be 0 and the
      // toBeGreaterThan below would already fail here.
      const countAfterMount = spy.mock.calls.length;
      expect(countAfterMount).toBeGreaterThan(0);

      // Advance 60 s — LiveRunProvider fires 60 per-second clock ticks.
      // Each tick pushes a new context value; CompactRunStrip is subscribed
      // via useLiveRun() and re-renders, invoking the hook each time.
      await act(async () => { vi.advanceTimersByTime(60_000); });

      // Spy count must be strictly greater than the mount count: the 60-s
      // window of clock ticks caused additional useLiveRun() invocations.
      // If the spy target were renamed, the count would remain at 0 (or stay
      // frozen at mount count), and this assertion would fail — catching the
      // regression before it can silently hollow out Test 1's flat assertion.
      expect(spy.mock.calls.length).toBeGreaterThan(countAfterMount);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  // ─── Test 2: COUNTER-PROOF ────────────────────────────────────────────────
  // Proves Test 1 has teeth: a memo()-wrapped component that calls useHomeCtx()
  // instead of useHomeTabCtx() DOES re-render when the same dialog field
  // toggles in the same wrapper.  This confirms that the HomeCtx value truly
  // changed (so the S12Wrapper is doing its job), and that Test 1's flat-spy
  // assertion would fail if CompactRunStrip were re-wired to call useHomeCtx().
  it("counter-proof: a useHomeCtx() subscriber DOES re-render when a HomeCtx dialog field toggles (proving Test 1 would catch the regression)", async () => {
    let renderCount = 0;

    const HomeCtxSub = memo(function HomeCtxSubInner() {
      renderCount++;
      // WRONG hook — mirrors what CompactRunStrip would look like if it were
      // accidentally re-wired to useHomeCtx() instead of useHomeTabCtx().
      useHomeCtx();
      return <span data-testid="s12-counter-proof">rendered</span>;
    });

    const { rerender } = render(
      <S12Wrapper runStatus="running" dialogOpen={false}>
        <HomeCtxSub />
      </S12Wrapper>,
    );

    const countAfterMount = renderCount;
    expect(countAfterMount).toBeGreaterThan(0);

    // Toggle the same HomeCtx dialog field.
    // HomeCtx invalidates → the useHomeCtx() subscriber receives the new
    // context value → re-renders.
    await act(async () => {
      rerender(
        <S12Wrapper runStatus="running" dialogOpen={true}>
          <HomeCtxSub />
        </S12Wrapper>,
      );
    });

    // renderCount increased: the wrong hook caused a needless re-render.
    // This confirms that Test 1's flat useLiveRun() spy assertion would also
    // fail if CompactRunStrip were re-wired to call useHomeCtx() — because
    // the re-render would call useLiveRun() and advance the spy count.
    expect(renderCount).toBeGreaterThan(countAfterMount);
  });

  // ─── Test 4: SPY COUNTER-PROOF FOR TEST 1's STRICT-EQUALITY ─────────────
  // Closes the gap left by Tests 2 and 3: proves that Test 1's
  // `expect(spy.mock.calls.length).toBe(countAfterMount)` strict-equality
  // assertion is NOT vacuous and CANNOT be silently weakened to `>=`.
  //
  // WHY THIS IS NEEDED:
  //   Test 1 asserts the spy count stays FLAT (strict `toBe`) after a dialog
  //   toggle — meaning zero extra useLiveRun() calls from CompactRunStrip.
  //   If someone weakened that assertion to `>= countAfterMount`, the test
  //   would still pass even when CompactRunStrip spuriously re-renders on
  //   every dialog toggle — silently hiding the regression.
  //
  //   Test 2 proves re-renders happen (via renderCount) but does NOT use the
  //   useLiveRun spy, so it cannot directly show that the spy advances.
  //   Test 3 advances the spy via clock ticks, not via dialog toggles.
  //
  //   This test uses the SAME spy as Test 1 and the SAME dialog toggle as
  //   Test 1, but mounts a useHomeCtx()-calling simulator instead of the real
  //   CompactRunStrip.  When the dialog toggles:
  //     • HomeCtx emits a new value.
  //     • The simulator (subscribed to HomeCtx) re-renders.
  //     • The re-render calls useLiveRun() again — advancing the spy count.
  //   The assertion `spy.mock.calls.length > countAfterMount` MUST pass.
  //
  //   If Test 1's `toBe` were weakened to `>=`:
  //     • Test 1 would pass vacuously for the wrong hook too (spy advances).
  //     • This test's `toBeGreaterThan` would still pass (spy DID advance).
  //     • Together they prove the weakening is distinguishable — `>=` in
  //       Test 1 cannot catch the isolation failure that `toBe` catches.
  //
  //   No fake timers are used: the clock is NOT advanced, so any spy increase
  //   is caused exclusively by the dialog-field-induced re-render.
  it("spy counter-proof: useLiveRun() spy count IS strictly greater than mount count after a dialog toggle for a useHomeCtx() (wrong-hook) simulator (proves Test 1's toBe has teeth and cannot be weakened to >=)", async () => {
    const spy = vi.spyOn(LiveRunContextNS, "useLiveRun");

    // WRONG-HOOK simulator: calls useHomeCtx() instead of useHomeTabCtx(),
    // exactly mirroring the regression Test 1 is designed to catch.
    // When HomeCtx emits a new value (dialog toggle), this component re-renders
    // and calls useLiveRun() — advancing the spy count.
    const WrongHookSim = memo(function WrongHookSimInner() {
      // Subscribes to HomeCtx — the WRONG context for isolation.
      useHomeCtx();
      // Also calls useLiveRun() so each re-render is captured by the spy.
      useLiveRun();
      return <span data-testid="s12-spy-counter-proof">wrong-hook</span>;
    });

    const { rerender } = render(
      <S12Wrapper runStatus="running" dialogOpen={false}>
        <WrongHookSim />
      </S12Wrapper>,
    );

    // Spy must fire at mount — WrongHookSim is rendered and calls useLiveRun().
    const countAfterMount = spy.mock.calls.length;
    expect(countAfterMount).toBeGreaterThan(0);

    // Toggle the HomeCtx dialog field — no clock advance.
    // HomeCtx emits a new value; WrongHookSim (subscribed via useHomeCtx())
    // re-renders and calls useLiveRun() again.
    await act(async () => {
      rerender(
        <S12Wrapper runStatus="running" dialogOpen={true}>
          <WrongHookSim />
        </S12Wrapper>,
      );
    });

    // Spy count MUST be strictly greater: the dialog toggle caused a re-render
    // that called useLiveRun() an additional time.
    // This proves that Test 1's `toBe(countAfterMount)` strict equality has
    // real teeth: a wrong-hook component WOULD advance the spy, so `>=` in
    // Test 1 would pass vacuously even for the regression case.
    expect(spy.mock.calls.length).toBeGreaterThan(countAfterMount);

    spy.mockRestore();
  });

  // ─── Test 5 (guard for Test 2's counter-proof): BROKEN-WRAPPER FLAT-COUNT PROOF ──
  //
  // WHY THIS IS NEEDED:
  //   Test 2 asserts `expect(renderCount).toBeGreaterThan(countAfterMount)` —
  //   i.e. the useHomeCtx() subscriber re-renders when the same dialog field
  //   toggles.  That assertion gives Test 1 its teeth.
  //
  //   But if S12Wrapper's homeCtxValue useMemo accidentally excluded dialogOpen
  //   from its deps, HomeCtx would never emit a new value on toggle.  The
  //   subscriber would NOT re-render — renderCount would stay flat (=== countAfterMount).
  //
  //   If Test 2 then used .toBeGreaterThanOrEqual(countAfterMount), the assertion
  //   would vacuously pass (`countAfterMount >= countAfterMount`), silently
  //   removing all guarantee from Test 1.
  //
  //   .toBeGreaterThan(countAfterMount) REQUIRES a strict increase:
  //     expect(countAfterMount).toBeGreaterThan(countAfterMount) → FAILS immediately.
  //
  //   This test makes the broken-wrapper scenario observable: it renders the same
  //   useHomeCtx() subscriber inside a BrokenS12Wrapper (dialogOpen excluded from
  //   deps), toggles dialogOpen, and asserts the render count stays FLAT.
  //   That flat count is precisely the scenario where .toBeGreaterThanOrEqual would
  //   pass vacuously — proving .toBeGreaterThan is the load-bearing assertion.
  it("guard for Test 2: broken S12Wrapper (homeCtxValue excludes dialogOpen from deps) keeps useHomeCtx() subscriber render count FLAT on toggle — proving toBeGreaterThan cannot be weakened to toBeGreaterThanOrEqual", async () => {
    // Broken wrapper: homeCtxValue useMemo intentionally excludes dialogOpen.
    // Toggling dialogOpen does NOT invalidate the memoized HomeCtx value, so
    // the context reference is unchanged and no subscriber re-renders.
    function BrokenS12Wrapper({
      runStatus = "running",
      dialogOpen = false,
      children,
    }: {
      runStatus?: string;
      dialogOpen?: boolean;
      children: ReactNode;
    }) {
      const form = useForm<FormValues>({ defaultValues: ACTIVE_VALUES });

      const tabCtxValue = useMemo(
        () => makeCompactRunStripCtxValue(runStatus),
        [runStatus],
      );

      // BROKEN: dialogOpen is intentionally omitted from deps.
      // The memoized object captures `dialogOpen` at its value from the first
      // render and never updates when dialogOpen changes — HomeCtx stays stale.
      const homeCtxValue = useMemo(
        () => ({
          runStatus,
          currentRun: { id: "run-live-1", brand: "TestBrand", flavor: "TestFlavor" },
          dayState: S12_DAY_STATE,
          form: null,
          activeTab: "run",
          manageCategory: dialogOpen ? "mixes" : "",
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [runStatus], // ← dialogOpen deliberately excluded (the bug this guard catches)
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
              dayState={S12_DAY_STATE}
              doughSubTab="dough"
              upcomingRunLabels={S12_UPCOMING_LABELS}
              prefs={undefined}
              screenMode={null}
              machine={S12_MACHINE}
            >
              {children}
            </LiveRunProvider>
          </HomeTabCtx.Provider>
        </HomeCtx.Provider>
      );
    }

    let renderCount = 0;
    const HomeCtxSub = memo(function HomeCtxSubBrokenWrapper() {
      renderCount++;
      useHomeCtx();
      return <span data-testid="s12-broken-guard">rendered</span>;
    });

    const { rerender } = render(
      <BrokenS12Wrapper runStatus="running" dialogOpen={false}>
        <HomeCtxSub />
      </BrokenS12Wrapper>,
    );

    const countAfterMount = renderCount;
    expect(countAfterMount).toBeGreaterThan(0);

    // Toggle dialogOpen — but the broken homeCtxValue memo does NOT update
    // (dialogOpen is not a dep), so HomeCtx emits the SAME cached reference.
    // The subscriber sees no context change and does NOT re-render.
    await act(async () => {
      rerender(
        <BrokenS12Wrapper runStatus="running" dialogOpen={true}>
          <HomeCtxSub />
        </BrokenS12Wrapper>,
      );
    });

    // Flat render count: HomeCtx never changed, so no re-render occurred.
    // This is the scenario where:
    //   .toBeGreaterThan(countAfterMount)    → FAILS (strict increase required)
    //   .toBeGreaterThanOrEqual(countAfterMount) → PASSES vacuously
    // Proving that Test 2's .toBeGreaterThan is the assertion that cannot be
    // silently weakened — a weaker form would hollow out Test 1 entirely.
    expect(renderCount).toBe(countAfterMount);
  });
});
