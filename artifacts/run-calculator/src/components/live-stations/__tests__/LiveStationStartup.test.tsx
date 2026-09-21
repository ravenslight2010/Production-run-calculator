// @vitest-environment jsdom

import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeCtx } from "../../../contexts/HomeCtx";
import { HomeTabCtx } from "../../../contexts/HomeTabCtx";
import { LiveRunProvider } from "../../../contexts/LiveRunContext";
import {
  claimManualSectionLock,
  clearManualSectionLocks,
  releaseManualSectionLock,
} from "../../../manualSectionLocks";
import { createPackagingManager } from "../../../packagingManager";
import { resetSauceBarrelEntry } from "../../../sauceBarrelStore";
import {
  acceptRemoteRunValueOnSync,
  loadRunValues,
  loadRunValuesUpdated,
  markRunValuesUpdated,
  saveRunValues,
  saveRunValuesUpdated,
} from "../../../storage";
import { DEFAULT_VALUES, type DayState, type FormValues, type RunMeta } from "../../../types";
import { LiveDoughTabContent } from "../LiveDoughTabContent";
import { LiveFrontlineTabContent } from "../LiveFrontlineTabContent";
import { LivePackagingTabContent } from "../LivePackagingTabContent";
import { LiveSauceTabContent } from "../LiveSauceTabContent";

vi.mock("../../../useRole", () => ({
  useMe: () => ({ hasCapability: () => false }),
}));
vi.mock("../../../hooks/useNotifications");

const RUN_ID = "station-startup-run";
const SWITCHED_RUN_ID = "station-switched-run";
const RUNNING_RUN: RunMeta = {
  id: RUN_ID,
  brand: "Startup Brand",
  flavor: "Startup Flavor",
  startedAt: Date.now() - 60_000,
  stoppages: [],
};
const PENDING_RUN: RunMeta = {
  id: RUN_ID,
  brand: "Startup Brand",
  flavor: "Startup Flavor",
  stoppages: [],
};

const STATION_VALUES: FormValues = {
  ...DEFAULT_VALUES,
  casesNeeded: 100,
  crustsPerCycle: 10,
  cycleSpeed: 1,
  pizzasPerCase: 10,
  casesPerSkid: 40,
  casesPerLayer: 10,
  doughballsPerTray: 10,
  doughBatchYield: 100,
  freezerTime: 30,
  sauceOzPerPizza: 1,
  sauceBarrelLbs: 30,
  frontlineRecipeName: "House Sauce",
  frontlineRecipe: [{ ingredient: "Tomato", lbs: 30 }],
  app1Type: "Cheese",
  app1OzPerPizza: 2,
  app1BatchLbs: 25,
  app1CheeseRecipeName: "House Cheese",
  app1CheeseRecipe: [{ ingredient: "Mozzarella", lbs: 25 }],
};

function StationProviders({
  status,
  runId = RUN_ID,
  values = STATION_VALUES,
  children,
}: {
  status: "pending" | "running";
  runId?: string;
  values?: FormValues;
  children: ReactNode;
}) {
  const form = useForm<FormValues>({ defaultValues: values });
  const currentRun = useMemo(
    () => ({ ...(status === "running" ? RUNNING_RUN : PENDING_RUN), id: runId }),
    [runId, status],
  );
  const dayState = useMemo<DayState>(
    () => ({ runs: [currentRun], currentIndex: 0 }),
    [currentRun],
  );
  const dayStateRef = useRef(dayState);
  const autoSuppressUntilRef = useRef(0);
  const lastLocalEditRef = useRef(0);
  const noop = vi.fn();
  const packagingManager = useMemo(
    () => ({
      persistManualProgress: noop,
      persistAutomaticProgress: () => false,
      updateDrainingRun: noop,
      selectDrainingRun: () => null,
      casesInDrainingFreezer: () => 0,
      advanceDrainingRun: noop,
    }),
    [noop],
  );
  const homeValue = {
    autoSuppressUntilRef,
    confirmRunSurplus: vi.fn().mockResolvedValue(undefined),
    currentRun,
    currentRunId: runId,
    dayState,
    dayStateRef,
    doughSubTab: "dough",
    form,
    freezerSurplus: [],
    freezerSurplusBusy: false,
    freezerSurplusError: null,
    freezerSurplusLoaded: true,
    isSupervisor: true,
    lastEndedRun: null,
    lastLocalEditRef,
    packagingManager,
    persistManualPackagingProgress: noop,
    queueManualCorrection: noop,
    refreshFreezerSurplus: vi.fn().mockResolvedValue(undefined),
    runStatus: status,
    runToTime: "12:00",
    schedulePush: noop,
    setDayState: noop,
    setRunToTime: noop,
    setWriteError: noop,
    updateDrainingRunValues: noop,
    v: values,
    ve: values,
  };

  return (
    <HomeCtx.Provider value={homeValue}>
      <HomeTabCtx.Provider value={homeValue}>
        <FormProvider {...form}>
          <LiveRunProvider
            v={values}
            ve={values}
            runStatus={status}
            currentRun={currentRun}
            currentRunId={runId}
            form={form}
            dayState={dayState}
            doughSubTab="dough"
            upcomingRunLabels={[]}
            prefs={undefined}
            screenMode={null}
            machine={{ spinSec: 510, hopperSec: 70 }}
            externalAutoSuppressRef={autoSuppressUntilRef}
          >
            {children}
          </LiveRunProvider>
        </FormProvider>
      </HomeTabCtx.Provider>
    </HomeCtx.Provider>
  );
}

const STATIONS = [
  {
    name: "Sauce",
    Component: LiveSauceTabContent,
    pendingSelector: { role: "button" as const, name: "Start Prep" },
    runningSelector: { text: "Sauce Batches Needed" },
  },
  {
    name: "Frontline",
    Component: LiveFrontlineTabContent,
    pendingSelector: { text: "Batches Needed" },
    runningSelector: { text: "Batches Needed" },
  },
  {
    name: "Dough",
    Component: LiveDoughTabContent,
    pendingSelector: { role: "button" as const, name: "Start Prep" },
    runningSelector: { text: /Batch Pipeline/ },
  },
  {
    name: "Packaging",
    Component: LivePackagingTabContent,
    pendingSelector: { text: "Active Skid Building" },
    runningSelector: { text: "Active Skid Building" },
  },
] as const;

const FRONTLINE_APPLICATOR_VALUES: FormValues = {
  ...STATION_VALUES,
  app2Type: "Cheese",
  app2OzPerPizza: 2,
  app2BatchLbs: 25,
  app2CheeseRecipeName: "House Cheese 2",
  app2CheeseRecipe: [{ ingredient: "Mozzarella", lbs: 25 }],
  app3Type: "Cheese",
  app3OzPerPizza: 2,
  app3BatchLbs: 25,
  app3CheeseRecipeName: "House Cheese 3",
  app3CheeseRecipe: [{ ingredient: "Mozzarella", lbs: 25 }],
  app4Type: "Cheese",
  app4OzPerPizza: 2,
  app4BatchLbs: 25,
  app4CheeseRecipeName: "House Cheese 4",
  app4CheeseRecipe: [{ ingredient: "Mozzarella", lbs: 25 }],
};

const FRONTLINE_APPLICATOR_LOCK_CASES = [
  { slot: "app1", label: "App 1 — Cheese" },
  { slot: "app2", label: "App 2 — Cheese" },
  { slot: "app3", label: "App 3 — Cheese" },
  { slot: "app4", label: "App 4 — Cheese" },
] as const;

function expectSelector(
  selector:
    | { readonly role: "button"; readonly name: string }
    | { readonly text: string | RegExp },
) {
  if ("role" in selector) {
    expect(screen.getByRole(selector.role, { name: selector.name })).toBeTruthy();
    return;
  }
  expect(screen.getByText(selector.text)).toBeTruthy();
}

describe("live station startup", () => {
  beforeEach(() => clearManualSectionLocks());
  afterEach(() => {
    cleanup();
    clearManualSectionLocks();
  });

  for (const station of STATIONS) {
    it(`${station.name} mounts in pending state with an operator-facing selector`, () => {
      render(
        <StationProviders status="pending">
          <station.Component />
        </StationProviders>,
      );
      expectSelector(station.pendingSelector);
    });

    it(`${station.name} mounts in running state with an operator-facing selector`, () => {
      render(
        <StationProviders status="running">
          <station.Component />
        </StationProviders>,
      );
      expectSelector(station.runningSelector);
    });
  }

  it("reports a clear HomeTabCtx wiring error", () => {
    expect(() => render(<LiveFrontlineTabContent />)).toThrow(
      "useHomeTabCtx must be used within HomeTabCtx.Provider",
    );
  });

  it("reports a clear LiveRunContext wiring error", () => {
    expect(() =>
      render(
        <HomeTabCtx.Provider value={{ currentRunId: RUN_ID, v: STATION_VALUES }}>
          <LiveFrontlineTabContent />
        </HomeTabCtx.Provider>,
      ),
    ).toThrow("useLiveRun must be used within LiveRunProvider");
  });

  it("keeps station controls disabled when the real manual lock is held by a peer", () => {
    claimManualSectionLock(RUN_ID, "packaging", "peer-device", 30_000, true);
    render(
      <StationProviders status="running">
        <LivePackagingTabContent />
      </StationProviders>,
    );

    expect((screen.getByTestId("btn-inc-skidsCompleted") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("btn-inc-casesOnCurrentSkid") as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps Sauce correction controls disabled while a peer owns the Sauce section, then restores them", () => {
    claimManualSectionLock(RUN_ID, "sauce", "peer-device", 30_000, true);
    render(
      <StationProviders status="running">
        <LiveSauceTabContent />
      </StationProviders>,
    );

    const controls = screen.getAllByRole("button", { name: /consumed batches correction/ });
    expect(controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(true);

    act(() => {
      releaseManualSectionLock(RUN_ID, "sauce", "peer-device");
    });

    expect(controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(false);
  });

  it.each(FRONTLINE_APPLICATOR_LOCK_CASES)(
    "keeps $slot Frontline correction controls disabled while a peer owns the applicator section, then restores them",
    ({ slot, label }) => {
      claimManualSectionLock(RUN_ID, slot, "peer-device", 30_000, true);
      render(
        <StationProviders status="running" values={FRONTLINE_APPLICATOR_VALUES}>
          <LiveFrontlineTabContent />
        </StationProviders>,
      );

      const controls = within(screen.getByText(label).parentElement!).getAllByRole("button", { name: /consumed batches correction/ });
      expect(controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(true);

      act(() => {
        releaseManualSectionLock(RUN_ID, slot, "peer-device");
      });

      expect(controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(false);
    },
  );

  it("keeps simultaneous peer locks scoped to their matching Frontline correction rows", () => {
    claimManualSectionLock(RUN_ID, "app1", "peer-app1", 30_000, true);
    claimManualSectionLock(RUN_ID, "app2", "peer-app2", 30_000, true);
    render(
      <StationProviders status="running" values={FRONTLINE_APPLICATOR_VALUES}>
        <LiveFrontlineTabContent />
      </StationProviders>,
    );

    const app1Controls = within(screen.getByText("App 1 — Cheese").parentElement!).getAllByRole("button", { name: /consumed batches correction/ });
    const app2Controls = within(screen.getByText("App 2 — Cheese").parentElement!).getAllByRole("button", { name: /consumed batches correction/ });
    expect(app1Controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(true);
    expect(app2Controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(true);

    act(() => {
      releaseManualSectionLock(RUN_ID, "app1", "peer-app1");
    });

    expect(app1Controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(false);
    expect(app2Controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(true);
  });

  it.each(FRONTLINE_APPLICATOR_LOCK_CASES.filter(({ slot }) => slot !== "app1"))(
    "keeps $slot Frontline correction controls usable after switching away from the peer-locked run",
    ({ slot, label }) => {
      claimManualSectionLock(RUN_ID, slot, "peer-device", 30_000, true);
      render(
        <StationProviders
          status="running"
          runId={SWITCHED_RUN_ID}
          values={FRONTLINE_APPLICATOR_VALUES}
        >
          <LiveFrontlineTabContent />
        </StationProviders>,
      );

      const controls = within(screen.getByText(label).parentElement!).getAllByRole("button", { name: /consumed batches correction/ });
      expect(controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(false);
    },
  );
});
/**
 * These are intentionally component-level regressions rather than more
 * packaging-manager unit tests. The production stations call their handlers
 * through HomeTabCtx, then the form autosave writes the edited value. Keeping
 * both halves here catches a wiring regression that a manager-only test cannot.
 */
function LiveStationPersistenceHarness({ children }: { children: ReactNode }) {
  const storedValues = loadRunValues(RUN_ID);
  const form = useForm<FormValues>({ defaultValues: storedValues });
  const watchedValues = useWatch({ control: form.control }) as FormValues;
  const currentRun = RUNNING_RUN;
  const dayState = useMemo<DayState>(
    () => ({ runs: [currentRun], currentIndex: 0 }),
    [currentRun],
  );
  const dayStateRef = useRef(dayState);
  const currentRunIdRef = useRef(RUN_ID);
  const autoSuppressUntilRef = useRef(0);
  const lastLocalEditRef = useRef(0);
  const doughAutoSuppressUntilRef = useRef(0);
  const manager = useMemo(
    () => createPackagingManager({
      currentRunIdRef,
      autoSuppressUntilRef,
      dayStateRef,
      autoSuppressMs: 60_000,
      loadRunValues,
      saveRunValues,
      markRunValuesUpdated,
      markLocalEdit: (now) => { lastLocalEditRef.current = now; },
      schedulePush: () => {},
      queueManualCorrection: () => {},
      recordManualProgress: () => {},
      recordAutomaticProgress: () => ({ accepted: true }),
    }),
    [],
  );

  // The real home form watcher persists the changed form after the station
  // callback runs. Keep this bridge deliberately small and storage-backed so
  // remounting exercises the same browser persistence boundary.
  useEffect(() => {
    saveRunValues(RUN_ID, { ...loadRunValues(RUN_ID), ...watchedValues });
  }, [watchedValues]);

  const homeValue = {
    autoSuppressUntilRef,
    currentRun,
    currentRunId: RUN_ID,
    dayState,
    dayStateRef,
    doughSubTab: "dough",
    form,
    isSupervisor: true,
    lastLocalEditRef,
    packagingManager: manager,
    persistManualPackagingProgress: manager.persistManualProgress,
    queueManualCorrection: () => {},
    runStatus: "running" as const,
    runToTime: "12:00",
    schedulePush: () => {},
    setDayState: () => {},
    setRunToTime: () => {},
    setWriteError: () => {},
    v: watchedValues,
    ve: watchedValues,
  };

  return (
    <HomeCtx.Provider value={homeValue}>
      <HomeTabCtx.Provider value={homeValue}>
        <FormProvider {...form}>
          <LiveRunProvider
            v={watchedValues}
            ve={watchedValues}
            runStatus="running"
            currentRun={currentRun}
            currentRunId={RUN_ID}
            form={form}
            dayState={dayState}
            doughSubTab="dough"
            upcomingRunLabels={[]}
            prefs={undefined}
            screenMode={null}
            machine={{ spinSec: 510, hopperSec: 70 }}
            externalAutoSuppressRef={doughAutoSuppressUntilRef}
          >
            {children}
          </LiveRunProvider>
        </FormProvider>
      </HomeTabCtx.Provider>
    </HomeCtx.Provider>
  );
}

describe("live station edits and stamped browser persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    clearManualSectionLocks();
    saveRunValues(RUN_ID, {
      ...STATION_VALUES,
      skidsCompleted: 2,
      casesOnCurrentSkid: 3,
      // Keep the sauce correction on its synchronous no-inventory branch. The
      // counter persistence under test is the station/form boundary, not the
      // inventory request.
      frontlineRecipeName: "",
      frontlineRecipe: [],
    });
    saveRunValuesUpdated({ [RUN_ID]: 100 });
    resetSauceBarrelEntry(RUN_ID);
  });

  afterEach(() => {
    cleanup();
    clearManualSectionLocks();
    resetSauceBarrelEntry(RUN_ID);
    localStorage.clear();
  });

  it("keeps the dough quick-check edit after remount and rejects a stale peer snapshot", async () => {
    const view = render(
      <LiveStationPersistenceHarness>
        <LiveDoughTabContent />
      </LiveStationPersistenceHarness>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-inc-packCases"));
    });

    await waitFor(() => {
      expect(loadRunValues(RUN_ID).casesOnCurrentSkid).toBe(4);
    });
    const editedStamp = loadRunValuesUpdated()[RUN_ID] ?? 0;
    expect(editedStamp).toBeGreaterThan(100);

    view.unmount();
    render(
      <LiveStationPersistenceHarness>
        <LiveDoughTabContent />
      </LiveStationPersistenceHarness>,
    );
    expect(screen.getByTestId("text-pack-cases").textContent).toContain("4");

    const localValues = loadRunValues(RUN_ID);
    const stalePeerValues = { ...localValues, casesOnCurrentSkid: 1 };
    const acceptsStalePeer = acceptRemoteRunValueOnSync(
      stalePeerValues,
      localValues,
      editedStamp - 1,
      editedStamp,
    );
    expect(acceptsStalePeer).toBe(false);

    if (acceptsStalePeer) saveRunValues(RUN_ID, stalePeerValues);
    expect(loadRunValues(RUN_ID).casesOnCurrentSkid).toBe(4);
  });

  it("keeps a packaging-floor count after remount and rejects a stale peer snapshot", async () => {
    const view = render(
      <LiveStationPersistenceHarness>
        <LivePackagingTabContent />
      </LiveStationPersistenceHarness>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-inc-casesOnCurrentSkid"));
    });

    await waitFor(() => {
      expect(loadRunValues(RUN_ID).casesOnCurrentSkid).toBe(4);
    });
    const editedStamp = loadRunValuesUpdated()[RUN_ID] ?? 0;
    expect(editedStamp).toBeGreaterThan(100);

    view.unmount();
    render(
      <LiveStationPersistenceHarness>
        <LivePackagingTabContent />
      </LiveStationPersistenceHarness>,
    );
    expect(screen.getByTestId("text-casesOnCurrentSkid").textContent).toBe("4");

    const localValues = loadRunValues(RUN_ID);
    const stalePeerValues = { ...localValues, casesOnCurrentSkid: 1 };
    const acceptsStalePeer = acceptRemoteRunValueOnSync(
      stalePeerValues,
      localValues,
      editedStamp - 1,
      editedStamp,
    );
    expect(acceptsStalePeer).toBe(false);

    if (acceptsStalePeer) saveRunValues(RUN_ID, stalePeerValues);
    expect(loadRunValues(RUN_ID).casesOnCurrentSkid).toBe(4);
  });

  it("keeps a sauce count after remount and rejects a stale peer snapshot", async () => {
    const view = render(
      <LiveStationPersistenceHarness>
        <LiveSauceTabContent />
      </LiveStationPersistenceHarness>,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Increase consumed batches correction" }),
      );
    });

    await waitFor(() => {
      expect(loadRunValues(RUN_ID).sauceBarrelsMade).toBe(1);
    });
    const editedStamp = loadRunValuesUpdated()[RUN_ID] ?? 0;
    expect(editedStamp).toBeGreaterThan(100);

    view.unmount();
    render(
      <LiveStationPersistenceHarness>
        <LiveSauceTabContent />
      </LiveStationPersistenceHarness>,
    );
    expect(screen.getByText(/consumed 1\.00/)).toBeTruthy();

    const localValues = loadRunValues(RUN_ID);
    const stalePeerValues = { ...localValues, sauceBarrelsMade: 0 };
    const acceptsStalePeer = acceptRemoteRunValueOnSync(
      stalePeerValues,
      localValues,
      editedStamp - 1,
      editedStamp,
    );
    expect(acceptsStalePeer).toBe(false);

    if (acceptsStalePeer) saveRunValues(RUN_ID, stalePeerValues);
    expect(loadRunValues(RUN_ID).sauceBarrelsMade).toBe(1);
  });
});
