import { createContext, useContext } from "react";

// ─── WarehouseTabCtx: narrow context for the Warehouse tab panel ──────────────
// WarehouseTabContent subscribes here instead of the full HomeCtx. Like
// HomeTabCtx, this context memoizes on only non-dialog, non-manage, non-import
// deps, so the Warehouse panel does NOT re-render when a manage dialog opens,
// merge state changes, or import progress ticks — only when warehouse data
// actually changes (need rows, freezer surplus/pull plan, schedules, runs,
// cycle counts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WarehouseTabCtx = createContext<any>(null);

export function useWarehouseTabCtx(): any {
  const ctx = useContext(WarehouseTabCtx);
  if (!ctx) throw new Error("useWarehouseTabCtx must be used within WarehouseTabCtx.Provider");
  return ctx;
}
