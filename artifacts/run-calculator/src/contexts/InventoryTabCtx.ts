import { createContext, useContext } from "react";

// ─── InventoryTabCtx: narrow context for the Inventory tab panel ─────────────
// InventoryTabContent subscribes here instead of the full HomeCtx. Like
// HomeTabCtx/WarehouseTabCtx, this context memoizes on only non-dialog,
// non-manage, non-import deps, so the Inventory panel does NOT re-render when
// a manage dialog opens, merge state changes, or import progress ticks — only
// when inventory data actually changes (candidate/coverage rows, substitutions).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const InventoryTabCtx = createContext<any>(null);

export function useInventoryTabCtx(): any {
  const ctx = useContext(InventoryTabCtx);
  if (!ctx) throw new Error("useInventoryTabCtx must be used within InventoryTabCtx.Provider");
  return ctx;
}
