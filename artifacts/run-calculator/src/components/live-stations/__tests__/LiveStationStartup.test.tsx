// @vitest-environment jsdom

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FormProvider, useForm, useFormContext, useWatch } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeCtx } from "../../../contexts/HomeCtx";
import { HomeTabCtx } from "../../../contexts/HomeTabCtx";
import { LiveRunProvider } from "../../../contexts/LiveRunContext";
import {
  claimManualSectionLock,
  clearManualSectionLocks,
  releaseManualSectionLock,
} from "../../../manualSectionLocks";
import { createPackagingManager, type PackagingManager } from "../../../packagingManager";
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
import { HomeStationTabs } from "../../../components/HomeStationTabs";
import { TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { APPLICATOR_STOCK_REGISTERS, applicatorStockFields } from "@workspace/live-calc";
import type { HomeTab } from "../../../hooks/useHomeNavigation";

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
const ENDED_RUN: RunMeta = {
  id: RUN_ID,
  brand: "Startup Brand",
  flavor: "Startup Flavor",
  startedAt: Date.now() - 60 * 60_000,
  endedAt: Date.now() - 20 * 60_000,
  stoppages: [],
};
const NEXT_RUN: RunMeta = {
  id: SWITCHED_RUN_ID,
  brand: "Next Brand",
  flavor: "Next Flavor",
  stoppages: [],
};
const MANUALLY_SELECTED_RUN: RunMeta = {
  id: "station-manually-selected-run",
  brand: "Selected Brand",
  flavor: "Selected Flavor",
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
  runs,
  switchToRun = vi.fn(() => true),
  packagingManager: packagingManagerOverride,
  sauceAutoTrackFailure = null,
  queueManualCorrection,
  children,
}: {
  status: "pending" | "running" | "paused" | "ended";
  runId?: string;
  values?: FormValues;
  runs?: RunMeta[];
  switchToRun?: (newIndex: number, expectedCurrentRunId?: string) => boolean;
  packagingManager?: PackagingManager;
  sauceAutoTrackFailure?: { barrelId: string; dismissed: boolean; kind: "transient" | "permanent" } | null;
  queueManualCorrection?: (...args: unknown[]) => void;
  children: ReactNode;
}) {
  const form = useForm<FormValues>({ defaultValues: values });
  const currentRun = useMemo(() => {
    if (runs?.[0]) return runs[0];
    const base = status === "ended" ? ENDED_RUN : status === "running" ? RUNNING_RUN : PENDING_RUN;
    return { ...base, id: runId };
  }, [runId, runs, status]);
  const dayRuns = useMemo(() => runs ?? [currentRun], [currentRun, runs]);
  const dayState = useMemo<DayState>(
    () => ({ runs: dayRuns, currentIndex: 0 }),
    [dayRuns],
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
  const stationPackagingManager = packagingManagerOverride ?? packagingManager;
  const homeValue = {
    autoSuppressUntilRef,
    confirmRunSurplus: vi.fn().mockResolvedValue(undefined),
    clearSauceAutoTrackFailureNotice: vi.fn(),
    currentRun,
    currentRunId: runId,
    dayState,
    dayStateRef,
    doughSubTab: "dough",
    form,
    freezerSurplus: { lots: [], allocations: [] },
    freezerSurplusBusy: false,
    freezerSurplusError: null,
    freezerSurplusLoaded: true,
    isSupervisor: true,
    lastEndedRun: null,
    lastLocalEditRef,
    packagingManager: stationPackagingManager,
    persistManualPackagingProgress: noop,
    queueManualCorrection: queueManualCorrection ?? noop,
    refreshFreezerSurplus: vi.fn().mockResolvedValue(undefined),
    runStatus: status,
    runToTime: "12:00",
    schedulePush: noop,
    sauceAutoTrackFailure,
    dismissSauceAutoTrackFailure: noop,
    setDayState: noop,
    setRunToTime: noop,
    setWriteError: noop,
    switchToRun,
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

function SauceWarningTabFixture() {
  const [activeTab, setActiveTab] = useState("run");
  return (
    <StationProviders
      status="running"
      sauceAutoTrackFailure={{
        barrelId: `${RUN_ID}:event-1`,
        dismissed: false,
        kind: "transient",
      }}
    >
      <HomeStationTabs activeTab={activeTab as any} onTabChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="run">Run</TabsTrigger>
          <TabsTrigger value="sauce">Sauce</TabsTrigger>
          <TabsTrigger value="dough">Dough</TabsTrigger>
        </TabsList>
        <TabsContent value="run"><div>Run screen</div></TabsContent>
        <TabsContent value="sauce"><LiveSauceTabContent /></TabsContent>
        <TabsContent value="dough"><div>Dough station</div></TabsContent>
      </HomeStationTabs>
    </StationProviders>
  );
}

describe("Sauce auto-track warning surface", () => {
  afterEach(() => { cleanup(); });
  it("shows the failure only on the selected Sauce station", async () => {
    render(<SauceWarningTabFixture />);
    expect(screen.getByText("Run screen").hidden).toBe(false);
    expect(screen.queryByTestId("sauce-auto-track-failure")).toBeNull();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Sauce" }), { button: 0 });
    expect((await screen.findByTestId("sauce-auto-track-failure")).hidden).toBe(false);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Dough" }), { button: 0 });
    await waitFor(() => expect(screen.queryByTestId("sauce-auto-track-failure")).toBeNull());
  });
});

const STATIONS = [
  {
    name: "Sauce",
    Component: LiveSauceTabContent,
    pendingSelector: { role: "button" as const, name: "Start Prep" },
    runningSelector: { text: "Current-run Sauce needs" },
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

function applicatorStockControls(slot: string) {
  const input = screen.getByTestId(`stock-${slot}-lbs`) as HTMLInputElement;
  const fillToCap = within(input.parentElement!).getByRole("button", { name: "Fill to cap" }) as HTMLButtonElement;
  return [input, fillToCap];
}

type CheeseApplicatorSlot = "app1" | "app2" | "app3" | "app4";

function ApplicatorRecipeEditor({ slot, recipeLbs }: { slot: CheeseApplicatorSlot; recipeLbs: number }) {
  const { control, setValue } = useFormContext<FormValues>();
  const recipeField = `${slot}CheeseRecipe` as `${CheeseApplicatorSlot}CheeseRecipe`;
  const stockField = `${slot}StockLbs` as `${CheeseApplicatorSlot}StockLbs`;
  const stockLbs = useWatch({ control, name: stockField });
  return (
    <>
      <button
        type="button"
        data-testid={`edit-${slot}-recipe`}
        onClick={() => setValue(recipeField, [{ ingredient: "Mozzarella", lbs: recipeLbs }], { shouldDirty: true })}
      >
        Edit {slot} recipe
      </button>
      <button
        type="button"
        data-testid={`clear-${slot}-recipe`}
        onClick={() => setValue(recipeField, [], { shouldDirty: true })}
      >
        Clear {slot} recipe
      </button>
      <output data-testid={`${slot}-stock-value`}>{stockLbs}</output>
    </>
  );
}

function PepperoniSetupEditor() {
  const { control, getValues, setValue } = useFormContext<FormValues>();
  const stockFields = [
    "pep1StockLbs",
    "pep1bStockLbs",
    "pep2StockLbs",
    "pep2bStockLbs",
  ] as const;
  const stockValues = useWatch({ control, name: stockFields });
  return (
    <>
      <button type="button" data-testid="change-pep1-type" onClick={() => setValue("pep1Type", "Turkey Pepperoni", { shouldDirty: true })}>
        Change Pep 1 type
      </button>
      <button type="button" data-testid="change-pep1-additional-type" onClick={() => setValue("pep1TypeB", "Beef Pepperoni", { shouldDirty: true })}>
        Change Pep 1 additional type
      </button>
      <button type="button" data-testid="clear-pep1-additional-type" onClick={() => setValue("pep1TypeB", "", { shouldDirty: true })}>
        Clear Pep 1 additional type
      </button>
      <button type="button" data-testid="change-pep2-type" onClick={() => setValue("pep2Type", "Turkey Cup Pepperoni", { shouldDirty: true })}>
        Change Pep 2 type
      </button>
      <button type="button" data-testid="change-pep2-additional-type" onClick={() => setValue("pep2TypeB", "Beef Cup Pepperoni", { shouldDirty: true })}>
        Change Pep 2 additional type
      </button>
      <button
        type="button"
        data-testid="toggle-pep1-combined"
        onClick={() => setValue("pep1Combined", !getValues("pep1Combined"), { shouldDirty: true })}
      >
        Toggle combined pepperoni
      </button>
      {stockFields.map((field, index) => (
        <output key={field} data-testid={field}>{stockValues[index]}</output>
      ))}
    </>
  );
}

const STOCK_DRAFT_VALUES: FormValues = {
  ...FRONTLINE_APPLICATOR_VALUES,
  pep1Type: "Pepperoni",
  pep1TypeB: "Cup Pepperoni",
  pep2Type: "Turkey Pepperoni",
  pep2TypeB: "Mini Pepperoni",
  pep1Combined: false,
};

function StockValuesObserver() {
  const values = useWatch<FormValues>();
  return <output data-testid="stock-form-values">{JSON.stringify(values)}</output>;
}

function FrontlineNavigationFixture({
  runId = RUN_ID,
  queueManualCorrection,
}: {
  runId?: string;
  queueManualCorrection: (...args: unknown[]) => void;
}) {
  const [activeTab, setActiveTab] = useState("frontline");
  return (
    <StationProviders status="running" runId={runId} values={STOCK_DRAFT_VALUES} queueManualCorrection={queueManualCorrection}>
      <HomeStationTabs activeTab={activeTab as HomeTab} onTabChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="frontline">Frontline</TabsTrigger>
          <TabsTrigger value="dough">Dough</TabsTrigger>
        </TabsList>
        <TabsContent value="frontline"><LiveFrontlineTabContent /></TabsContent>
        <TabsContent value="dough"><div>Dough station</div></TabsContent>
      </HomeStationTabs>
      <StockValuesObserver />
      <PepperoniSetupEditor />
    </StationProviders>
  );
}

describe("Frontline stock drafts across station navigation", () => {
  beforeEach(() => { clearManualSectionLocks(); });
  afterEach(() => { cleanup(); clearManualSectionLocks(); });

  function navigateAwayAndBack() {
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Dough" }), { button: 0, ctrlKey: false });
    expect(screen.queryByTestId("stock-app1-lbs")).toBeNull();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Frontline" }), { button: 0, ctrlKey: false });
  }

  it.each(APPLICATOR_STOCK_REGISTERS)("retains %s without changing stock or queuing persistence before Save", (register) => {
    const queueManualCorrection = vi.fn();
    render(<FrontlineNavigationFixture queueManualCorrection={queueManualCorrection} />);
    const beforeForm = screen.getByTestId("stock-form-values").textContent;
    const beforePersisted = loadRunValues(RUN_ID);
    const fields = applicatorStockFields(register);
    fireEvent.change(screen.getByTestId(`stock-${register}-lbs`), { target: { value: "12.25" } });
    navigateAwayAndBack();
    const input = screen.getByTestId(`stock-${register}-lbs`) as HTMLInputElement;
    expect(input.value).toBe("12.25");
    expect(screen.getByTestId("stock-form-values").textContent).toBe(beforeForm);
    expect(loadRunValues(RUN_ID)).toEqual(beforePersisted);
    expect(queueManualCorrection).not.toHaveBeenCalled();
    const other = register === "app1" ? "app2" : "app1";
    expect((screen.getByTestId(`stock-${other}-lbs`) as HTMLInputElement).value).not.toBe("12.25");

    fireEvent.click(within(input.parentElement!).getByRole("button", { name: "Save" }));
    expect(queueManualCorrection).toHaveBeenCalledTimes(1);
    expect(queueManualCorrection.mock.calls[0][0]).toBe(RUN_ID);
    expect(queueManualCorrection.mock.calls[0][1]).toMatchObject({ [fields.stock]: 12.25 });
    navigateAwayAndBack();
    const saved = screen.getByTestId(`stock-${register}-lbs`) as HTMLInputElement;
    expect(saved.value).toBe("12.25");
    expect((within(saved.parentElement!).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(["", "0", "9999"])("retains the raw draft %j without validating or saving during navigation", (draft) => {
    const queueManualCorrection = vi.fn();
    render(<FrontlineNavigationFixture queueManualCorrection={queueManualCorrection} />);
    fireEvent.change(screen.getByTestId("stock-app1-lbs"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("stock-app1-lbs"), { target: { value: draft } });
    navigateAwayAndBack();
    const input = screen.getByTestId("stock-app1-lbs") as HTMLInputElement;
    expect(input.value).toBe(draft);
    expect((within(input.parentElement!).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    expect(queueManualCorrection).not.toHaveBeenCalled();
  });

  it("retains simultaneous drafts separately and clears only the saved or filled slot", () => {
    render(<FrontlineNavigationFixture queueManualCorrection={vi.fn()} />);
    fireEvent.change(screen.getByTestId("stock-app1-lbs"), { target: { value: "12.25" } });
    fireEvent.change(screen.getByTestId("stock-pep2b-lbs"), { target: { value: "34.5" } });
    navigateAwayAndBack();
    const input = screen.getByTestId("stock-app1-lbs") as HTMLInputElement;
    fireEvent.click(within(input.parentElement!).getByRole("button", { name: "Fill to cap" }));
    navigateAwayAndBack();
    const filled = screen.getByTestId("stock-app1-lbs") as HTMLInputElement;
    expect(filled.value).toBe(filled.max);
    expect((within(filled.parentElement!).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("stock-pep2b-lbs") as HTMLInputElement).value).toBe("34.5");
  });

  it("does not carry a draft to another ingredient in the same slot", () => {
    render(<FrontlineNavigationFixture queueManualCorrection={vi.fn()} />);
    fireEvent.change(screen.getByTestId("stock-pep1-lbs"), { target: { value: "12.25" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Dough" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByTestId("change-pep1-type"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Frontline" }), { button: 0, ctrlKey: false });
    expect((screen.getByTestId("stock-pep1-lbs") as HTMLInputElement).value).not.toBe("12.25");
  });

  it("clears the bounded run cache even when the run changes while Frontline is unmounted", () => {
    const queueManualCorrection = vi.fn();
    const view = render(<FrontlineNavigationFixture queueManualCorrection={queueManualCorrection} />);
    fireEvent.change(screen.getByTestId("stock-app1-lbs"), { target: { value: "12.25" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Dough" }), { button: 0, ctrlKey: false });
    view.rerender(<FrontlineNavigationFixture runId={SWITCHED_RUN_ID} queueManualCorrection={queueManualCorrection} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Frontline" }), { button: 0, ctrlKey: false });
    expect((screen.getByTestId("stock-app1-lbs") as HTMLInputElement).value).not.toBe("12.25");
    view.rerender(<FrontlineNavigationFixture queueManualCorrection={queueManualCorrection} />);
    expect((screen.getByTestId("stock-app1-lbs") as HTMLInputElement).value).not.toBe("12.25");
    expect(queueManualCorrection).not.toHaveBeenCalled();
  });
});

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
    vi.useRealTimers();
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

  it("keeps Sauce stock controls disabled while a peer owns the stock section, then restores them", () => {
    claimManualSectionLock(RUN_ID, "sauce-stock", "peer-device", 30_000, true);
    render(
      <StationProviders status="running">
        <LiveSauceTabContent />
      </StationProviders>,
    );

    const increase = screen.getByTestId("sauce-stock-increase") as HTMLButtonElement;
    expect(increase.disabled).toBe(true);

    act(() => {
      releaseManualSectionLock(RUN_ID, "sauce-stock", "peer-device");
    });

    expect(increase.disabled).toBe(false);
  });

  it.each(FRONTLINE_APPLICATOR_LOCK_CASES)(
    "keeps $slot Frontline stock controls disabled while a peer owns the applicator section, then restores them",
    ({ slot, label }) => {
      claimManualSectionLock(RUN_ID, slot, "peer-device", 30_000, true);
      render(
        <StationProviders status="running" values={FRONTLINE_APPLICATOR_VALUES}>
          <LiveFrontlineTabContent />
        </StationProviders>,
      );

      expect(screen.getByText(label)).toBeTruthy();
      const controls = applicatorStockControls(slot);
      expect(controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(true);

      act(() => {
        releaseManualSectionLock(RUN_ID, slot, "peer-device");
      });

      expect(controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(false);
    },
  );

  it.each([
    {
      slot: "pep1",
      section: "pep1",
      registers: ["pep1", "pep1b"],
      otherRegisters: ["pep2", "pep2b"],
    },
    {
      slot: "pep2",
      section: "pep2",
      registers: ["pep2", "pep2b"],
      otherRegisters: ["pep1", "pep1b"],
    },
  ] as const)(
    "keeps $slot primary and additional stock rows scoped to their peer lock",
    ({ slot, section, registers, otherRegisters }) => {
      const values: FormValues = {
        ...STATION_VALUES,
        pep1Type: "Pepperoni",
        pep1TypeB: "Cup Pepperoni",
        pep2Type: "Turkey Pepperoni",
        pep2TypeB: "Mini Cup Pepperoni",
        pep1Combined: false,
      };
      claimManualSectionLock(RUN_ID, section, `peer-${slot}`, 30_000, true);
      render(
        <StationProviders status="running" values={values}>
          <LiveFrontlineTabContent />
        </StationProviders>,
      );

      const lockedControls = registers.flatMap(applicatorStockControls);
      const otherControls = otherRegisters.flatMap(applicatorStockControls);
      expect(lockedControls.every((control) => (control as HTMLButtonElement).disabled)).toBe(true);
      expect(otherControls.every((control) => !(control as HTMLButtonElement).disabled)).toBe(true);

      act(() => {
        releaseManualSectionLock(RUN_ID, section, `peer-${slot}`);
      });

      expect(lockedControls.every((control) => !(control as HTMLButtonElement).disabled)).toBe(true);
      expect(otherControls.every((control) => !(control as HTMLButtonElement).disabled)).toBe(true);
    },
  );

  it.each([
    { section: "pep1", registers: ["pep1", "pep1b"], otherRegisters: ["pep2", "pep2b"] },
    { section: "pep2", registers: ["pep2", "pep2b"], otherRegisters: ["pep1", "pep1b"] },
  ] as const)(
    "restores $section primary and additional stock rows when its peer lease expires without remounting",
    ({ section, registers, otherRegisters }) => {
      vi.useFakeTimers();
      // Expire before the running station's 1-second clock tick: only the lock
      // notification, not a live-clock rerender, should restore these controls.
      const leaseMs = 250;
      expect(claimManualSectionLock(RUN_ID, section, "peer-device", leaseMs, true)).toBe(true);
      render(
        <StationProviders status="running" values={{
          ...STATION_VALUES,
          pep1Type: "Pepperoni",
          pep1TypeB: "Cup Pepperoni",
          pep2Type: "Turkey Pepperoni",
          pep2TypeB: "Mini Cup Pepperoni",
          pep1Combined: false,
        }}>
          <LiveFrontlineTabContent />
        </StationProviders>,
      );

      const lockedControls = registers.flatMap(applicatorStockControls);
      const otherControls = otherRegisters.flatMap(applicatorStockControls);
      for (const control of lockedControls) expect(control.disabled).toBe(true);
      for (const control of otherControls) expect(control.disabled).toBe(false);

      act(() => { vi.advanceTimersByTime(leaseMs - 1); });
      for (const control of lockedControls) expect(control.disabled).toBe(true);
      for (const control of otherControls) expect(control.disabled).toBe(false);

      // The expiry notification runs one millisecond after the lease boundary.
      act(() => { vi.advanceTimersByTime(2); });
      for (const control of [...lockedControls, ...otherControls]) {
        expect(control.isConnected).toBe(true);
        expect(control.disabled).toBe(false);
      }
      expect(registers.flatMap(applicatorStockControls)).toEqual(lockedControls);
      expect(otherRegisters.flatMap(applicatorStockControls)).toEqual(otherControls);
    },
  );

  it("refreshes each applicator stock cap after recipe edits and uses batch weight for empty recipes", async () => {
    render(
      <StationProviders status="running" values={FRONTLINE_APPLICATOR_VALUES}>
        <>
          <LiveFrontlineTabContent />
          {FRONTLINE_APPLICATOR_LOCK_CASES.map(({ slot }) => (
            <ApplicatorRecipeEditor key={slot} slot={slot} recipeLbs={30 + Number(slot.slice(-1))} />
          ))}
        </>
      </StationProviders>,
    );

    for (const { slot } of FRONTLINE_APPLICATOR_LOCK_CASES) {
      const input = screen.getByTestId(`stock-${slot}-lbs`) as HTMLInputElement;
      const stockRow = input.parentElement!.parentElement!;
      const capacityLbs = (30 + Number(slot.slice(-1))) * 2;
      expect(input.max).toBe("50");

      fireEvent.click(screen.getByTestId(`edit-${slot}-recipe`));
      await waitFor(() => expect(input.max).toBe(String(capacityLbs)));
      expect(within(stockRow).getByText(`Capacity ${capacityLbs.toFixed(1)} lb`)).toBeTruthy();
      fireEvent.click(within(input.parentElement!).getByRole("button", { name: "Fill to cap" }));
      await waitFor(() => expect(screen.getByTestId(`${slot}-stock-value`).textContent).toBe(String(capacityLbs)));
      expect(input.value).toBe(String(capacityLbs));

      fireEvent.click(screen.getByTestId(`clear-${slot}-recipe`));
      await waitFor(() => expect(input.max).toBe("50"));
      expect(within(stockRow).getByText("Capacity 50.0 lb")).toBeTruthy();
      fireEvent.click(within(input.parentElement!).getByRole("button", { name: "Fill to cap" }));
      await waitFor(() => expect(screen.getByTestId(`${slot}-stock-value`).textContent).toBe("50"));
      expect(input.value).toBe("50");
    }
  });

  it("updates pepperoni stock rows after mounted type edits and combined-slot changes", async () => {
    const values: FormValues = {
      ...STATION_VALUES,
      pep1Type: "Pepperoni",
      pep1TypeB: "Cup Pepperoni",
      pep2Type: "Cup Pepperoni",
      pep2TypeB: "Mini Cup Pepperoni",
      pep1Combined: false,
      pep1StockLbs: 12.5,
      pep1bStockLbs: 15.5,
      pep2StockLbs: 22.5,
      pep2bStockLbs: 25.5,
    };
    render(
      <StationProviders status="running" values={values}>
        <>
          <LiveFrontlineTabContent />
          <PepperoniSetupEditor />
        </>
      </StationProviders>,
    );

    expect(screen.getByText("Pep 1 · Pepperoni")).toBeTruthy();
    expect(screen.getByText("Pep 1 additional · Cup Pepperoni")).toBeTruthy();
    expect(screen.getByText("Pep 2 · Cup Pepperoni")).toBeTruthy();
    expect(screen.getByText("Pep 2 additional · Mini Cup Pepperoni")).toBeTruthy();

    fireEvent.click(screen.getByTestId("change-pep1-type"));
    fireEvent.click(screen.getByTestId("change-pep1-additional-type"));
    fireEvent.click(screen.getByTestId("change-pep2-type"));
    fireEvent.click(screen.getByTestId("change-pep2-additional-type"));
    await waitFor(() => {
      expect(screen.getByText("Pep 1 · Turkey Pepperoni")).toBeTruthy();
      expect(screen.getByText("Pep 1 additional · Beef Pepperoni")).toBeTruthy();
      expect(screen.getByText("Pep 2 · Turkey Cup Pepperoni")).toBeTruthy();
      expect(screen.getByText("Pep 2 additional · Beef Cup Pepperoni")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("clear-pep1-additional-type"));
    await waitFor(() => {
      expect(screen.queryByTestId("stock-pep1b-lbs")).toBeNull();
      expect(screen.getByText("Pep 1 · Turkey Pepperoni")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("toggle-pep1-combined"));
    await waitFor(() => {
      expect(screen.queryByTestId("stock-pep2-lbs")).toBeNull();
      expect(screen.queryByTestId("stock-pep2b-lbs")).toBeNull();
    });
    expect(screen.getByTestId("stock-pep1-lbs")).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Pep 1 · Turkey Pepperoni pounds on hand" })).toBeTruthy();
    expect(screen.getByTestId("pep1StockLbs").textContent).toBe("12.5");
    expect(screen.getByTestId("pep2StockLbs").textContent).toBe("22.5");
    expect(screen.getByTestId("pep2bStockLbs").textContent).toBe("25.5");

    fireEvent.click(screen.getByTestId("toggle-pep1-combined"));
    await waitFor(() => {
      expect(screen.getByTestId("stock-pep2-lbs")).toBeTruthy();
      expect(screen.getByTestId("stock-pep2b-lbs")).toBeTruthy();
    });
    expect(screen.getByRole("spinbutton", { name: "Pep 2 · Turkey Cup Pepperoni pounds on hand" })).toBeTruthy();
    expect(screen.getByTestId("pep2StockLbs").textContent).toBe("22.5");
    expect(screen.getByTestId("pep2bStockLbs").textContent).toBe("25.5");
  });

  it("restores an unfinished Pep 2 stock draft after combined mode hides its rows", async () => {
    const values: FormValues = {
      ...STATION_VALUES,
      pep1Type: "Pepperoni",
      pep1TypeB: "Cup Pepperoni",
      pep2Type: "Cup Pepperoni",
      pep2TypeB: "Mini Cup Pepperoni",
      pep1Combined: false,
      pep1StockLbs: 12.5,
      pep1bStockLbs: 15.5,
      pep2StockLbs: 22.5,
      pep2bStockLbs: 25.5,
    };
    render(
      <StationProviders status="running" values={values}>
        <>
          <LiveFrontlineTabContent />
          <PepperoniSetupEditor />
        </>
      </StationProviders>,
    );

    fireEvent.change(screen.getByTestId("stock-pep2-lbs"), { target: { value: "34.25" } });
    fireEvent.click(screen.getByTestId("toggle-pep1-combined"));
    await waitFor(() => expect(screen.queryByTestId("stock-pep2-lbs")).toBeNull());
    expect(screen.queryByTestId("stock-pep2b-lbs")).toBeNull();
    expect(screen.getByTestId("pep1StockLbs").textContent).toBe("12.5");
    expect(screen.getByTestId("pep1bStockLbs").textContent).toBe("15.5");
    expect(screen.getByTestId("pep2StockLbs").textContent).toBe("22.5");
    expect(screen.getByTestId("pep2bStockLbs").textContent).toBe("25.5");

    fireEvent.click(screen.getByTestId("toggle-pep1-combined"));
    const restoredInput = await screen.findByTestId("stock-pep2-lbs") as HTMLInputElement;
    expect(restoredInput.value).toBe("34.25");
    expect(within(restoredInput.parentElement!).getByRole("button", { name: "Save" }).disabled).toBe(false);
    expect(screen.getByTestId("pep1StockLbs").textContent).toBe("12.5");
    expect(screen.getByTestId("pep1bStockLbs").textContent).toBe("15.5");
    expect(screen.getByTestId("pep2StockLbs").textContent).toBe("22.5");
    expect(screen.getByTestId("pep2bStockLbs").textContent).toBe("25.5");

    fireEvent.click(within(restoredInput.parentElement!).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("pep2StockLbs").textContent).toBe("34.25"));
  });

  it("keeps the fixed pepperoni cap for manual adjustments on the current visible slot", async () => {
    const values: FormValues = {
      ...STATION_VALUES,
      pep1Type: "Pepperoni",
      pep1TypeB: "",
      pep1Combined: false,
      pep1bStockLbs: 10,
    };
    render(
      <StationProviders status="running" values={values}>
        <>
          <LiveFrontlineTabContent />
          <PepperoniSetupEditor />
        </>
      </StationProviders>,
    );

    fireEvent.click(screen.getByTestId("change-pep1-additional-type"));
    await waitFor(() => expect(screen.getByText("Pep 1 additional · Beef Pepperoni")).toBeTruthy());
    const input = screen.getByTestId("stock-pep1b-lbs") as HTMLInputElement;
    expect(input.max).toBe("50");
    expect(within(input.parentElement!.parentElement!).getByText("Capacity 50.0 lb")).toBeTruthy();

    fireEvent.change(input, { target: { value: "42.75" } });
    fireEvent.click(within(input.parentElement!).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("pep1bStockLbs").textContent).toBe("42.75"));

    fireEvent.click(within(input.parentElement!).getByRole("button", { name: "Fill to cap" }));
    await waitFor(() => expect(screen.getByTestId("pep1bStockLbs").textContent).toBe("50"));
    expect(input.max).toBe("50");
  });

  it("keeps simultaneous peer locks scoped to their matching Frontline correction rows", () => {
    claimManualSectionLock(RUN_ID, "app1", "peer-app1", 30_000, true);
    claimManualSectionLock(RUN_ID, "app2", "peer-app2", 30_000, true);
    render(
      <StationProviders status="running" values={FRONTLINE_APPLICATOR_VALUES}>
        <LiveFrontlineTabContent />
      </StationProviders>,
    );

    const app1Controls = applicatorStockControls("app1");
    const app2Controls = applicatorStockControls("app2");
    expect(app1Controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(true);
    expect(app2Controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(true);

    act(() => {
      releaseManualSectionLock(RUN_ID, "app1", "peer-app1");
    });

    expect(app1Controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(false);
    expect(app2Controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(true);
  });

  it("advances Frontline once when its ended run has cleared Stage 1", () => {
    const runs = [ENDED_RUN, NEXT_RUN];
    const selectedRunId = { current: RUN_ID };
    const switchToRun = vi.fn((newIndex: number, expectedCurrentRunId?: string) => {
      if (expectedCurrentRunId && selectedRunId.current !== expectedCurrentRunId) return false;
      selectedRunId.current = runs[newIndex]?.id ?? selectedRunId.current;
      return true;
    });
    const view = render(
      <StationProviders status="ended" runs={runs} switchToRun={switchToRun}>
        <LiveFrontlineTabContent />
      </StationProviders>,
    );
    expect(switchToRun).toHaveBeenCalledTimes(1);
    expect(switchToRun).toHaveBeenCalledWith(1, RUN_ID);
    view.rerender(
      <StationProviders status="ended" runs={runs} switchToRun={switchToRun}>
        <LiveFrontlineTabContent />
      </StationProviders>,
    );
    expect(switchToRun).toHaveBeenCalledTimes(1);
  });

  it("keeps an ended station run selected when there is no queued next run", () => {
    const switchToRun = vi.fn();
    render(
      <StationProviders status="ended" runs={[ENDED_RUN]} switchToRun={switchToRun}>
        <LiveFrontlineTabContent />
      </StationProviders>,
    );

    expect(switchToRun).not.toHaveBeenCalled();
  });

  it("does not advance Packaging during Frontline or Freeze tunnel drain", () => {
    const switchToRun = vi.fn();
    const stillDraining = { ...ENDED_RUN, endedAt: Date.now() - 5 * 60_000 };
    render(
      <StationProviders status="ended" runs={[stillDraining, NEXT_RUN]} switchToRun={switchToRun}>
        <LivePackagingTabContent />
      </StationProviders>,
    );

    expect(switchToRun).not.toHaveBeenCalled();
  });

  it("advances Packaging once when the ended run is fully drained, including on mount", () => {
    const fullyDrained = { ...ENDED_RUN, endedAt: Date.now() - 40 * 60_000 };
    const runs = [fullyDrained, NEXT_RUN];
    const selectedRunId = { current: RUN_ID };
    const switchToRun = vi.fn((newIndex: number, expectedCurrentRunId?: string) => {
      if (expectedCurrentRunId && selectedRunId.current !== expectedCurrentRunId) return false;
      selectedRunId.current = runs[newIndex]?.id ?? selectedRunId.current;
      return true;
    });
    render(
      <StationProviders status="ended" runs={[fullyDrained, NEXT_RUN]} switchToRun={switchToRun}>
        <LivePackagingTabContent />
      </StationProviders>,
    );

    expect(switchToRun).toHaveBeenCalledTimes(1);
    expect(switchToRun).toHaveBeenCalledWith(1, RUN_ID);
  });

  it.each([
    { name: "Frontline", Component: LiveFrontlineTabContent },
    { name: "Packaging", Component: LivePackagingTabContent },
  ])(
    "does not skip the queued run when a foreground selection races $name drain completion",
    ({ Component }) => {
      const fullyDrained = { ...ENDED_RUN, endedAt: Date.now() - 40 * 60_000 };
      const runs = [fullyDrained, NEXT_RUN, MANUALLY_SELECTED_RUN];
      const selectedRunId = { current: MANUALLY_SELECTED_RUN.id };
      const switchToRun = vi.fn(
        (newIndex: number, expectedCurrentRunId?: string) => {
          // Model the real lifecycle manager's expected-run fence. The
          // foreground/manual selection has already won before this stale
          // station effect tries to advance the old draining run.
          if (
            expectedCurrentRunId &&
            selectedRunId.current !== expectedCurrentRunId
          ) {
            return false;
          }
          selectedRunId.current = runs[newIndex]?.id ?? selectedRunId.current;
          return true;
        },
      );

      render(
        <StationProviders
          status="ended"
          runs={runs}
          switchToRun={switchToRun}
        >
          <Component />
        </StationProviders>,
      );

      expect(switchToRun).toHaveBeenCalledTimes(1);
      expect(switchToRun).toHaveBeenCalledWith(1, RUN_ID);
      expect(selectedRunId.current).toBe(MANUALLY_SELECTED_RUN.id);
      expect(selectedRunId.current).not.toBe(NEXT_RUN.id);
    },
  );

  it("keeps a prior-run drain update keyed to that run across a selected-run handoff", () => {
    const priorRun: RunMeta = {
      ...ENDED_RUN,
      id: "station-prior-drain",
      endedAt: Date.now() - 5 * 60_000,
    };
    const priorValues = {
      ...STATION_VALUES,
      casesNeeded: 500,
      casesPerSkid: 40,
      skidsCompleted: 2,
      casesOnCurrentSkid: 10,
    };
    const draining = { run: priorRun, values: priorValues };
    const selectDrainingRun = vi.fn(() => draining);
    const casesInDrainingFreezer = vi.fn()
      .mockReturnValueOnce(12)
      .mockReturnValueOnce(11);
    const advanceDrainingRun = vi.fn();
    const packagingManager = {
      persistManualProgress: vi.fn(),
      persistAutomaticProgress: vi.fn(() => false),
      updateDrainingRun: vi.fn(),
      selectDrainingRun,
      casesInDrainingFreezer,
      advanceDrainingRun,
    } satisfies PackagingManager;

    const { rerender } = render(
      <StationProviders
        status="running"
        runId={SWITCHED_RUN_ID}
        runs={[NEXT_RUN, priorRun]}
        packagingManager={packagingManager}
      >
        <LivePackagingTabContent />
      </StationProviders>,
    );

    // The first effect call establishes the prior run's freezer baseline.
    // Re-render as if the foreground/manual handoff selected the next run;
    // the second call must still persist the old run's exited case.
    rerender(
      <StationProviders
        status="running"
        runId={SWITCHED_RUN_ID}
        runs={[{ ...NEXT_RUN }, priorRun]}
        packagingManager={packagingManager}
      >
        <LivePackagingTabContent />
      </StationProviders>,
    );

    expect(advanceDrainingRun).toHaveBeenCalledWith(
      priorRun.id,
      priorValues,
      1,
    );
    expect(advanceDrainingRun).not.toHaveBeenCalledWith(
      SWITCHED_RUN_ID,
      expect.anything(),
      expect.anything(),
    );
  });

  it.each(FRONTLINE_APPLICATOR_LOCK_CASES.filter(({ slot }) => slot !== "app1"))(
    "keeps $slot Frontline stock controls usable after switching away from the peer-locked run",
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

      expect(screen.getByText(label)).toBeTruthy();
      const controls = applicatorStockControls(slot);
      expect(controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(false);
    },
  );

  it.each([
    { slot: "pep1", registers: ["pep1", "pep1b"], otherRegisters: ["pep2", "pep2b"] },
    { slot: "pep2", registers: ["pep2", "pep2b"], otherRegisters: ["pep1", "pep1b"] },
  ] as const)(
    "keeps all pepperoni stock rows usable after switching away from a peer-locked $slot run",
    ({ slot, registers, otherRegisters }) => {
      const values: FormValues = {
        ...STATION_VALUES,
        pep1Type: "Pepperoni",
        pep1TypeB: "Cup Pepperoni",
        pep2Type: "Turkey Pepperoni",
        pep2TypeB: "Mini Cup Pepperoni",
        pep1Combined: false,
      };
      claimManualSectionLock(RUN_ID, slot, "peer-device", 30_000, true);
      const station = (runId: string) => (
        <StationProviders status="running" runId={runId} values={values}>
          <LiveFrontlineTabContent />
        </StationProviders>
      );
      const { rerender } = render(station(RUN_ID));

      for (const register of registers) {
        for (const control of applicatorStockControls(register)) {
          expect(control.disabled).toBe(true);
        }
      }
      for (const register of otherRegisters) {
        for (const control of applicatorStockControls(register)) {
          expect(control.disabled).toBe(false);
        }
      }

      rerender(station(SWITCHED_RUN_ID));

      for (const register of [...registers, ...otherRegisters]) {
        for (const control of applicatorStockControls(register)) {
          expect(control.disabled).toBe(false);
        }
      }

      // The switch must not release the peer's lock on the original run.
      rerender(station(RUN_ID));
      for (const register of registers) {
        for (const control of applicatorStockControls(register)) {
          expect(control.disabled).toBe(true);
        }
      }
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

  it("keeps Sauce stock after remount and rejects a stale peer snapshot", async () => {
    saveRunValues(RUN_ID, {
      ...loadRunValues(RUN_ID),
      sauceStockBarrels: 1.2,
      sauceStockAnchorNetSec: 0,
      sauceStockCorrectionGeneration: 0,
      sauceStockInitialized: true,
    });
    const view = render(
      <LiveStationPersistenceHarness>
        <LiveSauceTabContent />
      </LiveStationPersistenceHarness>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("sauce-stock-increase"));
    });

    await waitFor(() => {
      expect(loadRunValues(RUN_ID).sauceStockBarrels).toBe(1.3);
    });
    const editedStamp = loadRunValuesUpdated()[RUN_ID] ?? 0;
    expect(editedStamp).toBeGreaterThan(100);

    view.unmount();
    render(
      <LiveStationPersistenceHarness>
        <LiveSauceTabContent />
      </LiveStationPersistenceHarness>,
    );
    expect(screen.getByLabelText("Sauce stock on hand").textContent).toContain("1.3");

    const localValues = loadRunValues(RUN_ID);
    const stalePeerValues = { ...localValues, sauceStockBarrels: 1.2 };
    const acceptsStalePeer = acceptRemoteRunValueOnSync(
      stalePeerValues,
      localValues,
      editedStamp - 1,
      editedStamp,
    );
    expect(acceptsStalePeer).toBe(false);

    if (acceptsStalePeer) saveRunValues(RUN_ID, stalePeerValues);
    expect(loadRunValues(RUN_ID).casesOnCurrentSkid).toBe(3);
    expect(loadRunValues(RUN_ID).sauceStockBarrels).toBe(1.3);
  });

});
