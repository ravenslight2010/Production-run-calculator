// @vitest-environment jsdom

import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeCtx } from "../../../contexts/HomeCtx";
import { HomeTabCtx } from "../../../contexts/HomeTabCtx";
import { LiveRunProvider } from "../../../contexts/LiveRunContext";
import {
  claimManualSectionLock,
  clearManualSectionLocks,
} from "../../../manualSectionLocks";
import { createPackagingManager } from "../../../packagingManager";
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
  children,
}: {
  status: "pending" | "running";
  children: ReactNode;
}) {
  const form = useForm<FormValues>({ defaultValues: STATION_VALUES });
  const currentRun = status === "running" ? RUNNING_RUN : PENDING_RUN;
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
    currentRunId: RUN_ID,
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
    v: STATION_VALUES,
    ve: STATION_VALUES,
  };

  return (
    <HomeCtx.Provider value={homeValue}>
      <HomeTabCtx.Provider value={homeValue}>
        <FormProvider {...form}>
          <LiveRunProvider
            v={STATION_VALUES}
            ve={STATION_VALUES}
            runStatus={status}
            currentRun={currentRun}
            currentRunId={RUN_ID}
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
});

/**
 * This is intentionally a component-level regression rather than another
 * packaging-manager unit test. The production station calls the manager
 * through HomeTabCtx, then the form autosave writes the edited value. Keeping
 * both halves here catches a wiring regression that a manager-only test cannot.
 */
function LiveEditPersistenceHarness() {
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
    persistManualPackagingProgress: manager.persistManualProgress,
    queueManualCorrection: () => {},
    runStatus: "running" as const,
    runToTime: "12:00",
    schedulePush: () => {},
    setDayState: () => {},
    setRunToTime: () => {},
    v: watchedValues,
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
            <LiveDoughTabContent />
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
    });
    saveRunValuesUpdated({ [RUN_ID]: 100 });
  });

  afterEach(() => {
    cleanup();
    clearManualSectionLocks();
    localStorage.clear();
  });

  it("keeps a live-tab edit after remount and rejects a stale peer snapshot", async () => {
    const view = render(<LiveEditPersistenceHarness />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-inc-packCases"));
    });

    await waitFor(() => {
      expect(loadRunValues(RUN_ID).casesOnCurrentSkid).toBe(4);
    });
    const editedStamp = loadRunValuesUpdated()[RUN_ID] ?? 0;
    expect(editedStamp).toBeGreaterThan(100);

    view.unmount();
    render(<LiveEditPersistenceHarness />);
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

    // Mirror the receive guard: only an accepted peer snapshot is written.
    if (acceptsStalePeer) saveRunValues(RUN_ID, stalePeerValues);
    expect(loadRunValues(RUN_ID).casesOnCurrentSkid).toBe(4);
  });
});