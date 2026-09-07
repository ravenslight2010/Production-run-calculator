import { createContext, useContext } from "react";
import type { CandidateItem } from "../inventoryShared";
import type {
  FormValues,
  IngredientSubstitution,
  SubstitutionLogEntry,
} from "../types";

// ─── InventoryTabCtx: narrow context for the Inventory tab panel ─────────────
// InventoryTabContent subscribes here instead of the full HomeCtx. Like
// HomeTabCtx/WarehouseTabCtx, this context memoizes on only non-dialog,
// non-manage, non-import deps, so the Inventory panel does NOT re-render when
// a manage dialog opens, merge state changes, or import progress ticks — only
// when inventory data actually changes (candidate/coverage rows, substitutions).
/** Narrow provider contract. Individual station values are supplied by Home. */
export interface InventoryTabContextValue {
  candidates: CandidateItem[];
  runValsList: FormValues[];
  coverageRunVals: FormValues[];
  substitutions: IngredientSubstitution[];
  substitutionLog: SubstitutionLogEntry[];
  substitutionOptions: string[];
  onAddSubstitution: (sub: IngredientSubstitution) => void;
  onRemoveSubstitution: (id: string) => void;
  onClearSubstitutions: () => void;
}

export const InventoryTabCtx = createContext<InventoryTabContextValue | null>(null);

export function useInventoryTabCtx(): InventoryTabContextValue {
  const ctx = useContext(InventoryTabCtx);
  if (!ctx) throw new Error("useInventoryTabCtx must be used within InventoryTabCtx.Provider");
  return ctx;
}
