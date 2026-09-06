import { createContext, useContext } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { FormValues, RunMeta } from "../types";
import type { RunSuggestion } from "../runInsights";

// ─── SetupTabCtx: narrow context for the Setup tab panel ─────────────────────
// SetupContent subscribes here instead of the full HomeCtx. Like
// HomeTabCtx/WarehouseTabCtx/InventoryTabCtx/MixesTabCtx, this context
// memoizes on only non-dialog, non-manage, non-import deps, so the Setup
// panel does NOT re-render when a manage dialog opens, merge state changes,
// or import progress ticks — only when setup-relevant data actually changes
// (form watch values, editable packaging lists, role/current-run fields).
/** Narrow provider contract. Individual station values are supplied by Home. */
export interface SetupTabContextValue {
  v: FormValues;
  form: UseFormReturn<FormValues>;
  circles: string[];
  shipper: string[];
  skidStacking: string[];
  gripSheets: string[];
  isManager: boolean;
  isSupervisor: boolean;
  currentRun: RunMeta | undefined;
  doughSubTab: "dough" | "crusts";
  commitMissingField: (key: string, value: string | number) => void;
  applyRunSuggestion: (suggestion: RunSuggestion) => Promise<string>;
  getRunSuggestionAcceptWarning: (suggestion: RunSuggestion) => string | null;
}

export const SetupTabCtx = createContext<SetupTabContextValue | null>(null);

export function useSetupTabCtx(): SetupTabContextValue {
  const ctx = useContext(SetupTabCtx);
  if (!ctx) throw new Error("useSetupTabCtx must be used within SetupTabCtx.Provider");
  return ctx;
}
