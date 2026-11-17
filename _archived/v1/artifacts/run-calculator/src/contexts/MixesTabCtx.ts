import { createContext, useContext } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { Mix } from "@workspace/mixes";
import type { DayState, FormValues, RunMeta } from "../types";
import type { ScheduledDay } from "../scheduledDays";

// ─── MixesTabCtx: narrow context for the Mix Plan tab panel ──────────────────
// MixesTabContent subscribes here instead of the full HomeCtx. Like
// HomeTabCtx/WarehouseTabCtx, this context memoizes on only non-dialog,
// non-manage, non-import deps, so the Mix Plan panel does NOT re-render when
// a manage dialog opens, merge state changes, or import progress ticks — only
// when mix-plan data actually changes (mixes, scheduled/live runs, make-day,
// surplus-adjusted effective values, optimistic "already made" updates).
/** Narrow provider contract. Individual station values are supplied by Home. */
export interface MixesTabContextValue {
  canManageInventory: boolean;
  currentRunId: string;
  dayState: DayState;
  effectiveValuesForRun: (run: RunMeta | undefined, values: FormValues) => FormValues;
  form: UseFormReturn<FormValues>;
  mixMakeDay: string;
  mixPlanItems: Mix[];
  mixes: Mix[];
  scheduledDays: ScheduledDay[];
  saveMixAlreadyMadeOptimistically: (nextMix: Mix) => void;
  acknowledgeMixAlreadyMadeSave: (optimisticMix: Mix, saved: Mix[]) => void;
  setMixMakeDay: Dispatch<SetStateAction<string>>;
}

export const MixesTabCtx = createContext<MixesTabContextValue | null>(null);

export function useMixesTabCtx(): MixesTabContextValue {
  const ctx = useContext(MixesTabCtx);
  if (!ctx) throw new Error("useMixesTabCtx must be used within MixesTabCtx.Provider");
  return ctx;
}
