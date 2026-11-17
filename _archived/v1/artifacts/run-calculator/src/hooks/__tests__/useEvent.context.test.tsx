// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { memo, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useEvent } from "../useEvent";
import { InventoryTabCtx, useInventoryTabCtx } from "../../contexts/InventoryTabCtx";
import { SetupTabCtx, useSetupTabCtx } from "../../contexts/SetupTabCtx";
import { WarehouseTabCtx, useWarehouseTabCtx, type WarehouseTabContextValue } from "../../contexts/WarehouseTabCtx";
import { DEFAULT_VALUES, type FormValues } from "../../types";

afterEach(cleanup);

describe("useEvent", () => {
  it("keeps its identity while dispatching to the latest render implementation", async () => {
    const identities: Array<() => void> = [];
    function Probe() {
      const [owned, setOwned] = useState(1);
      const [dialog, setDialog] = useState(false);
      const [seen, setSeen] = useState(0);
      const action = useEvent(() => setSeen(owned));
      identities.push(action);
      return <>
        <button onClick={() => setDialog((value) => !value)}>dialog:{String(dialog)}</button>
        <button onClick={() => setOwned(2)}>owned</button>
        <button onClick={action}>invoke</button>
        <output>{seen}</output>
      </>;
    }
    const screen = render(<Probe />);
    await act(async () => fireEvent.click(screen.getByText("dialog:false")));
    expect(identities.at(-1)).toBe(identities[0]);
    await act(async () => fireEvent.click(screen.getByText("owned")));
    expect(identities.at(-1)).toBe(identities[0]);
    await act(async () => fireEvent.click(screen.getByText("invoke")));
    expect(screen.container.querySelector("output")?.textContent).toBe("2");
  });
});

describe("useEvent narrow context projections", () => {
  it("keeps Inventory consumers flat for dialog/import updates and refreshes them for owned data", async () => {
    let renders = 0;
    const Consumer = memo(function Consumer() {
      const { candidates } = useInventoryTabCtx();
      renders++;
      return <output>{candidates[0]?.name ?? "empty"}</output>;
    });
    function Fixture() {
      const [owned, setOwned] = useState("flour");
      const [dialog, setDialog] = useState(false);
      const [importing, setImporting] = useState(false);
      const add = useEvent(() => {});
      const remove = useEvent(() => {});
      const clear = useEvent(() => {});
      const value = useMemo(() => ({
        candidates: [{ name: owned, required: 1, available: 1, unit: "lbs" }],
        runValsList: [], coverageRunVals: [], substitutions: [], substitutionLog: [],
        substitutionOptions: [owned], onAddSubstitution: add,
        onRemoveSubstitution: remove, onClearSubstitutions: clear,
      }), [owned, add, remove, clear]);
      return <InventoryTabCtx.Provider value={value}>
        <button onClick={() => setDialog((v) => !v)}>dialog:{String(dialog)}</button>
        <button onClick={() => setImporting((v) => !v)}>import:{String(importing)}</button>
        <button onClick={() => setOwned("sugar")}>owned</button><Consumer />
      </InventoryTabCtx.Provider>;
    }
    const screen = render(<Fixture />);
    expect(renders).toBe(1);
    await act(async () => fireEvent.click(screen.getByText("dialog:false")));
    await act(async () => fireEvent.click(screen.getByText("import:false")));
    expect(renders).toBe(1);
    await act(async () => fireEvent.click(screen.getByText("owned")));
    expect(renders).toBe(2);
    expect(screen.container.querySelector("output")?.textContent).toBe("sugar");
  });

  it("keeps Setup consumers flat for dialog/import updates and refreshes them for owned data", async () => {
    let renders = 0;
    const Consumer = memo(function Consumer() {
      const { circles } = useSetupTabCtx();
      renders++;
      return <output>{circles[0]}</output>;
    });
    function Fixture() {
      const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES });
      const [owned, setOwned] = useState("10 inch");
      const [dialog, setDialog] = useState(false);
      const [importing, setImporting] = useState(false);
      const commit = useEvent((_key: string, _value: string | number) => {});
      const apply = useEvent(async () => "applied");
      const warning = useEvent(() => null);
      const value = useMemo(() => ({
        v: DEFAULT_VALUES, form, circles: [owned], shipper: [], skidStacking: [], gripSheets: [],
        isManager: false, isSupervisor: false, currentRun: undefined, doughSubTab: "dough" as const,
        commitMissingField: commit, applyRunSuggestion: apply, getRunSuggestionAcceptWarning: warning,
      }), [owned, form, commit, apply, warning]);
      return <SetupTabCtx.Provider value={value}>
        <button onClick={() => setDialog((v) => !v)}>dialog:{String(dialog)}</button>
        <button onClick={() => setImporting((v) => !v)}>import:{String(importing)}</button>
        <button onClick={() => setOwned("12 inch")}>owned</button><Consumer />
      </SetupTabCtx.Provider>;
    }
    const screen = render(<Fixture />);
    expect(renders).toBe(1);
    await act(async () => fireEvent.click(screen.getByText("dialog:false")));
    await act(async () => fireEvent.click(screen.getByText("import:false")));
    expect(renders).toBe(1);
    await act(async () => fireEvent.click(screen.getByText("owned")));
    expect(renders).toBe(2);
    expect(screen.container.querySelector("output")?.textContent).toBe("12 inch");
  });

  it("keeps Warehouse consumers flat for dialog/import updates and refreshes them for owned data", async () => {
    let renders = 0;
    const Consumer = memo(function Consumer() {
      const { activeWarehouseRows } = useWarehouseTabCtx();
      renders++;
      return <output>{activeWarehouseRows[0]?.label ?? "empty"}</output>;
    });
    function Fixture() {
      const [owned, setOwned] = useState("Flour");
      const [dialog, setDialog] = useState(false);
      const [importing, setImporting] = useState(false);
      const [pinError, setPinError] = useState("");
      const [pinInput, setPinInput] = useState("");
      const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
      const [scheduled, setScheduled] = useState([]);
      const [scheduleView, setScheduleView] = useState<"list" | "editor" | "advanced">("list");
      const [showPin, setShowPin] = useState(false);
      const [showSchedule, setShowSchedule] = useState(false);
      const toggle = useEvent((_runId: string, _rowKey: string) => {});
      const replace = useEvent(async () => {});
      const refresh = useEvent(async () => {});
      const value = useMemo<WarehouseTabContextValue>(() => ({
        activePackagingRows: [], activeRunNeedDetails: new Map(), activeRunValues: [], activeRuns: [],
        activeWarehouseRows: [{ label: owned, value: "1" }], cycleCountSchedules: [],
        dayState: { runs: [], currentIndex: 0 }, freezerPullPlan: [],
        freezerSurplus: { lots: [], allocations: [] }, freezerSurplusBusy: false, freezerSurplusError: null,
        freezerSurplusLoaded: true, isSupervisor: false, markCountedMutation: {} as WarehouseTabContextValue["markCountedMutation"],
        refreshFreezerSurplus: refresh, replaceRunSurplus: replace, runValuesById: new Map(),
        scheduledDays: scheduled, scheduledValues: [], setPinError, setPinInput,
        setScheduleDeleteConfirm: setDeleteConfirm, setScheduledDays: setScheduled, setScheduleView,
        setShowPinDialog: setShowPin, setShowScheduleDialog: setShowSchedule, todayScheduledValues: [],
        toggleStagedItem: toggle,
      }), [owned, refresh, replace, scheduled, toggle]);
      return <WarehouseTabCtx.Provider value={value}>
        <button onClick={() => setDialog((v) => !v)}>dialog:{String(dialog)}</button>
        <button onClick={() => setImporting((v) => !v)}>import:{String(importing)}</button>
        <button onClick={() => setOwned("Sugar")}>owned</button><Consumer />
      </WarehouseTabCtx.Provider>;
    }
    const screen = render(<Fixture />);
    expect(renders).toBe(1);
    await act(async () => fireEvent.click(screen.getByText("dialog:false")));
    await act(async () => fireEvent.click(screen.getByText("import:false")));
    expect(renders).toBe(1);
    await act(async () => fireEvent.click(screen.getByText("owned")));
    expect(renders).toBe(2);
    expect(screen.container.querySelector("output")?.textContent).toBe("Sugar");
  });
});