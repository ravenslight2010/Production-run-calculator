// @vitest-environment jsdom

import { type ReactNode, useMemo, useRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeCtx } from "../../../contexts/HomeCtx";
import { HomeTabCtx } from "../../../contexts/HomeTabCtx";
import { LiveRunProvider } from "../../../contexts/LiveRunContext";
import {
  claimManualSectionLock,
  clearManualSectionLocks,
} from "../../../manualSectionLocks";
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