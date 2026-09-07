import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import type { FreezerPullGroup, FreezerSurplusLedger } from "@workspace/freezer-pull";
import type { CycleCountSchedule } from "@workspace/cycle-count";
import type { DayState, FormValues, RunMeta } from "../types";
import type { ScheduledDay } from "../scheduledDays";
import type { WarehouseArea } from "../warehouseGrouping";
import type { computeSummaryStats } from "../utils";

// ─── WarehouseTabCtx: narrow context for the Warehouse tab panel ──────────────
// WarehouseTabContent subscribes here instead of the full HomeCtx. Like
// HomeTabCtx, this context memoizes on only non-dialog, non-manage, non-import
// deps, so the Warehouse panel does NOT re-render when a manage dialog opens,
// merge state changes, or import progress ticks — only when warehouse data
// actually changes (need rows, freezer surplus/pull plan, schedules, runs,
// cycle counts).
/** Warehouse requirement row computed in Home and consumed by the tab panel. */
export interface WarehouseTabNeedRow {
  label: string;
  value: string;
  sub?: string;
  area?: WarehouseArea;
}

/** Narrow provider contract. Individual station values are supplied by Home. */
export interface WarehouseTabContextValue {
  activePackagingRows: WarehouseTabNeedRow[];
  activeRunNeedDetails: Map<string, {
    summary: ReturnType<typeof computeSummaryStats>;
    rows: WarehouseTabNeedRow[];
  }>;
  activeRunValues: FormValues[];
  activeRuns: RunMeta[];
  activeWarehouseRows: WarehouseTabNeedRow[];
  cycleCountSchedules: CycleCountSchedule[];
  dayState: DayState;
  freezerPullPlan: FreezerPullGroup[];
  freezerSurplus: FreezerSurplusLedger;
  freezerSurplusBusy: boolean;
  freezerSurplusError: string | null;
  freezerSurplusLoaded: boolean;
  isSupervisor: boolean;
  markCountedMutation: UseMutationResult<CycleCountSchedule[], Error, string, unknown>;
  refreshFreezerSurplus: () => Promise<void>;
  replaceRunSurplus: (
    run: RunMeta,
    allocations: Array<{ lotId: string; cases: number }>,
  ) => Promise<void>;
  runValuesById: ReadonlyMap<string, FormValues>;
  scheduledDays: ScheduledDay[];
  scheduledValues: FormValues[];
  setPinError: Dispatch<SetStateAction<string>>;
  setPinInput: Dispatch<SetStateAction<string>>;
  setScheduleDeleteConfirm: Dispatch<SetStateAction<string | null>>;
  setScheduledDays: Dispatch<SetStateAction<ScheduledDay[]>>;
  setScheduleView: Dispatch<SetStateAction<"list" | "editor" | "advanced">>;
  setShowPinDialog: Dispatch<SetStateAction<boolean>>;
  setShowScheduleDialog: Dispatch<SetStateAction<boolean>>;
  todayScheduledValues: FormValues[];
  toggleStagedItem: (runId: string, rowKey: string) => void;
}

export const WarehouseTabCtx = createContext<WarehouseTabContextValue | null>(null);

export function useWarehouseTabCtx(): WarehouseTabContextValue {
  const ctx = useContext(WarehouseTabCtx);
  if (!ctx) throw new Error("useWarehouseTabCtx must be used within WarehouseTabCtx.Provider");
  return ctx;
}
